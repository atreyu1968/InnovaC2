import assert from "node:assert/strict";
import { spawn, fork } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";

const root = resolve(import.meta.dirname, "..");
const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const dbRequire = createRequire(new URL("../lib/db/package.json", import.meta.url));
const { build } = require("esbuild");
const { Pool } = dbRequire("pg");
// Never consume a supplied application/test database or any application secret.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !key.startsWith("PG") && !/DATABASE_URL|SESSION_SECRET|AI_INTEGRATIONS/.test(key)));
const directory = await mkdtemp(resolve(tmpdir(), "innova-ai-shared-"));
const data = resolve(directory, "postgres");
const socket = resolve(directory, "socket");
const children = new Set();
let admin, provider, started = false, activeTool;
const interrupted = () => {
  for (const child of children) child.kill("SIGKILL");
  activeTool?.kill("SIGKILL");
};
process.once("SIGINT", interrupted);
process.once("SIGTERM", interrupted);

async function run(command, args) {
  await new Promise((done, fail) => {
    let output = "";
    const child = spawn(command, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    activeTool = child;
    const timer = setTimeout(() => child.kill("SIGKILL"), 90_000);
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    child.once("error", fail);
    child.once("close", code => {
      clearTimeout(timer);
      activeTool = undefined;
      code === 0 ? done() : fail(new Error(`${command} failed (${code}): ${output}`));
    });
  });
}

async function worker() {
  const child = fork(resolve(directory, "worker.cjs"), [], {
    env: { ...env, WORKER_ID: randomUUID() }, stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  children.add(child);
  let output = "";
  child.stderr.on("data", chunk => { output += chunk; });
  const pending = new Map();
  child.on("message", message => {
    const callback = pending.get(message.id);
    if (callback) { pending.delete(message.id); callback.resolve(message.result); }
  });
  child.once("exit", () => {
    children.delete(child);
    for (const callback of pending.values()) callback.reject(new Error(`Worker exited: ${output}`));
    pending.clear();
  });
  await Promise.race([
    once(child, "message"),
    new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error("Worker startup timeout")), 10_000); timer.unref(); }),
  ]);
  return {
    child,
    call(command, identity, extra = {}) {
      const id = randomUUID();
      return new Promise((done, fail) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          fail(new Error(`Worker command timed out: ${command}`));
        }, 30_000);
        pending.set(id, {
          resolve(value) { clearTimeout(timer); done(value); },
          reject(error) { clearTimeout(timer); fail(error); },
        });
        child.send({ id, command, ...identity, ...extra });
      });
    },
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const closed = once(child, "exit");
      child.kill("SIGKILL");
      await closed;
    },
  };
}
const identity = (centerId = randomUUID(), userId = randomUUID()) => ({ userId, centerId });
const denied = result => {
  assert.equal(result.allowed, false, JSON.stringify(result));
  assert.ok(result.retryAfterSeconds >= 1 && result.retryAfterSeconds <= 300);
};

try {
  await mkdir(socket, { mode: 0o700 });
  await run("initdb", ["-D", data, "-U", "ai_check_test", "--auth=trust", "--no-locale", "--encoding=UTF8"]);
  await run("pg_ctl", ["-D", data, "-l", resolve(directory, "postgres.log"),
    "-o", `-F -h '' -k '${socket}'`, "-w", "-t", "15", "start"]);
  started = true;
  await run("createdb", ["-h", socket, "-U", "ai_check_test", "ai_check_test"]);
  const url = new URL("postgresql://ai_check_test@localhost/ai_check_test");
  url.searchParams.set("host", socket);
  env.DATABASE_URL = url.href;
  // Exercise the real ordered migration chain on a new, owned cluster.
  await run("pnpm", ["--filter", "@workspace/db", "run", "migrate"]);
  admin = new Pool({ connectionString: url.href });
  await build({
    entryPoints: [resolve(root, "scripts/fixtures/ai-check-worker.ts")],
    outfile: resolve(directory, "worker.cjs"), bundle: true, platform: "node", format: "cjs", logLevel: "silent",
    plugins: [{
      name: "owned-postgres",
      setup(builder) {
        builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: "db", namespace: "owned" }));
        builder.onLoad({ filter: /.*/, namespace: "owned" }, () => ({ contents: `
          import { createRequire } from "node:module";
          const loadPg = createRequire(${JSON.stringify(new URL("../lib/db/package.json", import.meta.url).href)});
          export const pool = new (loadPg("pg").Pool)({
            connectionString: process.env.DATABASE_URL, application_name: process.env.WORKER_ID, max: 30
          });`, loader: "js" }));
      },
    }],
  });
  let calls = 0, held = false, activeSockets = 0;
  let bothStarted;
  const waiting = new Set();
  provider = createServer((req, res) => {
    calls++;
    activeSockets++;
    res.on("close", () => { activeSockets--; waiting.delete(res); });
    req.resume();
    const respond = () => {
      res.setHeader("content-type", "application/json");
      res.end(req.url.endsWith("transcriptions") ? '{"text":""}' : '{"choices":[{"message":{"content":"Ficticio"}}]}');
    };
    if (held) {
      waiting.add(res);
      if (waiting.size === 2) bothStarted?.();
    } else respond();
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  const baseUrl = `http://127.0.0.1:${provider.address().port}/v1`;
  let a = await worker();
  const b = await worker();
  const c = await worker();
  const runCheck = (w, id) => w.call("run", id, { baseUrl });
  const release = (w, reservation) => w.call("release", undefined, { reservation });
  const age = async (id, seconds, expire = false) => admin.query(`
    UPDATE ai_provider_check_usage SET started_at = clock_timestamp() - $3 * interval '1 second'
      ${expire ? ", reserved_until = clock_timestamp() - interval '1 second'" : ""}
    WHERE user_id = $1 AND center_id = $2`, [id.userId, id.centerId, seconds]);

  const id = identity();
  assert.equal((await runCheck(a, id)).allowed, true);
  assert.equal(calls, 2);
  await a.stop();
  a = await worker();
  denied(await runCheck(a, id));
  denied(await runCheck(b, { ...identity(), userId: id.userId }));
  assert.equal(calls, 2, "Restart and a different center cannot reset the user's quota");
  assert.equal((await runCheck(b, identity(id.centerId))).allowed, true);
  assert.equal((await runCheck(c, identity(id.centerId))).allowed, true);
  const before = calls;
  denied(await runCheck(a, identity(id.centerId)));
  assert.equal(calls, before, "Center quota survives across three processes");
  await age(id, 61);
  denied(await runCheck(a, id)); // Center still has 3 starts.
  await admin.query("UPDATE ai_provider_check_usage SET started_at = clock_timestamp() - interval '301 seconds' WHERE center_id = $1", [id.centerId]);
  assert.equal((await runCheck(a, id)).allowed, true);

  // Only the winner opens sockets, including races sharing only one identity.
  const race = identity();
  const results = await Promise.all(Array.from({ length: 18 }, (_, i) =>
    [a, b, c][i % 3].call("hold", i % 2 ? race : { ...race, userId: randomUUID() })));
  assert.equal(results.filter(result => result.allowed).length, 1);
  const winner = results.findIndex(result => result.allowed);
  await release([a, b, c][winner % 3], results[winner].reservation);
  // A held live reservation stays exclusive even after all timestamps expire.
  const live = identity();
  const reservation = await a.call("hold", live);
  assert.equal(reservation.allowed, true);
  a.child.kill("SIGSTOP");
  try {
    await age(live, 301, true);
    denied(await b.call("hold", live));
    denied(await b.call("hold", { ...live, centerId: randomUUID() }));
    denied(await b.call("hold", { ...live, userId: randomUUID() }));
    assert.equal((await runCheck(c, identity())).allowed, true, "Unrelated centers are not globally locked");
  } finally { a.child.kill("SIGCONT"); }
  await release(a, reservation.reservation);
  assert.equal((await runCheck(b, live)).allowed, true);

  const crash = identity();
  assert.equal((await a.call("hold", crash)).allowed, true);
  await a.stop();
  denied(await b.call("hold", { ...crash, userId: randomUUID() }));
  await age(crash, 61, true);
  assert.equal((await runCheck(b, crash)).allowed, true, "Abandoned reservation is recovered after quarantine");
  a = await worker();

  // Kill a database backend while real fake-provider sockets are open. The
  // production error listener must abort both sockets, retaining quarantine.
  const lost = identity();
  held = true;
  const reached = new Promise(resolve => { bothStarted = resolve; });
  const pending = runCheck(a, lost);
  await Promise.race([reached, new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error("Fake provider did not receive both calls")), 5000);
    timer.unref();
  })]);
  denied(await b.call("hold", lost));
  // No other test reservation is live here: find its actual lock-owning backend.
  const owners = await admin.query(`SELECT DISTINCT pid FROM pg_locks WHERE locktype = 'advisory' AND granted`);
  assert.equal(owners.rows.length, 1);
  await admin.query("SELECT pg_terminate_backend($1)", [owners.rows[0].pid]);
  const cancelled = await pending;
  assert.equal(cancelled.diagnostic.transcription.status, "connection_error");
  assert.equal(cancelled.diagnostic.minutes.status, "connection_error");
  const until = Date.now() + 2000;
  while (activeSockets && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(activeSockets, 0, "Both live HTTP sockets close after database connection loss");
  denied(await b.call("hold", { ...lost, userId: randomUUID() }));
  held = false;
  await age(lost, 61, true);
  assert.equal((await runCheck(b, lost)).allowed, true);

  // Provider failures consume quota and finally releases the session locks.
  const failed = identity();
  const failedResult = await b.call("run", failed, { baseUrl: "http://169.254.169.254/v1" });
  assert.equal(failedResult.diagnostic.minutes.status, "connection_error");
  denied(await c.call("hold", failed));
  await age(failed, 61);
  assert.equal((await runCheck(c, failed)).allowed, true);
  const columns = await admin.query(`SELECT column_name FROM information_schema.columns
    WHERE table_name = 'ai_provider_check_usage' ORDER BY ordinal_position`);
  assert.deepEqual(columns.rows.map(row => row.column_name),
    ["id", "user_id", "center_id", "started_at", "reserved_until"]);
  const raw = JSON.stringify((await admin.query("SELECT * FROM ai_provider_check_usage")).rows);
  for (const secret of ["synthetic-only", "Ficticio", "fake-audio", baseUrl]) assert.ok(!raw.includes(secret));
  await admin.query("ALTER TABLE ai_provider_check_usage RENAME TO unavailable_usage");
  const outageCalls = calls;
  const unavailable = await runCheck(c, identity());
  assert.equal(unavailable.status, 503);
  assert.equal(calls, outageCalls, "Store unavailable: no provider calls and no memory fallback");
  console.log("PASS: isolated PostgreSQL migrations; three processes; persistent user/center quotas; atomic admission; live lock vs TTL; crash quarantine/recovery; database-loss cancellation; provider failure recovery; minimal stored metadata; fail-closed storage.");
} finally {
  for (const child of children) child.kill("SIGKILL");
  await Promise.all([...children].map(child => once(child, "exit").catch(() => {})));
  if (provider) {
    provider.closeAllConnections();
    await new Promise(resolve => provider.close(resolve));
  }
  await admin?.end();
  if (started) {
    try { await run("pg_ctl", ["-D", data, "-m", "immediate", "-w", "-t", "15", "stop"]); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
  if (!existsSync(resolve(data, "postmaster.pid"))) await rm(directory, { recursive: true, force: true });
  else { console.error(`Disposable cluster still running; retained ${directory}`); process.exitCode = 1; }
  process.removeListener("SIGINT", interrupted);
  process.removeListener("SIGTERM", interrupted);
}
