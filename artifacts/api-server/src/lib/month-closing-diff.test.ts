// ---------------------------------------------------------------------------
// Unit-Tests für die Nachberechnungs-Differenz (Monatsabschluss).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { computeMonthClosingDiff, type DiffSourceRow } from "./month-closing-diff";
import type { MonthClosingEntry } from "@workspace/db";

const entry = (
  userId: number,
  userName: string,
  totalFulfilledHours: number,
  totalPay: number | null = null,
): MonthClosingEntry => ({
  userId,
  userName,
  plannedHours: 0,
  totalFulfilledHours,
  billingMethod: "IST",
  hourlyWage: null,
  basePay: null,
  nightSurchargePay: null,
  sundaySurchargePay: null,
  holidaySurchargePay: null,
  totalPay,
});

const cur = (
  userId: number,
  userName: string,
  totalFulfilledHours: number,
  totalPay: number | null = null,
): DiffSourceRow => ({ userId, userName, totalFulfilledHours, totalPay });

describe("computeMonthClosingDiff", () => {
  it("liefert leere Liste, wenn nichts abweicht", () => {
    const rows = computeMonthClosingDiff(
      [entry(1, "Anna", 40, 60000)],
      [cur(1, "Anna", 40, 60000)],
    );
    expect(rows).toEqual([]);
  });

  it("ignoriert Fließkomma-Rauschen unterhalb der Toleranz", () => {
    const rows = computeMonthClosingDiff(
      [entry(1, "Anna", 40.001)],
      [cur(1, "Anna", 40.0)],
    );
    expect(rows).toEqual([]);
  });

  it("meldet Stunden-Differenz mit gerundeten Werten", () => {
    const rows = computeMonthClosingDiff(
      [entry(1, "Anna", 40)],
      [cur(1, "Anna", 42.5)],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: 1,
      reportedHours: 40,
      currentHours: 42.5,
      diffHours: 2.5,
      diffPay: null,
    });
  });

  it("meldet reine Geld-Differenz auch bei gleichen Stunden", () => {
    const rows = computeMonthClosingDiff(
      [entry(1, "Anna", 40, 600)],
      [cur(1, "Anna", 40, 650.5)],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].diffHours).toBe(0);
    expect(rows[0].diffPay).toBeCloseTo(50.5, 2);
  });

  it("fehlende Seite zählt als 0 (neu hinzugekommen / entfernt)", () => {
    const rows = computeMonthClosingDiff(
      [entry(1, "Entfernt", 10, 100)],
      [cur(2, "Neu", 8, 80)],
    );
    expect(rows).toHaveLength(2);
    const removed = rows.find((r) => r.userId === 1)!;
    expect(removed).toMatchObject({ reportedHours: 10, currentHours: 0, diffHours: -10 });
    expect(removed.diffPay).toBeCloseTo(-100, 2);
    const added = rows.find((r) => r.userId === 2)!;
    expect(added).toMatchObject({ reportedHours: 0, currentHours: 8, diffHours: 8 });
    expect(added.diffPay).toBeCloseTo(80, 2);
  });

  it("diffPay bleibt null, wenn keine Seite Geldwerte hat", () => {
    const rows = computeMonthClosingDiff([entry(1, "Anna", 40)], [cur(1, "Anna", 41)]);
    expect(rows[0].reportedPay).toBeNull();
    expect(rows[0].currentPay).toBeNull();
    expect(rows[0].diffPay).toBeNull();
  });

  it("einseitiger Geldwert: fehlende Seite zählt als 0", () => {
    const rows = computeMonthClosingDiff(
      [entry(1, "Anna", 40, null)],
      [cur(1, "Anna", 40, 600)],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].diffPay).toBeCloseTo(600, 2);
  });

  it("schlüsselt die Geld-Differenz in Grundlohn und Zuschläge auf", () => {
    const frozen: MonthClosingEntry = {
      userId: 1,
      userName: "Anna",
      plannedHours: 0,
      totalFulfilledHours: 40,
      billingMethod: "IST",
      hourlyWage: 15,
      basePay: 600,
      nightSurchargePay: 30,
      sundaySurchargePay: 20,
      holidaySurchargePay: null,
      totalPay: 650,
    };
    const rows = computeMonthClosingDiff(
      [frozen],
      [
        {
          userId: 1,
          userName: "Anna",
          totalFulfilledHours: 44,
          totalPay: 730,
          basePay: 660,
          surchargePay: 70,
        },
      ],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].diffPay).toBeCloseTo(80, 2);
    expect(rows[0].diffBasePay).toBeCloseTo(60, 2);
    expect(rows[0].diffSurchargePay).toBeCloseTo(20, 2);
  });

  it("Aufschlüsselung bleibt null ohne Geldwerte", () => {
    const rows = computeMonthClosingDiff([entry(1, "Anna", 40)], [cur(1, "Anna", 41)]);
    expect(rows[0].diffBasePay).toBeNull();
    expect(rows[0].diffSurchargePay).toBeNull();
  });

  it("reicht den Abwesenheits-Ausweis (Urlaub/Krank) aus dem aktuellen Stand durch", () => {
    const rows = computeMonthClosingDiff(
      [entry(1, "Anna", 40, 600)],
      [
        {
          userId: 1,
          userName: "Anna",
          totalFulfilledHours: 40,
          totalPay: 650,
          vacationHours: 8,
          vacationPay: 160,
          sickHours: 16.333,
          sickPay: 326.66,
        },
      ],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].vacationHours).toBeCloseTo(8, 2);
    expect(rows[0].vacationPay).toBeCloseTo(160, 2);
    expect(rows[0].sickHours).toBeCloseTo(16.33, 2);
    expect(rows[0].sickPay).toBeCloseTo(326.66, 2);
  });

  it("Abwesenheits-Ausweis ohne Angaben: 0 Stunden, Geld null", () => {
    const rows = computeMonthClosingDiff([entry(1, "Anna", 40)], [cur(1, "Anna", 41)]);
    expect(rows[0].vacationHours).toBe(0);
    expect(rows[0].vacationPay).toBeNull();
    expect(rows[0].sickHours).toBe(0);
    expect(rows[0].sickPay).toBeNull();
  });

  it("stundenneutrale Umwandlung: Abwesenheits-Änderung allein erzeugt eine Zeile", () => {
    // Dienst → Krankheit umgewandelt: Stunden und Geld identisch, aber der
    // (neue) Schnappschuss kennt die Abwesenheitsfelder (0) — Zeile erscheint.
    const rows = computeMonthClosingDiff(
      [{ ...entry(1, "Anna", 40, 600), vacationHours: 0, sickHours: 0 }],
      [
        {
          userId: 1,
          userName: "Anna",
          totalFulfilledHours: 40,
          totalPay: 600,
          vacationHours: 0,
          vacationPay: null,
          sickHours: 8,
          sickPay: 120,
        },
      ],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].diffHours).toBe(0);
    expect(rows[0].diffPay).toBe(0);
    expect(rows[0].sickHours).toBe(8);
    expect(rows[0].sickPay).toBe(120);
  });

  it("Alt-Schnappschuss ohne Abwesenheitsfelder: keine Schein-Zeile bei gleichem Stand", () => {
    // Legacy-Abschluss kennt die Abwesenheitsfelder nicht — bloßes Vorhandensein
    // von Abwesenheiten im aktuellen Stand darf KEINE Nachberechnung auslösen.
    const rows = computeMonthClosingDiff(
      [entry(1, "Anna", 40, 600)],
      [
        {
          userId: 1,
          userName: "Anna",
          totalFulfilledHours: 40,
          totalPay: 600,
          vacationHours: 8,
          vacationPay: 160,
          sickHours: 0,
          sickPay: null,
        },
      ],
    );
    expect(rows).toEqual([]);
  });

  it("sortiert nach Name (deutsch)", () => {
    const rows = computeMonthClosingDiff(
      [],
      [cur(1, "Zoe", 1), cur(2, "Ärger", 2), cur(3, "Anna", 3)],
    );
    expect(rows.map((r) => r.userName)).toEqual(["Anna", "Ärger", "Zoe"]);
  });
});
