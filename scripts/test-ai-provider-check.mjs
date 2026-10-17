import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

// Real router, auth/CSRF, provider loader/encryption and HTTP transport.
// Only database and logger are replaced; no application database is opened.
const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const { build } = require("esbuild");
const express = require("express");
const dir = await mkdtemp(resolve(tmpdir(), "innova-ai-check-"));
const root = resolve(import.meta.dirname, "..");
process.env.SESSION_SECRET = "isolated-synthetic-test-secret-not-for-real-use";
const csrf = "synthetic-csrf";
const database = `
  export const state = { role: "admin_tecnico", centerId: "test-center", row: null, reads: 0, writes: 0 };
  export const usersTable = {}, aiProviderSettingsTable = {}, auditLogsTable = {}, centersTable = {};
  export const authSessionsTable = {}, rolePermissionsTable = {}, schoolYearsTable = {}, schoolYearAssignmentsTable = {};
  export const db = {
    select() { state.reads++; return { from(table) {
      const chain = { innerJoin() { return chain; }, where() { return chain; }, async limit() {
        if (table === authSessionsTable) return [{
          sessionId: "test-session", csrfHash: ${JSON.stringify(createHash("sha256").update(csrf).digest("hex"))},
          userId: "test-admin", role: state.role, active: true
        }];
        if (table === usersTable) return [{ centerId: state.centerId }];
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
        export { state } from "@workspace/db";
        export { encryptAIProviderKey } from "./src/lib/ai-provider";
        export { requestAIJson } from "./src/lib/ai-http";
      `,
      resolveDir: resolve(root, "artifacts/api-server"),
    },
    outfile: bundle, bundle: true, platform: "node", format: "cjs", logLevel: "silent",
    plugins: [{
      name: "isolated-db",
      setup(build) {
        build.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: "db", namespace: "isolated" }));
        build.onLoad({ filter: /.*/, namespace: "isolated" }, () => ({ contents: database, loader: "js" }));
        build.onResolve({ filter: /\/logger$/ }, () => ({ path: "logger", namespace: "logger" }));
        build.onLoad({ filter: /.*/, namespace: "logger" }, () => ({ contents: "export const logger = { error() {} };" }));
      },
    }],
  });
  const { router, state, encryptAIProviderKey, requestAIJson } = await import(pathToFileURL(bundle).href).then(m => m.default);
  let scenario = "ok", calls = 0;
  const paths = [];
  provider = createServer(async (req, res) => {
    calls++;
    paths.push(req.url);
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    assert.equal(req.headers.authorization, "Bearer synthetic-provider-key");
    res.setHeader("content-type", "application/json");
    if (scenario === "timeout") return;
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
  app.use(router);
  appServer = app.listen(0, "127.0.0.1");
  await once(appServer, "listening");
  const url = `http://127.0.0.1:${appServer.address().port}/admin/ai/provider/check`;
  async function request(body = { expectedRevision: 7, syntheticSampleConfirmed: true }, options = {}) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(options.session === false ? {} : { cookie: "innova_session=synthetic-session" }),
        ...(options.csrf === false ? {} : { "x-csrf-token": options.csrf ?? csrf }),
      },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    assert.ok(!JSON.stringify(data).includes("synthetic-provider-key"), "Never return upstream details or credentials");
    return { status: response.status, data, headers: response.headers };
  }
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
  for (const [testCase, expected] of [
    ["http-401", "authorization_error"], ["http-403", "authorization_error"],
    ["http-400", "model_error"], ["http-404", "model_error"], ["http-422", "model_error"],
    ["http-429", "provider_error"], ["http-500", "provider_error"], ["http-307", "provider_error"],
    ["invalid-json", "format_error"], ["bad-shape", "format_error"], ["oversize", "format_error"],
  ]) {
    scenario = testCase;
    const result = await request();
    assert.equal(result.status, 200);
    assert.equal(result.data.transcription.status, expected, testCase);
    assert.equal(result.data.minutes.status, expected, testCase);
  }
  scenario = "partial";
  const partial = await request();
  assert.equal(partial.data.transcription.status, "format_error");
  assert.equal(partial.data.minutes.status, "ok");
  assert.deepEqual(state.row, snapshot, "The saved provider remains unchanged after every diagnostic");
  const config = { mode: "local", baseUrl, apiKey: "synthetic-provider-key" };
  scenario = "timeout";
  await assert.rejects(requestAIJson(config, "chat/completions", "{}", 25), e => e.kind === "connection");
  state.row = { ...row, baseUrl: "http://169.254.169.254/v1" };
  const before = calls;
  const blocked = await request();
  assert.equal(blocked.data.transcription.status, "connection_error");
  assert.equal(blocked.data.minutes.status, "connection_error");
  assert.equal(calls, before, "Forbidden endpoint blocked before opening a socket");
  assert.equal(state.writes, 0, "No settings, meetings or audit content is saved");
  assert.ok(paths.every(p => ["/v1/audio/transcriptions", "/v1/chat/completions"].includes(p)), "No redirects followed");
  console.log("PASS: isolated provider diagnostics: real auth/CSRF, explicit confirmation, saved config, both models, HTTP/format/network errors, no writes or credential leaks.");
} finally {
  for (const server of [appServer, provider]) {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
  await rm(dir, { recursive: true, force: true });
}
