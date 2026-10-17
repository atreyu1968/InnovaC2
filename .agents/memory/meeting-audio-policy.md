---
name: Meeting audio policy
description: User-selected retention and provider boundaries for in-person and online meeting recordings.
---

Support recordings of both in-person and online meetings for AI draft minutes. Do not retain the original audio after successful processing; keep the transcript and human-review draft instead.

**Why:** The user requested both meeting types and explicitly selected “Borrarlo tras transcribir” for original-audio retention.

**How to apply:** Use only the app-configured provider. Pending audio may stay transiently in browser memory for preview/retry, with an explicit discard option and warning before closing. Do not introduce persistent original-audio archives or silently substitute a provider. Distinguish the app's no-retention policy from any external provider's independent retention contract.
