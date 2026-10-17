// Development setup uses drizzle push, which cannot express PostgreSQL triggers.
// Standalone installations use the equivalent versioned Drizzle migration.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Pool } = require(require.resolve("pg", { paths: [new URL("../lib/db", import.meta.url).pathname] }));
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for development setup.");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('innova-course-guards-setup',0))");
    await client.query(await readFile(new URL("../lib/db/drizzle/0007_course_guards.sql", import.meta.url), "utf8"));
    // Only run after the CICLOPE tables have been created by drizzle push.
    await client.query(await readFile(new URL("../lib/db/drizzle/0009_ciclope_guards.sql", import.meta.url), "utf8"));
    await client.query(await readFile(new URL("../lib/db/drizzle/0011_mail_course_guards.sql", import.meta.url), "utf8"));
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
} finally { await pool.end(); }
