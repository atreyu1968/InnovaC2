import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { rm } from "node:fs/promises";

// Never run credential-changing tests against the application's database.
const url = process.env.TEST_DATABASE_URL;
if (!url || url === process.env.DATABASE_URL || !/test/i.test(new URL(url).pathname)) {
  throw new Error("Set TEST_DATABASE_URL to a separate disposable database whose name contains 'test'.");
}
const require = createRequire(import.meta.url);
const { Pool } = require(require.resolve("pg", { paths: ["lib/db"] }));
const pool = new Pool({ connectionString: url });
const port = 39000 + Math.floor(Math.random() * 4000);
const base = `http://127.0.0.1:${port}/api/v1`;
const dataDir = `/tmp/innova-password-change-${randomUUID()}`;
const messages = [];
let failMail = false;
const mail = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  if (failMail) {
    res.writeHead(503).end();
  } else {
    messages.push(JSON.parse(body));
    res.writeHead(200, { "content-type": "application/json" }).end('{"id":"test"}');
  }
});
await new Promise(resolve => mail.listen(0, "127.0.0.1", resolve));
const api = spawn(process.execPath, ["artifacts/api-server/dist/index.mjs"], {
  env: {
    ...process.env,
    DATABASE_URL: url,
    SESSION_SECRET: randomBytes(32).toString("hex"),
    NODE_ENV: "test",
    PORT: String(port),
    DATA_DIR: dataDir,
    RESEND_API_KEY: "test-only",
    RESEND_FROM_EMAIL: "no-reply@example.invalid",
    RESEND_API_BASE_URL: `http://127.0.0.1:${mail.address().port}/emails`,
  },
  stdio: ["ignore", "ignore", "ignore"],
});
async function request(path, { cookie, csrf, body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(csrf ? { "x-csrf-token": csrf } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, data: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
}
const email = `change-${randomUUID()}@example.invalid`;
const before = `Before-${randomUUID()}`;
const after = `After-${randomUUID()}`;
let userId;
let centerId;
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${base}/health`)).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, "test API starts");
  // This suite deliberately requires a freshly migrated empty disposable database.
  const setup = await request("/setup/initialize", { body: {
    email, password: before, name: "Password change test",
    centerName: `Password test ${randomUUID()}`, schoolYear: "2099-2100",
  } });
  assert.equal(setup.status, 201);
  userId = setup.data.user.id;
  centerId = (await pool.query("SELECT center_id FROM users WHERE id=$1", [userId])).rows[0].center_id;
  // Exercise a non-administrator role: this is self-service, not user management.
  await pool.query("UPDATE users SET role='profesorado' WHERE id=$1", [userId]);
  const login = () => request("/auth/login", { body: { email, password: before } });
  const other = await login();
  assert.equal(other.status, 200);
  const cookie = setup.cookie;
  const csrf = setup.data.csrfToken;
  const change = (body, overrides = {}) => request("/auth/password/change", { cookie, csrf, body, ...overrides });
  assert.equal((await change({ currentPassword: before, password: after }, { cookie: undefined })).status, 401);
  assert.equal((await change({ currentPassword: before, password: after }, { csrf: undefined })).status, 403);
  assert.equal((await change({ currentPassword: before, password: after }, { csrf: "wrong" })).status, 403);
  assert.equal((await change({ currentPassword: "wrong", password: after })).status, 400);
  assert.equal((await change({ currentPassword: before, password: "short" })).status, 400);
  assert.equal((await change({ currentPassword: before, password: "x".repeat(1025) })).status, 400);
  assert.equal((await change({ currentPassword: "x".repeat(1025), password: after })).status, 400);
  assert.equal((await change({ currentPassword: before, password: before })).status, 400);
  assert.equal((await request("/auth/me", { cookie: other.cookie })).status, 200);
  assert.equal(messages.length, 0, "rejected requests do not send notices");
  const resetToken = randomBytes(32).toString("base64url");
  await pool.query(
    "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,NOW()+INTERVAL '30 minutes')",
    [userId, createHash("sha256").update(resetToken).digest("hex")],
  );
  const success = await change({ currentPassword: before, password: after, userId: randomUUID() });
  assert.equal(success.status, 200);
  assert.deepEqual(success.data, { success: true, noticeSent: true });
  assert.equal((await request("/auth/me", { cookie })).status, 200, "current session is retained");
  assert.equal((await request("/auth/me", { cookie: other.cookie })).status, 401, "other session is revoked");
  assert.equal((await login()).status, 401, "old password no longer works");
  assert.equal((await request("/auth/login", { body: { email, password: after } })).status, 200);
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0].to, [email]);
  assert.ok(!JSON.stringify(messages).includes(after), "notice excludes credentials");
  assert.ok(!JSON.stringify(messages).includes(before), "notice excludes old credentials");
  assert.equal((await request("/auth/password-reset/complete", { body: { token: resetToken, password: before } })).status, 400);
  const audit = await pool.query("SELECT * FROM audit_logs WHERE user_id=$1 AND action='auth.password.changed'", [userId]);
  assert.equal(audit.rowCount, 1);
  assert.ok(!JSON.stringify(audit.rows).includes(after));
  failMail = true;
  const newest = `Newest-${randomUUID()}`;
  const concurrent = await Promise.all([
    change({ currentPassword: after, password: newest }),
    change({ currentPassword: after, password: `Concurrent-${randomUUID()}` }),
  ]);
  assert.equal(concurrent.filter(r => r.status === 200).length, 1, "only one concurrent change succeeds");
  assert.ok(concurrent.some(r => r.status === 409 || r.status === 400));
  assert.equal(concurrent.find(r => r.status === 200).data.noticeSent, false, "mail failure is explicit");
  assert.equal((await request("/auth/me", { cookie })).status, 200);
  for (let i = 0; i < 8; i++) {
    assert.equal((await change({ currentPassword: "wrong", password: after })).status, 400);
  }
  assert.equal((await change({ currentPassword: "wrong", password: after })).status, 429);
  console.log("Password change: authentication, CSRF, validation, role access, session revocation, reset invalidation, notification success/failure, concurrency, audit and rate limit passed.");
} finally {
  if (api.exitCode === null) {
    api.kill("SIGTERM");
    await Promise.race([once(api, "exit"), new Promise(resolve => setTimeout(resolve, 3000))]);
    if (api.exitCode === null) api.kill("SIGKILL");
  }
  await new Promise(resolve => mail.close(resolve));
  if (userId) await pool.query("DELETE FROM audit_logs WHERE user_id=$1", [userId]);
  if (centerId) await pool.query("DELETE FROM centers WHERE id=$1", [centerId]);
  await pool.end();
  await rm(dataDir, { recursive: true, force: true });
}
