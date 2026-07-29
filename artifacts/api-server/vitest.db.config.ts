import { defineConfig } from "vitest/config";

// DB-gebundene Suite (test:db): laeuft gegen die geteilte `<dbname>_test`-DB
// und wird deshalb — wie die E2E-Laeufe — durch den Lauf-uebergreifenden
// Postgres-Advisory-Lock geschuetzt (globalSetup erwirbt ihn vor dem ersten
// DB-Zugriff, der Teardown gibt ihn am Suite-Ende frei).
export default defineConfig({
  test: {
    include: [
      "src/lib/platform-errors.retention.test.ts",
      "src/lib/register-rate-limit.db.test.ts",
      "src/routes/auth.register-rate-limit.route.db.test.ts",
    ],
    fileParallelism: false,
    globalSetup: ["./vitest.db.global-setup.ts"],
  },
});
