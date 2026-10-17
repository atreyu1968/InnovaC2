---
name: GitHub authentication boundaries
description: Distinguish working GitHub connector authorization from terminal Git authentication.
---

In this workspace, the authorized GitHub connection can have repository write
permission while terminal HTTPS Git has no credentials. Do not treat a CLI
authentication failure as proof that the connection needs reauthorization.
Never extract the connector token into a remote URL, environment variable or
credential file.

**Why:** Repository reads succeeded anonymously, terminal pushes could not
authenticate, and the existing connector still had valid write access.

**How to apply:** Use the authorized connector for supported operations or a
separately configured Git authentication flow. Synchronization must preserve
remote ancestry and local content; verify object hashes and use non-forced
reference updates rather than overwriting the remote branch.
