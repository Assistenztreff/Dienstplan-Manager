---
name: contracts self-scoping authorization
description: How assistant-facing reads of admin list endpoints are authorized in the api-server
---

# Self-scoping shared list endpoints

`GET /api/contracts` is shared between roles:
- **admin**: may pass any `userId` (or none → all contracts).
- **assistant (non-admin)**: the route forces `userId` to the caller's own session id, ignoring any `userId` query param.

**Why:** there was no assistant-accessible endpoint exposing their own contract
(e.g. Resturlaub/vacation balance). `auth/me` returns only id/name/email/role —
no contract. Rather than add a new endpoint + OpenAPI change, the existing
admin endpoint was relaxed from `requireAdmin` to `requireAuth` with
server-side userId forcing. Response shape is identical, so no codegen change.

**How to apply:** when an assistant-facing screen needs data already served by
an admin-only list endpoint, prefer relaxing that endpoint to `requireAuth` and
forcing the non-admin's `userId` server-side over inventing a parallel
endpoint. Keep the response shape identical to avoid OpenAPI/codegen churn.
Verify both paths: admin sees all / by-param; assistant sees only own and the
`userId` query param is ignored.
