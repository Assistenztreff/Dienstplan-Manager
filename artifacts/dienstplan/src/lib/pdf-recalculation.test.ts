import { describe, expect, it, vi } from "vitest";
import {
  renderRecalculationPage,
  type StatementRecalculation,
} from "./pdf-export";

// Friert den PDF-Nachberechnungs-Anhang ein: die Spalte „davon Urlaub /
// Krankheit" (Stunden + Geldwert je Zeile) muss erscheinen, sobald mindestens
// eine Zeile einen Abwesenheits-Anteil trägt — und darf sonst komplett fehlen.
// Getestet werden die an jspdf-autotable übergebenen head/body-Zeilen, nicht
// das gerenderte PDF selbst (DB-frei, kein Browser nötig).

function fakeDoc() {
  return {
    setFontSize: vi.fn(),
    setFont: vi.fn(),
    text: vi.fn(),
    lastAutoTable: { finalY: 80 },
  };
}

function baseRecalc(
  rows: StatementRecalculation["rows"],
  monthTotals: StatementRecalculation["monthTotals"] = null,
): StatementRecalculation {
  return {
    monthLabel: "Februar 2026",
    prevLabel: "Januar 2026",
    rows,
    monthTotals,
  };
}

function firstTableCall(autoTable: ReturnType<typeof vi.fn>) {
  expect(autoTable).toHaveBeenCalled();
  return autoTable.mock.calls[0][1] as {
    head: string[][];
    body: string[][];
    columnStyles: Record<string, unknown>;
  };
}

describe("renderRecalculationPage — Abwesenheits-Spalte", () => {
  it("weist Urlaubs- und Krankheitsanteil mit Stunden und Geldwert aus", () => {
    const autoTable = vi.fn();
    renderRecalculationPage(
      fakeDoc(),
      autoTable,
      baseRecalc([
        {
          userName: "Anna Muster",
          diffHours: 8,
          diffPay: 120.5,
          diffBasePay: 100,
          diffSurchargePay: 20.5,
          vacationHours: 8,
          vacationPay: 96,
        },
        {
          userName: "Bernd Beispiel",
          diffHours: -4,
          diffPay: -48,
          diffBasePay: -48,
          diffSurchargePay: 0,
          sickHours: 4,
          sickPay: 48,
        },
      ]),
    );

    const opts = firstTableCall(autoTable);
    expect(opts.head[0]).toContain("davon Urlaub / Krankheit");
    expect(opts.head[0]).toHaveLength(6);

    const [anna, bernd] = opts.body;
    expect(anna[0]).toBe("Anna Muster");
    expect(anna[5]).toBe(`Urlaub 8 h (${(96).toLocaleString("de-DE", { style: "currency", currency: "EUR" })})`);
    expect(bernd[5]).toBe(`Krankheit 4 h (${(48).toLocaleString("de-DE", { style: "currency", currency: "EUR" })})`);
    // Rechtsbündige Ausrichtung auch für die Zusatzspalte
    expect(opts.columnStyles["5"]).toEqual({ halign: "right" });
  });

  it("kombiniert Urlaub UND Krankheit in einer Zeile, ohne Geldwert nur Stunden", () => {
    const autoTable = vi.fn();
    renderRecalculationPage(
      fakeDoc(),
      autoTable,
      baseRecalc([
        {
          userName: "Clara Combi",
          diffHours: 12.5,
          diffPay: null,
          diffBasePay: null,
          diffSurchargePay: null,
          vacationHours: 8.5,
          vacationPay: null,
          sickHours: 4,
          sickPay: null,
        },
      ]),
    );

    const opts = firstTableCall(autoTable);
    expect(opts.body[0][5]).toBe("Urlaub 8,5 h\nKrankheit 4 h");
  });

  it("zeigt einen Strich für Zeilen ohne Abwesenheits-Anteil, wenn andere einen haben", () => {
    const autoTable = vi.fn();
    renderRecalculationPage(
      fakeDoc(),
      autoTable,
      baseRecalc([
        {
          userName: "Mit Urlaub",
          diffHours: 8,
          diffPay: 96,
          diffBasePay: 96,
          diffSurchargePay: 0,
          vacationHours: 8,
          vacationPay: 96,
        },
        {
          userName: "Ohne Abwesenheit",
          diffHours: 2,
          diffPay: 24,
          diffBasePay: 24,
          diffSurchargePay: 0,
        },
      ]),
    );

    const opts = firstTableCall(autoTable);
    expect(opts.body[1][5]).toBe("—");
  });

  it("lässt die Spalte komplett weg, wenn keine Zeile einen Abwesenheits-Anteil trägt", () => {
    const autoTable = vi.fn();
    renderRecalculationPage(
      fakeDoc(),
      autoTable,
      baseRecalc([
        {
          userName: "Nur Differenz",
          diffHours: 3,
          diffPay: 36,
          diffBasePay: 36,
          diffSurchargePay: 0,
          // 0-Werte zählen NICHT als Abwesenheits-Anteil
          vacationHours: 0,
          sickHours: 0,
        },
      ]),
    );

    const opts = firstTableCall(autoTable);
    expect(opts.head[0]).toHaveLength(5);
    expect(opts.head[0]).not.toContain("davon Urlaub / Krankheit");
    expect(opts.body[0]).toHaveLength(5);
    expect(opts.columnStyles["5"]).toBeUndefined();
  });

  it("führt die Nachberechnungs-Summe in der Gesamtsummen-Tabelle mit", () => {
    const autoTable = vi.fn();
    renderRecalculationPage(
      fakeDoc(),
      autoTable,
      baseRecalc(
        [
          {
            userName: "Anna Muster",
            diffHours: 8,
            diffPay: 100,
            diffBasePay: 100,
            diffSurchargePay: 0,
            vacationHours: 8,
            vacationPay: 100,
          },
        ],
        { basePay: 1000, surchargePay: 200, totalPay: 1200 },
      ),
    );

    expect(autoTable).toHaveBeenCalledTimes(2);
    const totals = autoTable.mock.calls[1][1] as { body: string[][] };
    const rows = totals.body.map((r) => r.join(" | "));
    expect(rows.some((r) => r.startsWith("Nachberechnung Januar 2026"))).toBe(true);
    const gesamt = totals.body.find((r) => r[0] === "Gesamt inkl. Nachberechnung");
    expect(gesamt?.[1]).toBe(
      (1300).toLocaleString("de-DE", { style: "currency", currency: "EUR" }),
    );
  });
});
