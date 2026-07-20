---
name: drizzle push can create tables without FKs
description: Non-interactive drizzle-kit push may create a new table missing its FK constraints; breaks the TEAM_BOUND_TABLES FK guard at e2e config load.
---

Non-interactive `drizzle-kit push` (as run by setup-test-db against the `_test` DB) can create a new table **without its foreign-key constraints** while reporting success. The e2e config-load guard then fails with "TEAM_BOUND_TABLES enthält Tabelle(n) ohne nicht-kaskadierenden FK auf teams.id" even though the Drizzle schema declares the FKs correctly.

**Why:** push suppresses interactive prompts (stdin ignored) and silently skips constraint additions in some paths; re-running setup-test-db does NOT repair it (schema hash unchanged / push sees no diff it will apply).

**How to apply:** when the FK-guard names a table whose schema looks correct, inspect the `_test` DB with `\d <table>` — if FKs are missing, add them via idempotent SQL (`pg_constraint` existence check + `ALTER TABLE ... ADD CONSTRAINT <drizzle-naming: table_col_reftable_id_fk> FOREIGN KEY ...`) against both dev and `_test` DBs as needed, then re-run the suite.
