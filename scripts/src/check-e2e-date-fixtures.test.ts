import { describe, expect, it } from "vitest";
import { findViolationsInSource } from "./check-e2e-date-fixtures";

// Realer Baseline-Eintrag aus check-e2e-date-fixtures.ts, zu Testzwecken hier
// nachgebildet: dienstplan-lohnauswertung-ist-modus-api.spec.ts, Zeile 56.
const BASELINED_FILE = "dienstplan-lohnauswertung-ist-modus-api.spec.ts";
const BASELINED_TEXT = 'const VACATION_DAY = "2026-10-15";';

function absenceSourceWithLines(lines: string[]): string {
  // ABSENCE_MARKER_RE braucht irgendwo einen Abwesenheits-Marker im Text.
  return ['type: "vacation",', ...lines].join("\n");
}

describe("check-e2e-date-fixtures", () => {
  it("meldet kein Datum ohne Abwesenheits-Marker in der Datei", () => {
    const src = 'const d = "2027-03-10";';
    expect(findViolationsInSource(src, "irgendeine.spec.ts")).toHaveLength(0);
  });

  it("meldet ein hartkodiertes Datum ausserhalb der Baseline", () => {
    const src = absenceSourceWithLines(['const d = "2027-03-10";']);
    expect(findViolationsInSource(src, "neue-spec.spec.ts")).toHaveLength(1);
  });

  it("erkennt Datumsliterale auch innerhalb von Template-Literalen (Backtick)", () => {
    const src = absenceSourceWithLines([
      "const start = `2027-03-10T08:00:00.000Z`;",
    ]);
    expect(findViolationsInSource(src, "neue-spec.spec.ts")).toHaveLength(1);
  });

  it("greift auch fuer freizeitausgleich/urlaubsabgeltung als Abwesenheits-Marker", () => {
    const src = [
      'type: "freizeitausgleich",',
      'const d = "2027-03-10";',
    ].join("\n");
    expect(findViolationsInSource(src, "neue-spec.spec.ts")).toHaveLength(1);

    const src2 = [
      'type: "urlaubsabgeltung",',
      'const d = "2027-03-10";',
    ].join("\n");
    expect(findViolationsInSource(src2, "neue-spec.spec.ts")).toHaveLength(1);
  });

  it("laesst einen exakt (Datei+Zeile+Text) passenden Baseline-Treffer durch", () => {
    // Bewusst so gebaut, dass BASELINED_TEXT exakt auf Zeile 56 landet.
    const filler = Array.from({ length: 54 }, (_, i) => `// Zeile ${i + 2}`);
    const src = absenceSourceWithLines([...filler, BASELINED_TEXT]);
    expect(findViolationsInSource(src, BASELINED_FILE)).toHaveLength(0);
  });

  it("laesst ein Duplikat derselben Baseline-Zeile an ANDERER Position NICHT durch (Kern-Regression)", () => {
    // Dieselbe Datei, derselbe exakte Zeilentext wie die echte Baseline-
    // Zeile 56 — aber an einer anderen Zeilennummer (z. B. in einem neu
    // hinzugefuegten Testblock weiter oben). Ohne Datei+Zeile-Bindung wuerde
    // eine reine Text-Baseline dies faelschlich als bereits geprueft
    // durchwinken, obwohl es sich um einen NEUEN, ungeprueften Fixture-Ort
    // handelt, der eigenstaendig rotten kann.
    const src = absenceSourceWithLines([BASELINED_TEXT]); // landet auf Zeile 2, nicht 56
    const violations = findViolationsInSource(src, BASELINED_FILE);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.text).toBe(BASELINED_TEXT);
  });

  it("verlangt eine Aktualisierung, wenn sich die Baseline-Zeile inhaltlich verschiebt", () => {
    // Gleiche Zeilennummer wie der Baseline-Eintrag, aber abweichender Text
    // (z. B. das Datum wurde manuell geaendert, ohne den Eintrag zu pflegen).
    const filler = Array.from({ length: 54 }, (_, i) => `// Zeile ${i + 2}`);
    const src = absenceSourceWithLines([
      ...filler,
      'const VACATION_DAY = "2027-11-20";',
    ]);
    expect(findViolationsInSource(src, BASELINED_FILE)).toHaveLength(1);
  });

  it("ignoriert Datumsliterale in Kommentaren", () => {
    const src = absenceSourceWithLines(["// z. B. 2027-03-10 als Beispiel"]);
    expect(findViolationsInSource(src, "neue-spec.spec.ts")).toHaveLength(0);
  });
});
