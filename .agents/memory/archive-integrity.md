---
name: Closed-course integrity
description: Hash compatibility and the trust boundary of redacted historical exports.
---

Preserve the hash serialization used at closure when verifying existing archived
courses. PostgreSQL JSONB reorders keys; hashing a generic reserialization of the
retrieved snapshot is not equivalent to hashing the object assembled at closure.

**Why:** Existing archived hashes use insertion-order JSON serialization, while
JSONB storage does not retain wrapper insertion order. A hash algorithm change
must not invalidate immutable archives.

**How to apply:** Verify against the original closure serialization (including its
wrapper order) for existing snapshots. Any future canonical hash format needs an
explicit version and backward-compatible verification, not rewritten archives.

Keep the original private archive hash distinct from checksums of an exported,
redacted projection. Server verification of the private hash is not an offline
cryptographic proof or digital signature.

**Why:** Removing storage locations changes the hashed content; a recipient cannot
recompute the original private hash from the public projection.

**How to apply:** Describe both checks honestly and never claim authenticity from
self-contained, unsigned checksums.

Use semantic object comparison for immutable-field checks on data returned from
JSONB; do not compare ordinary JSON strings as a proxy for equality.

**Why:** Equivalent objects can have different key order after database storage.
Treating that difference as a user edit incorrectly blocks valid updates.

**How to apply:** Distinguish field equality from historical hash verification:
compare fields semantically, while preserving the original serialization contract
when verifying existing archive hashes.
