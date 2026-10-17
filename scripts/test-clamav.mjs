// Self-contained real-engine integration run. Never connects to the app database.
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = await mkdtemp(path.join(tmpdir(), "innova-clamav-test-"));
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, env, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.error ?? ""}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);
}
let pgStarted = false;
let child;
let interrupted = false;
const onSignal = () => { interrupted = true; child?.kill("SIGTERM"); };
process.once("SIGTERM", onSignal);
process.once("SIGINT", onSignal);
try {
  run(process.env.CLAMD_BIN || "clamd", ["--help"]);
  run("initdb", ["-D", path.join(directory, "pg"), "-U", "innova_test", "-A", "trust", "--no-locale"]);
  run("pg_ctl", ["-D", path.join(directory, "pg"), "-l", path.join(directory, "postgres.log"),
    "-o", `-h '' -k '${directory}' -F`, "-w", "start"]);
  pgStarted = true;
  const url = `postgresql://innova_test@localhost/innova_clamav_test?host=${encodeURIComponent(directory)}`;
  run("createdb", ["-h", directory, "-U", "innova_test", "innova_clamav_test"]);
  run("pnpm", ["--filter", "@workspace/api-server", "run", "build"]);
  const exitCode = await new Promise((resolve, reject) => {
    child = spawn(process.execPath, ["scripts/test-phase2.mjs"], {
      cwd: root, stdio: "inherit",
      env: { ...process.env, TEST_DATABASE_URL: url, TEST_REAL_CLAMAV: "1" },
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
  if (exitCode !== 0 || interrupted) throw new Error(`ClamAV integration tests failed (${exitCode}).`);
} finally {
  if (pgStarted) run("pg_ctl", ["-D", path.join(directory, "pg"), "-m", "immediate", "-w", "stop"]);
  await rm(directory, { recursive: true, force: true });
}
