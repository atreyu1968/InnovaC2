import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { mock } from "node:test";

// Real router, auth/CSRF, provider loader/encryption and HTTP transport.
// Only database and logger are replaced; no application database is opened.
const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const { build } = require("esbuild");
const express = require("express");
const dir = await mkdtemp(resolve(tmpdir(), "innova-ai-check-"));
const root = resolve(import.meta.dirname, "..");
process.env.SESSION_SECRET = "isolated-synthetic-test-secret-not-for-real-use";
const csrf = "synthetic-csrf";
// Advance only Date, not network timers: no sleeps and no real provider calls.
mock.timers.enable({ apis: ["Date"], now: Date.now() });
const database = `
  import { AsyncLocalStorage } from "node:async_hooks";
  export const requestContext = new AsyncLocalStorage();
  export const state = { role: "admin_tecnico", userId: "test-admin", centerId: "test-center", sessions: {}, row: null, reads: 0, writes: 0 };
  export const usersTable = {}, aiProviderSettingsTable = {}, auditLogsTable = {}, centersTable = {};
  export const authSessionsTable = {}, rolePermissionsTable = {}, schoolYearsTable = {}, schoolYearAssignmentsTable = {};
  export const db = {
    select() { state.reads++; return { from(table) {
      const chain = { innerJoin() { return chain; }, where() { return chain; }, async limit() {
         const identity = requestContext.getStore();
        if (table === authSessionsTable) return [{
           sessionId: identity.sessionId, csrfHash: ${JSON.stringify(createHash("sha256").update(csrf).digest("hex"))},
           userId: identity.userId, role: state.role, active: true
        }];
         if (table === usersTable) return [{ centerId: identity.centerId }];
        if (table === aiProviderSettingsTable) return state.row ? [state.row] : [];
        throw new Error("Unexpected read");
      }}; return chain;
    }}; },
    insert() { state.writes++; throw new Error("No writes allowed"); },
    update() { state.writes++; throw new Error("No writes allowed"); },
    transaction() { state.writes++; throw new Error("No writes allowed"); }
  };
`;
let appServer, provider;
try {
  const bundle = resolve(dir, "check.cjs");
  await build({
    stdin: {
      contents: `
        export { default as router } from "./src/routes/ai-provider";
         export { state, requestContext } from "@workspace/db";
        export { encryptAIProviderKey } from "./src/lib/ai-provider";
        export { requestAIJson } from "./src/lib/ai-http";
      `,
      resolveDir: resolve(root, "artifacts/api-server"),
    },
    outfile: bundle, bundle: true, platform: "node", format: "cjs", logLevel: "silent",
    plugins: [{
      name: "isolated-db",
      setup(build) {
        build.onResolve({ filter: /\/ai-provider-check-limits$/ }, () => ({
          path: resolve(root, "scripts/fixtures/ai-check-memory-limits.ts"),
        }));
        build.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: "db", namespace: "isolated" }));
        build.onLoad({ filter: /.*/, namespace: "isolated" }, () => ({ contents: database, loader: "js" }));
        build.onResolve({ filter: /\/logger$/ }, () => ({ path: "logger", namespace: "logger" }));
        build.onLoad({ filter: /.*/, namespace: "logger" }, () => ({ contents: "export const logger = { error() {} };" }));
      },
    }],
  });
  const { router, state, requestContext, encryptAIProviderKey, requestAIJson } = await import(pathToFileURL(bundle).href).then(m => m.default);
  let scenario = "ok", calls = 0;
  let hold;
  const paths = [];
  provider = createServer(async (req, res) => {
    calls++;
    paths.push(req.url);
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    assert.equal(req.headers.authorization, "Bearer synthetic-provider-key");
    res.setHeader("content-type", "application/json");
    if (hold && hold.calls < 2) {
      const gate = hold;
      if (++gate.calls === 2) gate.started.resolve();
      await gate.release.promise;
    }
    if (scenario === "timeout") return;
    if (scenario === "disconnect") return void req.socket.destroy();
    if (scenario.startsWith("http-")) {
      res.writeHead(Number(scenario.slice(5))).end('{"error":"synthetic-provider-key credential details"}');
      return;
    }
    if (scenario === "invalid-json") return void res.end("synthetic-provider-key: invalid JSON");
    if (scenario === "oversize") return void res.end(JSON.stringify({ text: "x".repeat(2 * 1024 * 1024) }));
    if (scenario === "bad-shape") return void res.end("null");
    if (req.url === "/v1/audio/transcriptions") {
      assert.match(req.headers["content-type"], /multipart\/form-data/);
      assert.match(body.toString(), /saved-transcription-model/);
      assert.match(body.toString(), /comprobacion-sintetica.wav/);
      assert.ok(body.includes(Buffer.from("RIFF")));
      res.end(JSON.stringify(scenario === "partial" ? { wrong: true } : { text: "" }));
    } else {
      assert.equal(req.url, "/v1/chat/completions");
      const data = JSON.parse(body.toString());
      assert.equal(data.model, "saved-minutes-model");
      assert.match(data.messages[0].content, /datos ficticios/);
      res.end(JSON.stringify({ choices: [{ message: { content: "Respuesta sintética." } }] }));
    }
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  const baseUrl = `http://127.0.0.1:${provider.address().port}/v1`;
  const key = encryptAIProviderKey("synthetic-provider-key");
  const row = {
    provider: "local", baseUrl, transcriptionModel: "saved-transcription-model",
    minutesModel: "saved-minutes-model", revision: 7,
    apiKeyCiphertext: key.ciphertext, apiKeyIv: key.iv, apiKeyTag: key.tag,
  };
  state.row = structuredClone(row);
  const app = express();
  app.use(express.json());
  // Test-only sessions map to stable identities; production auth and CSRF still run.
  app.use((req, res, next) => {
    const token = req.headers.cookie?.split("=")[1];
    if (req.headers["x-test-response-failure"]) {
      const json = res.json.bind(res);
      res.json = () => {
        res.json = json;
        throw new Error("Synthetic unexpected response failure: synthetic-provider-key");
      };
    }
    requestContext.run({
      sessionId: token,
      ...(state.sessions[token] ?? { userId: state.userId, centerId: state.centerId }),
    }, next);
  });
  app.use(router);
  appServer = app.listen(0, "127.0.0.1");
  await once(appServer, "listening");
  const url = `http://127.0.0.1:${appServer.address().port}/admin/ai/provider/check`;
  async function request(body = { expectedRevision: 7, syntheticSampleConfirmed: true }, options = {}) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(options.session === false ? {} : { cookie: `innova_session=${options.session ?? "synthetic-session"}` }),
        ...(options.csrf === false ? {} : { "x-csrf-token": options.csrf ?? csrf }),
        ...(options.responseFailure ? { "x-test-response-failure": "true" } : {}),
      },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    assert.ok(!JSON.stringify(data).includes("synthetic-provider-key"), "Never return upstream details or credentials");
    return { status: response.status, data, headers: response.headers };
  }
  function assertThrottled(result, seconds) {
    assert.equal(result.status, 429);
    assert.equal(result.headers.get("cache-control"), "no-store");
    const retry = Number(result.headers.get("retry-after"));
    assert.ok(Number.isInteger(retry) && retry > 0, "Send a valid Retry-After");
    if (seconds !== undefined) assert.equal(retry, seconds);
    assert.match(result.data.error, /[Ee]spera/);
    assert.match(result.data.error, new RegExp(`${retry} segundos`));
    assert.deepEqual(Object.keys(result.data), ["error"], "No identity or configuration leaks");
  }
  function session(name, userId, centerId = "test-center") {
    state.sessions[name] = { userId, centerId };
    return { session: name };
  }
  const otherSession = session("another-session", "test-admin");
  const otherUser = session("other-user-session", "other-admin");
  const thirdUser = session("third-user-session", "third-admin");
  const fourthUser = session("fourth-user-session", "fourth-admin");
  const movedUser = session("same-user-other-center", "test-admin", "other-center");
  const independent = session("independent-session", "independent-admin", "independent-center");
  assert.equal((await request(undefined, { session: false })).status, 401);
  assert.equal((await request(undefined, { csrf: false })).status, 403);
  assert.equal((await request(undefined, { csrf: "wrong" })).status, 403);
  for (const role of ["c2_innovacion", "coordinacion_red", "jefatura_departamento", "profesorado", "direccion", "admin"]) {
    state.role = role;
    assert.equal((await request()).status, 403);
  }
  state.role = "admin_tecnico";
  state.centerId = null;
  assert.equal((await request()).status, 403);
  state.centerId = "test-center";
  for (const body of [
    {}, { expectedRevision: 7, syntheticSampleConfirmed: false },
    { expectedRevision: 7, syntheticSampleConfirmed: "true" },
    { expectedRevision: 7, syntheticSampleConfirmed: true, transcript: "Never send this" },
    { expectedRevision: -1, syntheticSampleConfirmed: true },
  ]) assert.equal((await request(body)).status, 400);
  assert.equal((await request({ expectedRevision: 6, syntheticSampleConfirmed: true })).status, 409);
  for (const patch of [null, { provider: "disabled" }, { baseUrl: null }, { minutesModel: null },
    { provider: "external_authorized", externalAuthorizedAt: null },
    { provider: "external_authorized", externalAuthorizedAt: new Date(), apiKeyCiphertext: null },
    { apiKeyTag: "invalid" }]) {
    state.row = patch === null ? null : { ...row, ...patch };
    assert.equal((await request()).status, 503);
  }
  assert.equal(calls, 0, "No network calls before auth, CSRF, confirmation and valid saved settings");
  state.row = structuredClone(row);
  const snapshot = structuredClone(state.row);
  const good = await request();
  assert.equal(good.status, 200);
  assert.equal(good.headers.get("cache-control"), "no-store");
  assert.equal(good.data.revision, 7);
  assert.equal(good.data.qualityAssessed, false);
  assert.equal(good.data.transcription.status, "ok");
  assert.equal(good.data.minutes.status, "ok");
  assert.ok(Number.isFinite(Date.parse(good.data.checkedAt)));
  assert.equal(calls, 2, "One diagnostic sends exactly one request to each model");

  // Quotas are identity-based, never cookie/IP-based, and rejected attempts do not count.
  let before = calls;
  const rapid = await Promise.all(Array.from({ length: 12 }, () => request(undefined, otherSession)));
  rapid.forEach(result => assertThrottled(result, 60));
  assertThrottled(await request(undefined, movedUser), 60);
  assert.equal(calls, before, "Repeated sessions cannot bypass the user limit");
  assert.equal((await request(undefined, otherUser)).status, 200);
  assert.equal((await request(undefined, thirdUser)).status, 200);
  before = calls;
  assertThrottled(await request(undefined, fourthUser), 300);
  assert.equal(calls, before, "Different administrators share the center quota");
  assert.equal((await request(undefined, independent)).status, 200, "Other centers/users are independent");
  mock.timers.tick(59_999);
  assertThrottled(await request(undefined, movedUser), 1);
  mock.timers.tick(1);
  assert.equal((await request(undefined, movedUser)).status, 200, "User window expires at exactly one minute");
  mock.timers.tick(239_999);
  assertThrottled(await request(undefined, fourthUser), 1);
  mock.timers.tick(1);
  assert.equal((await request(undefined, fourthUser)).status, 200, "Center window expires at exactly five minutes");

  // Hold the real HTTP provider open while other sessions race the route.
  mock.timers.tick(300_000);
  hold = { calls: 0, started: Promise.withResolvers(), release: Promise.withResolvers() };
  const pending = request();
  let timer;
  try {
    await Promise.race([
      hold.started.promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Diagnostic did not reach both models")), 3000); }),
    ]);
    clearTimeout(timer);
    before = calls;
    const concurrent = await Promise.all(Array.from({ length: 18 }, (_, i) =>
      request(undefined, [otherSession, otherUser, movedUser][i % 3])));
    concurrent.forEach(result => {
      assertThrottled(result);
      assert.match(result.data.error, /en curso/);
    });
    assert.equal(calls, before, "Only one diagnostic can be in flight across sessions, users and centers sharing an identity");
    mock.timers.tick(300_000);
    assertThrottled(await request(undefined, otherSession), 1);
    assertThrottled(await request(undefined, otherUser), 1);
    assertThrottled(await request(undefined, movedUser), 1);
    assert.equal(calls, before, "Reservations do not expire while a diagnostic is still running");
    assert.equal((await request(undefined, independent)).status, 200, "Unrelated identities are not globally locked");
  } finally {
    clearTimeout(timer);
    hold.release.resolve();
  }
  assert.equal((await pending).status, 200);
  hold = undefined;
  assert.equal((await request(undefined, otherSession)).status, 200, "Completion releases both identity locks");

  for (const [testCase, expected] of [
    ["http-401", "authorization_error"], ["http-403", "authorization_error"],
    ["http-400", "model_error"], ["http-404", "model_error"], ["http-422", "model_error"],
    ["http-429", "provider_error"], ["http-500", "provider_error"], ["http-307", "provider_error"],
    ["invalid-json", "format_error"], ["bad-shape", "format_error"], ["oversize", "format_error"],
    ["disconnect", "connection_error"],
  ]) {
    mock.timers.tick(300_000);
    scenario = testCase;
    const result = await request();
    assert.equal(result.status, 200);
    assert.equal(result.data.transcription.status, expected, testCase);
    assert.equal(result.data.minutes.status, expected, testCase);
    before = calls;
    assertThrottled(await request(undefined, otherSession), 60);
    assert.equal(calls, before, "Failed diagnostics also consume quota without repeating provider calls");
  }
  mock.timers.tick(300_000);
  scenario = "partial";
  const partial = await request();
  assert.equal(partial.data.transcription.status, "format_error");
  assert.equal(partial.data.minutes.status, "ok");
  mock.timers.tick(300_000);
  scenario = "ok";
  assert.equal((await request()).status, 200, "Provider failures do not leave concurrency locks stuck");
  mock.timers.tick(300_000);
  assert.equal((await request(undefined, { responseFailure: true })).status, 500);
  before = calls;
  assertThrottled(await request(undefined, otherSession), 60);
  assert.equal(calls, before, "Unexpected errors also retain the consumption limit");
  mock.timers.tick(60_000);
  assert.equal((await request(undefined, otherSession)).status, 200, "Unexpected errors release the lock in finally");
  assert.deepEqual(state.row, snapshot, "The saved provider remains unchanged after every diagnostic");
  const config = { mode: "local", baseUrl, apiKey: "synthetic-provider-key" };
  before = calls;
  for (const guard of [
    { signal: AbortSignal.abort(), deadline: Infinity },
    { signal: new AbortController().signal, deadline: Date.now() - 1 },
  ]) {
    await assert.rejects(requestAIJson(config, "chat/completions", "{}", 1000, guard),
      error => error.kind === "connection");
  }
  assert.equal(calls, before, "Cancelled or expired reservations cannot dispatch requests");
  scenario = "timeout";
  await assert.rejects(requestAIJson(config, "chat/completions", "{}", 25), e => e.kind === "connection");
  state.row = { ...row, baseUrl: "http://169.254.169.254/v1" };
  mock.timers.tick(300_000);
  before = calls;
  const blocked = await request();
  assert.equal(blocked.data.transcription.status, "connection_error");
  assert.equal(blocked.data.minutes.status, "connection_error");
  assert.equal(calls, before, "Forbidden endpoint blocked before opening a socket");
  assert.equal(state.writes, 0, "No settings, meetings or audit content is saved");
  assert.ok(paths.every(p => ["/v1/audio/transcriptions", "/v1/chat/completions"].includes(p)), "No redirects followed");
  console.log("PASS: isolated provider diagnostics: real auth/CSRF, explicit confirmation, saved config, both models, per-user/center quotas and exact expiry, cross-session concurrency, failure recovery, HTTP/format/network errors, no writes or credential leaks.");
} finally {
  mock.timers.reset();
  for (const server of [appServer, provider]) {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
  await rm(dir, { recursive: true, force: true });
}
