/**
 * Unit-Tests fuer die Zuordnungsregeln der gestaffelten Abschlusspruefung
 * (Task #636). Schwerpunkt: gemischte Aenderungen und unbekannte Pfade
 * eskalieren IMMER auf die volle Kette (Sicherheitsregel).
 */
import { describe, expect, it } from "vitest";
import {
  blocksForCategory,
  classifyChangedFiles,
  classifyPath,
  E2E_BLOCKS,
} from "./validation-scope.js";

describe("classifyPath", () => {
  it("stuft Doku/Notizen als docs ein", () => {
    expect(classifyPath("replit.md")).toBe("docs");
    expect(classifyPath("tasks.md")).toBe("docs");
    expect(classifyPath("lib/db/README.md")).toBe("docs");
    expect(classifyPath(".agents/memory/MEMORY.md")).toBe("docs");
    expect(classifyPath(".local/tasks/task-636.md")).toBe("docs");
    expect(classifyPath("attached_assets/foto.png")).toBe("docs");
  });

  it("stuft reine Oberflaeche als frontend ein", () => {
    expect(classifyPath("artifacts/dienstplan/src/pages/dashboard.tsx")).toBe(
      "frontend",
    );
    expect(classifyPath("artifacts/dienstplan/src/index.css")).toBe("frontend");
    expect(classifyPath("artifacts/dienstplan/public/manifest.json")).toBe(
      "frontend",
    );
    expect(classifyPath("artifacts/dienstplan/index.html")).toBe("frontend");
    expect(
      classifyPath("artifacts/mockup-sandbox/src/components/mockups/x.tsx"),
    ).toBe("frontend");
  });

  it("stuft API/Schema/Shared/Test-Infrastruktur als full ein", () => {
    expect(classifyPath("artifacts/api-server/src/routes/shifts.ts")).toBe("full");
    expect(classifyPath("lib/db/src/schema/users.ts")).toBe("full");
    expect(classifyPath("lib/api-spec/openapi.yaml")).toBe("full");
    expect(classifyPath("lib/test-fixtures/src/verify-checks.ts")).toBe("full");
    expect(classifyPath("scripts/src/setup-test-db.ts")).toBe("full");
    expect(classifyPath("artifacts/dienstplan/e2e/foo-api.spec.ts")).toBe("full");
    expect(classifyPath("artifacts/dienstplan/e2e/smoke-specs.txt")).toBe("full");
    expect(classifyPath("artifacts/dienstplan/playwright.config.ts")).toBe("full");
    expect(classifyPath("artifacts/dienstplan/vite.config.ts")).toBe("full");
    expect(classifyPath("artifacts/dienstplan/package.json")).toBe("full");
    expect(classifyPath("pnpm-lock.yaml")).toBe("full");
    expect(classifyPath("package.json")).toBe("full");
    expect(classifyPath(".replit")).toBe("full");
  });

  it("Sicherheitsregel: unbekannte/neue Pfade => full", () => {
    expect(classifyPath("voellig/neues/verzeichnis/datei.ts")).toBe("full");
    expect(classifyPath("artifacts/mobile/App.tsx")).toBe("full");
    expect(classifyPath("Dockerfile")).toBe("full");
  });

  it("mockup-sandbox: Build-/Dependency-Dateien bleiben full", () => {
    expect(classifyPath("artifacts/mockup-sandbox/package.json")).toBe("full");
    expect(classifyPath("artifacts/mockup-sandbox/vite.config.ts")).toBe("full");
    expect(classifyPath("artifacts/mockup-sandbox/tsconfig.json")).toBe("full");
  });
});

describe("classifyChangedFiles", () => {
  it("nur Doku => docs", () => {
    const r = classifyChangedFiles(["replit.md", ".agents/memory/MEMORY.md"]);
    expect(r.category).toBe("docs");
  });

  it("Frontend + Doku => frontend (Doku eskaliert nicht)", () => {
    const r = classifyChangedFiles([
      "replit.md",
      "artifacts/dienstplan/src/pages/dashboard.tsx",
    ]);
    expect(r.category).toBe("frontend");
    expect(r.decisiveFiles).toContain(
      "artifacts/dienstplan/src/pages/dashboard.tsx",
    );
  });

  it("gemischt mit EINER Server-Datei => full", () => {
    const r = classifyChangedFiles([
      "replit.md",
      "artifacts/dienstplan/src/pages/dashboard.tsx",
      "artifacts/api-server/src/routes/shifts.ts",
    ]);
    expect(r.category).toBe("full");
    expect(r.decisiveFiles).toEqual(["artifacts/api-server/src/routes/shifts.ts"]);
  });

  it("gemischt mit unbekanntem Pfad => full", () => {
    const r = classifyChangedFiles([
      "artifacts/dienstplan/src/App.tsx",
      "irgendwas/neues.txt",
    ]);
    expect(r.category).toBe("full");
  });

  it("leere Liste => full (Sicherheitsregel)", () => {
    expect(classifyChangedFiles([]).category).toBe("full");
  });

  it("E2E-Spec-Aenderung => full (Testinhalte sind Infrastruktur)", () => {
    const r = classifyChangedFiles([
      "artifacts/dienstplan/e2e/dienstplan-shift-dialog.spec.ts",
    ]);
    expect(r.category).toBe("full");
  });
});

describe("blocksForCategory", () => {
  it("docs => keine Bloecke", () => {
    expect(blocksForCategory("docs")).toEqual([]);
  });
  it("frontend => nur Smoke", () => {
    expect(blocksForCategory("frontend")).toEqual([E2E_BLOCKS.e2eSmoke]);
  });
  it("full => komplette Kette in Reihenfolge", () => {
    expect(blocksForCategory("full")).toEqual([
      E2E_BLOCKS.apiServerDb,
      E2E_BLOCKS.scriptsDb,
      E2E_BLOCKS.e2eApi,
      E2E_BLOCKS.e2eSmoke,
    ]);
  });
});
