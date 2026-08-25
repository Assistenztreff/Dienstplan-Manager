---
name: Approval-mediated write flows must re-apply direct-route guards
description: When a request/approve flow wraps a shared creation function that a direct route also uses, every guard, side-effect, and transaction boundary of the direct route must be re-applied explicitly in the approval handler.
---

Converting a direct self-service write into a request→approve flow does not automatically inherit the direct route's guards or transactional behavior just because the approval handler calls the same shared creation function.

**Why:** the direct route enforces things (plan limits, forward-planning caps, side-effect notifications) inline before calling the shared function. The approval handler is a new call site — it must reapply each guard/side-effect independently, or the indirect path becomes a bypass, or silently drops behavior (a notification that fired on the direct route becomes dead code once that route is blocked for the affected role).

**How to apply:** when adding a request/approval layer in front of an existing shared write path:
1. Diff the direct route's full guard list against what the approval handler enforces — every guard must appear in both, or be intentionally deferred with a comment explaining why.
2. Decide *when* each side effect should fire — at submission time vs. approval time — don't assume porting the old call site verbatim is correct; the semantics differ.
3. Grep for the old call site after gating it behind a now-unreachable path — dead code hiding a regression is easy to miss in review.

**Concurrency:** an approve/reject pair acting on the same row is a read-then-write race (double-approve, or approve+reject both succeeding) unless the entire critical section — status re-check, any state-dependent guard, the shared write, and the final status update — runs inside one transaction holding a per-row advisory lock acquired before the first read. Splitting the lock into two acquisitions (one for the check, one for the write) still leaves the race window open around the write.

**Nested transactions silently break that guarantee:** if the shared write function unconditionally opens its own `db.transaction` (rather than accepting and reusing the caller's already-open transaction/executor), it commits independently on a second pool connection. The outer transaction's later rollback (e.g. the status update fails) then can't undo what the shared function already committed — orphaned writes survive a "failed" approval. Fix: give the shared function an optional transaction/executor parameter; use it directly when provided (no nested `db.transaction`, no separate advisory-lock lifetime) and only open a fresh transaction for callers that don't already have one open. A regression test should force the outer transaction to roll back after the shared call returns and assert nothing persisted — that fails immediately if a nested independent commit sneaks back in.
