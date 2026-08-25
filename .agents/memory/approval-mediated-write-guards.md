---
name: Approval-mediated write flows must re-apply direct-route guards
description: When a request/approve flow wraps a shared creation function that a direct route also uses, every guard and side-effect of the direct route must be re-checked explicitly in the approval handler.
---

Converting a direct self-service write (e.g. `POST /shifts`) into a request→approve flow (e.g. `POST /absence-requests` + `POST /absence-requests/:id/approve`) does not automatically inherit the direct route's guards just because the approval handler calls the same core creation function (e.g. `runBulkAbsenceCreation`).

**Why:** the direct route enforces things (plan limits like `historyMonths` forward-planning caps, side-effect notifications like owner emails) inline before calling the shared function. The approval handler is a new call site — it must reapply each guard/side-effect independently, or the indirect path becomes a bypass (plan-limit bypass) or silently drops behavior (a notification that used to fire on the direct route becomes dead code once the direct route is blocked for non-privileged users).

**How to apply:** when adding a request/approval layer in front of an existing shared write path:
1. Diff the direct route's full guard list (plan limits, team scoping, forward-planning limits, etc.) against what the approval handler enforces — every guard must appear in both, or be intentionally deferred with a comment explaining why.
2. Decide *when* each side effect (notifications, audit rows) should fire — at submission time (self-report / duty-of-care) vs. approval time (privileged confirmation) — and don't assume porting the old call site verbatim is correct; the semantics of "self-service create" and "planner approves" differ.
3. Grep for the old call site after gating it behind a now-unreachable path (e.g. a route that returns 403 for the relevant role) — dead code hiding a regression is easy to miss in code review.

**Concurrency:** an approve/reject pair of endpoints acting on the same row is a classic read-then-write race (double-approve, or approve+reject both succeeding) unless the entire critical section — status re-check, any guard that depends on current state, the shared write call, and the final status update — runs inside one transaction holding a per-row advisory lock acquired before the first read. Splitting the lock into two separate acquisitions (one for the check, one for the write) still leaves the race window open around the write itself.
