---
name: Scope checks before content checks
description: Ordering of authorization vs. business-rule checks in write routes to avoid cross-tenant error oracles.
---

Rule: In every write route, resolve and enforce tenant scope (team ownership, member-of-team → 403/404) BEFORE any content/business checks that leak state (overlap → 409, duplicate → 409, validation that echoes existing rows).

**Why:** POST /shifts previously ran the overlap check before the member-of-team check; an attacker could probe a foreign user's shift times by watching for 409 vs. 403 (a timing/existence oracle over cross-tenant data).

**How to apply:** When adding or reviewing write endpoints, order checks: auth → scope (resolveWriteTeamId, membership) → plan gates → content checks. E2E specs assert 403 even with deliberately overlapping times to lock the ordering in.
