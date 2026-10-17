// Self-contained integration tests: a disposable local PostgreSQL cluster and API.
// No application DATABASE_URL, credentials, files, or database are reused.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import path from "node:path";

const root = new URL("../", import.meta.url).pathname;
const require = createRequire(import.meta.url);
const { Pool } = require(require.resolve("pg", { paths: [path.join(root, "lib/db")] }));
const directory = await mkdtemp(path.join(tmpdir(), "innova-cycle-test-"));
const pgdata = path.join(directory, "pgdata");
let api, pool, postgresStarted = false;
let apiOutput = "";
const freePort = async () => {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
};
function command(name, args, env = process.env) {
  const result = spawnSync(name, args, { cwd: root, env, encoding: "utf8", timeout: 90_000 });
  if (result.status !== 0) throw new Error(`${name} failed: ${result.stderr || result.error || result.stdout}`);
}
let stopping = false;
async function cleanup() {
  if (stopping) return;
  stopping = true;
  if (api && api.exitCode === null && api.signalCode === null) {
    api.kill("SIGTERM");
    await Promise.race([once(api, "exit"), new Promise(resolve => setTimeout(resolve, 3000))]);
    if (api.exitCode === null && api.signalCode === null) { api.kill("SIGKILL"); await once(api, "exit"); }
  }
  if (pool) await pool.end();
  if (postgresStarted) command("pg_ctl", ["-D", pgdata, "-m", "immediate", "-w", "stop"]);
  await rm(directory, { recursive: true, force: true });
}
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, async () => {
  await cleanup(); process.exit(130);
});

try {
  const pgPort = await freePort();
  const apiPort = await freePort();
  command("initdb", ["-D", pgdata, "-U", "cycle_test", "-A", "trust", "--no-locale", "--encoding=UTF8"]);
  command("pg_ctl", ["-D", pgdata, "-l", path.join(directory, "postgres.log"),
    "-o", `-h 127.0.0.1 -p ${pgPort} -k ${directory}`, "-w", "start"]);
  postgresStarted = true;
  const databaseUrl = `postgresql://cycle_test@127.0.0.1:${pgPort}/postgres`;
  const env = { ...process.env, DATABASE_URL: databaseUrl, SESSION_SECRET: randomBytes(48).toString("hex"),
    PORT: String(apiPort), NODE_ENV: "test", COOKIE_SECURE: "false", DATA_DIR: path.join(directory, "files"),
    RESEND_API_KEY: "", PASSWORD_RESET_EMAIL_ENABLED: "false", CLAMAV_HOST: "", CLAMAV_PORT: "" };
  command("pnpm", ["--filter", "@workspace/db", "run", "migrate"], env);
  pool = new Pool({ connectionString: databaseUrl });
  api = spawn(process.execPath, ["artifacts/api-server/dist/index.mjs"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  api.stdout.on("data", chunk => { apiOutput += chunk; });
  api.stderr.on("data", chunk => { apiOutput += chunk; });
  const base = `http://127.0.0.1:${apiPort}/api/v1`;
  async function request(url, { method = "GET", session, body, raw } = {}) {
    const headers = { "content-type": raw ? "application/octet-stream" : "application/json" };
    if (session) { headers.cookie = session.cookie; headers["x-csrf-token"] = session.csrf; }
    const response = await fetch(base + url, { method, headers,
      ...(raw ? { body: raw } : body ? { body: JSON.stringify(body) } : {}) });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: response.status, data, cookie: response.headers.get("set-cookie")?.split(";")[0] };
  }
  function status(result, expected) { assert.equal(result.status, expected, JSON.stringify(result.data)); return result.data; }
  for (let i = 0; i < 100; i++) {
    try { if ((await request("/health")).status === 200) break; } catch {}
    if (api.exitCode !== null) throw new Error(`Test API exited: ${apiOutput.slice(-3000)}`);
    if (i === 99) throw new Error("Test API did not start");
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const password = `Test-${randomUUID()}-Secure`;
  const initialized = await request("/setup/initialize", { method: "POST", body: {
    email: "admin@cycle.example.invalid", password, name: "Cycle admin",
    centerName: "Isolated course lifecycle", schoolYear: "2099-2100",
  } });
  status(initialized, 201);
  const admin = { cookie: initialized.cookie, csrf: initialized.data.csrfToken };
  const create = async (email, role, family = null) => {
    const account = status(await request("/users", { method: "POST", session: admin, body: {
      email, role, name: role, temporaryPassword: password, professionalFamily: family,
    } }), 201);
    const login = await request("/auth/login", { method: "POST", body: { email, password } });
    status(login, 200);
    return { account, session: { cookie: login.cookie, csrf: login.data.csrfToken } };
  };
  const families = status(await request("/catalogs/current", { session: admin }), 200).familias_profesionales;
  const family = families[0];
  const c2 = await create("c2@cycle.example.invalid", "c2_innovacion");
  const teacher = await create("teacher@cycle.example.invalid", "profesorado", family);
  const omitted = await create("omitted@cycle.example.invalid", "profesorado", family);
  const omittedC2 = await create("omitted-c2@cycle.example.invalid", "c2_innovacion");
  const years = () => request("/school-years", { session: admin });
  const old = status(await years(), 200)[0];
  const [{ center_id: center }] = (await pool.query("SELECT center_id FROM school_years WHERE id=$1", [old.id])).rows;
  const foreignCenter = (await pool.query("INSERT INTO centers(name) VALUES ('Other center') RETURNING id")).rows[0].id;
  const foreignYear = (await pool.query("INSERT INTO school_years(center_id,label) VALUES ($1,'2099-2100') RETURNING id", [foreignCenter])).rows[0].id;
  status(await request(`/school-years/${foreignYear}/validation`, { session: admin }), 404);
  status(await request("/school-years", { session: teacher.session }), 403);
  status(await request("/school-years"), 401);
  const plan = status(await request("/plans/current", { method: "POST", session: c2.session }), 201);
  const activity = (await pool.query(`INSERT INTO activities(center_id,school_year_id,title,description,professional_family,responsible_user_id,created_by,fingerprint)
    VALUES ($1,$2,'Old achievement','Historical description',$3,$4,$4,'test-fingerprint') RETURNING id`, [center, old.id, family, teacher.account.id])).rows[0].id;
  await pool.query("INSERT INTO activity_versions(activity_id,revision,content) VALUES ($1,1,'{}')", [activity]);
  const document = (await pool.query(`INSERT INTO documents(center_id,school_year_id,title,professional_family,created_by,status)
    VALUES ($1,$2,'Historical evidence',$3,$4,'aprobado') RETURNING id`, [center, old.id, family, c2.account.id])).rows[0].id;
  const version = (await pool.query(`INSERT INTO document_versions(document_id,version,original_name,media_type,size_bytes,sha256,storage_key,scan_status)
    VALUES ($1,1,'old.txt','text/plain',5,$2,'immutable/old-file','limpio') RETURNING id`, [document, "a".repeat(64)])).rows[0].id;
  const oldEvidence = (await pool.query("INSERT INTO evidences(document_version_id,captured_by) VALUES ($1,$2) RETURNING id",
    [version, c2.account.id])).rows[0].id;
  const oldEvidenceLink = (await pool.query("INSERT INTO evidence_links(evidence_id,linked_by) VALUES ($1,$2) RETURNING id",
    [oldEvidence, c2.account.id])).rows[0].id;
  const restrictedDocument = (await pool.query(`INSERT INTO documents(center_id,school_year_id,title,access_scope,created_by,status)
    VALUES ($1,$2,'Restricted historical document','restricted',$3,'aprobado') RETURNING id`,
    [center, old.id, c2.account.id])).rows[0].id;
  await pool.query(`INSERT INTO document_versions(document_id,version,original_name,media_type,size_bytes,sha256,storage_key,scan_status)
    VALUES ($1,1,'restricted.txt','text/plain',5,$2,'immutable/restricted','limpio')`, [restrictedDocument, "c".repeat(64)]);
  const otherFamilyDocument = (await pool.query(`INSERT INTO documents(center_id,school_year_id,title,professional_family,created_by,status)
    VALUES ($1,$2,'Other historical family',$3,$4,'aprobado') RETURNING id`, [center, old.id, families[1], c2.account.id])).rows[0].id;
  await pool.query(`INSERT INTO document_versions(document_id,version,original_name,media_type,size_bytes,sha256,storage_key,scan_status)
    VALUES ($1,1,'other.txt','text/plain',5,$2,'immutable/other-file','limpio')`, [otherFamilyDocument, "b".repeat(64)]);
  await pool.query(`INSERT INTO indicator_observations(plan_id,indicator_code,period,revision,value,method,formula,evidence_ids,assessment)
    VALUES ($1,'TEST-HISTORY','annual',1,'42','historical','manual','[]','validated')`, [plan.id]);
  await pool.query("UPDATE documents SET status='pendiente_revision' WHERE id=$1", [document]);
  const information = (await pool.query(`INSERT INTO information_requests
    (center_id,school_year_id,recipient_user_id,subject_type,subject_id,requested_fields,reason,request_key)
    VALUES ($1,$2,$3,'activity',$4,'[\"description\"]','Review needed','test-information') RETURNING id`,
    [center, old.id, teacher.account.id, activity])).rows[0].id;
  const validation = () => request(`/school-years/${old.id}/validation`, { session: c2.session });
  let check = status(await validation(), 200);
  assert.equal(check.canClose, false);
  assert.ok(check.blockers.some(b => b.includes("actuaciones")));
  assert.ok(check.blockers.some(b => b.includes("documentos")));
  assert.ok(check.blockers.some(b => b.includes("solicitudes")));
  const closeBody = () => ({ expectedRevision: check.revision, confirmation: old.label, reason: "Cierre del curso de prueba." });
  status(await request(`/school-years/${old.id}/close`, { method: "POST", session: c2.session, body: closeBody() }), 409);
  await pool.query("UPDATE activities SET status='validada' WHERE id=$1", [activity]);
  await pool.query("UPDATE documents SET status='aprobado' WHERE id=$1", [document]);
  await pool.query("UPDATE information_requests SET status='cerrada' WHERE id=$1", [information]);
  check = status(await validation(), 200);
  assert.equal(check.canClose, true);
  status(await request(`/school-years/${old.id}/close`, { method: "POST", session: { cookie: admin.cookie }, body: closeBody() }), 403);
  status(await request(`/school-years/${old.id}/close`, { method: "POST", session: admin,
    body: { ...closeBody(), confirmation: "wrong" } }), 409);
  // A writer commits after validation: the old expectedRevision must be rejected.
  await pool.query("UPDATE activities SET title='Final historical achievement' WHERE id=$1", [activity]);
  status(await request(`/school-years/${old.id}/close`, { method: "POST", session: admin, body: closeBody() }), 409);
  check = status(await validation(), 200);
  // Two simultaneous closes: exactly one succeeds and audit/snapshot are created once.
  const closes = await Promise.all([1, 2].map(() => request(`/school-years/${old.id}/close`,
    { method: "POST", session: c2.session, body: closeBody() })));
  assert.deepEqual(closes.map(c => c.status).sort(), [200, 409]);
  const closed = closes.find(c => c.status === 200).data;
  const historic = status(await request(`/school-years/${old.id}/history`, { session: c2.session }), 200);
  assert.equal(historic.label, old.label);
  assert.ok(historic.sources.some(s => s.source === "evidence_links" && s.id === oldEvidenceLink));
  assert.ok(historic.sources.some(s => s.source === "indicator_observations" && s.data.value === 42));
  assert.ok(historic.sources.some(s => s.source === "activities" && s.id === activity && s.data.title === "Final historical achievement"));
  assert.ok(!JSON.stringify(historic).includes("immutable/old-file"));
  assert.ok(!JSON.stringify(historic).includes("password_hash"));
  status(await request(`/school-years/${old.id}/history`, { session: teacher.session }), 403);
  status(await request(`/school-years/${foreignYear}/history`, { session: c2.session }), 404);
  const snapshotBefore = (await pool.query("SELECT content,source_hash FROM school_year_snapshots WHERE school_year_id=$1", [old.id])).rows[0];
  for (const [query, values] of [
    ["UPDATE activities SET title='tamper' WHERE id=$1", [activity]],
    ["DELETE FROM activity_versions WHERE activity_id=$1 RETURNING *", [activity]],
    ["UPDATE pic_plans SET content='{}' WHERE id=$1", [plan.id]],
    ["UPDATE documents SET title='tamper' WHERE id=$1", [document]],
    ["UPDATE document_versions SET storage_key='tamper' WHERE id=$1", [version]],
    ["UPDATE evidence_links SET note='tamper' WHERE id=$1", [oldEvidenceLink]],
    ["INSERT INTO evidence_links(evidence_id,linked_by) VALUES ($1,$2)", [oldEvidence, c2.account.id]],
    ["UPDATE indicator_observations SET value='100' WHERE plan_id=$1", [plan.id]],
    ["UPDATE school_year_snapshots SET content='{}' WHERE school_year_id=$1", [old.id]],
    ["DELETE FROM school_year_snapshots WHERE school_year_id=$1", [old.id]],
    ["UPDATE school_years SET active=true WHERE id=$1", [old.id]],
    ["DELETE FROM school_years WHERE id=$1", [old.id]],
  ]) {
    await assert.rejects(pool.query(query, values), /COURSE_/);
  }
  status(await request(`/plans/${plan.id}`, { method: "PUT", session: c2.session,
    body: { expectedRevision: plan.revision, content: plan.content } }), 409);
  const assignments = [
    { userId: c2.account.id, role: "c2_innovacion", professionalFamily: null },
    { userId: teacher.account.id, role: "profesorado", professionalFamily: family },
  ];
  const opening = { label: "2100-2101", previousYearId: old.id, expectedRevision: closed.revision, permissionsReviewed: true, assignments };
  status(await request("/school-years", { method: "POST", session: admin, body: { ...opening, permissionsReviewed: false } }), 400);
  status(await request("/school-years", { method: "POST", session: admin, body: { ...opening, assignments: [assignments[1]] } }), 409);
  status(await request("/school-years", { method: "POST", session: admin, body: { ...opening, label: "2100-2102" } }), 400);
  status(await request("/school-years", { method: "POST", session: admin, body: { ...opening, expectedRevision: 1 } }), 409);
  const openings = await Promise.all([1, 2].map(() => request("/school-years", { method: "POST", session: admin, body: opening })));
  assert.deepEqual(openings.map(o => o.status).sort(), [201, 409]);
  const next = openings.find(o => o.status === 201).data;
  assert.equal(next.label, "2100-2101");
  assert.equal(status(await years(), 200).filter(y => y.active).length, 1);
  for (const table of ["activities", "documents", "pic_plans", "information_requests"]) {
    assert.equal(Number((await pool.query(`SELECT count(*) AS n FROM ${table} WHERE school_year_id=$1`, [next.id])).rows[0].n), 0);
  }
  status(await request("/activities", { session: omitted.session }), 403);
  status(await request("/school-years", { session: omittedC2.session }), 403);
  // New C2 membership cannot grant access to a closed course that did not
  // include the account; promotion cannot elevate an earlier teacher's scope.
  const laterC2 = await create("later-c2@cycle.example.invalid", "c2_innovacion");
  await pool.query("UPDATE users SET role='c2_innovacion' WHERE id=$1", [omitted.account.id]);
  await pool.query(`INSERT INTO school_year_assignments(school_year_id,user_id,role,reviewed_by)
    VALUES ($1,$2,'c2_innovacion',$3)`, [next.id, omitted.account.id, c2.account.id]);
  for (const session of [laterC2.session, omitted.session]) {
    status(await request("/school-years", { session }), 200);
    status(await request(`/documents/${restrictedDocument}`, { session }), 404);
    status(await request(`/activities/${activity}`, { session }), 404);
    status(await request(`/school-years/${old.id}/history`, { session }), 403);
  }
  // Remove the temporary promotion to retain the staff-options omission check.
  await pool.query("UPDATE users SET role='profesorado' WHERE id=$1", [omitted.account.id]);
  await pool.query("DELETE FROM school_year_assignments WHERE school_year_id=$1 AND user_id=$2", [next.id, omitted.account.id]);
  status(await request("/activities", { session: teacher.session }), 200);
  // Technical administration keeps its existing center-wide operational access
  // even when only the explicitly selected staff are annual assignees.
  status(await request("/activities", { session: admin }), 200);
  status(await request(`/documents/${document}`, { session: teacher.session }), 200);
  status(await request("/users/" + teacher.account.id + "/family", { method: "POST", session: admin, body: {
    expectedFamily: family, professionalFamily: families[1],
  } }), 200);
  // A later family assignment must not unlock that family's earlier documents.
  status(await request(`/documents/${otherFamilyDocument}`, { session: teacher.session }), 404);
  status(await request(`/documents/${document}`, { session: teacher.session }), 200);
  const options = status(await request("/staff/options", { session: c2.session }), 200);
  assert.ok(!options.some(u => u.id === omitted.account.id));
  assert.ok(options.some(u => u.id === teacher.account.id));
  status(await request("/plans/current", { session: c2.session }), 404);
  const newPlan = status(await request("/plans/current", { method: "POST", session: c2.session }), 201);
  assert.deepEqual(newPlan.content.selectedActions, []);
  assert.equal(Number((await pool.query("SELECT count(*) AS n FROM indicator_observations WHERE plan_id=$1", [newPlan.id])).rows[0].n), 0);
  // Seed a clean active-course upload: re-upload must reuse it and create an
  // evidence-only link, without requiring antivirus or a linked activity.
  const duplicateBytes = Buffer.from("Unlinked duplicate course evidence\n");
  const duplicateDocument = (await pool.query(`INSERT INTO documents
    (center_id,school_year_id,title,access_scope,created_by,status)
    VALUES ($1,$2,'Unlinked duplicate','restricted',$3,'aprobado') RETURNING id`,
    [center, next.id, c2.account.id])).rows[0].id;
  const duplicateVersion = (await pool.query(`INSERT INTO document_versions
    (document_id,version,original_name,media_type,size_bytes,sha256,storage_key,scan_status)
    VALUES ($1,1,'duplicate.txt','text/plain',$2,$3,'isolated/duplicate','limpio') RETURNING id`,
    [duplicateDocument, duplicateBytes.length, createHash("sha256").update(duplicateBytes).digest("hex")])).rows[0].id;
  const duplicateEvidence = (await pool.query("INSERT INTO evidences(document_version_id,captured_by) VALUES ($1,$2) RETURNING id",
    [duplicateVersion, c2.account.id])).rows[0].id;
  for (let repeat = 0; repeat < 2; repeat++) {
    const duplicateUpload = status(await request("/documents?" + new URLSearchParams({
      title: "Unlinked duplicate", category: "evidencia", accessScope: "restricted", fileName: "duplicate.txt",
    }), { method: "POST", session: c2.session, raw: duplicateBytes }), 201);
    assert.equal(duplicateUpload.id, duplicateDocument);
  }
  assert.equal(Number((await pool.query("SELECT count(*) AS n FROM evidence_links WHERE evidence_id=$1 AND activity_id IS NULL AND plan_id IS NULL",
    [duplicateEvidence])).rows[0].n), 1);
  // Exercise existing write/confirm/validate and information flows after the
  // identity transition, not only SQL fixtures and empty collection reads.
  const freshActivity = status(await request("/activities", { method: "POST", session: teacher.session, body: {
    title: "New course activity", description: "New work without inherited results",
    professionalFamily: families[1], responsibleUserId: teacher.account.id,
    indicatorCodes: [], activityDate: null, sourceLabel: "Course isolation test",
  } }), 201).activity;
  const freshRequest = status(await request("/information-requests", { method: "POST", session: c2.session, body: {
    recipientUserId: teacher.account.id, subjectType: "activity", subjectId: freshActivity.id,
    requestedFields: ["activityDate"], reason: "Completar la fecha antes de confirmar",
  } }), 201);
  const answered = status(await request(`/information-requests/${freshRequest.id}/respond`, {
    method: "POST", session: teacher.session, body: {
      expectedRevision: freshRequest.revision, responseStatus: "respondida", answers: { activityDate: "2100-10-01" },
    },
  }), 201);
  status(await request(`/information-requests/${freshRequest.id}/validate`, {
    method: "POST", session: c2.session, body: { expectedRevision: answered.revision },
  }), 200);
  const freshRead = status(await request(`/activities/${freshActivity.id}`, { session: teacher.session }), 200);
  const freshUpdated = status(await request(`/activities/${freshActivity.id}`, {
    method: "PATCH", session: teacher.session, body: {
      expectedRevision: freshRead.revision, title: "New course reviewed activity", activityDate: "2100-10-01",
    },
  }), 200);
  const freshConfirmed = status(await request(`/activities/${freshActivity.id}/confirm`, {
    method: "POST", session: teacher.session, body: { expectedRevision: freshUpdated.revision, informationStatus: "confirmada" },
  }), 200);
  const freshValidated = status(await request(`/activities/${freshActivity.id}/validate`, {
    method: "POST", session: c2.session, body: { expectedRevision: freshConfirmed.revision },
  }), 200);
  assert.equal(freshValidated.status, "validada");
  // Cross-year evidence/project links cannot import an old value into the new course.
  await assert.rejects(pool.query(`INSERT INTO activity_indicator_links(activity_id,plan_id,action_code,indicator_code)
    VALUES ($1,$2,'TEST','TEST-HISTORY')`, [activity, newPlan.id]), /COURSE_SCOPE_CONFLICT/);
  // Closed writes racing a held close lock must recheck after waiting, not use stale state.
  const blocker = await pool.connect();
  const writer = await pool.connect();
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM school_years WHERE id=$1 FOR UPDATE", [old.id]);
    const blockedWrite = writer.query("UPDATE documents SET title='racing' WHERE id=$1", [document]);
    const rejected = assert.rejects(blockedWrite, /COURSE_CLOSED/);
    await blocker.query("COMMIT");
    await rejected;
  } finally { blocker.release(); writer.release(); }
  assert.deepEqual((await pool.query("SELECT content,source_hash FROM school_year_snapshots WHERE school_year_id=$1", [old.id])).rows[0], snapshotBefore);
  const historicAfter = status(await request(`/school-years/${old.id}/history`, { session: admin }), 200);
  assert.deepEqual(historicAfter.sources, historic.sources);
  assert.equal(historicAfter.sourceHash, historic.sourceHash);
  const audit = (await pool.query("SELECT action,count(*) AS n FROM audit_logs WHERE action LIKE 'school_year.%' GROUP BY action")).rows;
  assert.equal(Number(audit.find(a => a.action === "school_year.closed").n), 1);
  assert.equal(Number(audit.find(a => a.action === "school_year.opened").n), 1);
  assert.ok(Number(audit.find(a => a.action === "school_year.history.read").n) >= 2);
  console.log("PASS: isolated two-course lifecycle, RBAC/CSRF, pending/stale validation, concurrent close/open, immutable PIC/documents/indicators, source attribution, annual assignments and audit.");
} catch (error) {
  console.error(apiOutput.slice(-10000));
  throw error;
} finally {
  await cleanup();
}
