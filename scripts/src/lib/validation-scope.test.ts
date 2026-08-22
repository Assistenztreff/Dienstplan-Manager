/**
 * Unit-Tests fuer die Zuordnungsregeln der gestaffelten Abschlusspruefung
 * (Task #636). Schwerpunkt: gemischte Aenderungen und unbekannte Pfade
 * eskalieren IMMER auf die volle Kette (Sicherheitsregel).
 */
import { describe, expect, it } from "vitest";
import {
  API_SHARD_PREBUILD,
  API_SHARD_COUNT,
  blocksForCategory,
  classifyChangedFiles,
  classifyPath,
  E2E_BLOCKS,
  planForCategory,
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

describe("planForCategory (Task #640)", () => {
  it("docs => leerer Plan", () => {
    const p = planForCategory("docs", "abc123", true);
    expect(p.serialHead).toEqual([]);
    expect(p.parallelLanes).toEqual([]);
    expect(p.serialTail).toEqual([]);
  });

  it("frontend => eine serielle Lane mit Smoke", () => {
    const p = planForCategory("frontend", "abc123", true);
    expect(p.serialHead).toEqual([]);
    expect(p.parallelLanes).toEqual([
      { name: "seriell", commands: [E2E_BLOCKS.e2eSmoke] },
    ]);
    expect(p.serialTail).toEqual([]);
  });

  it("full + privater Suffix => DB-Lane + API-Shards parallel, Smoke danach", () => {
    const p = planForCategory("full", "abc123", true);
    expect(p.serialHead).toEqual([API_SHARD_PREBUILD]);
    expect(p.parallelLanes.map((l) => l.name)).toEqual([
      "db-tests",
      ...Array.from({ length: API_SHARD_COUNT }, (_, i) => `api-shard-${i + 1}`),
    ]);
    expect(p.parallelLanes[0]!.commands).toEqual([
      E2E_BLOCKS.apiServerDb,
      E2E_BLOCKS.scriptsDb,
    ]);
    // Jede Shard-Lane: eigener Suffix, eigene Ports, Playwright-Shard-Flag.
    const suffixes = new Set<string>();
    const ports = new Set<string>();
    for (const [i, lane] of p.parallelLanes.slice(1).entries()) {
      expect(lane.commands).toHaveLength(1);
      expect(lane.commands[0]).toContain(`--shard=${i + 1}/${API_SHARD_COUNT}`);
      expect(lane.commands[0]).toContain('"api\\.spec\\.ts$"');
      const env = lane.env!;
      expect(env.E2E_TEST_DB_SUFFIX).toMatch(/^[a-z0-9]{1,16}$/);
      expect(env.E2E_TEST_DB_SUFFIX!.startsWith("abc123")).toBe(true);
      suffixes.add(env.E2E_TEST_DB_SUFFIX!);
      ports.add(env.E2E_API_PORT!);
      ports.add(env.E2E_WEB_PORT!);
      // Standard-Ports (8099/5199) bleiben dem Smoke-/Default-Lauf vorbehalten.
      expect(env.E2E_API_PORT).not.toBe("8099");
      expect(env.E2E_WEB_PORT).not.toBe("5199");
      expect(env.E2E_API_PREBUILT).toBe("1");
    }
    expect(suffixes.size).toBe(API_SHARD_COUNT);
    expect(ports.size).toBe(API_SHARD_COUNT * 2);
    expect(p.serialTail).toEqual([E2E_BLOCKS.e2eSmoke]);
  });

  it("langer Basis-Suffix wird gekappt und bleibt whitelist-konform", () => {
    const p = planForCategory("full", "a".repeat(16), true);
    for (const lane of p.parallelLanes.slice(1)) {
      expect(lane.env!.E2E_TEST_DB_SUFFIX).toMatch(/^[a-z0-9]{1,16}$/);
    }
  });

  it("full ohne privaten Suffix (geteilte _test-DB) => serielle Kette", () => {
    const p = planForCategory("full", "", true);
    expect(p.serialHead).toEqual([]);
    expect(p.parallelLanes).toEqual([
      { name: "seriell", commands: blocksForCategory("full") },
    ]);
    expect(p.serialTail).toEqual([]);
  });

  it("full mit E2E_PARALLEL=0 => serielle Kette", () => {
    const p = planForCategory("full", "abc123", false);
    expect(p.parallelLanes).toEqual([
      { name: "seriell", commands: blocksForCategory("full") },
    ]);
  });

  it("ungueltiger Suffix (Whitelist-Verletzung) => serielle Kette", () => {
    const p = planForCategory("full", "ÄÖ/;drop", true);
    expect(p.parallelLanes.map((l) => l.name)).toEqual(["seriell"]);
  });
});
