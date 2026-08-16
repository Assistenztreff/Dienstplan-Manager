---
name: Assistant shift-delete returns 404, not 403
description: DELETE /shifts (and bulk-delete) intentionally answers 404 (not 403) when a plain assistant targets a non-own/non-absence shift ID, to avoid an ID-existence oracle.
---

`DELETE /api/shifts/:id` and `/api/shifts/bulk-delete` deliberately return 404 (not 403) when the requester is a plain assistant (no admin/teamleiter/access-level privilege for the shift's team) targeting someone else's shift, or their own non-absence shift. Assistants may only self-service-delete their OWN absence (vacation/sick) shifts (see `assistant-absence-selfservice.md`); everything else is a 404, consistently, so a probing assistant can't distinguish "not yours" from "doesn't exist."

**Why:** An older test, `dienstplan-assistant-write-forbidden.spec.ts`, still asserts `FORBIDDEN = [401, 403]` for a plain assistant's `DELETE /api/shifts/:id` and fails (gets 404) — this is a stale test expectation from before the self-service redesign, not a regression. Confirmed via `git status`-isolated re-run: fails identically on a clean checkout with no code changes.

**How to apply:** If you see this specific test fail with "Expected 401/403, received 404," it's the known stale assertion, not a new bug — don't chase it as a regression. Fixing the test (widen `FORBIDDEN` to include 404, or split the DELETE case into its own 404 assertion) is still open/undone as of 2026-08-16.
