---
name: Drizzle migration merges
description: Preserve ordered, runnable Drizzle migrations when independent feature branches add database changes.
---

When parallel feature branches add Drizzle migrations, their generated filename prefixes and journal indices can collide. `drizzle-kit migrate` applies only migrations listed in `meta/_journal.json`; having SQL files and TypeScript schema declarations is not enough.

**Why:** An unlisted migration left PIC follow-up tables absent on a fresh database, causing an authenticated API request to fail with a 500.

**How to apply:** After a merge, compare migration SQL files with journal tags, append missing migrations in dependency order with unique sequential indices, and run the feature's isolated test against a newly initialized database. Then reconcile the running development schema separately.

Do not replay historical migrations or declare them all applied merely because the current development migration ledger is empty.

**Why:** The existing development installation already had application tables with an empty Drizzle ledger, so a full migration replay failed despite the same journal succeeding on a fresh isolated cluster.

**How to apply:** Inspect the live schema first. Apply only verified missing, additive changes without deleting data; baselining the old ledger requires a separate schema comparison, not fabricated migration history.

New course-scoped tables need both versioned migrations and the development setup's idempotent SQL-guard replay.

**Why:** Schema push creates tables but does not install PostgreSQL triggers. A clean migration test alone can pass while a push-based installation lacks closure, concurrency or history protections.

**How to apply:** Keep guard SQL independently replayable, register it in development setup, and verify replay alongside fresh migrations. Do not replay table-creation DDL as a substitute for installing guards.

Dump/restore can flatten equivalent nested `AND` clauses produced by `BETWEEN`. Schema fingerprints must accommodate only proven equivalent forms without changing already-shipped migration SQL.

**Why:** A restored database can otherwise be rejected as drift despite having the same constraints. Removing SQL parentheses indiscriminately would instead hide real logic changes.

**How to apply:** Prefer PostgreSQL's stable CHECK representation over text
substitutions. Preserve every bound, predicate, operator precedence and
validation/inheritance flag. Regenerate the isolated reference, and pair full
dump/restore equivalence tests with rejection of changed bounds, boolean logic
and validation state.

Schema synchronization can create PIC follow-up tables without installing their
hand-written immutability and course-scope guards. Their existence is not proof
that the corresponding migration's protections ran.

**Why:** A read-only comparison of the development installation found missing
follow-up functions/triggers even though the tables and AI settings were present.
Physical column order also differed from migration-created tables without
changing the named fields' meaning.

**How to apply:** Treat missing guards separately from changed guards: only an
explicit, backed-up addition of proven missing definitions may precede a full
structural baseline. Never overwrite differing guards to make a comparison pass.
A structural baseline does not certify the historical data or course approval.

Regenerate the structural migration reference from a fresh owned PostgreSQL
cluster whenever the migration journal changes; do not derive it from an
existing installation.

**Why:** The upgrade preflight intentionally rejects a reference that does not
cover every journal entry. A new additive migration can therefore block unrelated
fresh-database test suites until the reference is regenerated too.

**How to apply:** Use the documented reference-generation command and run its
restore/upgrade checks, not merely fresh migration execution.

Use PostgreSQL's canonical pretty deparsing for CHECK fingerprints rather than
raw redundant-parenthesis formatting.

**Why:** Dump/restore can flatten nested associative AND expressions introduced
by BETWEEN without changing their meaning. Raw formatting produced a false
structural mismatch on an otherwise unchanged restored installation.

**How to apply:** Keep checks that changed literal values and changed AND/OR
precedence are still rejected; never strip parentheses with a text replacement.
