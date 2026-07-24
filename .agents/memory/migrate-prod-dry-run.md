---
name: migrate-prod & drizzle dry-run
description: Safe production schema sync flow and the strict-push-without-TTY dry-run trick.
---

**Rule:** Production schema sync runs via the `migrate-prod` script (explicit URL, `--yes <dbname>` confirmation, refuses env DATABASE_URL/APP_DATABASE_URL targets). Its pre-push SQL mirrors `scripts/post-merge.sh` — keep both in sync when adding idempotent pre-steps.

**Dry-run trick:** drizzle-kit push has no dry-run flag, but `push --strict --verbose` with stdin ignored prints all planned statements and then aborts at the approval prompt ("Interactive prompts require a TTY") WITHOUT applying anything — a reliable read-only diff. Note: it exits 0 even on that abort, so detect the prompt text, not the exit code.

**Why:** Republish only ships code; the prod DB must be migrated first (schema before code, additive = backward compatible). Silent partial application or targeting staging by accident would corrupt prod.

**How to apply:** Before publishing schema-affecting changes, run the dry-run, then apply with confirmation, then republish. A planned `DROP TABLE session` means the session table fell out of the Drizzle schema — always abort.
