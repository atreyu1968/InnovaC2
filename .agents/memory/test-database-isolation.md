---
name: Test database isolation
description: Why destructive integration tests need a fresh PostgreSQL cluster rather than a test-named database.
---

Prefer a newly created, disposable PostgreSQL cluster for integration tests that initialize application state. A database name containing “test” does not establish that it is safe to modify.

**Why:** A supplied test connection can still point at an existing installation; refusing a missing test URL alone prevents fallback but leaves verification dependent on manual provisioning.

**How to apply:** Keep automatic test provisioning independent of application connection settings. Other integration suites can adopt the same isolation without changing the application's database provider.
