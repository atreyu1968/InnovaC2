---
name: Test database isolation
description: Why destructive integration tests need a fresh PostgreSQL cluster rather than a test-named database.
---

Prefer a newly created, disposable PostgreSQL cluster for integration tests that initialize application state. A database name containing “test” does not establish that it is safe to modify.

**Why:** A supplied test connection can still point at an existing installation; refusing a missing test URL alone prevents fallback but leaves verification dependent on manual provisioning.

**How to apply:** Keep automatic test provisioning independent of application connection settings. Other integration suites can adopt the same isolation without changing the application's database provider.

For destructive maintenance-script tests, prefer staging the unchanged scripts beside a generated temporary configuration and a strict local command adapter over adding test-only target overrides to production scripts.

**Why:** Backup/restore scripts source installation configuration themselves. Changing their target-selection contract just to make tests convenient can create a new path to restoring into the wrong installation.

**How to apply:** Exercise real encryption, PostgreSQL dumps/restores and physical archives against owned disposable resources; state explicitly that a local adapter does not verify Docker orchestration or production-volume permissions.
