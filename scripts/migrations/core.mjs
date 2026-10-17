import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export const { Client } = require(require.resolve("pg", { paths: [new URL("../../lib/db", import.meta.url).pathname] }));
const directory = new URL("../../lib/db/drizzle/", import.meta.url);
export const referencePath = new URL("./reference.json", import.meta.url);
export const hash = (value) => createHash("sha256").update(value).digest("hex");
export const stable = (value) => JSON.stringify(value, (_, v) =>
  v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b, "en")))
    : v);

export async function migrations() {
  const journal = JSON.parse(await readFile(new URL("meta/_journal.json", directory), "utf8"));
  const tags = journal.entries.map(e => e.tag);
  const files = (await readdir(directory)).filter(f => f.endsWith(".sql"));
  if (new Set(tags).size !== tags.length || files.length !== tags.length ||
      files.some(f => !tags.includes(f.slice(0, -4)))) throw new Error("SQL y diario no coinciden.");
  return Promise.all(journal.entries.map(async (entry, i) => {
    if (entry.idx !== i || !Number.isSafeInteger(entry.when) ||
        (i && entry.when <= journal.entries[i - 1].when)) throw new Error("Orden del diario inválido.");
    const sql = await readFile(new URL(`${entry.tag}.sql`, directory), "utf8");
    return { ...entry, sql, hash: hash(sql) };
  }));
}

export async function catalog(client, namespace = "public") {
  if (!["public", "drizzle"].includes(namespace)) throw new Error("Invalid catalog namespace");
  await client.query("SET LOCAL search_path = public, pg_catalog");
  const sql = (await readFile(new URL("./catalog.sql", import.meta.url), "utf8"))
    .replaceAll("n.nspname='public'", `n.nspname='${namespace}'`);
  const { rows } = await client.query(sql);
  if (new Set(rows.map(r => r.key)).size !== rows.length) throw new Error("Catálogo ambiguo; no se puede reconciliar.");
  return Object.fromEntries(rows.map(r => [r.key, hash(stable(r.value))]));
}

export async function guardDefinitions(client) {
  const { rows } = await client.query(`
    SELECT 'function:'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS key,
      pg_get_functiondef(p.oid) AS sql FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.prokind<>'a'
    UNION ALL
    SELECT 'trigger:'||c.relname||'.'||t.tgname, pg_get_triggerdef(t.oid,false)
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY key`);
  return Object.fromEntries(rows.map(r => [r.key, r.sql]));
}

export function difference(expected, actual) {
  return [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()
    .filter(k => expected[k] !== actual[k])
    .map(key => ({ key, state: !expected[key] ? "extra" : !actual[key] ? "missing" : "changed" }));
}

export async function loadReference(all) {
  const reference = JSON.parse(await readFile(referencePath, "utf8"));
  const catalogHash = hash(await readFile(new URL("./catalog.sql", import.meta.url), "utf8"));
  if (reference.version !== 1 || reference.stages.length !== all.length ||
      reference.catalogHash !== catalogHash ||
      all.some((m, i) => reference.stages[i].tag !== m.tag ||
        reference.stages[i].hash !== m.hash || reference.stages[i].when !== m.when))
    throw new Error("Referencia obsoleta: regenérela en un clúster aislado y ejecute test:migrations.");
  let state = {};
  let guards = {};
  const states = [{}];
  const guardStates = [{}];
  for (const stage of reference.stages) {
    state = { ...state, ...stage.set };
    guards = { ...guards, ...stage.guards };
    for (const key of stage.remove) delete state[key];
    for (const key of stage.remove) delete guards[key];
    states.push(state);
    guardStates.push(guards);
  }
  return { ...reference, states, guardStates };
}

export async function applySql(client, migration) {
  for (const statement of migration.sql.split("--> statement-breakpoint")) {
    if (statement.trim()) await client.query(statement);
  }
}

export async function ledger(client) {
  const exists = (await client.query("SELECT to_regclass('drizzle.__drizzle_migrations') AS name")).rows[0].name;
  if (!exists) return [];
  return (await client.query('SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id')).rows;
}

export async function inspect(client, all, reference) {
  const version = Number((await client.query("SHOW server_version_num")).rows[0].server_version_num);
  if (Math.floor(version / 10000) !== reference.pgMajor)
    throw new Error(`Se requiere PostgreSQL ${reference.pgMajor}; no se comparan catálogos entre versiones mayores.`);
  const actual = await catalog(client);
  const ledgerSchema = await catalog(client, "drizzle");
  if (Object.keys(ledgerSchema).length &&
      difference(reference.ledger, ledgerSchema).length)
    throw new Error("La estructura del ledger es desconocida; no se modifica.");
  const rows = await ledger(client);
  let prefix = 0;
  if (rows.length) {
    if (rows.length > all.length || rows.some((r, i) =>
      r.hash !== all[i].hash || Number(r.created_at) !== all[i].when))
      throw new Error("Ledger desconocido, alterado o no contiguo. No se modificó.");
    prefix = rows.length;
    const drift = difference(reference.states[prefix], actual);
    if (drift.length) return { status: "blocked", prefix, differences: drift };
  } else {
    prefix = reference.states.findIndex(state => difference(state, actual).length === 0);
    if (prefix < 0) {
      const closest = reference.states.map((state, i) => ({ prefix: i, differences: difference(state, actual) }))
        .sort((a, b) => a.differences.length - b.differences.length)[0];
      return {
        status: "blocked", ...closest,
        guardRepairAvailable: closest.differences.every(d => d.state === "missing" &&
          reference.guardStates[closest.prefix][d.key]),
      };
    }
  }
  return {
    status: rows.length ? "tracked" : prefix ? "baseline-required" : "fresh",
    prefix, baseline: rows.length === 0 && prefix > 0,
    matchedThrough: prefix ? all[prefix - 1].tag : null,
    pending: all.slice(prefix).map(m => m.tag),
  };
}

export async function upgrade(client, all, reference, {
  allowBaseline = false, repairGuards = false, startup = false,
} = {}) {
  // Caller owns the transaction and has stopped all application writers.
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('innova-migrations',0))");
  const tables = (await client.query(`SELECT quote_ident(n.nspname)||'.'||quote_ident(c.relname) AS name
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','drizzle') AND c.relkind IN ('r','p') ORDER BY 1`)).rows;
  if (tables.length) await client.query(`LOCK TABLE ${tables.map(t => `ONLY ${t.name}`).join(",")} IN ACCESS EXCLUSIVE MODE`);
  let plan = await inspect(client, all, reference);
  const repaired = [];
  if (plan.status === "blocked" && plan.guardRepairAvailable && repairGuards && allowBaseline) {
    // Only absent functions/triggers; never overwrite a differing definition or
    // touch an application row. SQL is reproduced from the migration reference.
    for (const d of [...plan.differences].sort((a, b) => a.key.localeCompare(b.key, "en"))) {
      await client.query(reference.guardStates[plan.prefix][d.key]);
      repaired.push(d.key);
    }
    plan = await inspect(client, all, reference);
  }
  if (plan.status === "blocked") throw new Error(`Estructura incompatible: ${JSON.stringify(plan.differences)}`);
  if (plan.baseline && !allowBaseline) throw new Error("Ledger vacío: requiere respaldo, preflight y --baseline.");
  if (startup && plan.prefix > 0 && plan.pending.length)
    throw new Error("Actualización pendiente: ejecutar scripts/migrate.sh --apply con respaldo antes de arrancar.");
  await client.query('CREATE SCHEMA IF NOT EXISTS drizzle');
  await client.query(`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
    id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`);
  if (plan.baseline) {
    for (const m of all.slice(0, plan.prefix))
      await client.query('INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ($1,$2)', [m.hash, m.when]);
  }
  for (const m of all.slice(plan.prefix)) {
    await applySql(client, m);
    await client.query('INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ($1,$2)', [m.hash, m.when]);
  }
  const drift = difference(reference.states.at(-1), await catalog(client));
  if (drift.length) throw new Error(`Comprobación final fallida: ${JSON.stringify(drift)}`);
  return { ...plan, repaired };
}
