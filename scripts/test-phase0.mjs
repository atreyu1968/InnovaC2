import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { createHmac, randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
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
const centerName = `INNOVA-C2 Fase 0 test ${testId}`;
const adminEmail = `phase0-admin-${testId}@example.invalid`;
const teacherEmail = `phase0-teacher-${testId}@example.invalid`;
const adminPassword = `Test-${randomUUID()}-Secure`;
const teacherPassword = `Test-${randomUUID()}-Secure`;
const failedLoginIp = "203.0.113.27";
const blockedEmail = `phase0-lock-${testId}@example.invalid`;
const port = String(32_000 + Math.floor(Math.random() * 12_000));
const base = `http://127.0.0.1:${port}/api/v1`;
const testDataDirectory = path.join("/tmp", `innova-c2-phase0-${testId}`);
const server = spawn(
  process.execPath,
  [path.join(root, "artifacts/api-server/dist/index.mjs")],
  {
    cwd: root,
    env: {
      ...process.env,
      DATABASE_URL: testDatabaseUrl,
      DATA_DIR: testDataDirectory,
      PORT: port,
      NODE_ENV: "test",
      TRUST_PROXY: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let serverOutput = "";
server.stdout.on("data", (chunk) => (serverOutput += chunk.toString()));
server.stderr.on("data", (chunk) => (serverOutput += chunk.toString()));
let centerId;

function cookieFrom(response) {
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie, "server should issue an HttpOnly session cookie");
  return cookie.split(";")[0];
}

async function request(pathname, { method = "GET", cookie, csrf, body, forwardedFor } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (csrf) headers["x-csrf-token"] = csrf;
  if (forwardedFor) headers["x-forwarded-for"] = forwardedFor;
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
      throw new Error(`API server exited during startup.\n${serverOutput.slice(-5000)}`);
    }
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return;
    } catch {
      // The listener is not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`API server did not become healthy.\n${serverOutput.slice(-5000)}`);
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
  const centers = await pool.query(
    "SELECT id FROM centers WHERE name = $1",
    [centerName],
  );
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
  const keyHash = (value) =>
    createHmac("sha256", process.env.SESSION_SECRET).update(value).digest("hex");
  const ipKeys = [
    keyHash(`login-ip:${failedLoginIp}`),
    keyHash(`login-identity:${failedLoginIp}:${blockedEmail}`),
  ];
  await pool.query(
    "DELETE FROM auth_login_attempts WHERE key = ANY($1::text[])",
    [ipKeys],
  );
  await pool.query(
    "DELETE FROM audit_logs WHERE action = 'auth.login.failed' AND ip_hash = $1",
    [keyHash(failedLoginIp)],
  );
  await pool.end();
  await rm(testDataDirectory, { recursive: true, force: true });
}

let cleanupFailure;
try {
  await waitForServer();
  const setup = await request("/setup/status");
  assert.equal(setup.response.status, 200);
  assert.equal(setup.data.initialized, false, "smoke test requires an unused setup");

  const catalog = JSON.parse(
    await readFile(
      path.join(root, "config/pic_2026_2027_catalogo.json"),
      "utf8",
    ),
  );
  const initialized = await request("/setup/initialize", {
    method: "POST",
    body: {
      email: adminEmail,
      name: "Prueba automatizada Fase 0",
      password: adminPassword,
      centerName,
      schoolYear: "2099-2100",
    },
  });
  assert.equal(initialized.response.status, 201, "one-shot setup should succeed");
  const adminCookie = cookieFrom(initialized.response);
  const adminCsrf = initialized.data.csrfToken;
  const adminId = initialized.data.user.id;
  const createdCenter = await pool.query(
    "SELECT id FROM centers WHERE name = $1",
    [centerName],
  );
  centerId = createdCenter.rows[0]?.id;
  assert.ok(centerId, "setup should persist the centre");

  const setupAgain = await request("/setup/initialize", {
    method: "POST",
    body: {
      email: adminEmail,
      name: "Duplicated setup",
      password: adminPassword,
      centerName,
      schoolYear: "2099-2100",
    },
  });
  assert.equal(setupAgain.response.status, 409, "initial setup must be one-shot");

  const current = await request("/auth/me", { cookie: adminCookie });
  assert.equal(current.response.status, 200, "session cookie should authenticate");
  assert.equal(current.data.user.id, adminId);
  assert.equal(current.data.csrfToken, adminCsrf, "CSRF token survives page reload");

  const dashboard = await request("/dashboard/summary", { cookie: adminCookie });
  assert.equal(dashboard.response.status, 200);
  assert.equal(dashboard.data.userCount, 1);
  assert.equal(dashboard.data.objectiveCount, 6);
  assert.equal(dashboard.data.actionCount, 24);
  assert.equal(dashboard.data.indicatorCount, 31);

  const officialCatalog = await request("/catalogs/current", {
    cookie: adminCookie,
  });
  assert.equal(officialCatalog.response.status, 200);
  assert.equal(officialCatalog.data.objetivos.length, 6);
  assert.equal(
    officialCatalog.data.objetivos.reduce((sum, item) => sum + item.acciones.length, 0),
    24,
  );
  assert.equal(
    officialCatalog.data.objetivos.reduce(
      (sum, objective) =>
        sum +
        objective.acciones.reduce(
          (actionSum, action) => actionSum + action.indicadores.length,
          0,
        ),
      0,
    ),
    31,
  );

  const noCsrf = await request("/users", {
    method: "POST",
    cookie: adminCookie,
    body: {
      email: teacherEmail,
      name: "Docente de prueba",
      role: "profesorado",
      temporaryPassword: teacherPassword,
    },
  });
  assert.equal(noCsrf.response.status, 403, "writes require CSRF validation");

  const createdUser = await request("/users", {
    method: "POST",
    cookie: adminCookie,
    csrf: adminCsrf,
    body: {
      email: teacherEmail,
      name: "Docente de prueba",
      role: "profesorado",
      temporaryPassword: teacherPassword,
      professionalFamily: officialCatalog.data.familias_profesionales[0],
    },
  });
  assert.equal(createdUser.response.status, 201, "admin should create a user");
  assert.equal(createdUser.data.role, "profesorado");
  const accounts = await request("/users", { cookie: adminCookie });
  assert.equal(accounts.response.status, 200);
  assert.equal(accounts.data.length, 2);

  const login = await request("/auth/login", {
    method: "POST",
    body: { email: teacherEmail.toUpperCase(), password: teacherPassword },
  });
  assert.equal(login.response.status, 200, "email login should be case-insensitive");
  const teacherCookie = cookieFrom(login.response);
  const teacherCsrf = login.data.csrfToken;
  const deniedUsers = await request("/users", { cookie: teacherCookie });
  assert.equal(deniedUsers.response.status, 403, "RBAC must be enforced server-side");
  const deniedImport = await request("/admin/catalogs/import", {
    method: "POST",
    cookie: teacherCookie,
    csrf: teacherCsrf,
    body: { catalog },
  });
  assert.equal(deniedImport.response.status, 403);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const failedLogin = await request("/auth/login", {
      method: "POST",
      forwardedFor: failedLoginIp,
      body: { email: blockedEmail, password: "Invalid-password-for-test" },
    });
    assert.equal(failedLogin.response.status, 401);
  }
  const rateLimited = await request("/auth/login", {
    method: "POST",
    forwardedFor: failedLoginIp,
    body: { email: blockedEmail, password: "Invalid-password-for-test" },
  });
  assert.equal(rateLimited.response.status, 429, "repeated failures must trigger a persistent lock");

  const reimport = await request("/admin/catalogs/import", {
    method: "POST",
    cookie: adminCookie,
    csrf: adminCsrf,
    body: { catalog },
  });
  assert.equal(reimport.response.status, 201);
  assert.equal(reimport.data.active, true, "importing the same hash must be idempotent");

  const invalidCatalog = structuredClone(catalog);
  invalidCatalog.objetivos = [];
  const invalidImport = await request("/admin/catalogs/import", {
    method: "POST",
    cookie: adminCookie,
    csrf: adminCsrf,
    body: { catalog: invalidCatalog },
  });
  assert.equal(invalidImport.response.status, 400, "invalid catalogue must be rejected");

  const logout = await request("/auth/logout", {
    method: "POST",
    cookie: teacherCookie,
    csrf: teacherCsrf,
  });
  assert.equal(logout.response.status, 200);
  const expired = await request("/auth/me", { cookie: teacherCookie });
  assert.equal(expired.response.status, 401, "logout must revoke the session");

  console.log("Fase 0 smoke test completado: configuración, persistencia, catálogo, CSRF, RBAC, login, cierre de sesión y bloqueo por intentos.");
} finally {
  try {
    await cleanup();
  } catch (error) {
    console.error("Smoke-test cleanup failed. Remove the uniquely named test centre before retrying.", error);
    cleanupFailure = error;
  }
}
if (cleanupFailure) throw cleanupFailure;
