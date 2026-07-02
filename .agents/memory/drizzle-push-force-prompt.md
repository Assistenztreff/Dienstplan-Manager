---
name: drizzle push --force still prompts
description: drizzle-kit push --force does not suppress suggestion prompts (truncate/unique) in non-TTY shells
---
`drizzle-kit push --force` (0.31.x) only auto-accepts data-loss confirmations, NOT "suggestion" prompts like "add UNIQUE constraint to populated table — truncate?". In a non-TTY shell it crashes with "Interactive prompts require a TTY".

**Why:** Stale test DB (`<dbname>_test`) hit this when the schema had gained `users.plan` + `users.calendar_token UNIQUE`; both plain push and `--force` failed non-interactively.

**How to apply:** When setup-test-db's push fails on such a prompt, apply the missing DDL manually with idempotent SQL (IF NOT EXISTS / pg_constraint check) against the test DB, then re-run push — it completes cleanly once no prompt-worthy diff remains.
