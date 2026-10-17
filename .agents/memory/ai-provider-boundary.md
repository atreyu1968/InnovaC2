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
