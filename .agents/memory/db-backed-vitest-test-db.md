---
name: DB-backed vitest against the _test DB
description: How to write unit tests that need Postgres without touching the dev DB
---

Unit tests needing real Postgres (e.g. pruning/retention SQL) must run against the isolated `<dbname>_test` DB, never the dev DB — table-wide deletes with test-sized limits would destroy real dev rows.

**Pattern:** rewrite `process.env.DATABASE_URL` (and any env-read config like `PLATFORM_ERRORS_MAX_STORED`) BEFORE dynamically importing `@workspace/db` and the module under test — both read env at module load. Keep all imports that transitively touch `@workspace/db` dynamic; vitest isolates test files, so other (pure) test files are unaffected.

**Self-provisioning:** probe the table with a cheap SELECT; on failure run `pnpm --filter @workspace/scripts run setup-test-db` via execSync from repo root with the ORIGINAL dev DATABASE_URL (the script derives `_test` itself — passing the already-rewritten URL would create `_test_test`). Generous beforeAll timeout (~240s) for the cold path; warm re-runs are ~2s.

**Teardown:** `await pool.end()` in afterAll or vitest hangs.

Example: `artifacts/api-server/src/lib/platform-errors.retention.test.ts`.

**Throwaway full-schema DB variant:** scripts that reshape the whole team layout (e.g. test-account re-setup) must NOT run against the shared `_test` DB. Instead create a uniquely named throwaway DB, push the full Drizzle schema via `pnpm --filter @workspace/db run push` (treat "Interactive prompts require a TTY" in output as failure even with exit 0), seed the minimal core rows, run the real script via spawnSync with DATABASE_URL+APP_DATABASE_URL overridden, drop the DB in afterAll. Example: `scripts/src/setup-test-accounts.legacy-cleanup.db.test.ts` (wired into scripts' vitest.db.config.ts; plain `test` excludes `**/*.db.test.ts`).
