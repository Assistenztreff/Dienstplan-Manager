---
name: data_migrations marker makes backfill scripts single-shot per DB
description: Re-running an e2e spec that executes a `data_migrations`-guarded backfill script (e.g. backfill-partial-absence-flag) against the same test DB looks like a regression but is just the one-time lock already claimed.
---

Scripts that backfill legacy rows (see `scripts/src/backfill-partial-absence-flag.ts`) claim a permanent
`INSERT INTO data_migrations (name) VALUES (...) ON CONFLICT DO NOTHING` marker before running their UPDATE.
This is intentional: it stops the backfill from re-classifying freshly-created rows that legitimately match
the same WHERE condition after the first rollout.

**Why:** the alternative (re-run every time the WHERE condition matches) would corrupt new, correct data on
every subsequent run — the marker is the only thing preventing that.

**How to apply:** if you manually re-run an e2e spec (or the script directly) a second time against the same
private `_test` DB to double-check a fix, the migration becomes a guaranteed no-op the second time — the
spec's assertion on the backfilled column will fail even though the code is correct. This is NOT a code
regression. To confirm code-only behavior, either delete the `data_migrations` row for that migration name
in the test DB before re-running, or use a fresh test DB. Don't chase this as a regression — check the marker
table first.
