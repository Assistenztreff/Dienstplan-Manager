/**
 * Guard (Task #643): playwright.config.ts (Lock-Erwerb) und
 * e2e/global-teardown.ts (Lock-Freigabe) muessen denselben Lauf-Lock-Pfad
 * ableiten. Beide nutzen dafuer die geteilte Funktion
 * `deriveRunLockPath` aus @workspace/test-fixtures/run-lock — dieser Test
 * sichert die Ableitung selbst ab und prueft per Quelltext-Check, dass
 * beide Dateien wirklich den geteilten Helper verwenden (und keine eigene
 * `run-….lock`-Ableitung mehr enthalten).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_E2E_API_PORT,
  DEFAULT_E2E_WEB_PORT,
  deriveRunLockPath,
  runLockRelativePath,
} from "@workspace/test-fixtures/run-lock";

const artifactRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

describe("deriveRunLockPath", () => {
  it("nutzt die Ports aus dem Environment (port-gebundener Name)", () => {
    expect(
      deriveRunLockPath("/repo", { E2E_API_PORT: "8201", E2E_WEB_PORT: "5301" }),
    ).toBe("/repo/node_modules/.cache/dienstplan-e2e/run-8201-5301.lock");
  });

  it("faellt ohne Environment auf die Standard-Ports zurueck", () => {
    expect(deriveRunLockPath("/repo", {})).toBe(
      path.join(
        "/repo",
        runLockRelativePath(DEFAULT_E2E_API_PORT, DEFAULT_E2E_WEB_PORT),
      ),
    );
  });

  it("liefert fuer verschiedene Shard-Lanes verschiedene Lock-Pfade", () => {
    const lane1 = deriveRunLockPath("/repo", {
      E2E_API_PORT: "8099",
      E2E_WEB_PORT: "5199",
    });
    const lane2 = deriveRunLockPath("/repo", {
      E2E_API_PORT: "8201",
      E2E_WEB_PORT: "5301",
    });
    expect(lane1).not.toBe(lane2);
  });
});

describe("Config und Teardown teilen sich die Lock-Ableitung", () => {
  const files = [
    "playwright.config.ts",
    path.join("e2e", "global-teardown.ts"),
  ];

  for (const file of files) {
    it(`${file} importiert deriveRunLockPath und baut keinen eigenen Lock-Namen`, () => {
      const source = readFileSync(path.join(artifactRoot, file), "utf8");
      expect(source).toContain("@workspace/test-fixtures/run-lock");
      expect(source).toContain("deriveRunLockPath(");
      // Keine lokale Template-Ableitung des Lock-Dateinamens mehr:
      expect(source).not.toMatch(/run-\$\{[^}]+\}-\$\{[^}]+\}\.lock/);
    });
  }
});
