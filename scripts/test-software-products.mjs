import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Runs only inside test-spaces' freshly provisioned private cluster, never against an application URL.
export async function testSoftwareProducts({ request, status, pool, admin, teacher, reader, adminId, browser }) {
  let assertions = 0;
  const check = (condition, message) => { assert.ok(condition, message); assertions++; };
  const overview = () => request("/software-products", admin).then(r => status(r, 200));
  status(await request("/software-products"), 401);
  check((await overview()).catalog === null, "No implicit initialization");
  status(await request("/software-products/initialize", teacher, "POST"), 403);
  status(await request("/software-products/initialize", admin, "POST", {}, false), 403);
  const initial = status(await request("/software-products/initialize", admin, "POST"), 201);
  check(initial.products.length === 3, "Three independent named products");
  check(initial.products.every(p => p.status === "idea" && !p.results && !p.approvalConfirmed && !p.securityReviewed), "No invented achievement");
  status(await request("/software-products/initialize", admin, "POST"), 409);
  const yearId = initial.schoolYearId;
  const centerId = (await pool.query("SELECT center_id FROM school_years WHERE id=$1", [yearId])).rows[0].center_id;
  let innova = initial.products.find(p => p.productKey === "innova-c2");
  const read = id => request(`/software-products/${id}`, admin).then(r => status(r, 200));
  let detail = await read(innova.id);
  check(detail.records.some(r => r.source === "installed_manifest" && r.version === "0.5.1"), "Real technical delivery self-registration");
  check(detail.product.status === "idea", "A technical delivery is not implantation");
  const count = detail.records.length;
  const synced = status(await request("/software-products/sync-deliveries", admin, "POST"), 200);
  check(synced.inserted === 0 && (await read(innova.id)).records.length === count, "Idempotent self-registration");
  status(await request("/software-products/sync-deliveries", teacher, "POST"), 403);
  const input = p => Object.fromEntries(Object.entries(p).filter(([k]) =>
    !["id", "revision", "productKey", "responsibleName", "evidence", "evidenceIssues"].includes(k)));
  let body = { ...input(detail.product), purpose: "Gestión verificable del PIC", responsibleUserId: adminId,
    status: "desarrollo", startedOn: "2026-10-01", currentVersion: "0.5.1", repositoryUrl: "https://github.com/atreyu1968/InnovaC2.git" };
  status(await request(`/software-products/${innova.id}`, teacher, "PUT", body), 403);
  status(await request(`/software-products/${innova.id}`, admin, "PUT", body, false), 403);
  innova = status(await request(`/software-products/${innova.id}`, admin, "PUT", body), 200);
  check(innova.startedOn === "2026-10-01", "Date-only value stays date-only");
  status(await request(`/software-products/${innova.id}`, admin, "PUT", body), 409);
  body = input(innova);
  status(await request(`/software-products/${innova.id}`, admin, "PUT", { ...body, repositoryUrl: "javascript:alert(1)" }), 400);
  status(await request(`/software-products/${innova.id}`, admin, "PUT", { ...body, repositoryUrl: "https://secret@example.invalid/repo" }), 400);
  status(await request(`/software-products/${innova.id}`, admin, "PUT", { ...body, repositoryUrl: "https://example.invalid/repo?token=do-not-store" }), 400);
  status(await request(`/software-products/${innova.id}`, admin, "PUT", { ...body, responsibleUserId: randomUUID() }), 400);
  status(await request(`/software-products/${innova.id}`, admin, "PUT", { ...body, startedOn: "2099-01-01" }), 400);
  for (const startedOn of ["2026-02-30", "2026-10-01T00:00:00Z", 0]) {
    status(await request(`/software-products/${innova.id}`, admin, "PUT", { ...body, startedOn }), 400);
  }
  for (const claim of [
    { status: "piloto", implementationCenter: "Centro de prueba", implementationDate: "2026-10-10" },
    { status: "implantado", implementationCenter: "Centro de prueba", implementationDate: "2026-10-10" },
    { status: "mantenimiento", implementationCenter: "Centro de prueba", implementationDate: "2026-10-10" },
    { results: "Resultado que no puede declararse sin documento", resultsConfirmedOn: "2026-10-10" },
    { approvalConfirmed: true, approvalDate: "2026-10-10" },
    { securityReviewed: true, securityDate: "2026-10-10" },
  ]) status(await request(`/software-products/${innova.id}`, admin, "PUT", { ...body, ...claim }), 400);
  async function document(title, scope = "center", scan = "limpio") {
    const doc = (await pool.query(`INSERT INTO documents(center_id,school_year_id,title,status,access_scope,created_by)
      VALUES($1,$2,$3,'aprobado',$4,$5) RETURNING id`, [centerId, yearId, title, scope, adminId])).rows[0];
    const v = (await pool.query(`INSERT INTO document_versions(document_id,version,original_name,media_type,size_bytes,sha256,storage_key,scan_status)
      VALUES($1,1,'fixture.pdf','application/pdf',12,$2,$3,$4) RETURNING id`,
      [doc.id, randomUUID().replaceAll("-", "").padEnd(64, "0"), `fixture/${randomUUID()}`, scan])).rows[0];
    return { documentId: doc.id, versionId: v.id };
  }
  const evidence = await document("Acta confirmada: prueba documental ficticia");
  const privateDoc = await document("Privado", "private");
  const infected = await document("Cuarentena", "center", "infectado");
  const options = (await overview()).evidenceOptions;
  check(options.some(e => e.versionId === evidence.versionId), "Approved clean shared document selectable");
  check(!options.some(e => [privateDoc.versionId, infected.versionId].includes(e.versionId)), "Private/infected not selectable");
  for (const versionId of [privateDoc.versionId, infected.versionId, randomUUID()]) {
    status(await request(`/software-products/${innova.id}`, admin, "PUT", { ...body, evidenceVersionIds: [versionId] }), 400);
  }
  status(await request(`/software-products/${innova.id}`, admin, "PUT", { ...body, status: "implantado",
    implementationCenter: "Centro ficticio", evidenceVersionIds: [evidence.versionId], implementationDate: null }), 400);
  innova = status(await request(`/software-products/${innova.id}`, admin, "PUT", { ...body, status: "piloto",
    implementationCenter: "Centro ficticio, no implantación real", implementationDate: "2026-10-10", evidenceVersionIds: [evidence.versionId] }), 200);
  check(innova.evidence[0].sha256.length === 64 && innova.evidence[0].versionNumber === 1, "Pinned source checksum/version");
  // Pinning never selects a PIC project or creates an activity.
  check(Number((await pool.query("SELECT count(*) FROM activities WHERE school_year_id=$1", [yearId])).rows[0].count) === 0, "No invented activity");
  const record = { expectedRevision: innova.revision, kind: "prueba", title: "Prueba funcional declarada", version: "0.5.1",
    occurredOn: "2026-10-10", details: "Comprobación manual ficticia, no certificado de seguridad", outcome: "superada",
    evidenceVersionIds: [evidence.versionId], supersedesId: null };
  status(await request(`/software-products/${innova.id}/records`, reader, "POST", record), 403);
  status(await request(`/software-products/${innova.id}/records`, admin, "POST", { ...record, kind: "manual", evidenceVersionIds: [] }), 400);
  status(await request(`/software-products/${innova.id}/records`, admin, "POST", { ...record, occurredOn: "2099-01-01" }), 400);
  detail = status(await request(`/software-products/${innova.id}/records`, admin, "POST", record), 201);
  const firstRecord = detail.records.find(r => r.source === "manual");
  status(await request(`/software-products/${innova.id}/records`, admin, "POST", record), 409);
  detail = status(await request(`/software-products/${innova.id}/records`, admin, "POST", { ...record,
    expectedRevision: detail.product.revision, supersedesId: firstRecord.id, title: "Rectificación justificada", details: "Se corrige el alcance del dato anterior, que sigue en el historial." }), 201);
  check(detail.records.some(r => r.id === firstRecord.id) && detail.records.some(r => r.supersedesId === firstRecord.id), "Corrections do not erase history");
  status(await request(`/software-products/${innova.id}/records`, admin, "POST", { ...record,
    expectedRevision: detail.product.revision, supersedesId: firstRecord.id }), 409);
  await assert.rejects(pool.query("UPDATE software_records SET kind='hito' WHERE id=$1", [firstRecord.id]), /SOFTWARE_HISTORY_IMMUTABLE/); assertions++;
  await assert.rejects(pool.query("DELETE FROM software_versions WHERE entity_id=$1", [innova.id]), /SOFTWARE_HISTORY_IMMUTABLE/); assertions++;
  const concurrent = { ...input(detail.product), purpose: "Actualización concurrente" };
  const attempts = await Promise.all([request(`/software-products/${innova.id}`, admin, "PUT", concurrent), request(`/software-products/${innova.id}`, admin, "PUT", concurrent)]);
  check(attempts.map(r => r.status).sort().join() === "200,409", "Concurrent revision CAS");
  await pool.query("UPDATE documents SET access_scope='private' WHERE id=$1", [evidence.documentId]);
  const withdrawn = await read(innova.id);
  check(withdrawn.product.evidenceIssues.length > 0 && withdrawn.product.evidence[0].title === "Evidencia no disponible", "Withdrawn evidence is warned and title redacted");
  check(!JSON.stringify(withdrawn.history).includes("Acta confirmada: prueba"), "No withdrawn title leaked by history");
  // Restore the synthetic proof for the browser fixture; no physical file download is attempted.
  await pool.query("UPDATE documents SET access_scope='center' WHERE id=$1", [evidence.documentId]);
  status(await request("/software-products/bad-id", admin), 400);
  status(await request(`/software-products/${randomUUID()}`, admin), 404);
  const newBody = { ...input((await read(innova.id)).product), name: "Producto nuevo ficticio", expectedRevision: 0,
    status: "idea", evidenceVersionIds: [], implementationCenter: "", implementationDate: null, results: "" };
  const created = status(await request("/software-products", admin, "POST", newBody), 201);
  status(await request("/software-products", admin, "POST", { ...newBody, name: newBody.name.toUpperCase() }), 409);
  check(created.productKey === null, "No canonical product key supplied by client");
  const catalog = (await overview()).catalog;
  status(await request("/software-products/catalog", admin, "PUT", { description: "Proyecto transversal, no una implantación", expectedRevision: catalog.revision, picProjectId: randomUUID() }), 400);
  status(await request("/software-products/catalog", admin, "PUT", { description: "Proyecto transversal, sin seleccionar proyectos PIC automáticamente", expectedRevision: catalog.revision, picProjectId: null }), 200);
  status(await request("/software-products/catalog", admin, "PUT", { description: "stale", expectedRevision: catalog.revision, picProjectId: null }), 409);
  status(await request("/software-products", reader), 200);
  if (browser) return { productId: innova.id, evidenceVersionId: evidence.versionId };
  const validation = status(await request(`/school-years/${yearId}/validation`, admin), 200);
  status(await request(`/school-years/${yearId}/close`, admin, "POST", {
    expectedRevision: validation.revision, confirmation: "2026-2027", reason: "Archivo de pruebas del catálogo",
  }), 200);
  const snapshot = (await pool.query("SELECT content FROM school_year_snapshots WHERE school_year_id=$1", [yearId])).rows[0].content;
  check(["software_catalogs", "software_products", "software_records", "software_versions"].every(name => JSON.stringify(snapshot).includes(name)), "All product sources archived");
  await assert.rejects(pool.query("UPDATE software_products SET name='late' WHERE id=$1", [innova.id]), /COURSE_CLOSED/); assertions++;
  await pool.query("INSERT INTO school_years(center_id,label,active) VALUES($1,'2027-2028',true)", [centerId]);
  const next = await overview();
  check(next.catalog === null && !next.products.length, "No automatic carryover of results across courses");
  status(await request(`/software-products/${innova.id}`, admin), 404);
  status(await request(`/software-products/${innova.id}/records`, admin, "POST", record), 404);
  console.log(`Catálogo de productos: ${assertions} verificaciones semánticas más respuestas HTTP/RBAC/CSRF comprobadas; base aislada.`);
  return null;
}
