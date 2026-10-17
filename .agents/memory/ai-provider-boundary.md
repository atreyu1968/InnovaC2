---
name: AI provider boundary
description: Provider selection and deployment portability for AI features in INNOVA-C2.
---

All AI features must use the provider selected by INNOVA-C2's own configuration, which is intended to support disabled, local and explicitly authorized external providers. Do not bypass this with Replit AI Integrations or a hard-coded external provider.

**Why:** The user requires the application to work independently of Replit and explicitly asked that meeting transcription use the API configured in the application.

**How to apply:** Route transcription, summaries and future retrieval through the app's AIProvider boundary. If its configuration is absent or unclear, do not silently select a provider; locate the existing setting or ask which configuration to use.

Technical diagnostics must ask for confirmation before sending synthetic samples to the saved provider. Never use real meetings for diagnostics, and never present a successful connection as an assessment of transcription or drafting quality.

**Why:** The user explicitly requires confirmation, synthetic-only checks and a distinction between connectivity and result quality.

**How to apply:** Keep diagnostic content independent of meeting records. A synthetic tone without speech may legitimately return an empty transcription; accept that as a compatible response, not as evidence of precision.

Do not replace distributed diagnostic exclusion with an expiring lease alone.
Keep a non-expiring live-session lock as well as a durable recovery quarantine,
and fence outgoing calls after the admission deadline or loss of the lock session.

**Why:** A paused but live replica can outlast a lease and later resume. Expiry alone
would allow another replica to send overlapping diagnostics. The quarantine also
covers the gap between loss of the database session and local HTTP cancellation.

**How to apply:** Preserve session affinity for PostgreSQL locks; transaction-pooling
proxies are incompatible. Do not claim that closing an HTTP socket cancels work
already accepted internally by an external provider.

Keep technical diagnostics deliberate and manual. Do not automatically run or retry them on page load, settings changes, background polling or routine validation.

**Why:** Preventing accidental provider consumption is a product requirement. Even failed diagnostic calls may consume quota or incur costs.

**How to apply:** Preserve explicit confirmation on every user-initiated check, disable automatic mutation retries, and use isolated fake providers for regression tests.
