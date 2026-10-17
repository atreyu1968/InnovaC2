// Isolated end-to-end checks for PIC follow-ups, snapshots, exports and delivery receipts.
// A fresh local PostgreSQL cluster is created; application and configured test databases are never reused.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import path from "node:path";

const root = new URL("../", import.meta.url).pathname;
const require = createRequire(import.meta.url);
const { Pool } = require(require.resolve("pg", { paths: [path.join(root, "lib/db")] }));
const isolatedEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !key.startsWith("PG") && !["DATABASE_URL", "TEST_DATABASE_URL", "SESSION_SECRET", "DATA_DIR", "PORT"].includes(key)));
const directory = await mkdtemp(path.join(tmpdir(), "innova-followups-test-"));
const pgdata = path.join(directory, "pgdata");
let api;
let pool;
let postgresStarted = false;
let apiOutput = "";

function command(name, args, env = isolatedEnv) {
  const result = spawnSync(name, args, { cwd: root, env, encoding: "utf8", timeout: 90_000 });
  if (result.status !== 0) throw new Error(`${name} failed: ${result.stderr || result.error || result.stdout}`);
}

async function freePort() {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function cleanup() {
  if (api && api.exitCode === null && api.signalCode === null) {
    api.kill("SIGTERM");
    await Promise.race([once(api, "exit"), new Promise((resolve) => setTimeout(resolve, 3000))]);
    if (api.exitCode === null && api.signalCode === null) {
      api.kill("SIGKILL");
      await once(api, "exit");
    }
  }
  if (pool) await pool.end();
  if (postgresStarted) command("pg_ctl", ["-D", pgdata, "-m", "immediate", "-w", "stop"]);
  await rm(directory, { recursive: true, force: true });
}

for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, async () => {
  await cleanup();
  process.exit(130);
});

try {
  const pgPort = await freePort();
  const apiPort = await freePort();
  command("initdb", ["-D", pgdata, "-U", "followup_test", "-A", "trust", "--no-locale", "--encoding=UTF8"]);
  command("pg_ctl", ["-D", pgdata, "-l", path.join(directory, "postgres.log"),
    "-o", `-h 127.0.0.1 -p ${pgPort} -k ${directory}`, "-w", "start"]);
  postgresStarted = true;
  const databaseUrl = `postgresql://followup_test@127.0.0.1:${pgPort}/postgres`;
  const env = {
    ...isolatedEnv,
    DATABASE_URL: databaseUrl,
    SESSION_SECRET: randomBytes(48).toString("hex"),
    PORT: String(apiPort),
    NODE_ENV: "test",
    COOKIE_SECURE: "false",
    DATA_DIR: path.join(directory, "files"),
    RESEND_API_KEY: "",
    PASSWORD_RESET_EMAIL_ENABLED: "false",
    CLAMAV_HOST: "",
    CLAMAV_PORT: "",
  };
  command("pnpm", ["--filter", "@workspace/db", "run", "migrate"], env);
  pool = new Pool({ connectionString: databaseUrl });
  api = spawn(process.execPath, ["artifacts/api-server/dist/index.mjs"], {
    cwd: root, env, stdio: ["ignore", "pipe", "pipe"],
  });
  api.stdout.on("data", (chunk) => { apiOutput += chunk.toString(); });
  api.stderr.on("data", (chunk) => { apiOutput += chunk.toString(); });
  const base = `http://127.0.0.1:${apiPort}/api/v1`;

  async function request(route, { method = "GET", session, body } = {}) {
    const headers = { "content-type": "application/json" };
    if (session) {
      headers.cookie = session.cookie;
      headers["x-csrf-token"] = session.csrf;
    }
    const response = await fetch(base + route, {
      method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (response.status >= 500) await new Promise((resolve) => setTimeout(resolve, 150));
    return { status: response.status, data, headers: response.headers, response };
  }
  const expect = (result, code) => {
    assert.equal(result.status, code, `${result.status}: ${JSON.stringify(result.data)}`);
    return result.data;
  };
  for (let i = 0; i < 100; i += 1) {
    try {
      if ((await request("/health")).status === 200) break;
    } catch {}
    if (api.exitCode !== null) throw new Error(`API exited: ${apiOutput.slice(-4000)}`);
    if (i === 99) throw new Error("API did not become healthy");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const password = `Test-${randomUUID()}-Secure`;
  const initializeResponse = await request("/setup/initialize", {
    method: "POST",
    body: { email: "followup-admin@example.invalid", password, name: "Administración de prueba", centerName: "Centro aislado PIC", schoolYear: "2099-2100" },
  });
  const initialized = expect(initializeResponse, 201);
  const admin = { cookie: initializeResponse.headers.get("set-cookie").split(";")[0], csrf: initialized.csrfToken };
  async function createAccount(email, role) {
    expect(await request("/users", {
      method: "POST", session: admin,
      body: { email, name: email, role, temporaryPassword: password, professionalFamily: null },
    }), 201);
    const response = await request("/auth/login", { method: "POST", body: { email, password } });
    expect(response, 200);
    return { cookie: response.headers.get("set-cookie").split(";")[0], csrf: response.data.csrfToken, user: response.data.user };
  }
  const c2 = await createAccount("followup-c2@example.invalid", "c2_innovacion");
  const director = await createAccount("followup-director@example.invalid", "equipo_directivo");
  const plan = expect(await request("/plans/current", { method: "POST", session: c2 }), 201);
  const { rows: [year] } = await pool.query("SELECT id,center_id FROM school_years WHERE active");
  const { rows: [c2User] } = await pool.query("SELECT id FROM users WHERE email='followup-c2@example.invalid'");

  const fakeAction = [{
    title: "Acción propia de seguimiento",
    objectiveCode: "OBJ-PRUEBA",
    indicatorLabel: "Revisión manual",
    unit: "registro",
    targetValue: 1,
    riskValue: 0,
  }];
  await pool.query("UPDATE pic_plans SET content=jsonb_set(content,'{customActions}',$1::jsonb,true) WHERE id=$2",
    [JSON.stringify(fakeAction), plan.id]);

  const activity = (await pool.query(`INSERT INTO activities
    (center_id,school_year_id,title,description,professional_family,responsible_user_id,created_by,
     fingerprint,status,information_status,confirmed_by,confirmed_at,validated_by,validated_at)
    VALUES ($1,$2,'Actuación validada de prueba','Trabajo verificado en el curso','General',$3,$3,
      'followup-test-activity','validada','confirmada',$3,now(),$3,now()) RETURNING id`,
  [year.center_id, year.id, c2User.id])).rows[0].id;

  async function document(title, accessScope = "center") {
    const id = (await pool.query(`INSERT INTO documents
      (center_id,school_year_id,title,access_scope,status,created_by)
      VALUES ($1,$2,$3,$4,'aprobado',$5) RETURNING id`,
    [year.center_id, year.id, title, accessScope, c2User.id])).rows[0].id;
    const bytes = Buffer.from(`fixture:${title}`);
    const sha256 = (await import("node:crypto")).createHash("sha256").update(bytes).digest("hex");
    const version = (await pool.query(`INSERT INTO document_versions
      (document_id,version,original_name,media_type,size_bytes,sha256,storage_key,scan_status)
      VALUES ($1,1,$2,'text/plain',$3,$4,$5,'limpio') RETURNING id`,
    [id, `${title}.txt`, bytes.length, sha256, `isolated/${randomUUID()}`])).rows[0].id;
    return { id, version, sha256, fileName: `${title}.txt` };
  }
  const proof = await document("Justificante Laycos");
  const restricted = await document("Justificante restringido", "restricted");
  const evidence = (await pool.query(`INSERT INTO evidences(document_version_id,description,captured_by,status)
    VALUES ($1,'Evidencia documentada de prueba',$2,'validada') RETURNING id`, [proof.version, c2User.id])).rows[0].id;

  const agenda = (await pool.query(`INSERT INTO ciclope_meetings
    (center_id,school_year_id,kind,title,starts_at,ends_at,state,content,created_by)
    VALUES ($1,$2,'red_c1','Agenda trimestral de C1',now(),now(),'programada','{"data":{}}',$3) RETURNING id`,
  [year.center_id, year.id, c2User.id])).rows[0].id;
  const acta = (await pool.query(`INSERT INTO ciclope_meetings
    (center_id,school_year_id,kind,title,starts_at,ends_at,state,content,created_by)
    VALUES ($1,$2,'ciclope','Acta de acuerdos validada',now(),now(),'acta_validada','{"data":{}}',$3) RETURNING id`,
  [year.center_id, year.id, c2User.id])).rows[0].id;
  const actaVersion = (await pool.query(`INSERT INTO ciclope_versions
    (school_year_id,meeting_id,revision,content,created_by)
    VALUES ($1,$2,1,'{"data":{}}',$3) RETURNING id`, [year.id, acta, c2User.id])).rows[0].id;
  const agreement = (await pool.query(`INSERT INTO ciclope_tasks
    (school_year_id,meeting_id,source_version_id,title,responsible_user_id,due_date,completed_at)
    VALUES ($1,$2,$3,'Acuerdo con tarea completada', $4,'2099-12-31',now()) RETURNING id`,
  [year.id, acta, actaVersion, c2User.id])).rows[0].id;
  const unvalidatedActa = (await pool.query(`INSERT INTO ciclope_meetings
    (center_id,school_year_id,kind,title,starts_at,ends_at,state,content,created_by)
    VALUES ($1,$2,'ciclope','Acta aún no validada',now(),now(),'acta_borrador','{"data":{}}',$3) RETURNING id`,
  [year.center_id, year.id, c2User.id])).rows[0].id;
  const observation = (await pool.query(`INSERT INTO indicator_observations
    (plan_id,indicator_code,period,revision,value,method,formula,evidence_ids,source_activity_count,assessment,created_by,validated_by)
    VALUES ($1,'IND-PRUEBA','trimestre-1',1,'1','manual','conteo explícito','[]',1,'logrado',$2,$2) RETURNING id`,
  [plan.id, c2User.id])).rows[0].id;

  const workspacePath = `/plans/${plan.id}/followups`;
  const workspace = expect(await request(workspacePath, { session: c2 }), 200);
  assert.deepEqual(workspace.selectedActions.map((item) => item.code), ["custom-1"]);
  assert.ok(workspace.sources.some((item) => item.type === "actuacion" && item.id === activity));
  assert.ok(workspace.sources.some((item) => item.type === "evidencia" && item.id === evidence));
  assert.ok(workspace.sources.some((item) => item.type === "agenda_c1" && item.id === agenda && item.notice.includes("No acredita asistencia")));
  assert.ok(workspace.sources.some((item) => item.type === "acta_ciclope" && item.id === acta));
  assert.ok(workspace.sources.some((item) => item.type === "acuerdo" && item.id === agreement));
  assert.ok(workspace.sources.some((item) => item.type === "indicador" && item.id === observation));
  assert.ok(!workspace.sources.some((item) => item.id === unvalidatedActa));
  assert.ok(!workspace.annexDocuments.some((item) => item.id === restricted.id));
  expect(await request(workspacePath, { session: director }), 403);
  expect(await request(workspacePath), 401);
  expect(await request(`/plans/${randomUUID()}/followups`, { session: c2 }), 404);

  const check = (status = "sin_verificar", sourceIds = []) => ({ status, observation: "", sourceIds });
  const baseContent = (type) => ({
    actions: [{ actionCode: "custom-1", status: "en_curso", note: "Seguimiento manual del periodo." }],
    activitiesNarrative: `Relato manual de ${type}.`,
    incidents: "Sin incidencias registradas.",
    adjustments: "Sin ajustes.",
    transferredDate: type === "tercer_trimestre" ? "2100-05-20" : null,
    positiveAspects: "Aspectos positivos consignados manualmente.",
    difficulties: "Dificultades consignadas manualmente.",
    unmetObjectivesExplanation: "Explicación manual; no se calcula el logro.",
    improvements: "Propuesta de mejora para el curso siguiente.",
    centerMemoryDate: "2100-06-10",
    sources: [{ type: "actuacion", id: activity, note: "Actuación revisada." }],
    annexes: [{ documentId: proof.id, title: "Justificante del centro", description: "Documento aprobado del curso." }],
    certification: {
      c1Attendance85: check("confirmado_por_persona", [agenda]),
      planPresented: check("confirmado_por_persona", [acta]),
      quarterlyReportsOnTime: check("confirmado_por_persona", [agreement]),
      finalMemoryOnTime: check("confirmado_por_persona"),
      certificationRequested: check("confirmado_por_persona"),
      personConfirmedAttendanceSummary: "Revisión personal de registros; no inferida de la agenda.",
    },
  });
  const reportTypes = ["primer_trimestre", "segundo_trimestre", "tercer_trimestre", "memoria_final", "justificacion"];
  const savedReports = new Map();
  const snapshots = new Map();
  for (const type of reportTypes) {
    const content = baseContent(type);
    if (type === "justificacion") content.sources = [];
    const reportPath = `${workspacePath}/${type}`;
    const untrusted = structuredClone(content);
    untrusted.sources = [{ type: "actuacion", id: randomUUID(), note: "Fuente inventada." }];
    expect(await request(reportPath, { method: "PUT", session: c2, body: { expectedRevision: 0, content: untrusted } }), 422);
    const saved = expect(await request(reportPath, {
      method: "PUT", session: c2, body: { expectedRevision: 0, content },
    }), type === "justificacion" ? 200 : 200);
    savedReports.set(type, saved);
    const frozen = expect(await request(`${reportPath}/snapshots`, {
      method: "POST", session: c2, body: { expectedRevision: saved.revision, reason: `Revisión humana ${type}` },
    }), 201);
    snapshots.set(type, frozen);
  }
  const quarterPath = `${workspacePath}/primer_trimestre`;
  const firstSnapshot = snapshots.get("primer_trimestre");
  assert.equal(firstSnapshot.validation.complete, true);
  assert.match(firstSnapshot.sourceHash, /^[0-9a-f]{64}$/);
  assert.ok(firstSnapshot.content.actions[0].actionTitle.includes("Acción propia"));
  assert.ok(firstSnapshot.content.annexes[0].versionId);
  assert.ok(!JSON.stringify(firstSnapshot).toLowerCase().includes("logro global"));
  await assert.rejects(pool.query("UPDATE pic_followup_snapshots SET reason='tamper' WHERE id=$1", [firstSnapshot.id]), /PIC_FOLLOWUP_SNAPSHOT_IMMUTABLE/);
  await assert.rejects(pool.query("DELETE FROM pic_followup_snapshots WHERE id=$1", [firstSnapshot.id]), /PIC_FOLLOWUP_SNAPSHOT_IMMUTABLE/);

  const edited = baseContent("primer_trimestre");
  edited.activitiesNarrative = "Texto revisado después de congelar la primera versión.";
  const secondDraft = expect(await request(quarterPath, {
    method: "PUT", session: c2, body: { expectedRevision: savedReports.get("primer_trimestre").revision, content: edited },
  }), 200);
  expect(await request(quarterPath, {
    method: "PUT", session: c2, body: { expectedRevision: 1, content: edited },
  }), 409);
  const secondSnapshot = expect(await request(`${quarterPath}/snapshots`, {
    method: "POST", session: c2, body: { expectedRevision: secondDraft.revision, reason: "Corrección documentada" },
  }), 201);
  const detail = expect(await request(quarterPath, { session: c2 }), 200);
  assert.equal(detail.snapshots.length, 2);
  const retained = detail.snapshots.find((item) => item.id === firstSnapshot.id);
  assert.equal(retained.content.activitiesNarrative, baseContent("primer_trimestre").activitiesNarrative);
  assert.notEqual(secondSnapshot.sourceHash, firstSnapshot.sourceHash);

  const baseExportPath = `${quarterPath}/snapshots/${secondSnapshot.id}/exports`;
  const laycos = expect(await request(`${baseExportPath}/laycos`, { session: c2 }), 200);
  assert.ok(laycos.fields.some((field) => field.section === 11 && field.label.includes("Acción")));
  assert.match(laycos.notice, /transcripción manual/);
  assert.match(laycos.notice, /No se ha enviado/);
  assert.ok(laycos.fields.every((field) => field.certainty === "pendiente_validacion" || field.certainty === "sin_informacion"));
  const internalLaycos = expect(await request(
    `${workspacePath}/justificacion/snapshots/${snapshots.get("justificacion").id}/exports/laycos`, { session: c2 },
  ), 200);
  assert.deepEqual(internalLaycos.fields, []);
  assert.match(internalLaycos.notice, /interno/);

  const docx = expect(await request(`${baseExportPath}/docx`, { session: c2 }), 200);
  const pdf = expect(await request(`${baseExportPath}/pdf`, { session: c2 }), 200);
  const json = expect(await request(`${baseExportPath}/json`, { session: c2 }), 200);
  assert.equal(Buffer.from(docx.contentBase64, "base64").subarray(0, 2).toString(), "PK");
  assert.equal(Buffer.from(pdf.contentBase64, "base64").subarray(0, 4).toString(), "%PDF");
  const jsonFile = JSON.parse(Buffer.from(json.contentBase64, "base64").toString("utf8"));
  assert.equal(jsonFile.metadata.sourceHash, secondSnapshot.sourceHash);
  assert.ok(jsonFile.content.activitiesNarrative.includes("Texto revisado"));
  assert.ok(Buffer.from(pdf.contentBase64, "base64").length > 1000);

  const deliveryBody = {
    snapshotId: secondSnapshot.id,
    deliveryDate: "2100-05-22",
    externalIdentifier: "LAYCOS-MANUAL-2100-01",
    proofDocumentId: proof.id,
    confirmation: "Confirmo personalmente que transcribí estos campos en Laycos.",
    personConfirmed: true,
  };
  expect(await request(`${quarterPath}/deliveries`, {
    method: "POST", session: c2, body: { ...deliveryBody, personConfirmed: false },
  }), 400);
  expect(await request(`${quarterPath}/deliveries`, {
    method: "POST", session: c2, body: { ...deliveryBody, proofDocumentId: restricted.id },
  }), 422);
  const delivered = expect(await request(`${quarterPath}/deliveries`, {
    method: "POST", session: c2, body: deliveryBody,
  }), 201);
  assert.equal(delivered.personConfirmed, true);
  assert.equal(delivered.proofVersionId, proof.version);
  assert.equal(delivered.proofSha256, proof.sha256);
  assert.equal(delivered.recordedByName, "followup-c2@example.invalid");
  assert.match(delivered.confirmation, /Confirmo personalmente/);
  assert.match(delivered.externalIdentifier, /LAYCOS/);
  expect(await request(`${quarterPath}/deliveries`, { method: "POST", session: c2, body: deliveryBody }), 409);
  await assert.rejects(pool.query("UPDATE pic_followup_deliveries SET confirmation='tamper' WHERE id=$1", [delivered.id]), /PIC_FOLLOWUP_DELIVERY_IMMUTABLE/);
  await assert.rejects(pool.query("DELETE FROM pic_followup_deliveries WHERE id=$1", [delivered.id]), /PIC_FOLLOWUP_DELIVERY_IMMUTABLE/);
  const receipts = expect(await request(`${quarterPath}/deliveries`, { session: c2 }), 200);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].proofVersionId, proof.version);

  const validation = expect(await request(`/school-years/${year.id}/validation`, { session: c2 }), 200);
  assert.equal(validation.canClose, true, JSON.stringify(validation));
  const closed = expect(await request(`/school-years/${year.id}/close`, {
    method: "POST", session: c2,
    body: { expectedRevision: validation.revision, confirmation: "2099-2100", reason: "Cierre aislado tras revisar informes." },
  }), 200);
  assert.ok(closed.closedAt);
  const history = expect(await request(`/school-years/${year.id}/history`, { session: c2 }), 200);
  for (const sourceName of ["pic_followup_reports", "pic_followup_snapshots", "pic_followup_deliveries"]) {
    assert.ok(history.sources.some((source) => source.source === sourceName), `missing archived source ${sourceName}`);
  }
  assert.ok(!JSON.stringify(history).includes("storage_key"));
  console.log("PIC follow-ups: current-course source scoping, human-only checks, snapshots, exports, manual Laycos receipts and archive retention passed.");
} catch (error) {
  console.error(`PIC follow-ups integration test failed.\n${error}\nRecent API output:\n${apiOutput.slice(-10000)}`);
  process.exitCode = 1;
} finally {
  await cleanup();
}
