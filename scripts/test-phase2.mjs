import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { Pool } = require(require.resolve("pg", { paths: [path.join(root, "lib/db")] }));
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("Define TEST_DATABASE_URL for a disposable PostgreSQL database; DATABASE_URL is never used by phase tests.");
}
if (testDatabaseUrl === process.env.DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL must be different from DATABASE_URL to protect application data.");
}
const testDatabaseName = decodeURIComponent(new URL(testDatabaseUrl).pathname).replace(/^\/+/, "");
if (!/test/i.test(testDatabaseName)) {
  throw new Error("The TEST_DATABASE_URL database name must contain 'test' to reduce the risk of using application data.");
}

const pushed = spawnSync("pnpm", ["--filter", "@workspace/db", "run", "push"], {
  cwd: root,
  encoding: "utf8",
  env: { ...process.env, DATABASE_URL: testDatabaseUrl },
});
if (pushed.status !== 0) {
  const output = `${pushed.stdout ?? ""}\n${pushed.stderr ?? ""}`.replaceAll(
    testDatabaseUrl,
    "[TEST_DATABASE_URL]",
  );
  throw new Error(`No se pudo preparar la base de pruebas aislada.\n${output.slice(-6000)}`);
}

const pool = new Pool({ connectionString: testDatabaseUrl });
const testId = randomUUID().replaceAll("-", "").slice(0, 12);
const centerName = `INNOVA-C2 Fase 2 test ${testId}`;
const adminEmail = `phase2-admin-${testId}@example.invalid`;
const c2Email = `phase2-c2-${testId}@example.invalid`;
const teacherAEmail = `phase2-a-${testId}@example.invalid`;
const teacherBEmail = `phase2-b-${testId}@example.invalid`;
const headAEmail = `phase2-head-${testId}@example.invalid`;
const adminPassword = `Test-${randomUUID()}-Secure`;
const c2Password = `Test-${randomUUID()}-Secure`;
const teacherAPassword = `Test-${randomUUID()}-Secure`;
const teacherBPassword = `Test-${randomUUID()}-Secure`;
const headAPassword = `Test-${randomUUID()}-Secure`;
const port = String(33_000 + Math.floor(Math.random() * 10_000));
const base = `http://127.0.0.1:${port}/api/v1`;
const testDataDirectory = path.join("/tmp", `innova-c2-phase2-${testId}`);
const server = spawn(
  process.execPath,
  [path.join(root, "artifacts/api-server/dist/index.mjs")],
  {
    cwd: root,
    env: {
      ...process.env,
      DATABASE_URL: testDatabaseUrl,
      PORT: port,
      NODE_ENV: "test",
      TRUST_PROXY: "1",
      DATA_DIR: testDataDirectory,
      CLAMAV_HOST: "",
      SESSION_SECRET: randomUUID(),
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let serverOutput = "";
server.stdout.on("data", (chunk) => (serverOutput += chunk.toString()));
server.stderr.on("data", (chunk) => (serverOutput += chunk.toString()));

function cookieFrom(response) {
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie, "login should issue a session cookie");
  return cookie.split(";")[0];
}

async function request(
  pathname,
  { method = "GET", cookie, csrf, body, headers: extraHeaders = {} } = {},
) {
  const headers = { ...extraHeaders };
  if (cookie) headers.cookie = cookie;
  if (csrf) headers["x-csrf-token"] = csrf;
  const binary = Buffer.isBuffer(body) || body instanceof Uint8Array;
  if (body !== undefined && !binary) headers["content-type"] = "application/json";
  if (binary && !headers["content-type"]) {
    headers["content-type"] = "application/octet-stream";
  }
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers,
    ...(body === undefined
      ? {}
      : { body: binary ? body : JSON.stringify(body) }),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { response, data };
}

function expectStatus(result, status, label) {
  assert.equal(
    result.response.status,
    status,
    `${label}: expected ${status}, received ${result.response.status}; response=${JSON.stringify(result.data)}`,
  );
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`API server exited during startup.\n${serverOutput.slice(-6000)}`);
    }
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return;
    } catch {
      // Wait for the local test API listener.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`API server did not become healthy.\n${serverOutput.slice(-6000)}`);
}

async function createStaff(admin, role, email, name, password, professionalFamily) {
  const result = await request("/users", {
    method: "POST",
    cookie: admin.cookie,
    csrf: admin.csrf,
    body: {
      email,
      name,
      role,
      temporaryPassword: password,
      ...(professionalFamily ? { professionalFamily } : {}),
    },
  });
  expectStatus(result, 201, `create ${role}`);
  const [user] = (
    await pool.query("SELECT id, professional_family FROM users WHERE email = $1", [email])
  ).rows;
  assert.ok(user, `created ${role} is present in the isolated database`);
  return { ...user, email, password };
}

async function login(email, password) {
  const result = await request("/auth/login", {
    method: "POST",
    body: { email, password },
  });
  expectStatus(result, 200, `login ${email}`);
  return { cookie: cookieFrom(result.response), csrf: result.data.csrfToken };
}

async function cleanup() {
  if (server.exitCode === null) {
    server.kill("SIGTERM");
    await Promise.race([
      once(server, "exit"),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
    if (server.exitCode === null) server.kill("SIGKILL");
  }
  const centers = await pool.query("SELECT id FROM centers WHERE name = $1", [centerName]);
  for (const row of centers.rows) {
    await pool.query(
      `DELETE FROM audit_logs
       WHERE entity_id = $1::text
          OR entity_id IN (SELECT id::text FROM users WHERE center_id = $1::uuid)
          OR entity_id IN (SELECT id::text FROM school_years WHERE center_id = $1::uuid)
          OR user_id IN (SELECT id FROM users WHERE center_id = $1::uuid)`,
      [row.id],
    );
    // Approved evidence deliberately prevents deleting its immutable version.
    // Remove only this disposable center's evidence before the center cascade.
    await pool.query(
      `DELETE FROM evidences WHERE document_version_id IN (
        SELECT v.id FROM document_versions v
        JOIN documents d ON d.id = v.document_id WHERE d.center_id = $1
      )`,
      [row.id],
    );
    await pool.query("DELETE FROM information_requests WHERE center_id = $1", [row.id]);
    await pool.query("DELETE FROM activities WHERE center_id = $1", [row.id]);
    await pool.query("DELETE FROM documents WHERE center_id = $1", [row.id]);
    await pool.query("DELETE FROM centers WHERE id = $1", [row.id]);
  }
  await pool.end();
  await rm(testDataDirectory, { recursive: true, force: true });
}

function indicatorRows(catalog) {
  return catalog.objetivos.flatMap((objective) =>
    objective.acciones.flatMap((action) =>
      action.indicadores.map((indicator) => ({
        actionCode: action.codigo,
        indicator,
      })),
    ),
  );
}

let testFailure;
try {
  await mkdir(testDataDirectory, { recursive: true });
  await waitForServer();
  const setupStatus = await request("/setup/status");
  expectStatus(setupStatus, 200, "setup status");
  assert.equal(setupStatus.data.initialized, false, "test requires an unused isolated database");

  const initialized = await request("/setup/initialize", {
    method: "POST",
    body: {
      email: adminEmail,
      name: "Administración de prueba",
      password: adminPassword,
      centerName,
      schoolYear: "2099-2100",
    },
  });
  expectStatus(initialized, 201, "initialize test center");
  const admin = {
    cookie: cookieFrom(initialized.response),
    csrf: initialized.data.csrfToken,
  };

  const c2 = await createStaff(
    admin,
    "c2_innovacion",
    c2Email,
    "Coordinación C2 de prueba",
    c2Password,
  );
  const c2Session = await login(c2Email, c2Password);
  const catalogs = await request("/catalogs/current", { cookie: c2Session.cookie });
  expectStatus(catalogs, 200, "read official PIC catalogue");
  const catalog = catalogs.data;
  const families = catalog.familias_profesionales;
  assert.ok(Array.isArray(families) && families.length >= 2, "official catalogue has at least two families");

  const teacherA = await createStaff(
    admin,
    "profesorado",
    teacherAEmail,
    "Profesorado familia A",
    teacherAPassword,
    families[0],
  );
  const teacherB = await createStaff(
    admin,
    "profesorado",
    teacherBEmail,
    "Profesorado familia B",
    teacherBPassword,
    families[1],
  );
  const headA = await createStaff(
    admin,
    "jefatura_departamento",
    headAEmail,
    "Jefatura familia A",
    headAPassword,
    families[0],
  );

  const teacherASession = await login(teacherAEmail, teacherAPassword);
  const teacherBSession = await login(teacherBEmail, teacherBPassword);
  const headASession = await login(headAEmail, headAPassword);
  // An existing account can be assigned by its administrator without recreation.
  await pool.query("UPDATE users SET professional_family = NULL WHERE id = $1", [teacherA.id]);
  expectStatus(await request(`/users/${teacherA.id}/family`, {
    method: "POST", cookie: admin.cookie, csrf: admin.csrf,
    body: { expectedFamily: null, professionalFamily: families[0] },
  }), 200, "assign family to existing account");
  expectStatus(await request(`/users/${teacherA.id}/family`, {
    method: "POST", cookie: admin.cookie, csrf: admin.csrf,
    body: { expectedFamily: null, professionalFamily: families[1] },
  }), 409, "reject stale family assignment");
  expectStatus(await request(`/users/${teacherB.id}/family`, {
    method: "POST", cookie: teacherASession.cookie, csrf: teacherASession.csrf,
    body: { expectedFamily: families[1], professionalFamily: families[0] },
  }), 403, "teacher cannot change family assignments");

  const staffOptions = await request("/staff/options", { cookie: c2Session.cookie });
  expectStatus(staffOptions, 200, "C2 staff selector");
  assert.ok(staffOptions.data.some((staff) => staff.id === teacherA.id));
  expectStatus(
    await request("/staff/options", { cookie: teacherASession.cookie }),
    403,
    "non-C2 staff selector denial",
  );

  const createdPlan = await request("/plans/current", {
    method: "POST",
    cookie: c2Session.cookie,
    csrf: c2Session.csrf,
  });
  expectStatus(createdPlan, 201, "create course PIC");
  const planId = createdPlan.data.id;
  const availableIndicators = indicatorRows(catalog);
  const selectedIndicators = [
    availableIndicators.find(({ indicator }) => indicator.tipo === "numero"),
    availableIndicators.find(({ indicator }) => indicator.tipo === "booleano"),
    availableIndicators.find(({ indicator }) => indicator.tipo === "porcentaje"),
  ];
  assert.ok(selectedIndicators.every(Boolean), "official PIC contains numeric, boolean and percentage indicators");

  for (const item of selectedIndicators) {
    const { indicator, actionCode } = item;
    const code = indicator.id ?? indicator.codigo;
    assert.ok(code, "selected official indicator has a stable code");
    const type = indicator.tipo;
    const unit =
      type === "porcentaje" ? "%" : type === "booleano" ? "Sí/No" : "número";
    const target = type === "booleano" ? true : type === "porcentaje" ? 70 : 1;
    const risk = type === "booleano" ? false : type === "porcentaje" ? 50 : 0;
    await pool.query(
      `INSERT INTO pic_indicator_targets
        (plan_id, action_code, indicator_id, unit, target_value, risk_value, updated_by)
       VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6::jsonb, $7::uuid)`,
      [planId, actionCode, code, unit, JSON.stringify(target), JSON.stringify(risk), c2.id],
    );
    item.code = code;
  }
  const numericIndicator = selectedIndicators.find(({ indicator }) => indicator.tipo === "numero");
  const booleanIndicator = selectedIndicators.find(({ indicator }) => indicator.tipo === "booleano");
  const percentageIndicator = selectedIndicators.find(({ indicator }) => indicator.tipo === "porcentaje");

  const created = await request("/activities", {
    method: "POST",
    cookie: teacherASession.cookie,
    csrf: teacherASession.csrf,
    body: {
      title: `Actuación de prueba ${testId}`,
      description: "Registro real de prueba de captura y trazabilidad.",
      activityDate: null,
      professionalFamily: families[0],
      projectId: null,
      responsibleUserId: null,
      sourceLabel: "Registro manual",
      indicatorCodes: [numericIndicator.code],
    },
  });
  expectStatus(created, 201, "create activity");
  assert.equal(created.data.duplicate, false);
  const activity = created.data.activity;
  assert.equal(activity.informationStatus, "en_revision");

  const duplicate = await request("/activities", {
    method: "POST",
    cookie: teacherASession.cookie,
    csrf: teacherASession.csrf,
    body: {
      title: `Actuación de prueba ${testId}`,
      description: "Texto distinto, mismo registro identificable.",
      activityDate: null,
      professionalFamily: families[0],
      projectId: null,
      responsibleUserId: null,
      sourceLabel: "Otra fuente del mismo registro",
      indicatorCodes: [numericIndicator.code],
    },
  });
  expectStatus(duplicate, 201, "deduplicate same activity");
  assert.equal(duplicate.data.duplicate, true);
  assert.equal(duplicate.data.activity.id, activity.id);

  expectStatus(
    await request("/activities", { cookie: teacherBSession.cookie }),
    200,
    "family B activity list",
  );
  const familyBActivities = await request("/activities", { cookie: teacherBSession.cookie });
  assert.ok(!familyBActivities.data.some((row) => row.id === activity.id), "family B cannot read family A activity");
  const familyAActivities = await request("/activities", { cookie: headASession.cookie });
  expectStatus(familyAActivities, 200, "same-family head activity list");
  assert.ok(familyAActivities.data.some((row) => row.id === activity.id));
  const forbiddenFamilyActivity = await request("/activities", {
    method: "POST",
    cookie: teacherASession.cookie,
    csrf: teacherASession.csrf,
    body: {
      title: `Actuación fuera de ámbito ${testId}`,
      description: "Debe bloquearse.",
      activityDate: null,
      professionalFamily: families[1],
      projectId: null,
      responsibleUserId: null,
      sourceLabel: "Prueba de ámbito",
      indicatorCodes: [],
    },
  });
  expectStatus(forbiddenFamilyActivity, 403, "cross-family activity creation");

  const requestedFields = ["activityDate"];
  async function requestMissingDate() {
    const result = await request("/information-requests", {
      method: "POST",
      cookie: c2Session.cookie,
      csrf: c2Session.csrf,
      body: {
        recipientUserId: teacherA.id,
        subjectType: "activity",
        subjectId: activity.id,
        requestedFields,
        reason: "Completar la fecha necesaria para validar el registro.",
      },
    });
    expectStatus(result, 201, "create minimal information request");
    return result.data;
  }
  async function answerAndValidate(responseStatus, answers = {}) {
    const informationRequest = await requestMissingDate();
    const response = await request(
      `/information-requests/${informationRequest.id}/respond`,
      {
        method: "POST",
        cookie: teacherASession.cookie,
        csrf: teacherASession.csrf,
        body: {
          responseStatus,
          answers,
          comment: `Respuesta ${responseStatus} de prueba`,
        },
      },
    );
    expectStatus(response, 201, `respond ${responseStatus}`);
    const validated = await request(
      `/information-requests/${informationRequest.id}/validate`,
      {
        method: "POST",
        cookie: c2Session.cookie,
        csrf: c2Session.csrf,
        body: { expectedRevision: response.data.revision },
      },
    );
    expectStatus(validated, 200, `validate ${responseStatus}`);
    assert.equal(validated.data.latestResponseStatus, responseStatus);
    return validated.data;
  }

  const noInformation = await answerAndValidate("sin_informacion");
  assert.equal(noInformation.latestAnswers && Object.keys(noInformation.latestAnswers).length, 0);
  const notPerformed = await answerAndValidate("no_realizada");
  assert.equal(notPerformed.latestResponseStatus, "no_realizada");
  const dateRequest = await requestMissingDate();
  const dateResponse = await request(`/information-requests/${dateRequest.id}/respond`, {
    method: "POST",
    cookie: teacherASession.cookie,
    csrf: teacherASession.csrf,
    body: {
      responseStatus: "respondida",
      answers: { activityDate: "2026-12-10" },
      comment: "Fecha confirmada para el test.",
    },
  });
  expectStatus(dateResponse, 201, "respond with missing activity date");
  const dateValidated = await request(
    `/information-requests/${dateRequest.id}/validate`,
    {
      method: "POST",
      cookie: c2Session.cookie,
      csrf: c2Session.csrf,
      body: { expectedRevision: dateResponse.data.revision },
    },
  );
  expectStatus(dateValidated, 200, "validate activity date response");
  assert.equal(dateValidated.data.latestResponseStatus, "respondida");

  const afterDate = await request("/activities", { cookie: teacherASession.cookie });
  const updatedActivity = afterDate.data.find((row) => row.id === activity.id);
  assert.equal(updatedActivity.activityDate, "2026-12-10");
  assert.equal(updatedActivity.informationStatus, "en_revision");
  const confirmed = await request(`/activities/${activity.id}/confirm`, {
    method: "POST",
    cookie: teacherASession.cookie,
    csrf: teacherASession.csrf,
    body: {
      expectedRevision: updatedActivity.revision,
      informationStatus: "confirmada",
    },
  });
  expectStatus(confirmed, 200, "confirm activity information");
  const validatedActivity = await request(`/activities/${activity.id}/validate`, {
    method: "POST",
    cookie: c2Session.cookie,
    csrf: c2Session.csrf,
    body: { expectedRevision: confirmed.data.revision },
  });
  expectStatus(validatedActivity, 200, "C2 validate activity");
  assert.equal(validatedActivity.data.status, "validada");

  const indicatorsBeforeEvidence = await request("/indicators/current", {
    cookie: c2Session.cookie,
  });
  expectStatus(indicatorsBeforeEvidence, 200, "read PIC indicator summary");
  const numberSummary = indicatorsBeforeEvidence.data.find(
    (item) => item.code === numericIndicator.code,
  );
  assert.equal(numberSummary.activityCount, 0, "an activity without approved evidence must not increment the count");
  assert.equal(numberSummary.currentValue, null, "absence of qualifying evidence is not represented as zero");

  const zeroObservation = await request(
    `/indicators/${numericIndicator.code}/observations`,
    {
      method: "POST",
      cookie: c2Session.cookie,
      csrf: c2Session.csrf,
      body: { period: "2026-12" },
    },
  );
  expectStatus(zeroObservation, 201, "record deterministic numeric observation");
  assert.equal(zeroObservation.data.value, 0);
  assert.equal(zeroObservation.data.assessment, "sin_datos");
  const missingBooleanEvidence = await request(
    `/indicators/${booleanIndicator.code}/observations`,
    {
      method: "POST",
      cookie: c2Session.cookie,
      csrf: c2Session.csrf,
      body: { period: "2026-12", value: true, evidenceIds: [] },
    },
  );
  expectStatus(missingBooleanEvidence, 400, "boolean observation requires evidence");
  const missingPercentageEvidence = await request(
    `/indicators/${percentageIndicator.code}/observations`,
    {
      method: "POST",
      cookie: c2Session.cookie,
      csrf: c2Session.csrf,
      body: { period: "2026-12", numerator: 8, denominator: 10, evidenceIds: [] },
    },
  );
  expectStatus(missingPercentageEvidence, 400, "percentage observation requires evidence");

  const pdf = Buffer.from("%PDF-1.4\nINNOVA-C2 isolated test evidence\n%%EOF\n");
  const uploadParams = new URLSearchParams({
    title: `Evidencia de prueba ${testId}`,
    category: "evidencia",
    professionalFamily: families[0],
    accessScope: "family",
    activityId: activity.id,
    indicatorCode: numericIndicator.code,
    fileName: "evidencia.pdf",
  });
  const uploaded = await request(`/documents?${uploadParams.toString()}`, {
    method: "POST",
    cookie: teacherASession.cookie,
    csrf: teacherASession.csrf,
    body: pdf,
  });
  expectStatus(uploaded, 201, "upload private evidence to quarantine");
  assert.equal(uploaded.data.status, "pendiente_revision");
  assert.notEqual(uploaded.data.scanStatus, "limpio", "test intentionally has no antivirus daemon configured");
  const documentId = uploaded.data.id;

  const duplicateFile = await request(`/documents?${uploadParams.toString()}`, {
    method: "POST",
    cookie: teacherASession.cookie,
    csrf: teacherASession.csrf,
    body: pdf,
  });
  expectStatus(duplicateFile, 201, "reuse duplicate document");
  assert.equal(duplicateFile.data.id, documentId, "identical file reuses the existing document");
  const familyBDocument = await request(`/documents/${documentId}`, {
    cookie: teacherBSession.cookie,
  });
  expectStatus(familyBDocument, 404, "family boundary for document metadata");

  const granted = await request(`/documents/${documentId}/access`, {
    method: "POST",
    cookie: c2Session.cookie,
    csrf: c2Session.csrf,
    body: { userId: teacherB.id, granted: true },
  });
  expectStatus(granted, 200, "grant explicit cross-family document access");
  const grantedDocument = await request(`/documents/${documentId}`, {
    cookie: teacherBSession.cookie,
  });
  expectStatus(grantedDocument, 200, "read document after explicit grant");
  assert.equal(grantedDocument.data.document.scanStatus, uploaded.data.scanStatus);

  const blockedDownload = await request(
    `/documents/${documentId}/versions/1/content`,
    { cookie: teacherBSession.cookie },
  );
  expectStatus(blockedDownload, 409, "quarantined evidence cannot be downloaded");
  const blockedApproval = await request(`/documents/${documentId}/approve`, {
    method: "POST",
    cookie: c2Session.cookie,
    csrf: c2Session.csrf,
    body: { expectedRevision: uploaded.data.revision },
  });
  expectStatus(blockedApproval, 409, "quarantined evidence cannot be approved");

  const newerPdf = Buffer.from("%PDF-1.4\nINNOVA-C2 second immutable version\n%%EOF\n");
  const newVersion = await request(`/documents/${documentId}/versions`, {
    method: "POST",
    cookie: teacherASession.cookie,
    csrf: teacherASession.csrf,
    body: newerPdf,
  });
  expectStatus(newVersion, 201, "add immutable document version without custom header");
  assert.equal(newVersion.data.currentVersion, 2);
  assert.equal(newVersion.data.status, "pendiente_revision");
  assert.notEqual(newVersion.data.sha256, uploaded.data.sha256);

  const requestsForTeacher = await request("/information-requests", {
    cookie: teacherASession.cookie,
  });
  expectStatus(requestsForTeacher, 200, "recipient sees own information requests");
  assert.ok(requestsForTeacher.data.every((row) => row.recipientUserId === teacherA.id));
  const requestsForOther = await request("/information-requests", {
    cookie: teacherBSession.cookie,
  });
  expectStatus(requestsForOther, 200, "other family request list");
  assert.ok(requestsForOther.data.every((row) => row.recipientUserId === teacherB.id));

} catch (error) {
  testFailure = error;
} finally {
  await cleanup().catch((error) => {
    testFailure ??= error;
  });
}

if (testFailure) {
  throw testFailure;
}
console.log("Phase 2 integration tests passed: family assignments and scope, activity deduplication and revisions, distinct information outcomes, immutable/private documents, quarantine, grants, indicator evidence rules, and cleanup.");
