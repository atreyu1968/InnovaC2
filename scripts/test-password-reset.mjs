import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { Pool } = require(require.resolve("pg", { paths: [path.join(root, "lib/db")] }));
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("Define TEST_DATABASE_URL for an isolated disposable PostgreSQL database; DATABASE_URL is never used by password reset tests.");
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
const email = `reset-admin-${testId}@example.invalid`;
const centerName = `INNOVA-C2 password reset test ${testId}`;
const initialPassword = `Before-${randomUUID()}-Secure`;
const newPassword = `After-${randomUUID()}-Secure`;
const apiPort = String(35_000 + Math.floor(Math.random() * 8_000));
const mailPort = String(44_000 + Math.floor(Math.random() * 8_000));
const base = `http://127.0.0.1:${apiPort}/api/v1`;
const mailApiUrl = `http://127.0.0.1:${mailPort}/emails`;
const testDataDirectory = path.join("/tmp", `innova-c2-password-reset-${testId}`);
const sentEmails = [];
let failNextEmail = false;
let apiOutput = "";
let apiServer;

const mailServer = createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/emails") {
    res.writeHead(404).end();
    return;
  }
  let body = "";
  for await (const chunk of req) body += chunk;
  const message = JSON.parse(body);
  if (req.headers.authorization !== "Bearer resend-test-key") {
    res.writeHead(401).end();
    return;
  }
  if (failNextEmail) {
    failNextEmail = false;
    res.writeHead(503, { "content-type": "application/json" }).end('{"error":"simulated"}');
    return;
  }
  sentEmails.push(message);
  res.writeHead(200, { "content-type": "application/json" }).end('{"id":"email-test"}');
});

function cookieFrom(response) {
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie, "setup should issue an HttpOnly session cookie");
  return cookie.split(";")[0];
}

async function request(pathname, { method = "GET", cookie, body, forwardedFor } = {}) {
  const headers = { origin: `http://127.0.0.1:${apiPort}` };
  if (cookie) headers.cookie = cookie;
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

async function waitForApi() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (apiServer.exitCode !== null) {
      throw new Error(`API server exited during startup.\n${apiOutput.slice(-6000)}`);
    }
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return;
    } catch {
      // The API listener is not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`API server did not become healthy.\n${apiOutput.slice(-6000)}`);
}

async function cleanup() {
  if (apiServer?.exitCode === null) {
    apiServer.kill("SIGTERM");
    await Promise.race([
      once(apiServer, "exit"),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
    if (apiServer.exitCode === null) apiServer.kill("SIGKILL");
  }
  await new Promise((resolve) => mailServer.close(resolve));
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
  const hashKey = (value) =>
    createHmac("sha256", process.env.SESSION_SECRET).update(value).digest("hex");
  const keys = [
    ...Array.from({ length: 12 }, (_, i) => hashKey(`password-reset-ip:203.0.113.${100 + i}`)),
    ...[
      email,
      `unknown-${testId}@example.invalid`,
      ...Array.from({ length: 5 }, (_, i) => `ip-limit-${i}-${testId}@example.invalid`),
      `ip-limit-final-${testId}@example.invalid`,
    ].map((address) => hashKey(`password-reset-email:${address}`)),
  ];
  await pool.query("DELETE FROM auth_login_attempts WHERE key = ANY($1::text[])", [keys]);
  await pool.end();
  await rm(testDataDirectory, { recursive: true, force: true });
}

let cleanupFailure;
try {
  await new Promise((resolve, reject) => {
    mailServer.once("error", reject);
    mailServer.listen(Number(mailPort), "127.0.0.1", resolve);
  });
  apiServer = spawn(
    process.execPath,
    [path.join(root, "artifacts/api-server/dist/index.mjs")],
    {
      cwd: root,
      env: {
        ...process.env,
        DATABASE_URL: testDatabaseUrl,
        DATA_DIR: testDataDirectory,
        PORT: apiPort,
        NODE_ENV: "test",
        TRUST_PROXY: "1",
        RESEND_API_KEY: "resend-test-key",
        RESEND_FROM_EMAIL: "INNOVA-C2 <no-reply@example.invalid>",
        RESEND_API_BASE_URL: mailApiUrl,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  apiServer.stdout.on("data", (chunk) => (apiOutput += chunk.toString()));
  apiServer.stderr.on("data", (chunk) => (apiOutput += chunk.toString()));
  await waitForApi();

  const initialized = await request("/setup/initialize", {
    method: "POST",
    body: {
      email,
      name: "Administración de prueba",
      password: initialPassword,
      centerName,
      schoolYear: "2099-2100",
    },
  });
  assert.equal(initialized.response.status, 201);
  const oldCookie = cookieFrom(initialized.response);
  const userResult = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
  const userId = userResult.rows[0]?.id;
  assert.ok(userId);

  const unknown = await request("/auth/password-reset/request", {
    method: "POST",
    body: { email: `unknown-${testId}@example.invalid` },
    forwardedFor: "203.0.113.100",
  });
  assert.equal(unknown.response.status, 202);
  const sentBefore = sentEmails.length;
  failNextEmail = true;
  const deliveryFailure = await request("/auth/password-reset/request", {
    method: "POST",
    body: { email },
    forwardedFor: "203.0.113.101",
  });
  assert.equal(deliveryFailure.response.status, 202, "delivery errors must not disclose account existence");
  assert.deepEqual(deliveryFailure.data, unknown.data, "known and unknown accounts receive the same response");
  assert.equal(sentEmails.length, sentBefore, "the simulated failing sender should not record a delivered email");
  const afterDeliveryFailure = await pool.query(
    "SELECT COUNT(*)::int AS count FROM password_reset_tokens WHERE user_id = $1",
    [userId],
  );
  assert.equal(afterDeliveryFailure.rows[0].count, 0, "failed delivery must not leave an unusable token");

  const requested = await request("/auth/password-reset/request", {
    method: "POST",
    body: { email: email.toUpperCase() },
    forwardedFor: "203.0.113.102",
  });
  assert.equal(requested.response.status, 202);
  assert.deepEqual(requested.data, unknown.data);
  assert.equal(sentEmails.length, sentBefore + 1);
  const resetMessage = sentEmails.at(-1);
  assert.equal(resetMessage.to[0], email);
  const resetUrl = new URL(resetMessage.text.match(/https?:\/\/\S+/)[0]);
  const token = resetUrl.searchParams.get("token");
  assert.ok(token, "email includes a reset token");
  const stored = await pool.query(
    "SELECT token_hash, expires_at FROM password_reset_tokens WHERE user_id = $1",
    [userId],
  );
  assert.equal(stored.rows.length, 1);
  assert.equal(
    stored.rows[0].token_hash,
    createHash("sha256").update(token).digest("hex"),
    "only the token hash should be stored",
  );
  assert.notEqual(stored.rows[0].token_hash, token);
  assert.ok(new Date(stored.rows[0].expires_at) > new Date());

  const invalid = await request("/auth/password-reset/complete", {
    method: "POST",
    body: { token: randomBytes(32).toString("base64url"), password: newPassword },
  });
  assert.equal(invalid.response.status, 400, "unknown tokens are rejected");

  const completed = await request("/auth/password-reset/complete", {
    method: "POST",
    cookie: oldCookie,
    body: { token, password: newPassword },
  });
  assert.equal(completed.response.status, 200);
  assert.match(completed.response.headers.get("set-cookie") ?? "", /Max-Age=0|Expires=/i);
  const revokedSession = await request("/auth/me", { cookie: oldCookie });
  assert.equal(revokedSession.response.status, 401, "password change revokes existing sessions");
  const reused = await request("/auth/password-reset/complete", {
    method: "POST",
    body: { token, password: `Reuse-${randomUUID()}-Secure` },
  });
  assert.equal(reused.response.status, 400, "a completed token cannot be reused");
  const oldLogin = await request("/auth/login", {
    method: "POST",
    body: { email, password: initialPassword },
  });
  assert.equal(oldLogin.response.status, 401, "old password is rejected");
  const newLogin = await request("/auth/login", {
    method: "POST",
    body: { email, password: newPassword },
  });
  assert.equal(newLogin.response.status, 200, "new password works");
  const audit = await pool.query(
    "SELECT COUNT(*)::int AS count FROM audit_logs WHERE user_id = $1 AND action = 'auth.password_reset.completed'",
    [userId],
  );
  assert.equal(audit.rows[0].count, 1, "password change is audited");

  const expiredRequest = await request("/auth/password-reset/request", {
    method: "POST",
    body: { email },
    forwardedFor: "203.0.113.103",
  });
  assert.equal(expiredRequest.response.status, 202);
  const expiredToken = new URL(sentEmails.at(-1).text.match(/https?:\/\/\S+/)[0]).searchParams.get("token");
  await pool.query(
    "UPDATE password_reset_tokens SET expires_at = NOW() - INTERVAL '1 minute' WHERE token_hash = $1",
    [createHash("sha256").update(expiredToken).digest("hex")],
  );
  const expired = await request("/auth/password-reset/complete", {
    method: "POST",
    body: { token: expiredToken, password: `Expired-${randomUUID()}-Secure` },
  });
  assert.equal(expired.response.status, 400, "expired tokens are rejected");

  const beforeEmailLimit = sentEmails.length;
  const emailLimit = await request("/auth/password-reset/request", {
    method: "POST",
    body: { email },
    forwardedFor: "203.0.113.104",
  });
  assert.equal(emailLimit.response.status, 202, "per-address rate limiting keeps the generic response");
  assert.deepEqual(emailLimit.data, unknown.data);
  assert.equal(sentEmails.length, beforeEmailLimit, "requests beyond the per-address limit do not send email");

  for (let i = 0; i < 5; i += 1) {
    const limited = await request("/auth/password-reset/request", {
      method: "POST",
      body: { email: `ip-limit-${i}-${testId}@example.invalid` },
      forwardedFor: "203.0.113.105",
    });
    assert.equal(limited.response.status, 202);
  }
  const ipLimited = await request("/auth/password-reset/request", {
    method: "POST",
    body: { email: `ip-limit-final-${testId}@example.invalid` },
    forwardedFor: "203.0.113.105",
  });
  assert.equal(ipLimited.response.status, 429, "repeated requests from one IP are rate limited");

  console.log("Password reset test passed: generic responses, hashed and expiring one-time tokens, request limits, email failure handling, session revocation, and audit record.");
} catch (error) {
  await new Promise((resolve) => setTimeout(resolve, 150));
  console.error(`Password reset test failed. Recent API output:\n${apiOutput.slice(-10000)}`);
  throw error;
} finally {
  try {
    await cleanup();
  } catch (error) {
    console.error("Password reset test cleanup failed; remove the uniquely named test centre before retrying.", error);
    cleanupFailure = error;
  }
}
if (cleanupFailure) throw cleanupFailure;
