---
name: INNOVA-C2 workspace visual direction
description: Persistent appearance and navigation requirements for the signed-in workspace.
---

Use the same dark green as the section headers for both the workspace header and sidebar, with white foregrounds. Use a pale aquamarine active state with dark teal text and icons for clear contrast. On desktop, the icon rail starts collapsed and the expand/collapse control floats at the lower-left. On mobile, use the top hamburger to open a labeled navigation drawer.

**Why:** The user explicitly asked to match the top and side bars to the section-header green, superseding the earlier lighter aquamarine. Expanded/collapsed states and contrasting accents must remain.

**How to apply:** Preserve this palette and responsive navigation pattern when changing authenticated INNOVA-C2 screens.

Keep navigation organized by workflow area rather than adding every new section to a flat sidebar or icon rail. The panel and personal account remain direct accesses; functional sections belong inside collapsible groups.

**Why:** The user found the growing sidebar saturated and explicitly requested a logical reorganization of accesses and sections.

**How to apply:** Place future features in the appropriate existing area, preserve each role's visibility, and keep both grouped compact navigation and the expanded/mobile menu usable.

For public sign-in, keep the user-selected edge-to-edge split composition: an aquamarine welcome panel and the real credential form. The stock photo must remain bundled locally, credited, and clearly marked as illustrative; do not imply it depicts IES staff. Do not add password-recovery or invitation links until those flows have working routes.

**Why:** The user asked the access screen to resemble the supplied reference, fill the full page, and use stock imagery. Links must lead to real implemented flows.

**How to apply:** Preserve this treatment on `/login`, keep sign-in connected to the real API, and bundle assets so the app remains usable on a standalone Ubuntu server.

Use the Seguimientos PIC section header as the shared model for all authenticated top-level sections, adapting its content and actions to each section.

**Why:** The user explicitly approved this header and asked for it in every section.

**How to apply:** Retain the dark-green hero treatment, contextual academic-course information and responsive layout consistently across the workspace; do not apply it to public sign-in screens.
