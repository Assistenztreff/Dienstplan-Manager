import { defineConfig } from "vitest/config";

// Unit-Tests laufen ausschließlich gegen reine Logik unter src/ (keine DB-/HTTP-
// Abhängigkeiten). Sie spiegeln das Setup der übrigen Pakete im Monorepo.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
