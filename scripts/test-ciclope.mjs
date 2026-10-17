// Runs exclusively against a newly provisioned PostgreSQL cluster and private API.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { randomBytes, randomUUID, createHash, createHmac } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { startAIRecordingChecks } from "./ciclope-ai-checks.mjs";
const root = new URL("../", import.meta.url).pathname;
const require = createRequire(import.meta.url);
const { Pool } = require(require.resolve("pg", { paths: [path.join(root, "lib/db")] }));
const directory = await mkdtemp(path.join(tmpdir(), "innova-ciclope-"));
const pgdata = path.join(directory, "postgres");
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) =>
  !k.startsWith("PG") && !["DATABASE_URL", "TEST_DATABASE_URL", "SESSION_SECRET", "DATA_DIR"].includes(k)));
let pool, api, aiChecks, postgres = false, output = "", cleaned = false, checks = 0;
function command(name, args, env = cleanEnv) {
  const result = spawnSync(name, args, { cwd: root, env, encoding: "utf8", timeout: 90000 });
  assert.equal(result.status, 0, `${name}: ${result.stderr || result.stdout}`);
}
async function port() {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening"); const n = server.address().port;
  await new Promise(resolve => server.close(resolve)); return n;
}
async function cleanup() {
  if (cleaned) return; cleaned = true;
  if (aiChecks) await aiChecks.close();
  if (api && api.exitCode === null && api.signalCode === null) {
    api.kill("SIGTERM");
    await Promise.race([once(api, "exit"), new Promise(r => setTimeout(r, 2000))]);
    if (api.exitCode === null && api.signalCode === null) { api.kill("SIGKILL"); await once(api, "exit"); }
  }
  if (pool) await pool.end();
  if (postgres) command("pg_ctl", ["-D", pgdata, "-m", "immediate", "-w", "stop"]);
  await rm(directory, { recursive: true, force: true });
}
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, async () => { await cleanup(); process.exit(130); });
try {
  const pgPort = await port(), apiPort = await port();
  const testWebhookSecret = `whsec_${randomBytes(32).toString("base64")}`;
  command("initdb", ["-D", pgdata, "-U", "ciclope_test", "-A", "trust", "--no-locale", "--encoding=UTF8"]);
  command("pg_ctl", ["-D", pgdata, "-l", path.join(directory, "postgres.log"), "-o", `-h 127.0.0.1 -p ${pgPort} -k ${directory}`, "-w", "start"]);
  postgres = true;
  const databaseUrl = `postgresql://ciclope_test@127.0.0.1:${pgPort}/postgres`;
  const env = { ...cleanEnv, DATABASE_URL: databaseUrl, SESSION_SECRET: randomBytes(48).toString("hex"),
    PORT: String(apiPort), NODE_ENV: "test", COOKIE_SECURE: "false", DATA_DIR: path.join(directory, "files"),
    RESEND_API_KEY: "", RESEND_WEBHOOK_SECRET: testWebhookSecret, EMAIL_ENABLED: "false",
    PASSWORD_RESET_EMAIL_ENABLED: "false", CLAMAV_HOST: "", CLAMAV_PORT: "" };
  if (process.argv.includes("--serve-browser")) env.WEB_DIST_DIR = path.join(root, "artifacts/innova-c2/dist/public");
  command("pnpm", ["--filter", "@workspace/db", "run", "migrate"], env);
  pool = new Pool({ connectionString: databaseUrl });
  api = spawn(process.execPath, ["artifacts/api-server/dist/index.mjs"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  api.stdout.on("data", b => { output += b; }); api.stderr.on("data", b => { output += b; });
  const base = `http://127.0.0.1:${apiPort}/api/v1`;
  async function request(url, session, method = "GET", body, csrf = true) {
    const headers = { "content-type": "application/json" };
    if (session) { headers.cookie = session.cookie; if (csrf) headers["x-csrf-token"] = session.csrf; }
    const response = await fetch(base + url, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    const bytes = Buffer.from(await response.arrayBuffer());
    let data; try { data = JSON.parse(bytes.toString()); } catch {}
    return { status: response.status, data, bytes, cookie: response.headers.get("set-cookie")?.split(";")[0] };
  }
  function status(r, expected) { assert.equal(r.status, expected, JSON.stringify(r.data)); checks++; return r.data; }
  for (let n = 0; ; n++) {
    try { if ((await request("/health")).status === 200) break; } catch {}
    if (api.exitCode !== null || n > 150) throw Error(output.slice(-3000) || "API startup timeout");
    await new Promise(r => setTimeout(r, 100));
  }
  status(await request("/ciclope"), 401);
  const password = `Test-${randomUUID()}-Secure`;
  const setup = await request("/setup/initialize", null, "POST", {
    email: "admin@ciclope.example.invalid", password, name: "Administración de prueba",
    centerName: "Centro aislado CICLOPE", schoolYear: "2026-2027",
  });
  const initial = status(setup, 201), admin = { cookie: setup.cookie, csrf: initial.csrfToken };
  const family = status(await request("/catalogs/current", admin), 200).familias_profesionales[0];
  async function account(email, role) {
    const user = status(await request("/users", admin, "POST", {
      email, role, name: role, temporaryPassword: password,
      professionalFamily: role === "profesorado" ? family : null,
    }), 201);
    const logged = await request("/auth/login", null, "POST", { email, password });
    const login = status(logged, 200);
    return { user, session: { cookie: logged.cookie, csrf: login.csrfToken } };
  }
  const c2 = await account("c2@ciclope.example.invalid", "c2_innovacion");
  const direction = await account("direction@ciclope.example.invalid", "equipo_directivo");
  const teacher = await account("teacher@ciclope.example.invalid", "profesorado");
  const outsider = await account("other@ciclope.example.invalid", "profesorado");
  aiChecks = await startAIRecordingChecks({ request, status, admin, c2, teacher, pool, base, directory });
  await aiChecks.settingsChecks();
  status(await request("/admin/mail/provider-status", c2.session), 403);
  const mailConfig = status(await request("/admin/mail/provider-status", admin), 200);
  assert.equal(mailConfig.provider.keyConfigured, false); checks++;
  assert.equal(mailConfig.settings.sendEnabled, false); checks++;
  const savedMailConfig = status(await request("/admin/mail/settings", admin, "PUT", {
    expectedRevision: mailConfig.settings.revision, sendEnabled: false,
    senderAlias: "innovacion", replyTo: "innovacion@buzon.iesmmg.org",
  }), 200);
  assert.equal(savedMailConfig.settings.sendApprovalRequired, true); checks++;
  status(await request("/admin/mail/settings", admin, "PUT", {
    expectedRevision: savedMailConfig.settings.revision, sendEnabled: true,
    senderAlias: "innovacion", replyTo: "innovacion@buzon.iesmmg.org",
  }), 409);
  for (const [email, displayName, segment] of [
    ["c2@ciclope.example.invalid", "C2", "coordinacion_c1"],
    ["direction@ciclope.example.invalid", "Dirección", "direccion"],
    ["teacher@ciclope.example.invalid", "Docente", "profesorado"],
  ]) {
    status(await request("/mail/contacts", c2.session, "POST", {
      email, displayName, segment, institution: "Centro aislado CICLOPE",
      authorizationNote: "Destinatario autorizado para pruebas aisladas",
      optOut: false, active: true,
    }), 201);
  }
  const contactPayload = {
    email: "external@empresa.example.invalid", displayName: "Contacto de empresa",
    segment: "empresa", institution: "Empresa de prueba", authorizationNote: "Colaboración institucional aprobada",
    optOut: false, active: true,
  };
  const contact = status(await request("/mail/contacts", c2.session, "POST", contactPayload), 201);
  const optedOut = status(await request("/mail/contacts", c2.session, "POST", {
    ...contactPayload, email: "baja@empresa.example.invalid", optOut: true,
  }), 201);
  const template = status(await request("/mail/templates", c2.session, "POST", {
    name: "Aviso de prueba", subject: "Información institucional", body: "Texto autorizado.",
    classification: "informativa",
  }), 201);
  const draftInput = {
    recipientContactIds: [contact.id], templateId: template.id,
    subject: template.subject, bodyText: template.body, classification: "informativa",
    attachmentDocumentIds: [],
  };
  const draft = status(await request("/mail/drafts", c2.session, "POST", draftInput), 201).messages[0];
  assert.equal(draft.status, "borrador"); checks++;
  status(await request("/mail/drafts", c2.session, "POST", {
    ...draftInput, recipientContactIds: [contact.id, optedOut.id],
  }), 409);
  const submitted = status(await request(`/mail/drafts/${draft.id}/submit`, c2.session, "POST", {}), 200);
  assert.equal(submitted.status, "revision"); checks++;
  status(await request(`/mail/drafts/${draft.id}/approve`, c2.session, "POST", {}), 403);
  const approved = status(await request(`/mail/drafts/${draft.id}/approve`, direction.session, "POST", {}), 200);
  assert.equal(approved.status, "aprobado"); checks++;
  const queued = status(await request(`/mail/drafts/${draft.id}/send`, c2.session, "POST", { expectedRevision: approved.revision }), 200);
  assert.equal(queued.queued, true); checks++;
  assert.equal(queued.status, "en_cola"); checks++;
  const isolatedInbox = status(await request("/mail/overview", outsider.session), 200);
  assert.equal(isolatedInbox.threads.length, 0); checks++;
  const webhookUrl = `${base}/webhooks/resend`;
  async function postWebhook(eventId, payload, forceInvalid = false) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const raw = Buffer.from(JSON.stringify(payload));
    const signature = createHmac("sha256", Buffer.from(testWebhookSecret.slice("whsec_".length), "base64"))
      .update(`${eventId}.${timestamp}.`).update(raw).digest("base64");
    return fetch(webhookUrl, { method: "POST", headers: {
      "content-type": "application/json", "svix-id": eventId, "svix-timestamp": timestamp,
      "svix-signature": forceInvalid ? "v1,invalid" : `v1,${signature}`,
    }, body: raw });
  }
  const eventId = `msg_${randomUUID()}`;
  const webhookPayload = { type: "email.delivered", data: { email_id: `re_test_${randomUUID()}` } };
  assert.equal((await postWebhook(eventId, webhookPayload, true)).status, 401); checks++;
  const acceptedWebhook = await postWebhook(eventId, webhookPayload);
  assert.equal(acceptedWebhook.status, 200); checks++;
  assert.equal((await postWebhook(eventId, webhookPayload)).status, 200); checks++;
  const duplicateResult = await (await postWebhook(eventId, webhookPayload)).json();
  assert.equal(duplicateResult.duplicate, true); checks++;
  const webhookRows = await pool.query("SELECT count(*)::int AS count FROM mail_webhook_events WHERE provider_event_id=$1", [eventId]);
  assert.equal(webhookRows.rows[0].count, 1); checks++;
  const queuedRow = await pool.query("SELECT status, attempts, provider_message_id FROM mail_messages WHERE id=$1", [draft.id]);
  assert.deepEqual(queuedRow.rows[0], { status: "en_cola", attempts: 0, provider_message_id: null }); checks++;
  if (process.argv.includes("--serve-browser")) {
    const browserMeeting = await aiChecks.seedMeeting(body(6), false);
    const fixture = path.join(directory, "browser-fixture.json");
    await writeFile(fixture, JSON.stringify({
      url: `http://127.0.0.1:${apiPort}`, password,
      admin: "admin@ciclope.example.invalid", c2: "c2@ciclope.example.invalid",
      direction: "direction@ciclope.example.invalid", teacher: "teacher@ciclope.example.invalid",
      meetingId: browserMeeting.id,
      ...aiChecks.browserFixture(),
    }), { mode: 0o600, flag: "wx" });
    console.log(`Isolated browser fixture ready: ${fixture}`);
    await new Promise(() => {});
  }
  const overview = async session => status(await request("/ciclope", session), 200);
  let data = await overview(c2.session);
  assert.equal(data.policy.authorizedInternalChannel, false);
  status(await request("/ciclope/policy", c2.session, "PUT", { expectedRevision: 0, requireInstitutionalApproval: false, authorizedInternalChannel: true }), 403);
  status(await request("/ciclope/policy", direction.session, "PUT", { expectedRevision: 0, requireInstitutionalApproval: true, authorizedInternalChannel: true }), 200);
  function body(index, kind = "ciclope") {
    return {
      expectedRevision: 0, kind, title: `Sesión ${index} de coordinación`,
      startsAt: `2026-09-0${index}T10:00:00Z`, endsAt: `2026-09-0${index}T11:00:00Z`,
      purpose: "Seguimiento de las acciones y acuerdos del PIC", location: "Sala de coordinación",
      participants: [c2, direction, teacher].map((x, i) => ({ userId: x.user.id, formalRole: i === 0 ? "Secretaría operativa C2" : "Participante", appointedOn: null, attendance: "pendiente" })),
      agenda: ["Revisión de actuaciones PIC"], notes: "", agreements: [], chairUserId: direction.user.id,
      secretaryUserId: c2.user.id, validatorUserIds: [direction.user.id], attachmentIds: [],
      externalSender: kind === "red_c1" ? "Convocatoria externa recibida" : "",
      externalChecks: { laycos: "pendiente", questionnaire: "pendiente", constituted: "pendiente" },
    };
  }
  status(await request("/ciclope/meetings", teacher.session, "POST", body(1)), 403);
  status(await request("/ciclope/meetings", c2.session, "POST", body(1), false), 403);
  const created = [];
  for (let i = 1; i <= 4; i++) created.push(status(await request("/ciclope/meetings", c2.session, "POST", body(i)), 201));
  const unsafeAttachment = body(7); unsafeAttachment.attachmentIds = [randomUUID()];
  status(await request("/ciclope/meetings", c2.session, "POST", unsafeAttachment), 400);
  assert.equal((await overview(c2.session)).meetings.filter(m => m.data.kind === "ciclope").length, 4);
  assert.equal((await overview(outsider.session)).meetings.length, 0);
  status(await request(`/ciclope/meetings/${created[0].id}/versions`, outsider.session), 404);
  status(await request("/ciclope/meetings", c2.session, "POST", body(1)), 409); // overlapping people
  let m = created[0];
  const act = async (session, action, expected = 200, text) => {
    status(await request(`/ciclope/meetings/${m.id}/action`, session, "POST", { expectedRevision: m.revision, action, text }), expected);
    m = (await overview(c2.session)).meetings.find(x => x.id === m.id);
  };
  await act(c2.session, "convocar", 409);
  await act(c2.session, "solicitar_refrendo");
  await act(teacher.session, "aprobar_convocatoria", 403);
  await act(direction.session, "aprobar_convocatoria");
  status(await request("/ciclope/policy", direction.session, "PUT", { expectedRevision: 1, requireInstitutionalApproval: true, authorizedInternalChannel: true }), 200);
  await act(c2.session, "convocar", 409); // policy changes invalidate earlier approval
  await act(direction.session, "aprobar_convocatoria");
  await act(c2.session, "convocar");
  assert.equal(m.state, "convocada");
  assert.equal((await overview(teacher.session)).notices.filter(n => n.title.startsWith("Convocatoria:")).length, 1);
  const linkedMail = await pool.query(
    `SELECT t.id, t.subject, t.folder, m.recipient, m.status, m.event_metadata
     FROM mail_threads t
     JOIN mail_messages m ON m.thread_id = t.id
     WHERE m.event_metadata->>'ciclopeMeetingId' = $1`,
    [m.id],
  );
  assert.equal(linkedMail.rowCount, 3, "Una convocatoria refrendada crea un borrador individual por destinatario autorizado.");
  assert.deepEqual(linkedMail.rows.map(row => row.recipient).sort(), [
    "c2@ciclope.example.invalid",
    "direction@ciclope.example.invalid",
    "teacher@ciclope.example.invalid",
  ].sort(), "Los borradores individuales conservan exactamente los destinatarios refrendados.");
  assert.ok(linkedMail.rows.every(row => row.status === "borrador" && row.folder === "borradores"));
  assert.ok(linkedMail.rows.every(row => row.event_metadata.approvedPolicyRevision === 2));
  checks += 4;
  await act(c2.session, "preparar_acta", 409);
  status(await request(`/ciclope/meetings/${m.id}/export/acta/${m.revision}/pdf`, c2.session), 409);
  await act(c2.session, "celebrar");
  await aiChecks.exercise(body(6));
  const update = { ...m.data, expectedRevision: m.revision, notes: "Desarrollo revisado por las personas participantes.",
    participants: m.data.participants.map(p => ({ ...p, attendance: "presente" })),
    agreements: [{ title: "Revisar las evidencias pendientes", responsibleUserId: teacher.user.id, dueDate: "2026-10-28", remindersEnabled: true }] };
  m = status(await request(`/ciclope/meetings/${m.id}`, c2.session, "PUT", update), 200);
  assert.equal(m.approvalRequested, true, "El acta conserva la solicitud del refrendo ya emitido.");
  assert.equal(m.approvedPolicyRevision, 2, "Las revisiones del acta no revocan el refrendo de la convocatoria.");
  await act(c2.session, "preparar_acta");
  await act(c2.session, "validar_acta", 403);
  await act(direction.session, "validar_acta");
  assert.equal(m.approvedPolicyRevision, 2);
  const validatedRevision = m.revision;
  await aiChecks.rejectValidated(m);
  status(await request(`/ciclope/meetings/${m.id}`, c2.session, "PUT", { ...update, expectedRevision: m.revision }), 409);
  const task = (await overview(teacher.session)).tasks[0];
  assert.ok(task.sourceVersionId); assert.equal(task.remindersEnabled, false);
  const taskAction = async (session, action, expected = 200) => status(await request(`/ciclope/tasks/${task.id}/action`, session, "POST", { action }), expected);
  await taskAction(c2.session, "activar_recordatorios", 403);
  await taskAction(c2.session, "recordar", 409);
  await taskAction(teacher.session, "activar_recordatorios");
  await taskAction(c2.session, "recordar");
  assert.ok((await overview(teacher.session)).notices.some(n => n.title.startsWith("Recordatorio:")));
  assert.ok(!(await overview(c2.session)).notices.some(n => n.title.startsWith("Recordatorio:")));
  await taskAction(teacher.session, "completar");
  await taskAction(c2.session, "recordar", 409);
  const history = status(await request(`/ciclope/meetings/${m.id}/versions`, c2.session), 200);
  assert.equal(history[0].revision, validatedRevision);
  for (const format of ["pdf", "docx"]) {
    const url = `/ciclope/meetings/${m.id}/export/acta/${validatedRevision}/${format}`;
    const first = await request(url, c2.session), second = await request(url, c2.session);
    status(first, 200); status(second, 200);
    assert.equal(first.bytes.subarray(0, format === "pdf" ? 4 : 2).toString(), format === "pdf" ? "%PDF" : "PK");
    assert.equal(createHash("sha256").update(first.bytes).digest("hex"), createHash("sha256").update(second.bytes).digest("hex"));
  }
  await assert.rejects(pool.query("UPDATE ciclope_versions SET revision=revision+100 WHERE id=$1", [history[0].id]), /CICLOPE_VERSION_IMMUTABLE/);
  const external = status(await request("/ciclope/meetings", c2.session, "POST", body(5, "red_c1")), 201);
  status(await request(`/ciclope/meetings/${external.id}/action`, c2.session, "POST", { action: "convocar", expectedRevision: 1 }), 200);
  assert.equal(Number((await pool.query("SELECT count(*) FROM mail_messages WHERE event_metadata->>'ciclopeMeetingId'=$1", [external.id])).rows[0].count), 0,
    "Una reunión de red C1 no genera una convocatoria institucional propia.");
  m = (await overview(c2.session)).meetings.find(x => x.id === external.id);
  await act(c2.session, "celebrar");
  m = status(await request(`/ciclope/meetings/${m.id}`, c2.session, "PUT", {
    ...m.data, expectedRevision: m.revision, notes: "Registro personal de participación C2 en la reunión de red.",
    participants: m.data.participants.map(p => ({ ...p, attendance: p.userId === c2.user.id ? "presente" : "ausente" })),
  }), 200);
  data = await overview(c2.session);
  assert.equal(data.meetings.filter(x => x.data.kind === "ciclope" && x.state === "acta_validada").length, 1);
  // The AI fixture is a second real held meeting, but its draft is not validated.
  assert.equal(data.meetings.filter(x => x.data.kind === "ciclope" && ["celebrada", "acta_borrador", "acta_validada"].includes(x.state)).length, 2);
  assert.equal(data.meetings.filter(x => x.data.kind === "red_c1").length, 1);
  const conflict = created[1];
  const concurrent = await Promise.all([1, 2].map(n => request(`/ciclope/meetings/${conflict.id}/action`, teacher.session, "POST", { expectedRevision: 1, action: "aportar", text: `Propuesta ${n}` })));
  assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 409]);
  const future = body(6); future.startsAt = new Date(Date.now() + 86400000).toISOString(); future.endsAt = new Date(Date.now() + 90000000).toISOString();
  m = status(await request("/ciclope/meetings", c2.session, "POST", future), 201);
  await act(c2.session, "solicitar_refrendo"); await act(direction.session, "aprobar_convocatoria"); await act(c2.session, "convocar");
  await act(c2.session, "celebrar", 409);
  const yearId = data.schoolYearId;
  const validation = status(await request(`/school-years/${yearId}/validation`, admin), 200);
  status(await request(`/school-years/${yearId}/close`, admin, "POST", { expectedRevision: validation.revision, confirmation: "2026-2027", reason: "Prueba de archivo íntegro del módulo CICLOPE" }), 200);
  const snapshot = (await pool.query("SELECT content FROM school_year_snapshots WHERE school_year_id=$1", [yearId])).rows[0].content;
  for (const source of ["ciclope_policies", "ciclope_meetings", "ciclope_versions", "ciclope_tasks", "ciclope_notices"])
    assert.ok(snapshot.sources.some(s => s.source === source), `Missing archived ${source}`);
  await assert.rejects(pool.query("UPDATE ciclope_meetings SET title='no permitido' WHERE id=$1", [m.id]), /COURSE_CLOSED/);
  status(await request("/ciclope", c2.session), 409);
  const audits = (await pool.query("SELECT count(*) FROM audit_logs WHERE action LIKE 'ciclope.%'")).rows[0].count;
  assert.ok(Number(audits) > 15);
  console.log(`CICLOPE + Comunicaciones Fase 3B: ${checks} comprobaciones API correctas; permisos, CICLOPE, cola local sin envíos, aprobación, contactos, ajustes, firma y deduplicación de webhooks.`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally { await cleanup(); }
