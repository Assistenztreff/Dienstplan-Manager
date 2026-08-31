// ---------------------------------------------------------------------------
// Regressionstest zur Router-Reihenfolge (28.08.2026).
// ---------------------------------------------------------------------------
// shifts-crud.ts bringt GET /shifts/:id mit. Jeder Router, der einen
// STATISCHEN GET-Pfad unter /shifts/<wort> anbietet, muss deshalb VOR
// shiftsCrudRouter montiert werden — sonst schluckt /shifts/:id die Anfrage,
// liest "<wort>" als ID und antwortet mit 400 "Invalid id".
//
// Genau so ging GET /shifts/deviations verloren: Die Abweichungs-Liste kam im
// Frontend nie an, weshalb das "Gemeldet"-Badge nach einer Meldung nie
// erschien. Der Test liest die Quelldateien statt die App zu starten (die
// braucht eine DB-Verbindung) und prueft die Reihenfolge generisch — er
// erkennt also auch kuenftige Router mit demselben Problem.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const routesDir = fileURLToPath(new URL("./", import.meta.url));

/** Reihenfolge der router.use(...)-Aufrufe in index.ts, als Modulnamen. */
function mountOrder(): string[] {
  const src = readFileSync(`${routesDir}index.ts`, "utf8");
  const imports = new Map<string, string>();
  for (const m of src.matchAll(/import\s+(\w+)\s+from\s+"\.\/([\w.-]+)"/g)) {
    imports.set(m[1]!, m[2]!);
  }
  const order: string[] = [];
  for (const m of src.matchAll(/^router\.use\((\w+)\);/gm)) {
    const file = imports.get(m[1]!);
    if (file) order.push(file);
  }
  return order;
}

/** Router-Dateien mit einem statischen GET-Pfad unter /shifts/<wort>. */
function modulesWithStaticShiftsGet(): string[] {
  return readdirSync(routesDir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .filter((f) =>
      /router\.get\("\/shifts\/[a-z][\w-]*"/.test(readFileSync(`${routesDir}${f}`, "utf8")),
    )
    .map((f) => f.replace(/\.ts$/, ""));
}

describe("Router-Reihenfolge unter /shifts", () => {
  it("montiert jeden statischen GET /shifts/<wort> vor GET /shifts/:id", () => {
    const order = mountOrder();
    const crudIndex = order.indexOf("shifts-crud");
    expect(crudIndex, "shifts-crud muss in index.ts montiert sein").toBeGreaterThanOrEqual(0);

    const statics = modulesWithStaticShiftsGet();
    expect(statics, "erwartet mindestens shifts-deviations").toContain("shifts-deviations");

    for (const mod of statics) {
      const at = order.indexOf(mod);
      if (at < 0) continue; // nicht montiert => hier nicht relevant
      expect(
        at,
        `${mod} hat einen statischen GET /shifts/<wort> und muss VOR shifts-crud ` +
          `montiert werden, sonst verdeckt GET /shifts/:id die Route (400 "Invalid id").`,
      ).toBeLessThan(crudIndex);
    }
  });

  it("erkennt shifts-crud weiterhin als Traeger von GET /shifts/:id", () => {
    const src = readFileSync(`${routesDir}shifts-crud.ts`, "utf8");
    expect(src).toMatch(/router\.get\("\/shifts\/:id"/);
  });
});
