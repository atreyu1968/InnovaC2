// No URLs/passwords in argv or output. DATABASE_URL uses the existing connection.
import { Client, migrations, loadReference, inspect, upgrade } from "./migrations/core.mjs";
import { verifyBackup } from "./migrations/backup-proof.mjs";
const args = process.argv.slice(2);
let backup;
const backupIndex = args.indexOf("--backup-dir");
if (backupIndex >= 0) {
  backup = args[backupIndex + 1];
  args.splice(backupIndex, backup ? 2 : 1);
}
if (args.some(a => !["--preflight", "--apply", "--baseline", "--repair-guards", "--startup"].includes(a)) ||
    args.includes("--preflight") === args.includes("--apply") ||
    (args.includes("--baseline") && !args.includes("--apply")) ||
    (args.includes("--repair-guards") && !args.includes("--baseline")) ||
    (args.includes("--startup") && !args.includes("--apply"))) {
  console.error("Uso: node scripts/migrate-database.mjs --preflight | --apply [--baseline --backup-dir RUTA [--repair-guards]]");
  process.exit(1);
}
const client = new Client({ connectionString: process.env.DATABASE_URL });
try {
  if (!process.env.DATABASE_URL) throw new Error("Falta DATABASE_URL.");
  const all = await migrations();
  const reference = await loadReference(all);
  if (args.includes("--baseline")) await verifyBackup(backup);
  await client.connect();
  await client.query(args.includes("--preflight")
    ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN");
  await client.query("SET LOCAL lock_timeout='10s'");
  await client.query("SET LOCAL statement_timeout='120s'");
  const before = await inspect(client, all, reference);
  if (args.includes("--apply") && !args.includes("--startup") && !args.includes("--baseline") &&
      before.prefix > 0 && before.pending?.length) await verifyBackup(backup);
  const result = args.includes("--preflight")
    ? before
    : await upgrade(client, all, reference, {
      allowBaseline: args.includes("--baseline"), repairGuards: args.includes("--repair-guards"),
      startup: args.includes("--startup"),
    });
  if (result.status === "blocked") {
    console.log(JSON.stringify(result, null, 2));
    throw new Error("Preflight bloqueado; ninguna modificación aplicada.");
  }
  await client.query("COMMIT");
  console.log(JSON.stringify({ ...result, applied: args.includes("--apply") }, null, 2));
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  // Connection errors can contain hostnames but never echo connection settings.
  console.error(error.message.replace(/postgres(?:ql)?:\/\/\S+/gi, "[conexión oculta]"));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
