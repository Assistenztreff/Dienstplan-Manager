---
name: Client-trusted audit actor fields
description: Approval/confirmation endpoints must derive the acting user server-side, never accept it in the request body.
---

Any endpoint that records "who approved/confirmed/rejected X" (audit-relevant
actor field) must set that field from the authenticated session
(`req.session.userId`), never from a client-supplied body field like
`confirmedBy`/`approvedBy`. If the OpenAPI schema for the write request
includes such a field, remove it from the request schema (keep it on the
response schema) so it can't be spoofed, then set it server-side in the
route handler.

**Why:** an admin/API caller could otherwise attribute a payroll-relevant
action to a different user (impersonation of the approver in the audit
trail), even across tenants if the ID isn't scope-checked.

**How to apply:** when adding or reviewing any confirm/approve/reject/reverse
endpoint, grep the request Zod schema for actor-ish fields (`*By`, `actorId`,
`approverId`) and confirm they're absent from the input schema — only allowed
on responses, always set from session server-side. Zod's default `z.object`
strips unknown keys silently (no error), so removing a field from the request
schema is backward-compatible with old clients that still send it.
