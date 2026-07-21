import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Unit-Tests laufen ausschließlich gegen reine Logik unter src/. Die Playwright-
// E2E-Specs liegen in e2e/ (*.spec.ts) und werden hier bewusst NICHT eingebunden,
// damit `vitest` und `playwright test` sich nicht gegenseitig aufgreifen.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@assets": path.resolve(
        fileURLToPath(new URL(".", import.meta.url)),
        "..",
        "..",
        "attached_assets",
      ),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
