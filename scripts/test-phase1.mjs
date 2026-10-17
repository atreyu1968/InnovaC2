import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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
  throw new Error("Define TEST_DATABASE_URL for an isolated disposable PostgreSQL database; DATABASE_URL is never used by the phase tests.");
}
if (testDatabaseUrl === process.env.DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL must be different from DATABASE_URL to protect application data.");
}
const testDatabaseName = decodeURIComponent(new URL(testDatabaseUrl).pathname).replace(/^\/+/, "");
if (!/test/i.test(testDatabaseName)) {
  throw new Error("The TEST_DATABASE_URL database name must contain 'test' to reduce the risk of using application data.");
}
const pool = new Pool({ connectionString: testDatabaseUrl });
const testId = randomUUID().replaceAll("-", "").slice(0, 12);
const centerName = `INNOVA-C2 Fase 1 test ${testId}`;
const adminEmail = `phase1-admin-${testId}@example.invalid`;
const c2Email = `phase1-c2-${testId}@example.invalid`;
const adminPassword = `Test-${randomUUID()}-Secure`;
const c2Password = `Test-${randomUUID()}-Secure`;
const port = String(33_000 + Math.floor(Math.random() * 10_000));
const base = `http://127.0.0.1:${port}/api/v1`;
const testDataDirectory = path.join("/tmp", `innova-c2-phase1-${testId}`);
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

async function request(pathname, { method = "GET", cookie, csrf, body } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (csrf) headers["x-csrf-token"] = csrf;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`API server exited during startup.\n${serverOutput.slice(-6000)}`);
    }
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return;
    } catch {
      // Wait for the ephemeral API listener.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`API server did not become healthy.\n${serverOutput.slice(-6000)}`);
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
    await pool.query("DELETE FROM centers WHERE id = $1", [row.id]);
  }
  await pool.end();
  await rm(testDataDirectory, { recursive: true, force: true });
}

function indicatorValues(indicator, actionCode) {
  if (indicator.tipo === "booleano") {
    return {
      indicatorId: indicator.id,
      actionCode,
      unit: "Sí/No",
      targetValue: true,
      riskValue: false,
    };
  }
  let target;
  let risk;
  if (indicator.tipo === "porcentaje") {
    target = Math.min(100, Math.max(70, indicator.minimo_normativo ?? 0));
    risk = Math.max(1, target - 20);
  } else if (indicator.tipo === "escala_1_5") {
    target = Math.min(5, Math.max(4, indicator.minimo_normativo ?? 0));
    risk = Math.max(1, target - 1);
  } else {
    target = Math.max(5, indicator.minimo_normativo ?? 0);
    risk = Math.max(1, target - 2);
  }
  return {
    indicatorId: indicator.id,
    actionCode,
    unit:
      indicator.tipo === "porcentaje"
        ? "%"
        : indicator.tipo === "escala_1_5"
          ? "escala 1-5"
          : "número",
    targetValue: target,
    riskValue: risk,
  };
}

function completePlanContent(catalog) {
  const family = catalog.familias_profesionales[0];
  const dafo = Object.entries(catalog.dafo_categorias).map(([quadrant, choices]) => {
    const firstCategory = choices[0];
    return {
      quadrant,
      category: firstCategory.categoria,
      situation: firstCategory.opciones[0],
    };
  });
  const selectedActions = [];
  for (const objective of catalog.objetivos) {
    const chosen =
      objective.codigo === "1"
        ? objective.acciones.filter((action) => ["1.1", "1.2"].includes(action.codigo))
        : [objective.acciones[0]];
    for (const action of chosen) {
      selectedActions.push({
        actionCode: action.codigo,
        objectiveCode: objective.codigo,
        indicators: action.indicadores.map((indicator) =>
          indicatorValues(indicator, action.codigo),
        ),
      });
    }
  }
  const roles = [
    catalog.cargos_ciclope.find((role) => role.includes("Red de Innovación")),
    catalog.cargos_ciclope.find((role) => role.includes("FP Dual")),
    catalog.cargos_ciclope.find((role) => role.includes("equipo directivo")),
  ];
  assert.ok(roles.every(Boolean), "official CICLOPE roles are present in the imported catalogue");
  const objectives = catalog.objetivos.map((objective) => objective.codigo);
  return {
    coordinator: {
      profile: "C2",
      firstName: "Coordinación",
      lastName: "Prueba Fase 1",
      corporateEmail: `coordinacion-${testId}@canariaseducacion.es`,
      phone: "600123456",
      professionalFamily: family,
    },
    center: {
      professionalFamily: family,
      levels: ["Grado Superior"],
      groupCount: 4,
    },
    dafo,
    projectsInCenter: true,
    projects: [
      {
        promoter: "Propio del centro",
        name: `Proyecto de prueba ${testId}`,
        centerCoordinates: true,
        coordinatingFamily: family,
        coordinatorName: "Coordinación de prueba",
        coordinatorEmail: "contacto@empresa.invalid",
        includedInPic: true,
      },
    ],
    ateca: { available: false, referenceCenter: "Centro de referencia ficticio para prueba" },
    selectedActions,
    customActions: [],
    odsLinks: [
      { agenda: "ods_2030", odsCode: catalog.ods_2030[0], objectiveCodes: objectives.slice(0, 2) },
      { agenda: "ods_canarios", odsCode: catalog.ods_canarios[0], objectiveCodes: objectives.slice(0, 2) },
    ],
    ciclopeMembers: roles.map((role) => ({
      name: `Persona de prueba · ${role}`,
      role,
      professionalFamily: family,
    })),
    calendar: {
      redMeetingDates: ["2026-11-04", "2027-02-03"],
      ciclopeMeetingDates: ["2026-11-04", "2027-01-13", "2027-04-14", "2027-06-09"],
      notes: "",
    },
    diffusion: {
      onlineChannels: ["Web del centro"],
      offlineChannels: ["Claustro y departamentos"],
    },
  };
}

let cleanupFailure;
try {
  await mkdir(testDataDirectory, { recursive: true });
  await waitForServer();
  const status = await request("/setup/status");
  assert.equal(status.response.status, 200);
  assert.equal(status.data.initialized, false, "test requires an unused setup");

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
  assert.equal(initialized.response.status, 201);
  const adminCookie = cookieFrom(initialized.response);
  const adminCsrf = initialized.data.csrfToken;

  const createdC2 = await request("/users", {
    method: "POST",
    cookie: adminCookie,
    csrf: adminCsrf,
    body: {
      email: c2Email,
      name: "Coordinación C2 de prueba",
      role: "c2_innovacion",
      temporaryPassword: c2Password,
    },
  });
  assert.equal(createdC2.response.status, 201, "admin should provision a C2 coordinator");
  const c2Login = await request("/auth/login", {
    method: "POST",
    body: { email: c2Email, password: c2Password },
  });
  assert.equal(c2Login.response.status, 200);
  const c2Cookie = cookieFrom(c2Login.response);
  const c2Csrf = c2Login.data.csrfToken;

  const adminPlanBeforeCreation = await request("/plans/current", { cookie: adminCookie });
  assert.equal(adminPlanBeforeCreation.response.status, 404, "technical admin has PIC access before a plan exists");
  const noPlan = await request("/plans/current", { cookie: c2Cookie });
  assert.equal(noPlan.response.status, 404, "no PIC exists before creation");
  const createdPlan = await request("/plans/current", {
    method: "POST",
    cookie: c2Cookie,
    csrf: c2Csrf,
  });
  assert.equal(createdPlan.response.status, 201);
  const planId = createdPlan.data.id;
  assert.equal(createdPlan.data.revision, 1);

  const catalogResponse = await request("/catalogs/current", { cookie: c2Cookie });
  assert.equal(catalogResponse.response.status, 200);
  const content = completePlanContent(catalogResponse.data);
  const saved = await request(`/plans/${planId}`, {
    method: "PUT",
    cookie: adminCookie,
    csrf: adminCsrf,
    body: { expectedRevision: 1, content },
  });
  assert.equal(saved.response.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.revision, 2);

  const concurrentWrite = await request(`/plans/${planId}`, {
    method: "PUT",
    cookie: c2Cookie,
    csrf: c2Csrf,
    body: { expectedRevision: 1, content },
  });
  assert.equal(concurrentWrite.response.status, 409, "stale revisions cannot overwrite a newer plan");

  const validation = await request(`/plans/${planId}/validation`, { cookie: c2Cookie });
  assert.equal(validation.response.status, 200);
  assert.equal(validation.data.valid, true, JSON.stringify(validation.data.issues));
  const snapshot = await request(`/plans/${planId}/snapshot`, {
    method: "POST",
    cookie: c2Cookie,
    csrf: c2Csrf,
    body: { reason: "Versión de prueba validada" },
  });
  assert.equal(snapshot.response.status, 201, JSON.stringify(snapshot.data));
  assert.match(snapshot.data.sourceHash, /^[a-f0-9]{64}$/);

  const snapshots = await request(`/plans/${planId}/snapshots`, { cookie: c2Cookie });
  assert.equal(snapshots.response.status, 200);
  assert.equal(snapshots.data.length, 1);
  const snapshotDetail = await request(
    `/plans/${planId}/snapshots/${snapshot.data.snapshotId}`,
    { cookie: c2Cookie },
  );
  assert.equal(snapshotDetail.response.status, 200);
  assert.deepEqual(snapshotDetail.data.content, content, "snapshot should retain the complete source revision");

  const laycos = await request(`/plans/${planId}/exports/laycos`, { cookie: c2Cookie });
  assert.equal(laycos.response.status, 200);
  assert.ok(laycos.data.fields.length > 50);
  assert.deepEqual(
    [...new Set(laycos.data.fields.map((field) => field.section))].sort((a, b) => a - b),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  );
  assert.ok(laycos.data.fields.some((field) => field.label.includes("PIC-1.1-I2") && field.value === "5"));

  const docx = await request(`/plans/${planId}/exports/docx`, { cookie: adminCookie });
  assert.equal(docx.response.status, 200);
  const docxBytes = Buffer.from(docx.data.contentBase64, "base64");
  assert.equal(docxBytes.subarray(0, 2).toString(), "PK", "DOCX should be an actual ZIP-based Office document");
  const pdf = await request(`/plans/${planId}/exports/pdf`, { cookie: c2Cookie });
  assert.equal(pdf.response.status, 200, JSON.stringify(pdf.data));
  const pdfBytes = Buffer.from(pdf.data.contentBase64, "base64");
  assert.equal(pdfBytes.subarray(0, 5).toString(), "%PDF-", "PDF should be a real PDF file");
  assert.ok(pdfBytes.subarray(-1024).includes(Buffer.from("%%EOF")));

  const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZkL8AAAAASUVORK5CYII=";
  const submitted = await request(`/plans/${planId}/submission`, {
    method: "POST",
    cookie: c2Cookie,
    csrf: c2Csrf,
    body: {
      snapshotId: snapshot.data.snapshotId,
      submissionDate: "2026-10-20",
      externalIdentifier: "LAYCOS-TEST-01",
      evidenceFileName: "justificante.png",
      evidenceMimeType: "image/png",
      evidenceFileBase64: pngBase64,
    },
  });
  assert.equal(submitted.response.status, 201, JSON.stringify(submitted.data));
  assert.match(submitted.data.evidenceSha256, /^[a-f0-9]{64}$/);
  const submissionRead = await request(`/plans/${planId}/submission`, { cookie: c2Cookie });
  assert.equal(submissionRead.response.status, 200);
  assert.equal(submissionRead.data.externalIdentifier, "LAYCOS-TEST-01");
  const evidenceRead = await request(
    `/plans/${planId}/submission/${submitted.data.id}/evidence`,
    { cookie: c2Cookie },
  );
  assert.equal(evidenceRead.response.status, 200);
  assert.equal(evidenceRead.data.contentBase64, pngBase64);

  const editedContent = structuredClone(content);
  editedContent.calendar.notes = "Cambio posterior al snapshot";
  const edited = await request(`/plans/${planId}`, {
    method: "PUT",
    cookie: c2Cookie,
    csrf: c2Csrf,
    body: { expectedRevision: 2, content: editedContent },
  });
  assert.equal(edited.response.status, 200);
  assert.equal(edited.data.revision, 3);
  assert.equal(edited.data.status, "draft");
  const retained = await request(
    `/plans/${planId}/snapshots/${snapshot.data.snapshotId}`,
    { cookie: c2Cookie },
  );
  assert.equal(retained.response.status, 200);
  assert.equal(retained.data.content.calendar.notes, "", "later edits must not alter immutable snapshots");

  const invalidContent = structuredClone(editedContent);
  invalidContent.selectedActions = invalidContent.selectedActions.filter(
    (action) => action.actionCode !== "1.2",
  );
  invalidContent.selectedActions[0].indicators[1].riskValue = 0;
  const invalidSaved = await request(`/plans/${planId}`, {
    method: "PUT",
    cookie: c2Cookie,
    csrf: c2Csrf,
    body: { expectedRevision: 3, content: invalidContent },
  });
  assert.equal(invalidSaved.response.status, 200);
  const invalidValidation = await request(`/plans/${planId}/validation`, { cookie: c2Cookie });
  assert.equal(invalidValidation.response.status, 200);
  assert.equal(invalidValidation.data.valid, false);
  assert.ok(invalidValidation.data.issues.some((issue) => issue.code === "mandatory_action_1.2"));
  assert.ok(invalidValidation.data.issues.some((issue) => issue.code.startsWith("indicator_positive_")));
  const blockedSnapshot = await request(`/plans/${planId}/snapshot`, {
    method: "POST",
    cookie: c2Cookie,
    csrf: c2Csrf,
    body: { reason: "No debe cerrarse" },
  });
  assert.equal(blockedSnapshot.response.status, 422, "blocking rules prevent snapshot closure");

  const stored = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM pic_dafo WHERE plan_id = $1) AS dafo,
       (SELECT COUNT(*) FROM pic_projects WHERE plan_id = $1) AS projects,
       (SELECT COUNT(*) FROM pic_action_selections WHERE plan_id = $1) AS actions,
       (SELECT COUNT(*) FROM pic_indicator_targets WHERE plan_id = $1) AS targets`,
    [planId],
  );
  const expectedPersistedTargets = invalidContent.selectedActions
    .flatMap((selection) => selection.indicators)
    .filter((indicator) => indicator.targetValue !== null && indicator.riskValue !== null)
    .length;
  assert.equal(Number(stored.rows[0].dafo), 4, "DAFO should be stored in normalized rows");
  assert.equal(Number(stored.rows[0].projects), 1);
  assert.equal(Number(stored.rows[0].actions), invalidContent.selectedActions.length);
  assert.equal(Number(stored.rows[0].targets), expectedPersistedTargets);

  console.log("Fase 1 smoke test completado: edición PIC, validación oficial, concurrencia, snapshots inmutables, exportación DOCX/PDF, campos Laycos y justificante.");
} catch (error) {
  await new Promise((resolve) => setTimeout(resolve, 150));
  console.error(`Fase 1 test failed. Recent API output:\n${serverOutput.slice(-12000)}`);
  throw error;
} finally {
  try {
    await cleanup();
  } catch (error) {
    console.error("Fase 1 cleanup failed; remove the uniquely named test centre before retrying.", error);
    cleanupFailure = error;
  }
}
if (cleanupFailure) throw cleanupFailure;
