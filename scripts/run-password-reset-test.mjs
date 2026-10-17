import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Never accept a caller-supplied database or session secret for this test.
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !key.startsWith("PG") &&
      !["DATABASE_URL", "TEST_DATABASE_URL", "SESSION_SECRET"].includes(key),
  ),
);
const directory = await mkdtemp(path.join(os.tmpdir(), "innova-password-test-"));
const data = path.join(directory, "postgres");
const socket = path.join(directory, "socket");
let activeChild;
let interrupted = false;

function interrupt(signal) {
  interrupted = true;
  process.exitCode = signal === "SIGINT" ? 130 : 143;
  if (activeChild) {
    try {
      process.kill(-activeChild.pid, "SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
}
const onInterrupt = () => interrupt("SIGINT");
const onTerminate = () => interrupt("SIGTERM");
process.on("SIGINT", onInterrupt);
process.on("SIGTERM", onTerminate);

async function run(command, args, { cleanup = false, quiet = false } = {}) {
  if (interrupted && !cleanup) throw new Error("Password reset test interrupted.");
  await new Promise((resolve, reject) => {
    let output = "";
    const child = spawn(command, args, {
      cwd: root,
      env,
      detached: true,
      stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    if (quiet) {
      const capture = (chunk) => { output = (output + chunk.toString()).slice(-6000); };
      child.stdout.on("data", capture);
      child.stderr.on("data", capture);
    }
    activeChild = child;
    // Ensure an unresponsive test cannot prevent the cluster's cleanup.
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") reject(error);
      }
    }, cleanup ? 20_000 : 120_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      activeChild = undefined;
      reject(new Error(`Cannot run ${command}; install PostgreSQL 16+ tools and pnpm.`, { cause: error }));
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      activeChild = undefined;
      if (code === 0) resolve();
      else reject(new Error(`${command} failed (${signal ?? code}).${output ? `\n${output}` : ""}`));
    });
  });
}

try {
  await mkdir(socket, { mode: 0o700 });
  await run("initdb", ["-D", data, "-U", "password_test", "--auth=trust", "--no-locale", "--encoding=UTF8"], { quiet: true });
  // No TCP listener: the private Unix socket belongs only to this fresh cluster.
  await run("pg_ctl", [
    "-D", data, "-l", path.join(directory, "postgres.log"),
    "-o", `-F -h '' -k '${socket}'`, "-w", "-t", "15", "start",
  ]);
  await run("createdb", ["-h", socket, "-U", "password_test", "password_reset_test"]);
  const connection = new URL("postgresql://password_test@localhost/password_reset_test");
  connection.searchParams.set("host", socket);
  env.TEST_DATABASE_URL = connection.href;
  // DATABASE_URL is set only for tools/API that require it, never read as a fallback.
  env.SESSION_SECRET = randomBytes(48).toString("hex");
  env.DATABASE_URL = connection.href;
  await run("pnpm", ["--filter", "@workspace/db", "run", "migrate"]);
  await run("pnpm", ["--filter", "@workspace/api-server", "run", "build"]);
  delete env.DATABASE_URL;
  await run(process.execPath, [path.join(root, "scripts/test-password-reset.mjs")]);
} catch (error) {
  console.error(error.message);
  process.exitCode ||= 1;
} finally {
  try {
    await run("pg_ctl", ["-D", data, "-m", "immediate", "-w", "-t", "15", "stop"], { cleanup: true, quiet: true });
  } catch (error) {
    // initdb/start may have failed. Never delete a potentially running cluster.
    if (existsSync(path.join(data, "postmaster.pid"))) {
      console.error(error.message);
      console.error(`Could not stop disposable PostgreSQL; temporary files retained at ${directory}.`);
      process.exitCode ||= 1;
    }
  }
  if (!existsSync(path.join(data, "postmaster.pid"))) {
    await rm(directory, { recursive: true, force: true });
    console.log("Disposable password-test PostgreSQL cluster removed.");
  }
  process.off("SIGINT", onInterrupt);
  process.off("SIGTERM", onTerminate);
}
