---
name: Antivirus verification boundaries
description: Why isolated real-engine regression tests do not establish production signature-feed health.
---

Keep antivirus regression tests repeatable without Internet by using a real
ClamAV engine and an isolated EICAR-only signature fixture. Never present that
result as proof of production signature freshness or general malware coverage.

**Why:** Engine/protocol and quarantine recovery regressions need deterministic
tests; production feed downloads depend on network availability and have a
different operational failure mode.

**How to apply:** Keep fixtures out of production volumes. For claims about
production protection, separately check freshclam updates, full database loading
and container health; clearly state which checks were actually run.
