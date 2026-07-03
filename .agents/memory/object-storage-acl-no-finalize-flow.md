---
name: Object storage ACL has no finalize flow
description: Why /storage/objects reads can't enforce per-owner ACLs yet, and what "authenticated" vs "owner-scoped" means for this bucket.
---

The Replit object-storage scaffold (`objectStorage.ts` / `objectAcl.ts`) signs
an upload PUT URL for a private-dir object *before the object exists*. There
is no "finalize upload" callback in this app that would let the server call
`setObjectAclPolicy` with an owner after the client's PUT succeeds.

**Consequence:** `canAccessObjectEntity` can only be enforced on read for
objects that already carry ACL metadata. Objects uploaded through the current
flow (e.g. branding logos) have none, so treating "no policy" as "deny" would
break existing production objects/features that depend on displaying stored
objects to any authenticated user (not just the uploader).

**Current baseline:** both `/storage/uploads/request-url` and
`/storage/objects/*path` require a logged-in session (`requireAuth`). Objects
without ACL metadata remain readable by any authenticated user; if metadata
is ever set on an object, `canAccessObjectEntity` is enforced.

**Why:** closes the actual reported vulnerability (fully anonymous read/write
into the private bucket) without inventing a new ownership-assignment flow or
breaking legos/branding assets that pre-date any ACL policy.

**How to apply:** if a future feature needs real per-tenant object
confidentiality (not just "logged in vs not"), add an explicit finalize-upload
step that stamps `owner`/`visibility` once the object exists, then flip the
read-route fallback from "allow when no policy" to "deny when no policy."
