import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { Client, inspect, upgrade, ledger } from "./core.mjs";

// Explicit opt-in only. The only source operation is a read-only pg_dump.
// No credentials, dump contents, row hashes or personal data are logged.
export async function verifyDevelopmentCopy({ source, directory, socket, env, admin, connect, all, reference }) {
  assert.ok(source, "--copy-development requires an explicitly configured development DATABASE_URL");
  const dump = path.join(directory, "development-copy.dump");
  // libpq does not expand a URI supplied through PGDATABASE in pg_dump's
  // fallback connection path. Pass parsed fields as private environment values,
  // never put the credential-bearing URL in the command line.
  const connection = new Client({ connectionString: source }).connectionParameters;
  const sourceUrl = new URL(source);
  const result = spawnSync("pg_dump", ["-Fc", "--no-owner", "--no-privileges", "-f", dump], {
    env: {
      ...env, PGHOST: connection.host, PGPORT: String(connection.port),
      PGUSER: connection.user, PGPASSWORD: connection.password ?? "",
      PGDATABASE: connection.database,
      PGSSLMODE: sourceUrl.searchParams.get("sslmode") ?? (connection.ssl ? "require" : "prefer"),
      PGOPTIONS: "-c default_transaction_read_only=on",
    },
    encoding: "utf8", timeout: 120000,
  });
  assert.equal(result.status, 0, "Read-only development dump could not be made");
  await admin.query("CREATE DATABASE development_copy");
  const restored = spawnSync("pg_restore", ["-h", socket, "-U", "migration_test", "--no-owner",
    "--no-privileges", "--exit-on-error", "-d", "development_copy", dump],
  { env, encoding: "utf8", timeout: 120000 });
  assert.equal(restored.status, 0, "Development copy could not be restored");
  const client = await connect("development_copy");
  const tables = (await client.query(`SELECT quote_ident(tablename) AS name FROM pg_tables
    WHERE schemaname='public' ORDER BY tablename`)).rows;
  async function fingerprint() {
    const result = [];
    for (const { name } of tables) {
      const { rows } = await client.query(`SELECT count(*)::text AS count,
        md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) AS hash
        FROM public.${name} t`);
      result.push(rows[0]);
    }
    return result;
  }
  const before = await fingerprint();
  const originalLedger = await ledger(client);
  await client.query("BEGIN");
  const plan = await inspect(client, all, reference);
  if (plan.status === "blocked") assert.equal(plan.guardRepairAvailable, true,
    "Development schema diverges beyond safely addable guards");
  await upgrade(client, all, reference, { allowBaseline: true, repairGuards: true });
  await client.query("COMMIT");
  assert.deepEqual(await fingerprint(), before, "Existing development-copy rows must remain identical");
  const currentLedger = await ledger(client);
  assert.equal(currentLedger.length, all.length);
  await client.query("BEGIN");
  await upgrade(client, all, reference);
  await client.query("COMMIT");
  assert.deepEqual(await fingerprint(), before);
  assert.deepEqual(await ledger(client), currentLedger);
  const rowCount = before.reduce((sum, item) => sum + Number(item.count), 0);
  console.log(`PASS: read-only development dump restored into private cluster; ${tables.length} existing tables, ${rowCount} rows preserved; guards reconciled and ledger updated only in copy (${originalLedger.length} → ${currentLedger.length}); second update unchanged.`);
}
