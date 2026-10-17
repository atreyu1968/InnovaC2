// Own fresh cluster, private Unix socket, no fallback to any application DB.
// --generate-reference writes the reviewed catalog fixture, never an app schema.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client, migrations, catalog, hash, stable, referencePath, loadReference,
  applySql, inspect, upgrade, difference, ledger, guardDefinitions } from "./migrations/core.mjs";
import { verifyDevelopmentCopy } from "./migrations/test-development-copy.mjs";
import { verifyMaintenance } from "./migrations/test-maintenance.mjs";

const directory = await mkdtemp(path.join(os.tmpdir(), "innova-migrations-"));
const data = path.join(directory, "pg");
const socket = path.join(directory, "socket");
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) =>
  !k.startsWith("PG") && !["DATABASE_URL", "TEST_DATABASE_URL", "SESSION_SECRET"].includes(k)));
const developmentSource = process.argv.includes("--copy-development") ? process.env.DATABASE_URL : undefined;
const run = (command, args, options = {}) => {
  const r = spawnSync(command, args, { env, encoding: "utf8", timeout: 120000, ...options });
  assert.equal(r.status, 0, `${command} failed: ${r.stderr ?? r.error ?? ""}`);
  return r.stdout;
};
const clients = [];
async function connect(database) {
  const c = new Client({ host: socket, user: "migration_test", database });
  await c.connect();
  clients.push(c);
  return c;
}
async function transaction(client, fn, rollback = false) {
  await client.query("BEGIN");
  try {
    const result = await fn();
    await client.query(rollback ? "ROLLBACK" : "COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
let stopped = false;
function stop() {
  if (stopped) return;
  const r = spawnSync("pg_ctl", ["-D", data, "-m", "immediate", "-w", "-t", "10", "stop"],
    { env, encoding: "utf8", timeout: 15000 });
  stopped = r.status === 0 || !existsSync(path.join(data, "postmaster.pid"));
}
const interrupt = () => { stop(); process.exit(130); };
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);

try {
  await mkdir(socket, { mode: 0o700 });
  run("initdb", ["-D", data, "-U", "migration_test", "--auth=trust", "--no-locale", "--encoding=UTF8"]);
  run("pg_ctl", ["-D", data, "-l", path.join(directory, "postgres.log"),
    "-o", `-F -h '' -k '${socket}'`, "-w", "-t", "15", "start"]);
  const admin = await connect("postgres");
  await admin.query("CREATE DATABASE reference");
  const referenceDb = await connect("reference");
  const all = await migrations();
  const generated = {
    version: 1, pgMajor: 16,
    catalogHash: hash(await readFile(new URL("./migrations/catalog.sql", import.meta.url), "utf8")),
    ledger: {}, stages: [],
  };
  await transaction(referenceDb, async () => {
    await referenceDb.query(`CREATE SCHEMA drizzle;
      CREATE TABLE drizzle.__drizzle_migrations(id SERIAL PRIMARY KEY,hash text NOT NULL,created_at bigint)`);
    generated.ledger = await catalog(referenceDb, "drizzle");
    let previous = await catalog(referenceDb);
    let previousGuards = {};
    assert.deepEqual(previous, {});
    for (const m of all) {
      await applySql(referenceDb, m);
      const next = await catalog(referenceDb);
      const guards = await guardDefinitions(referenceDb);
      generated.stages.push({
        tag: m.tag, hash: m.hash, when: m.when,
        set: Object.fromEntries(Object.entries(next).filter(([k, v]) => previous[k] !== v)),
        remove: Object.keys(previous).filter(k => !next[k]),
        guards: Object.fromEntries(Object.entries(guards).filter(([k, v]) => previousGuards[k] !== v)),
      });
      previous = next;
      previousGuards = guards;
    }
  });
  if (process.argv.includes("--generate-reference")) {
    await writeFile(referencePath, `${JSON.stringify(generated, null, 2)}\n`);
    console.log("Reference generated exclusively from a new PostgreSQL cluster.");
  }
  assert.deepEqual(JSON.parse(await readFile(referencePath, "utf8")), generated,
    "Committed reference must exactly match the full journal on fresh PostgreSQL.");
  const reference = await loadReference(all);
  console.log(`PASS: all ${all.length} journal migrations and schema reference reproduced from scratch.`);

  await admin.query("CREATE DATABASE fresh");
  const fresh = await connect("fresh");
  await transaction(fresh, async () => {
    assert.equal((await inspect(fresh, all, reference)).status, "fresh");
    await upgrade(fresh, all, reference);
    assert.equal((await ledger(fresh)).length, all.length);
  });
  const beforeLedger = await ledger(fresh);
  await transaction(fresh, () => upgrade(fresh, all, reference));
  assert.deepEqual(await ledger(fresh), beforeLedger);
  console.log("PASS: clean installation and second update do not repeat migrations.");

  // Legacy deployment at the prefix before AI settings, genuinely populated,
  // empty (but valid) Drizzle ledger. Dump then restore into a DIFFERENT DB.
  await admin.query("CREATE DATABASE legacy");
  const legacy = await connect("legacy");
  const legacyPrefix = all.findIndex(m => m.tag === "0013_ai_provider_settings");
  assert.ok(legacyPrefix > 0, "Keep a fixed populated legacy prefix as new migrations are appended.");
  await transaction(legacy, async () => {
    for (const m of all.slice(0, legacyPrefix)) await applySql(legacy, m);
    await legacy.query(`CREATE SCHEMA drizzle;
      CREATE TABLE drizzle.__drizzle_migrations(id SERIAL PRIMARY KEY,hash text NOT NULL,created_at bigint)`);
    await legacy.query(`INSERT INTO centers(id,name) VALUES ('10000000-0000-0000-0000-000000000001','Centro conservado');
      INSERT INTO school_years(id,center_id,label) VALUES ('20000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001','2025-2026');
      INSERT INTO users(center_id,email,name,password_hash,role)
      VALUES ('10000000-0000-0000-0000-000000000001','fixture@example.invalid','Fixture','not-a-login','admin_tecnico');
      INSERT INTO audit_logs(action,entity_type,details) VALUES ('fixture','migration','{"preserve":true}');
      INSERT INTO auth_login_attempts(key,attempt_count) VALUES ('keep-existing',3)`);
  });
  const dump = path.join(directory, "legacy.dump");
  run("pg_dump", ["-h", socket, "-U", "migration_test", "-Fc", "-f", dump, "legacy"]);
  await admin.query("CREATE DATABASE restored");
  run("pg_restore", ["-h", socket, "-U", "migration_test", "--exit-on-error", "-d", "restored", dump]);
  const restored = await connect("restored");
  const tables = (await restored.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"))
    .rows.map(r => r.tablename);
  const rows = async (c) => {
    const result = {};
    for (const table of tables)
      result[table] = (await c.query(`SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY to_jsonb(t)::text`)).rows;
    return result;
  };
  const original = await rows(restored);
  const plan = await transaction(restored, () => inspect(restored, all, reference), true);
  assert.equal(plan.status, "baseline-required", JSON.stringify(plan));
  assert.deepEqual(plan.pending, all.slice(legacyPrefix).map(m => m.tag));
  assert.equal((await ledger(restored)).length, 0, "Preflight must not write ledger");
  await assert.rejects(transaction(restored, () => upgrade(restored, all, reference)), /--baseline/);
  await transaction(restored, () => upgrade(restored, all, reference, { allowBaseline: true }));
  assert.deepEqual(await rows(restored), original, "All pre-existing row values must survive");
  await transaction(restored, () => upgrade(restored, all, reference));
  assert.deepEqual(await rows(restored), original);
  assert.equal((await ledger(legacy)).length, 0, "Source database is not upgraded");
  assert.deepEqual(await rows(legacy), original, "Source dump remains unchanged");
  console.log("PASS: backup restored into isolated copy; verified baseline + additive AI update preserve every existing row; idempotent.");

  // Full current schema, ledger absent, and a genuine tracked intermediate DB.
  await referenceDb.end();
  clients.splice(clients.indexOf(referenceDb), 1);
  await admin.query("CREATE DATABASE full_legacy TEMPLATE reference");
  const full = await connect("full_legacy");
  await transaction(full, () => upgrade(full, all, reference, { allowBaseline: true }));
  assert.equal((await ledger(full)).length, all.length);
  await admin.query("CREATE DATABASE intermediate");
  const intermediate = await connect("intermediate");
  await transaction(intermediate, async () => {
    await intermediate.query(`CREATE SCHEMA drizzle;
      CREATE TABLE drizzle.__drizzle_migrations(id SERIAL PRIMARY KEY,hash text NOT NULL,created_at bigint)`);
    for (const m of all.slice(0, 8)) {
      await applySql(intermediate, m);
      await intermediate.query("INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ($1,$2)", [m.hash, m.when]);
    }
  });
  await assert.rejects(transaction(intermediate, () => upgrade(intermediate, all, reference, { startup: true })),
    /Actualización pendiente/);
  await transaction(intermediate, () => upgrade(intermediate, all, reference));
  console.log("PASS: full schema baselining and ordinary tracked-prefix upgrade.");

  const drifts = [
    ["space-range", `ALTER TABLE space_reservations DROP CONSTRAINT space_reservations_space_kinds_check;
      ALTER TABLE space_reservations ADD CONSTRAINT space_reservations_space_kinds_check
      CHECK (cardinality(space_kinds) BETWEEN 0 AND 2 AND space_kinds <@ ARRAY['ateca','fablab']::text[]
        AND (cardinality(space_kinds)=1 OR space_kinds[1]<>space_kinds[2]))`],
    ["column", `ALTER TABLE centers ALTER COLUMN name DROP NOT NULL`],
    ["extra", `CREATE TABLE unexpected_data(id integer)`],
    ["index", `CREATE INDEX extra_index ON centers(name)`],
    ["constraint", `ALTER TABLE users DROP CONSTRAINT users_center_id_centers_id_fk`],
    ["trigger", `ALTER TABLE school_years DISABLE TRIGGER ALL`],
    ["function", `CREATE OR REPLACE FUNCTION guard_closed_year() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$`],
    ["enum", `ALTER TYPE user_role ADD VALUE 'unexpected_role'`],
    ["default", `ALTER TABLE centers ALTER COLUMN id DROP DEFAULT`],
  ];
  for (const [label, sql] of drifts) {
    await transaction(restored, async () => {
      await restored.query(sql);
      assert.equal((await inspect(restored, all, reference)).status, "blocked", label);
      await assert.rejects(upgrade(restored, all, reference, { allowBaseline: true }), /incompatible/);
    }, true);
  }
  await transaction(restored, async () => {
    await restored.query("UPDATE drizzle.__drizzle_migrations SET hash='tampered' WHERE id=1");
    await assert.rejects(inspect(restored, all, reference), /Ledger/);
  }, true);
  await transaction(restored, async () => {
    await restored.query("CREATE TABLE drizzle.unexpected(id integer)");
    await assert.rejects(inspect(restored, all, reference), /estructura del ledger/);
  }, true);
  assert.deepEqual(await rows(restored), original);
  // Existing closed-course trigger behavior is not merely inferred from names.
  await assert.rejects(transaction(restored, () => restored.query(
    "UPDATE school_years SET closed_at=now(),active=false WHERE id='20000000-0000-0000-0000-000000000001'")),
  /COURSE_SNAPSHOT_REQUIRED/);
  console.log("PASS: column/default/enum/index/constraint/function/trigger drift, unknown ledger and extra ledger objects fail closed; course guards remain effective.");

  // Force failure after a baseline would have been inserted: whole transaction
  // rolls back, including historical acknowledgement and all new objects.
  const broken = all.map(m => ({ ...m }));
  broken.at(-1).sql += "\nSELECT missing_migration_function();";
  await assert.rejects(transaction(legacy, () => upgrade(legacy, broken, reference, { allowBaseline: true })),
    /missing_migration_function/);
  assert.equal((await ledger(legacy)).length, 0);
  assert.deepEqual(await rows(legacy), original);
  await transaction(legacy, async () => {
    assert.deepEqual(difference(reference.states[legacyPrefix], await catalog(legacy)), []);
  });
  console.log("PASS: failure rolls back both baseline and additive changes; backup/source unchanged.");

  // A push-created installation may have final columns in another physical
  // order and lack hand-written guards. Absent guards can be added explicitly;
  // differing guard bodies must NEVER be silently replaced.
  await transaction(legacy, async () => {
    await legacy.query("DROP TRIGGER course_write_guard ON pic_followup_reports");
    await legacy.query("DROP FUNCTION guard_pic_followup_delivery() CASCADE");
    const plan = await inspect(legacy, all, reference);
    assert.equal(plan.guardRepairAvailable, true);
    await assert.rejects(upgrade(legacy, all, reference, { allowBaseline: true }), /incompatible/);
    const repaired = await upgrade(legacy, all, reference, { allowBaseline: true, repairGuards: true });
    assert.ok(repaired.repaired.length >= 2);
    assert.deepEqual(await rows(legacy), original);
  }, true);
  await transaction(legacy, async () => {
    await legacy.query("CREATE OR REPLACE FUNCTION guard_closed_year() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$");
    const plan = await inspect(legacy, all, reference);
    assert.equal(plan.guardRepairAvailable, false);
    await assert.rejects(upgrade(legacy, all, reference, { allowBaseline: true, repairGuards: true }), /incompatible/);
  }, true);
  console.log("PASS: explicit repair adds only absent guards; changed functions are blocked without replacement.");
  await verifyMaintenance({ directory, socket, env, admin, connect, dump, all, reference, legacyPrefix });
  if (process.argv.includes("--copy-development")) {
    await verifyDevelopmentCopy({ source: developmentSource, directory, socket, env, admin, connect, all, reference });
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await Promise.all(clients.map(c => c.end().catch(() => {})));
  stop();
  if (stopped) await rm(directory, { recursive: true, force: true });
  else {
    console.error(`Cluster could not be stopped; retained at ${directory}`);
    process.exitCode = 1;
  }
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
}
