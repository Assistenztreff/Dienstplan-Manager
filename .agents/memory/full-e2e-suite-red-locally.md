---
name: Full e2e suite is red locally (pre-existing)
description: The complete `test:e2e` run has ~33 pre-existing failures unrelated to new changes; how to attribute failures correctly.
---

The full Playwright suite (`pnpm run test:e2e`, ~160 tests, ~25 min) fails ~33 tests locally, and these failures pre-date any given task's change. Verified by a baseline run with the suspect change disabled: identical failure identities.

**Why (failure buckets):**
1. Form-based `loginAsAdmin`/assistant login specs time out waiting for `#email` — the Vite-DEV auto-login redirects away from /login (see e2e-dev-auto-login.md).
2. Specs that register fresh accounts (now Free by default) and plan shifts >1 month ahead get server-side 403 `Im Free-Tarif kann nur fuer den aktuellen und naechsten Monat geplant werden` — collateral of the historyMonths entitlement enforcement; those specs were written before plan caps existed.
3. Strict-mode `getByText` dupes from Radix Toast's transient aria-live announcer (`Notification …` span) racing the visible toast.

**How to apply:** Never attribute full-suite failures to your change without a baseline. Cheap method: temporarily disable your change (`{false && <.../>}`), rerun only the failing spec files via a temporary console workflow, and diff failure identities. Run targeted specs, not the full suite, for task validation.
