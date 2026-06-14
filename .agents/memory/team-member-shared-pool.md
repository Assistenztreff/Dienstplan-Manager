---
name: Team membership uses a shared user pool
description: Why team-member assignment (#43) does not enforce per-dienstleister user ownership, and what #44 must add.
---

# Team membership operates on a global user pool

Member assignment endpoints (`/api/teams/:id/members`) enforce **team** ownership
(`assertTeamOwnership` → 404 on a foreign team) but do NOT scope the *assignable user*
to the calling dienstleister. Any dienstleister can assign any existing `users.id`.

**Why:** The `users` table has no owner/tenant column, and `GET /api/users`
(`requireAdmin`) returns every user to every admin. There is no concept of "which
user belongs to which dienstleister" yet, so there is nothing to scope against. The
multi-team rollout is staged: #43 = assignment only; strict tenant/data separation
(per-dienstleister users + visibility boundaries) is explicitly deferred to #44.

**How to apply:** Do not treat cross-tenant user assignment as a bug in the
membership endpoints. Closing it requires the user-ownership model from #44 (e.g. an
owner/created-by relation on users, plus scoping both `listUsers` and the member-add
existence check). Until then, the shared-pool behaviour is by design.
