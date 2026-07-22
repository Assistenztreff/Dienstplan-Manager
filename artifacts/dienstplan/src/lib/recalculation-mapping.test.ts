import { describe, expect, it } from "vitest";
import type { MonthClosingDiffRow } from "@workspace/api-client-react";
import {
  computeRecalculationMonthTotals,
  mapDiffRowsToRecalculationRows,
  type RecalculationBalance,
} from "./recalculation-mapping";

// Friert die Übergabe-Strecke Diff-API → PDF-Export ein: die Abwesenheits-
// Felder (vacationHours/vacationPay/sickHours/sickPay) aus der Antwort von
// GET /month-closings/diff müssen 1:1 (unvertauscht, unverfälscht) in die
// StatementRecalculation-Zeilen des PDF-Aufrufs gelangen. DB-frei; die
// Diff-Antwort ist typisiert gemockt, damit Schemaänderungen sofort auffallen.

function diffRow(overrides: Partial<MonthClosingDiffRow>): MonthClosingDiffRow {
  return {
    userId: 1,
    userName: "Anna Muster",
    reportedHours: 40,
    currentHours: 48,
    diffHours: 8,
    ...overrides,
  };
}

describe("mapDiffRowsToRecalculationRows", () => {
  it("uebergibt Urlaubs- und Krank-Felder 1:1 und unvertauscht", () => {
    const rows = mapDiffRowsToRecalculationRows(
      [
        diffRow({
          userId: 1,
          userName: "Anna Muster",
          diffHours: 8,
          diffPay: 120.5,
          diffBasePay: 100,
          diffSurchargePay: 20.5,
          vacationHours: 8,
          vacationPay: 96.4,
          sickHours: 0,
          sickPay: null,
        }),
        diffRow({
          userId: 2,
          userName: "Bernd Beispiel",
          diffHours: -4,
          diffPay: -48,
          diffBasePay: -48,
          diffSurchargePay: 0,
          vacationHours: 0,
          vacationPay: null,
          sickHours: 4.5,
          sickPay: 54.75,
        }),
      ],
      "all",
    );

    expect(rows).toEqual([
      {
        userName: "Anna Muster",
        diffHours: 8,
        diffPay: 120.5,
        diffBasePay: 100,
        diffSurchargePay: 20.5,
        vacationHours: 8,
        vacationPay: 96.4,
        sickHours: 0,
        sickPay: null,
      },
      {
        userName: "Bernd Beispiel",
        diffHours: -4,
        diffPay: -48,
        diffBasePay: -48,
        diffSurchargePay: 0,
        vacationHours: 0,
        vacationPay: null,
        sickHours: 4.5,
        sickPay: 54.75,
      },
    ]);
  });

  it("Urlaub und Krankheit landen nicht im jeweils anderen Feld", () => {
    const [row] = mapDiffRowsToRecalculationRows(
      [
        diffRow({
          vacationHours: 8,
          vacationPay: 96,
          sickHours: 3,
          sickPay: 36,
        }),
      ],
      "all",
    );
    expect(row.vacationHours).toBe(8);
    expect(row.vacationPay).toBe(96);
    expect(row.sickHours).toBe(3);
    expect(row.sickPay).toBe(36);
  });

  it("fehlende optionale Felder werden zu 0 (Stunden) bzw. null (Geld)", () => {
    const [row] = mapDiffRowsToRecalculationRows(
      [diffRow({ diffHours: 2 })],
      "all",
    );
    expect(row).toEqual({
      userName: "Anna Muster",
      diffHours: 2,
      diffPay: null,
      diffBasePay: null,
      diffSurchargePay: null,
      vacationHours: 0,
      vacationPay: null,
      sickHours: 0,
      sickPay: null,
    });
  });

  it("Assistenten-Filter behaelt nur die gewaehlte Person, Werte unveraendert", () => {
    const rows = mapDiffRowsToRecalculationRows(
      [
        diffRow({ userId: 1, userName: "Anna Muster", vacationHours: 8, vacationPay: 96 }),
        diffRow({ userId: 2, userName: "Bernd Beispiel", sickHours: 4, sickPay: 48 }),
      ],
      2,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].userName).toBe("Bernd Beispiel");
    expect(rows[0].sickHours).toBe(4);
    expect(rows[0].sickPay).toBe(48);
    expect(rows[0].vacationHours).toBe(0);
  });
});

// Friert die zweite Übergabe-Strecke ein: die Geld-Summen der PDF-
// Nachberechnungs-Seite (monthTotals) müssen korrekt aus den Monats-Balances
// von GET /dashboard/hours-balance summiert werden — inkl. aller drei
// Zuschlagsarten und dem Sonderfall „keine Lohnwerte → null".
describe("computeRecalculationMonthTotals", () => {
  function balance(overrides: RecalculationBalance): RecalculationBalance {
    return { ...overrides };
  }

  it("summiert basePay, alle drei Zuschlagsarten und totalPay ueber alle Balances", () => {
    const totals = computeRecalculationMonthTotals([
      balance({
        basePay: 1000,
        nightSurchargePay: 50,
        sundaySurchargePay: 30,
        holidaySurchargePay: 20,
        totalPay: 1100,
      }),
      balance({
        basePay: 500,
        nightSurchargePay: 10,
        sundaySurchargePay: 0,
        holidaySurchargePay: 40,
        totalPay: 550,
      }),
    ]);
    expect(totals).toEqual({
      basePay: 1500,
      surchargePay: 150,
      totalPay: 1650,
    });
  });

  it("liefert null, wenn keine Balance einen Lohnwert (totalPay) traegt", () => {
    expect(
      computeRecalculationMonthTotals([
        balance({ basePay: 100 }),
        balance({ totalPay: null }),
      ]),
    ).toBeNull();
  });

  it("liefert null bei leerer Balance-Liste", () => {
    expect(computeRecalculationMonthTotals([])).toBeNull();
  });

  it("behandelt fehlende Felder als 0, sobald mindestens ein totalPay vorliegt", () => {
    const totals = computeRecalculationMonthTotals([
      balance({ totalPay: 200, basePay: 200 }),
      balance({}),
    ]);
    expect(totals).toEqual({ basePay: 200, surchargePay: 0, totalPay: 200 });
  });

  it("totalPay 0 zaehlt als Lohnwert (nicht als fehlend)", () => {
    const totals = computeRecalculationMonthTotals([
      balance({ totalPay: 0, basePay: 0 }),
    ]);
    expect(totals).toEqual({ basePay: 0, surchargePay: 0, totalPay: 0 });
  });
});
