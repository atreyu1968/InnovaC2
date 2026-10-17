---
name: Academic cycle policy
description: Intentional boundaries for annual transitions, historical consultation and incomplete PIC closure.
---

Never automatically carry achievements, indicator observations or historical documents into another course. Historical material is context, not a current result; retrieval must identify its course and source.

**Why:** The user explicitly required an immutable historical record and no automatic transfer of achievements or indicator values.

**How to apply:** Preserve this boundary in imports, assistant retrieval, new-year templates, document maintenance and reporting. Copying planning structure would require a separate explicit workflow; it must not bring results with it.

Course closure is an administrative archival decision, not certification that the PIC was approved or submitted. An absent/draft PIC is a visible warning, while unresolved capture/review work blocks closure.

**Why:** A school must be able to archive an incomplete or unused year honestly, without inventing completion or destroying its actual state.

**How to apply:** Keep approval/submission claims separate from the closed-course state, and preserve the actual draft or missing-plan state in historical views.

Consolidated historical consultation is intentionally limited to technical administration and C2 authorized in both the center today and the historical course. Reviewed annual assignments are an upper bound alongside current account permissions, not a way to retain revoked account privileges.

**Why:** Historical sources include staff context and documentary metadata. A global account role or a family from a later course must not silently grant a new annual assignment.

**How to apply:** New assistant/search/export features must reuse course-aware authorization, cite immutable sources and never expose private storage paths. Only technical administration has a global historical exception; a current C2 role alone must never bypass historical membership or scope.

Active-course query aliases must discard old-course data on a course identity change; ordinary cache invalidation is not sufficient.

**Why:** React Query retains successful cached data after a subsequent 404. An empty new course can otherwise appear to contain the previous course's PIC even though the database is correctly empty.

**How to apply:** Treat opening/closing as an identity boundary for current-course caches. Preserve immutable historical caches separately, and keep unavailable current-course data out of editable forms.

Laycos exports are prepared for manual transcription only. The software never sends them or marks them submitted. A delivery receipt is a person's immutable attestation tied to a report snapshot and an approved document version; it is not proof of acceptance by Laycos. Attendance, certification and payment remain human-verified.

**Why:** External submission, attendance and certification are official acts that cannot be inferred from a generated report, agenda, or internally recorded receipt.

**How to apply:** Keep exports offline, require an explicit human confirmation for an internal receipt, and label its evidence and limits wherever the report is displayed or archived.
