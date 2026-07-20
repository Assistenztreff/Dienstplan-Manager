import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit-Tests laufen ausschließlich gegen reine Logik unter src/. Die Playwright-
// E2E-Specs liegen in e2e/ (*.spec.ts) und werden hier bewusst NICHT eingebunden,
// damit `vitest` und `playwright test` sich nicht gegenseitig aufgreifen.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
