import { defineConfig } from "vitest/config";

// DB-gebundene Suite (test:db): migrate-prod legt seine Wegwerf-DB auf
// demselben geteilten Postgres-Server an wie die `_test`-DB der uebrigen
// Laeufe. Der Lauf-uebergreifende Advisory-Lock (globalSetup) verhindert,
// dass parallele Task-Umgebungen sich gegenseitig kippen.
export default defineConfig({
  test: {
    include: [
      "src/migrate-prod.fresh-db.test.ts",
      "src/pre-push-sql.bestands-db.db.test.ts",
      "src/setup-test-accounts.legacy-cleanup.db.test.ts",
    ],
    fileParallelism: false,
    globalSetup: ["./vitest.db.global-setup.ts"],
  },
});
