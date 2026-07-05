---
name: allowance migration re-adds stale owner_id UNIQUE
description: why team-override allowance writes 500 in the _test DB and how the legacy migration fights the current schema
---

# Allowance settings: legacy migration vs. team-override schema

The current `allowance_settings` schema allows an owner to have BOTH a Konto row
(`team_id IS NULL`) AND many Team-override rows (`team_id` set). Uniqueness is
therefore only a **partial** index `allowance_settings_owner_account_unique`
(`owner_id WHERE team_id IS NULL`) plus a full `UNIQUE(team_id)`. There must be
**no** full `UNIQUE(owner_id)` constraint.

**The trap:** the pre-team-override migration (`scripts/migrate-allowance-settings`)
was written when allowance was one-row-per-owner and it (re)created a full
`allowance_settings_owner_id_unique UNIQUE(owner_id)`. `post-merge.sh` already
drops that and creates the partial index, so the **dev** DB ends up clean. But
`setup-test-db` runs the migration and does NOT apply the post-merge cleanup, so
the `_test` DB kept the full constraint. Result: writing a Team override for an
owner that already has a Konto row → second row, same `owner_id` → constraint
violation → route returns 500 "Interner Serverfehler". Symptom is DB-only; the
app/route code is correct.

**Fix applied:** the migration now drops the legacy full constraint and creates
the partial index itself (idempotent, matching schema + post-merge.sh), so any DB
that runs the migration (incl. `_test`) ends consistent.

**Why:** the app lazily creates the Konto row on GET /allowance-settings, so you
cannot avoid the two-rows-per-owner situation from the test side; the schema drift
had to be fixed.

**How to apply:** if a team-override allowance write 500s, check
`pg_constraint` on `allowance_settings` for a stray full `UNIQUE(owner_id)`; the
only valid uniqueness is the partial `owner_account_unique` index + `UNIQUE(team_id)`.
