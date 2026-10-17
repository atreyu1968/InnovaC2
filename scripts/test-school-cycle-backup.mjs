// Helpers for test-school-cycle.mjs --backup-restore. Never use a supplied DB:
// callers must own the freshly initialized cluster and temporary directory.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

export async function materializeDocuments(pool, dataDir, yearId) {
  const versions = (await pool.query(`SELECT v.* FROM document_versions v
    JOIN documents d ON d.id=v.document_id WHERE d.school_year_id=$1`, [yearId])).rows;
  assert.ok(versions.length > 0);
  for (const version of versions) {
    const bytes = Buffer.from(`Physical course evidence: ${yearId}\n${version.id}\n`);
    const file = path.join(dataDir, version.storage_key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
    await pool.query("UPDATE document_versions SET sha256=$2,size_bytes=$3 WHERE id=$1",
      [version.id, sha256(bytes), bytes.length]);
  }
}

// Intentionally tiny Docker adapter: executes genuine pg_dump/pg_restore/tar
// against the local disposable cluster. It cannot invoke Docker or a host volume.
const adapter = `#!/usr/bin/env node
const {spawnSync}=require("node:child_process");
const fs=require("node:fs"), path=require("node:path");
const a=process.argv.slice(2);
if(process.cwd()!==process.env.TEST_RESTORE_SANDBOX) throw Error("Unsafe working directory");
const run=(cmd,args)=>{const r=spawnSync(cmd,args,{stdio:"inherit"});if(r.error)throw r.error;process.exit(r.status??1)};
if(a.slice(0,5).join(" ")==="compose exec -T db pg_dump")
  run("pg_dump",a.slice(5));
if(a.slice(0,5).join(" ")==="compose exec -T db pg_restore") run("pg_restore",a.slice(5));
if(a.join(" ")==='compose exec -T api sh -c tar -C "$DATA_DIR" -czf - .')
  run("tar",["-C",process.env.TEST_DOCUMENTS,"-czf","-","."]);
if(a.join(" ")==="compose stop api"||a.join(" ")==="compose start api") {
  fs.appendFileSync(process.env.TEST_RESTORE_SANDBOX+"/service-calls",a.join(" ")+"\\n");process.exit(0);
}
if(a.slice(0,7).join(" ")==="compose run --rm --no-deps --entrypoint node api" && a[7]==="-e") {
  run(process.execPath,a.slice(7));
}
if(a.join(" ")==="compose run --rm --no-deps --entrypoint tar api -C /var/lib/innova/documents -xzf -")
  run("tar",["-C",process.env.TEST_DOCUMENTS,"-xzf","-"]);
throw Error("Unexpected Docker invocation: "+a.join(" "));
`;

export async function verifyBackupRestore({ pool, env, directory, root, closedYears, activeYear, histories }) {
  // Assert ownership independently of application configuration before any restore.
  assert.ok(directory.startsWith(path.join((await import("node:os")).tmpdir(), "innova-cycle-test-")));
  assert.equal(path.resolve(env.DATA_DIR), path.join(directory, "files"));
  const connection = new URL(env.DATABASE_URL);
  assert.equal(connection.hostname, "127.0.0.1");
  assert.equal(connection.username, "cycle_test");
  assert.equal(connection.pathname, "/postgres");
  const control = await readFile(path.join(directory, "pgdata/postmaster.pid"), "utf8");
  assert.equal(control.split("\n")[3], connection.port, "Must own this PostgreSQL instance");
  const sandbox = path.join(directory, "backup-harness");
  const restoredFiles = path.join(directory, "restored-files");
  await mkdir(path.join(sandbox, "scripts"), { recursive: true });
  await mkdir(path.join(sandbox, "bin"));
  await mkdir(restoredFiles);
  for (const script of ["backup.sh", "restore.sh"]) {
    await cp(path.join(root, "scripts", script), path.join(sandbox, "scripts", script));
  }
  await writeFile(path.join(sandbox, "bin/docker"), adapter, { mode: 0o700 });
  // All values in this env file are generated test values, not workspace secrets.
  const key = randomBytes(32).toString("hex");
  const backupRoot = path.join(sandbox, "backups");
  const configure = database => writeFile(path.join(sandbox, ".env"),
    `POSTGRES_USER=cycle_test\nPOSTGRES_DB=${database}\nBACKUP_ENCRYPTION_KEY=${key}\nBACKUP_DIR='${backupRoot}'\n`,
    { mode: 0o600 });
  const cleanEnv = Object.fromEntries(Object.entries(env).filter(([k]) =>
    !k.startsWith("PG") && !["DATABASE_URL", "TEST_DATABASE_URL", "BACKUP_DIR", "BACKUP_ENCRYPTION_KEY"].includes(k)));
  Object.assign(cleanEnv, {
    PATH: `${sandbox}/bin:${env.PATH}`, PGHOST: "127.0.0.1", PGPORT: connection.port,
    PGUSER: "cycle_test", TEST_RESTORE_SANDBOX: sandbox, TEST_DOCUMENTS: env.DATA_DIR,
  });
  const run = (cmd, args, { input, expected = 0 } = {}) => {
    const result = spawnSync(cmd, args, { cwd: sandbox, env: cleanEnv, input, encoding: "utf8", timeout: 90_000 });
    if (expected === 0) assert.equal(result.status, 0, `${cmd}: ${result.stderr}\n${result.stdout}`);
    else assert.ok(result.status !== 0 && result.status !== null, "Expected an explicit failure");
    return result;
  };
  // Compare every row, not just row counts, including sources, assignments and
  // closure metadata. Stable JSONB ordering avoids dump serialization differences.
  const tables = (await pool.query(`SELECT tablename FROM pg_tables
    WHERE schemaname='public' ORDER BY tablename`)).rows.map(r => r.tablename);
  const capture = async client => Object.fromEntries(await Promise.all(tables.map(async table => [
    table, (await client.query(`SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY to_jsonb(t)::text`)).rows,
  ])));
  const before = await capture(pool);
  const fileManifest = async base => {
    const versions = (await pool.query("SELECT storage_key,sha256,size_bytes FROM document_versions ORDER BY id")).rows;
    assert.ok(versions.length >= 4);
    for (const version of versions) {
      const bytes = await readFile(path.join(base, version.storage_key));
      assert.equal(sha256(bytes), version.sha256);
      assert.equal(bytes.length, Number(version.size_bytes));
    }
    return versions;
  };
  const filesBefore = await fileManifest(env.DATA_DIR);
  await configure("postgres");
  run("bash", ["scripts/backup.sh"]);
  const backups = await readdir(backupRoot);
  assert.equal(backups.length, 1);
  const backup = path.join(backupRoot, backups[0]);
  assert.deepEqual((await readdir(backup)).sort(), ["SHA256SUMS", "database.dump.enc", "documents.tar.gz.enc"].sort());

  run("createdb", ["restore_test"]);
  const Pool = pool.constructor;
  const targetUrl = new URL(connection);
  targetUrl.pathname = "/restore_test";
  const restored = new Pool({ connectionString: targetUrl.href });
  try {
    // Pre-existing disposable state proves that restore replaces rather than
    // merely reading the source. Matching schema avoids unrelated stale tables.
    run("pg_dump", ["--format=custom", "--file", path.join(sandbox, "seed.dump"), "postgres"]);
    run("pg_restore", ["--dbname=restore_test", path.join(sandbox, "seed.dump")]);
    await restored.query("UPDATE centers SET name='Disposable destination sentinel'");
    await writeFile(path.join(restoredFiles, "must-be-removed"), "stale");
    cleanEnv.TEST_DOCUMENTS = restoredFiles;
    cleanEnv.DATA_DIR = restoredFiles;
    await configure("restore_test");
    // Corruption and refusal must leave both destination DB and files alone.
    const ciphertext = path.join(backup, "database.dump.enc");
    const original = await readFile(ciphertext);
    await writeFile(ciphertext, Buffer.concat([original, Buffer.from("corrupt")]));
    run("bash", ["scripts/restore.sh", backup], { input: "RESTAURAR\n", expected: 1 });
    await writeFile(ciphertext, original);
    run("bash", ["scripts/restore.sh", backup], { input: "NO\n", expected: 1 });
    assert.equal((await restored.query("SELECT name FROM centers ORDER BY name")).rows
      .every(r => r.name === "Disposable destination sentinel"), true);
    assert.equal(await readFile(path.join(restoredFiles, "must-be-removed"), "utf8"), "stale");
    run("bash", ["scripts/restore.sh", backup], { input: "RESTAURAR\n" });
    assert.equal(await readFile(path.join(sandbox, "service-calls"), "utf8"), "compose stop api\ncompose start api\n");
    assert.deepEqual(await capture(restored), before, "All database rows must round-trip exactly");
    await assert.rejects(readFile(path.join(restoredFiles, "must-be-removed")), { code: "ENOENT" });
    assert.deepEqual(await fileManifest(restoredFiles), filesBefore);
    const snapshots = (await restored.query("SELECT * FROM school_year_snapshots ORDER BY school_year_id")).rows;
    assert.equal(snapshots.length, 2);
    for (const year of closedYears) {
      const snapshot = snapshots.find(s => s.school_year_id === year);
      const history = histories.find(h => h.schoolYearId === year);
      assert.ok(snapshot && history);
      assert.match(snapshot.source_hash, /^[a-f0-9]{64}$/);
      assert.equal(snapshot.source_hash, history.sourceHash);
      assert.ok(snapshot.content.sources.some(s => s.source === "documents"));
      assert.ok(snapshot.content.sources.some(s => s.source === "document_versions"));
      assert.ok(snapshot.content.sources.some(s => s.source === "school_year_assignments"));
      // Restored triggers must reject inserts, updates, deletes, reopening,
      // snapshot tampering and changes through a document's indirect parent.
      for (const [sql, expected] of [
        ["UPDATE school_years SET active=true WHERE id=$1", "COURSE_CLOSED"],
        ["DELETE FROM school_years WHERE id=$1", "COURSE_CLOSED"],
        ["UPDATE school_year_snapshots SET source_hash='tampered' WHERE school_year_id=$1", "COURSE_SNAPSHOT_IMMUTABLE"],
        ["DELETE FROM school_year_snapshots WHERE school_year_id=$1", "COURSE_SNAPSHOT_IMMUTABLE"],
        ["UPDATE activities SET title='tampered' WHERE school_year_id=$1", "COURSE_CLOSED"],
        ["DELETE FROM documents WHERE school_year_id=$1", "COURSE_CLOSED"],
        ["UPDATE document_versions SET sha256='tampered' WHERE document_id IN (SELECT id FROM documents WHERE school_year_id=$1)", "COURSE_CLOSED"],
        ["UPDATE school_year_assignments SET reviewed_at=now() WHERE school_year_id=$1", "COURSE_CLOSED"],
        ["INSERT INTO activities(center_id,school_year_id,title,description,created_by) SELECT center_id,id,'Rejected','Rejected',closed_by FROM school_years WHERE id=$1", "COURSE_CLOSED"],
      ]) await assert.rejects(restored.query(sql, [year]), e => e.code === "23514" && e.message.includes(expected));
    }
    assert.deepEqual((await restored.query(`SELECT id FROM school_years WHERE active
      AND center_id=(SELECT center_id FROM school_years WHERE id=$1)`, [activeYear])).rows, [{ id: activeYear }]);
    const activeBefore = (await restored.query("SELECT revision FROM school_years WHERE id=$1", [activeYear])).rows[0].revision;
    await restored.query("BEGIN");
    try {
      const write = await restored.query("UPDATE school_year_assignments SET reviewed_at=now() WHERE school_year_id=$1 RETURNING user_id", [activeYear]);
      assert.ok(write.rowCount > 0, "Active course must remain writable");
      assert.ok((await restored.query("SELECT revision FROM school_years WHERE id=$1", [activeYear])).rows[0].revision > activeBefore);
    } finally { await restored.query("ROLLBACK"); }
    assert.deepEqual(await capture(restored), before, "Rejected writes must not alter archived records");
    assert.deepEqual(await capture(pool), before, "Source database must not be restored into");
    console.log("PASS: encrypted backup/restore, two closed dossiers, physical checksums, all rows/sources/hashes/assignments, active course, restored immutability, corruption/cancellation safety.");
  } finally {
    await restored.end();
    await rm(path.join(sandbox, ".env"), { force: true });
  }
}
