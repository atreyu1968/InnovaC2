---
name: Drizzle migration merges
description: Preserve ordered, runnable Drizzle migrations when independent feature branches add database changes.
---

When parallel feature branches add Drizzle migrations, their generated filename prefixes and journal indices can collide. `drizzle-kit migrate` applies only migrations listed in `meta/_journal.json`; having SQL files and TypeScript schema declarations is not enough.

**Why:** An unlisted migration left PIC follow-up tables absent on a fresh database, causing an authenticated API request to fail with a 500.

**How to apply:** After a merge, compare migration SQL files with journal tags, append missing migrations in dependency order with unique sequential indices, and run the feature's isolated test against a newly initialized database. Then reconcile the running development schema separately.
