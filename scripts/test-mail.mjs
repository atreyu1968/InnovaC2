// Isolated institutional-mail integration checks. Never calls Resend to send mail.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

const root = new URL("../", import.meta.url).pathname;
const require = createRequire(import.meta.url);
const { Pool } = require(require.resolve("pg", { paths: [path.join(root, "lib/db")] }));
const directory = await mkdtemp(path.join(tmpdir(), "innova-mail-"));
const pgdata = path.join(directory, "postgres");
const ts = require("typescript");
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !key.startsWith("PG") && ![
    "DATABASE_URL", "TEST_DATABASE_URL", "SESSION_SECRET", "DATA_DIR",
    "RESEND_API_KEY", "RESEND_WEBHOOK_SECRET", "EMAIL_ENABLED", "EMAIL_ACTIVATION_CONFIRMED",
  ].includes(key)));
let pool, api, postgres = false, output = "", cleaned = false, checks = 0;
function command(name, args, env = cleanEnv) {
  const result = spawnSync(name, args, { cwd: root, env, encoding: "utf8", timeout: 90000 });
  assert.equal(result.status, 0, `${name}: ${result.stderr || result.stdout}`);
}
async function port() {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const value = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return value;
}
async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  if (api && api.exitCode === null && api.signalCode === null) {
    api.kill("SIGTERM");
    await Promise.race([once(api, "exit"), new Promise(resolve => setTimeout(resolve, 2000))]);
    if (api.exitCode === null && api.signalCode === null) {
      api.kill("SIGKILL");
      await once(api, "exit");
    }
  }
  if (pool) await pool.end();
  if (postgres) command("pg_ctl", ["-D", pgdata, "-m", "immediate", "-w", "stop"]);
  await rm(directory, { recursive: true, force: true });
}
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, async () => {
  await cleanup();
  process.exit(130);
});

try {
  // AT-41 DNS parsing and the second activation gate are checked offline.
  const providerSource = await readFile(path.join(root, "artifacts/api-server/src/lib/mail-provider.ts"), "utf8");
  const providerBundle = ts.transpileModule(providerSource, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const providerPath = path.join(directory, "mail-provider-test.mjs");
  await writeFile(providerPath, providerBundle);
  const provider = await import(pathToFileURL(providerPath).href);
  const resolver = {
    txt: async host => ({
      "iesmmg.org": [],
      "send.iesmmg.org": [["v=spf1 include:amazonses.com ~all"]],
      "resend._domainkey.iesmmg.org": [["v=DKIM1; p=PUBLICKEY"]],
      "_dmarc.iesmmg.org": [["v=DMARC1; p=reject"]],
    })[host] ?? [],
    mx: async host => host === "iesmmg.org"
      ? [{ priority: 10, exchange: "root-mx.example." }]
      : host === "buzon.iesmmg.org"
        ? [{ priority: 20, exchange: "inbound-mx.example." }]
        : [],
  };
  const publicDns = await provider.verifyMailDns(true, resolver);
  assert.equal(publicDns.ready, true);
  assert.deepEqual(publicDns.rootMx, ["10 root-mx.example."]);
  assert.deepEqual(publicDns.inboundMx, ["20 inbound-mx.example."]);
  checks += 3;
  const incompleteDns = await provider.verifyMailDns(true, {
    ...resolver,
    txt: async host => host === "_dmarc.iesmmg.org" ? [] : resolver.txt(host),
  });
  assert.equal(incompleteDns.ready, false);
  checks++;
  const previousEmailEnabled = process.env.EMAIL_ENABLED;
  const previousActivation = process.env.EMAIL_ACTIVATION_CONFIRMED;
  process.env.EMAIL_ENABLED = "true";
  process.env.EMAIL_ACTIVATION_CONFIRMED = "false";
  assert.equal(provider.mailSendEnabled(), false);
  process.env.EMAIL_ACTIVATION_CONFIRMED = "true";
  assert.equal(provider.mailSendEnabled(), true);
  if (previousEmailEnabled === undefined) delete process.env.EMAIL_ENABLED;
  else process.env.EMAIL_ENABLED = previousEmailEnabled;
  if (previousActivation === undefined) delete process.env.EMAIL_ACTIVATION_CONFIRMED;
  else process.env.EMAIL_ACTIVATION_CONFIRMED = previousActivation;
  checks += 2;

  const pgPort = await port(), apiPort = await port();
  command("initdb", ["-D", pgdata, "-U", "mail_test", "-A", "trust", "--no-locale", "--encoding=UTF8"]);
  command("pg_ctl", ["-D", pgdata, "-l", path.join(directory, "postgres.log"),
    "-o", `-h 127.0.0.1 -p ${pgPort} -k ${directory}`, "-w", "start"]);
  postgres = true;
  const databaseUrl = `postgresql://mail_test@127.0.0.1:${pgPort}/postgres`;
  const sessionSecret = randomBytes(48).toString("hex");
  const webhookKey = randomBytes(32);
  const webhookSecret = `whsec_${webhookKey.toString("base64")}`;
  const env = {
    ...cleanEnv,
    DATABASE_URL: databaseUrl,
    SESSION_SECRET: sessionSecret,
    PORT: String(apiPort),
    NODE_ENV: "test",
    COOKIE_SECURE: "false",
    DATA_DIR: path.join(directory, "files"),
    EMAIL_ENABLED: "false",
    EMAIL_ACTIVATION_CONFIRMED: "false",
    RESEND_API_KEY: "",
    RESEND_WEBHOOK_SECRET: webhookSecret,
    PASSWORD_RESET_EMAIL_ENABLED: "false",
    CLAMAV_HOST: "",
    CLAMAV_PORT: "",
  };
  command("pnpm", ["--filter", "@workspace/db", "run", "migrate"], env);
  pool = new Pool({ connectionString: databaseUrl });
  api = spawn(process.execPath, ["artifacts/api-server/dist/index.mjs"], {
    cwd: root, env, stdio: ["ignore", "pipe", "pipe"],
  });
  api.stdout.on("data", bytes => { output += bytes; });
  api.stderr.on("data", bytes => { output += bytes; });
  const base = `http://127.0.0.1:${apiPort}/api/v1`;
  async function request(url, session, method = "GET", body, extraHeaders = {}) {
    const headers = { "content-type": "application/json", ...extraHeaders };
    if (session) {
      headers.cookie = session.cookie;
      headers["x-csrf-token"] = session.csrf;
    }
    const requestBody = body === undefined ? undefined :
      Buffer.isBuffer(body) ? body : JSON.stringify(body);
    const response = await fetch(base + url, {
      method, headers, ...(requestBody === undefined ? {} : { body: requestBody }),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    let data;
    try { data = JSON.parse(bytes.toString("utf8")); } catch {}
    return {
      status: response.status,
      data,
      bytes,
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  }
  function status(response, expected) {
    assert.equal(response.status, expected, JSON.stringify(response.data));
    checks++;
    return response.data;
  }
  for (let attempt = 0; ; attempt++) {
    try {
      if ((await request("/health")).status === 200) break;
    } catch {}
    if (api.exitCode !== null || attempt > 150) throw Error(output.slice(-3000) || "API startup timeout");
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  const password = `Test-${randomUUID()}-Secure`;
  const setup = await request("/setup/initialize", null, "POST", {
    email: "admin@ciclope.example.invalid", password, name: "Administración de prueba",
    centerName: "Centro aislado de comunicaciones", schoolYear: "2026-2027",
  });
  const initial = status(setup, 201);
  const admin = { cookie: setup.cookie, csrf: initial.csrfToken };
  const family = status(await request("/catalogs/current", admin), 200).familias_profesionales[0];
  async function login(email) {
    const response = await fetch(`${base}/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    checks++;
    return { cookie: response.headers.get("set-cookie")?.split(";")[0], csrf: data.csrfToken };
  }
  const createAccount = async (email, role) => {
    const user = status(await request("/users", admin, "POST", {
      email, name: role, role, temporaryPassword: password,
      professionalFamily: role === "profesorado" ? family : null,
    }), 201);
    return { user, session: await login(email) };
  };
  const c2 = await createAccount("c2@ciclope.example.invalid", "c2_innovacion");
  const direction = await createAccount("direction@ciclope.example.invalid", "equipo_directivo");
  const teacher = await createAccount("teacher@ciclope.example.invalid", "profesorado");

  // AT-41 / AT-44: read-only public DNS view, separate receive subdomain, and
  // both server-side activation gates default off. No root MX is written.
  const overview = status(await request("/mail/overview", c2.session), 200);
  assert.equal(overview.provider.deploymentEnabled, false);
  assert.equal(overview.provider.activationConfirmed, false);
  assert.equal(overview.provider.domain, "iesmmg.org");
  const restrictedOverview = status(await request("/mail/overview", teacher.session), 200);
  assert.equal(restrictedOverview.canManage, false);
  assert.equal(restrictedOverview.contacts.length, 0);
  const statusPage = status(await request("/admin/mail/provider-status", admin), 200);
  assert.equal(statusPage.provider.deploymentEnabled, false);
  const dnsBefore = statusPage.dns.rootMx;
  const verified = status(await request("/admin/mail/provider-status/verify", admin, "POST", {}), 200);
  assert.equal(typeof verified.dns.spf, "string");
  assert.equal(typeof verified.dns.dkim, "string");
  assert.equal(typeof verified.dns.dmarc, "string");
  assert.deepEqual(verified.dns.rootMx, dnsBefore);

  // AT-51: authorized contacts, categories, templates, and drafts remain local.
  const contact = status(await request("/mail/contacts", c2.session, "POST", {
    email: "coordination@example.invalid",
    displayName: "Contacto de prueba",
    segment: "coordinacion_c1",
    institution: "Centro de prueba",
    authorizationNote: "Alta autorizada para prueba aislada",
    active: true,
    optOut: false,
  }), 201);
  const template = status(await request("/mail/templates", c2.session, "POST", {
    name: "Plantilla de prueba",
    subject: "Aviso de prueba",
    body: "Contenido ficticio para verificación.",
    classification: "organizativa",
  }), 201);
  const threadCount = async () => Number((await pool.query("SELECT count(*) FROM mail_threads")).rows[0].count);
  const beforeRejectedDraft = await threadCount();
  status(await request("/mail/drafts", c2.session, "POST", {
    recipientContactIds: [contact.id],
    subject: "Adjunto no autorizado",
    bodyText: "No se debe crear el hilo.",
    classification: "organizativa",
    attachmentDocumentIds: [randomUUID()],
  }), 400);
  assert.equal(await threadCount(), beforeRejectedDraft);

  const centerId = (await pool.query("SELECT center_id FROM users WHERE id=$1", [c2.user.id])).rows[0].center_id;
  const schoolYearId = (await pool.query(
    "SELECT id FROM school_years WHERE center_id=$1 AND active=true", [centerId],
  )).rows[0].id;
  async function seedDocument(title, size, scanStatus) {
    const [document] = (await pool.query(
      `INSERT INTO documents(center_id,school_year_id,title,access_scope,status,created_by,approved_by,approved_at)
       VALUES($1,$2,$3,'center','aprobado',$4,$4,now()) RETURNING id`,
      [centerId, schoolYearId, title, c2.user.id],
    )).rows;
    const storageKey = randomUUID();
    await pool.query(
      `INSERT INTO document_versions(document_id,version,original_name,media_type,size_bytes,sha256,storage_key,scan_status,uploaded_by)
       VALUES($1,1,$2,'text/plain',$3,$4,$5,$6,$7)`,
      [document.id, `${title}.txt`, size, createHash("sha256").update(`${title}:${storageKey}`).digest("hex"),
        storageKey, scanStatus, c2.user.id],
    );
    return document.id;
  }
  const cleanDocumentId = await seedDocument("Acta autorizada", 2048, "limpio");
  const approvedAttachmentDraft = status(await request("/mail/drafts", c2.session, "POST", {
    recipientContactIds: [contact.id], subject: "Adjunto autorizado",
    bodyText: "Solo se fija la versión aprobada y limpia.", classification: "organizativa",
    attachmentDocumentIds: [cleanDocumentId],
  }), 201);
  assert.equal(approvedAttachmentDraft.messages[0].attachments.length, 1);
  assert.equal(approvedAttachmentDraft.messages[0].attachments[0].documentId, cleanDocumentId);
  const dirtyDocumentId = await seedDocument("Acta sin análisis", 2048, "no_configurado");
  const beforeDirtyAttachment = await threadCount();
  status(await request("/mail/drafts", c2.session, "POST", {
    recipientContactIds: [contact.id], subject: "Adjunto no limpio",
    bodyText: "No debe crearse el hilo.", classification: "organizativa",
    attachmentDocumentIds: [dirtyDocumentId],
  }), 400);
  assert.equal(await threadCount(), beforeDirtyAttachment);

  const draftResult = status(await request("/mail/drafts", c2.session, "POST", {
    recipientContactIds: [contact.id],
    templateId: template.id,
    subject: "Convocatoria de prueba",
    bodyText: "Previsualización local. No enviar.",
    classification: "organizativa",
    attachmentDocumentIds: [],
  }), 201);
  const draft = draftResult.messages[0];
  assert.equal(draft.status, "borrador");
  assert.equal(draft.recipient, contact.email);
  const row = (await pool.query(
    "SELECT t.id AS thread_id, t.reply_token, m.thread_id FROM mail_threads t JOIN mail_messages m ON m.thread_id=t.id WHERE m.id=$1",
    [draft.id],
  )).rows[0];
  const thread = status(await request(`/mail/threads/${row.thread_id}`, c2.session), 200);
  assert.equal(thread.messages[0].id, draft.id);
  assert.ok(row.thread_id);
  assert.ok(row.reply_token);
  const rfcMessageId = `<test-${randomUUID()}@iesmmg.org>`;
  await pool.query("UPDATE mail_messages SET message_id=$1 WHERE id=$2", [rfcMessageId, draft.id]);
  assert.equal((await pool.query("SELECT thread_id FROM mail_messages WHERE message_id=$1", [rfcMessageId])).rows[0].thread_id, row.thread_id);
  checks += 4;
  const [quarantinedAttachment] = (await pool.query(
    `INSERT INTO mail_attachments(center_id,school_year_id,message_id,filename,media_type,size_bytes,sha256,storage_key,scan_status)
     VALUES($1,$2,$3,'entrada.txt','text/plain',32,'',$4,'no_configurado') RETURNING id`,
    [centerId, schoolYearId, draft.id, randomUUID()],
  )).rows;
  status(await request(`/mail/attachments/${quarantinedAttachment.id}/download`, c2.session), 403);

  // AT-45: Svix signatures are checked before durable event insertion;
  // duplicate event IDs produce only one row.
  const payload = Buffer.from(JSON.stringify({ type: "email.received", data: { email_id: `re_${randomUUID()}` } }));
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const eventId = randomUUID();
  status(await request("/webhooks/resend", null, "POST", payload, {
    "content-type": "application/json", "svix-id": eventId,
    "svix-timestamp": timestamp, "svix-signature": "v1,invalid",
  }), 401);
  const signature = createHmac("sha256", webhookKey)
    .update(`${eventId}.${timestamp}.`).update(payload).digest("base64");
  const eventHeaders = {
    "content-type": "application/json", "svix-id": eventId,
    "svix-timestamp": timestamp, "svix-signature": `v1,${signature}`,
  };
  const firstEvent = status(await request("/webhooks/resend", null, "POST", payload, eventHeaders), 200);
  const duplicateEvent = status(await request("/webhooks/resend", null, "POST", payload, eventHeaders), 200);
  assert.equal(firstEvent.duplicate, false);
  assert.equal(duplicateEvent.duplicate, true);
  assert.equal(Number((await pool.query(
    "SELECT count(*) FROM mail_webhook_events WHERE provider_event_id=$1", [eventId],
  )).rows[0].count), 1);
  checks += 3;

  // AT-42 / AT-50: explicit independent approval is required. The local DB
  // queue persists, but disabled provider state cannot create a delivery claim.
  const submitted = status(await request(`/mail/drafts/${draft.id}/submit`, c2.session, "POST"), 200);
  assert.equal(submitted.status, "revision");
  const approved = status(await request(`/mail/drafts/${draft.id}/approve`, direction.session, "POST"), 200);
  assert.equal(approved.status, "aprobado");
  const queued = status(await request(`/mail/drafts/${draft.id}/send`, c2.session, "POST", {
    expectedRevision: approved.revision,
  }), 200);
  assert.equal(queued.queued, true);
  assert.equal(queued.deliveryClaimed, false);
  await new Promise(resolve => setTimeout(resolve, 150));
  const storedQueue = (await pool.query(
    "SELECT status, provider_message_id, sent_at FROM mail_messages WHERE id=$1", [draft.id],
  )).rows[0];
  assert.ok(["en_cola", "cola_pausada"].includes(storedQueue.status));
  assert.equal(storedQueue.provider_message_id, null);
  assert.equal(storedQueue.sent_at, null);
  checks += 4;

  console.log(`Comunicaciones: ${checks} comprobaciones locales correctas (AT-41–AT-46, AT-50–AT-51). No se envió correo ni se modificó DNS. La entrega externa AT-42 y las respuestas reales siguen pendientes de credenciales, DNS y autorización.`);
} catch (error) {
  console.error(error);
  await new Promise(resolve => setTimeout(resolve, 75));
  if (output) console.error(output.slice(-5000));
  process.exitCode = 1;
} finally {
  await cleanup();
}
