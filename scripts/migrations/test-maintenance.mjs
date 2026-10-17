// Real backup/encryption/migration/restore with a strict local Docker command
// adapter. Does not claim to verify Compose networking, images or host volumes.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cp, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { verifyBackup } from "./backup-proof.mjs";
import { ledger } from "./core.mjs";

const adapter = `#!/usr/bin/env node
const {spawnSync}=require("node:child_process"),fs=require("node:fs"),path=require("node:path");
const a=process.argv.slice(2);
if(process.cwd()!==process.env.TEST_MAINTENANCE_ROOT) throw Error("Unsafe adapter cwd");
fs.appendFileSync(path.join(process.cwd(),"calls"),JSON.stringify(a)+"\\n");
function run(cmd,args) {
 const r=spawnSync(cmd,args,{stdio:"inherit"});if(r.error)throw r.error;process.exit(r.status??1);
}
if(a.join(" ")==="compose stop api")process.exit(0);
if(a.slice(0,5).join(" ")==="compose exec -T db pg_dump"){
 if(process.env.TEST_FAIL_BACKUP==="yes")process.exit(75);
 run("pg_dump",a.slice(5));
}
if(a.slice(0,6).join(" ")==="compose run --rm --no-deps -T --entrypoint"){
 const entry=a[6],service=a.indexOf("api",7),rest=a.slice(service+1);
 if(service<7)throw Error("Missing api service");
 if(entry==="sh"&&rest.join(" ")==='-c tar -C "$DATA_DIR" -czf - .')
   run("tar",["-C",process.env.TEST_MAINTENANCE_DOCUMENTS,"-czf","-","."]);
 if(entry==="node"&&rest[0]==="scripts/migrate-database.mjs"){
   const v=a.indexOf("-v"),b=rest.indexOf("--backup-dir");
   if(b>=0){if(v<0)throw Error("Missing backup mount");rest[b+1]=a[v+1].split(":")[0];}
   rest[0]=path.join(process.env.TEST_PROJECT_ROOT,rest[0]);
   run(process.execPath,rest);
 }
}
throw Error("Unsupported Docker command");
`;

export async function verifyMaintenance({ directory, socket, env, admin, connect, dump, all }) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const sandbox = path.join(directory, "maintenance");
  const docs = path.join(sandbox, "documents");
  await mkdir(path.join(sandbox, "bin"), { recursive: true });
  await mkdir(path.join(sandbox, "scripts"));
  await mkdir(docs);
  await writeFile(path.join(docs, "preserved.txt"), "Existing institution document\n");
  for (const name of ["migrate.sh", "backup.sh"])
    await cp(path.join(root, "scripts", name), path.join(sandbox, "scripts", name));
  await writeFile(path.join(sandbox, "bin", "docker"), adapter, { mode: 0o700 });
  const key = randomBytes(32).toString("hex");
  await writeFile(path.join(sandbox, ".env"), `POSTGRES_USER=migration_test
POSTGRES_DB=maintenance
BACKUP_DIR='${sandbox}/custom-backups'
BACKUP_ENCRYPTION_KEY=${key}
`, { mode: 0o600 });
  await admin.query("CREATE DATABASE maintenance");
  const run = (command, args, options = {}) => {
    const r = spawnSync(command, args, { cwd: sandbox, env: localEnv, encoding: "utf8", timeout: 120000, ...options });
    assert.equal(r.status, 0, `${command} failed: ${r.stderr}\n${r.stdout}`);
    return r.stdout;
  };
  const connection = new URL("postgresql://migration_test@localhost/maintenance");
  connection.searchParams.set("host", socket);
  const localEnv = {
    ...env, PATH: `${sandbox}/bin:${env.PATH}`, DATABASE_URL: connection.href,
    PGHOST: socket, PGUSER: "migration_test", TEST_PROJECT_ROOT: root,
    TEST_MAINTENANCE_ROOT: sandbox, TEST_MAINTENANCE_DOCUMENTS: docs,
    BACKUP_ENCRYPTION_KEY: key,
  };
  run("pg_restore", ["--exit-on-error", "-d", "maintenance", dump]);
  const client = await connect("maintenance");
  const plan = JSON.parse(run("bash", ["scripts/migrate.sh"]));
  assert.equal(plan.status, "baseline-required");
  assert.equal((await ledger(client)).length, 0);
  const initialCalls = (await readFile(path.join(sandbox, "calls"), "utf8"));
  assert.ok(!initialCalls.includes('"stop"'), "Default preflight cannot stop API");

  // Failed backup must prevent even the baseline and leave service stopped.
  const failure = spawnSync("bash", ["scripts/migrate.sh", "--apply", "--baseline"], {
    cwd: sandbox, env: { ...localEnv, TEST_FAIL_BACKUP: "yes" }, encoding: "utf8", timeout: 120000,
  });
  assert.notEqual(failure.status, 0);
  assert.equal((await ledger(client)).length, 0);
  run("bash", ["scripts/migrate.sh", "--apply", "--baseline"]);
  assert.equal((await ledger(client)).length, all.length);
  const rootEntries = await readdir(path.join(sandbox, "custom-backups"));
  const receipts = [];
  for (const parent of rootEntries) {
    const dir = path.join(sandbox, "custom-backups", parent);
    for (const leaf of await readdir(dir)) {
      const candidate = path.join(dir, leaf);
      try { await verifyBackup(candidate); receipts.push(candidate); } catch {}
    }
  }
  assert.equal(receipts.length, 1, "Exactly one successful verified backup");
  const receipt = receipts[0];
  assert.equal(JSON.parse(await readFile(path.join(receipt, "migration-result.json"), "utf8")).applied, true);
  const cipher = await readFile(path.join(receipt, "documents.tar.gz.enc"));
  await writeFile(path.join(receipt, "documents.tar.gz.enc"), Buffer.alloc(64));
  await assert.rejects(verifyBackup(receipt), /suma/);
  await writeFile(path.join(receipt, "documents.tar.gz.enc"), cipher);
  const plainDump = path.join(directory, "maintenance-backup.dump");
  run("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "310000", "-md", "sha256",
    "-pass", "env:BACKUP_ENCRYPTION_KEY", "-in", path.join(receipt, "database.dump.enc"), "-out", plainDump]);
  await admin.query("CREATE DATABASE maintenance_backup");
  run("pg_restore", ["--exit-on-error", "-d", "maintenance_backup", plainDump]);
  const backup = await connect("maintenance_backup");
  assert.equal((await ledger(backup)).length, 0, "Backup is the pre-update state");
  assert.equal((await backup.query("SELECT name FROM centers")).rows[0].name, "Centro conservado");
  assert.equal((await backup.query("SELECT to_regclass('public.ai_provider_settings') AS name")).rows[0].name, null);
  const calls = await readFile(path.join(sandbox, "calls"), "utf8");
  assert.ok(!calls.includes('"start"') && !calls.includes('"up"'), "API must not auto-restart");
  console.log("PASS: staged maintenance scripts run real encrypted backup and migration, retain a restorable pre-update dump; failed backup blocks updates, bad checksum is rejected, API stays stopped (local Docker adapter).");
}
