---
name: Playwright config env & schema-skip marker
description: ESM playwright.config.ts has no __dirname; how setup-test-db is skipped on unchanged schema.
---

# Playwright config runtime facts (dienstplan)

- `artifacts/dienstplan/playwright.config.ts` runs as ESM (`"type":"module"`). At
  config-load `__dirname` is UNDEFINED. `import.meta.url` is unreliable across
  Playwright's transpile. `process.cwd()` is reliably the artifact dir
  (`artifacts/dienstplan`) for both `test:e2e` and `pnpm exec playwright test`.
  To resolve repo-relative paths, walk up from cwd to the dir containing
  `pnpm-workspace.yaml`.

# setup-test-db skip-on-unchanged-schema

- **Rule:** the expensive `setup-test-db` (~20s) is skipped when a SHA-256
  fingerprint of `lib/db/src/schema/*.ts` + `lib/db/drizzle.config.ts` +
  `scripts/src/setup-test-db.ts` + the test-DB name matches a marker file at
  `node_modules/.cache/dienstplan-e2e/test-db-schema.hash` (gitignored).
- **Why:** repeated single-spec runs paid the full provisioning cost every time
  even with no schema change.
- **How to apply:** marker is written ONLY after a successful `setup-test-db`.
  Safety-over-speed: any doubt (missing marker, read/write error, changed hash)
  → provision. `E2E_SKIP_DB_SETUP=1` still skips the ENTIRE setup block
  (setup + separation + cleanup checks); the marker only gates `setup-test-db`,
  the two verify-* checks keep their own skip envs. If you add anything that
  changes the resulting test-DB state (new seed/migrate step), fold its source
  into `computeSchemaFingerprint`'s file list or the marker goes stale-safe-wrong.
