---
name: Communications data continuity
description: Preserve existing course-scoped messages, contacts, settings, and quarantined attachments when expanding institutional mail.
---

Extend the existing course-scoped mail schema and API when adding communications features. A parallel or replacement model must not displace existing records, consent controls, course boundaries, or private attachment review.

**Why:** Existing installations can already contain institutional mail data. Replacing the schema with an incompatible model could make those records inaccessible or require destructive migration.

**How to apply:** Before changing mail tables or routes, check the current migrations and user-data lifecycle. Prefer additive, backward-compatible changes; if a conversion is necessary, preserve the source records and define an explicit migration and rollback plan.
