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
    // Reine Logik-Tests laufen ohne DOM (Standard-Node-Environment, schnell).
    // Einzelne Dateien mit React-Komponenten/-Hooks holen sich ihr eigenes
    // DOM per `// @vitest-environment jsdom`-Pragma (z. B. auth.test.tsx) —
    // kein globaler jsdom-Zwang für alle Tests.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
