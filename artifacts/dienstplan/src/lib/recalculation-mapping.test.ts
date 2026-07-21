import { describe, expect, it } from "vitest";
import type { MonthClosingDiffRow } from "@workspace/api-client-react";
import { mapDiffRowsToRecalculationRows } from "./recalculation-mapping";

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
