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
