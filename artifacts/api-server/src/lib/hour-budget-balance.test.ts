/**
 * Unit-Tests für die reine Budget-Bilanz (lib/hour-budget-balance.ts).
 *
 * Fachliche Kernpunkte (Arbeitsanweisung 06.08.2026, Punkt 2.2):
 * - Genehmigte Stunden kommen aus Zielvereinbarungen mit Gültigkeitszeitraum;
 *   Monate ohne gültige Vereinbarung zählen 0.
 * - Verbrauch zählt NUR echte Arbeitsdienste — Abwesenheiten (Urlaub, Krank,
 *   Freizeitausgleich, Freistellung, abgesagt_ag) und Info-Kategorien
 *   (kind_krank, abgesagt_an, urlaubsabgeltung) sowie Teamsitzungen zählen
 *   NICHT als Verbrauch.
 * - Jahressaldo = kumuliert genehmigt minus verbraucht seit Jahresbeginn.
 * - Warnschwelle: Jahressaldo > 1,5 × Monatsbudget (nur bei vorhandenem Budget).
 * - Zeiträume dürfen sich nicht überlappen (409-Validierung in der Route).
 */

import { describe, it, expect } from "vitest";
import {
  BUDGET_WARNING_FACTOR,
  approvedHoursForMonth,
  budgetPeriodsOverlap,
  computeHourBudgetBalance,
  consumedHoursForMonth,
  findOverlappingBudget,
  isConsumedShiftType,
  monthEndDate,
  monthStartDate,
  type BudgetPeriod,
  type BudgetShift,
} from "./hour-budget-balance";

const budget = (monthlyHours: number, startDate: string, endDate: string | null = null): BudgetPeriod => ({
  monthlyHours,
  startDate,
  endDate,
});

const workShift = (startTime: string, endTime: string, valuedHours?: number): BudgetShift => ({
  type: "work",
  startTime,
  endTime,
  valuedHours,
});

describe("budgetPeriodsOverlap / findOverlappingBudget", () => {
  it("erkennt Überlappungen in allen Varianten", () => {
    const a = { startDate: "2026-01-01", endDate: "2026-06-30" };
    expect(budgetPeriodsOverlap(a, { startDate: "2026-06-01", endDate: "2026-12-31" })).toBe(true);
    expect(budgetPeriodsOverlap(a, { startDate: "2025-06-01", endDate: "2026-01-01" })).toBe(true);
    expect(budgetPeriodsOverlap(a, { startDate: "2026-07-01", endDate: null })).toBe(false);
    // Offenes Ende überlappt alles ab seinem Beginn.
    expect(budgetPeriodsOverlap({ startDate: "2026-03-01", endDate: null }, a)).toBe(true);
    expect(budgetPeriodsOverlap(a, { startDate: "2025-01-01", endDate: "2025-12-31" })).toBe(false);
  });

  it("findet den ersten überlappenden Eintrag und ignoriert excludeId (PATCH)", () => {
    const existing = [
      { id: 1, ...budget(100, "2026-01-01", "2026-06-30") },
      { id: 2, ...budget(120, "2026-07-01", null) },
    ];
    expect(findOverlappingBudget(existing, { startDate: "2026-05-01", endDate: null })?.id).toBe(1);
    // PATCH auf id 1: darf sich nicht mit sich selbst schneiden, wohl aber mit 2.
    expect(
      findOverlappingBudget(existing, { startDate: "2026-01-01", endDate: "2026-06-30" }, 1),
    ).toBeNull();
    expect(
      findOverlappingBudget(existing, { startDate: "2026-06-01", endDate: "2026-07-15" }, 1)?.id,
    ).toBe(2);
  });
});

describe("approvedHoursForMonth", () => {
  it("zählt 0 ohne gültige Zielvereinbarung", () => {
    expect(approvedHoursForMonth([], 8, 2026)).toBe(0);
    expect(approvedHoursForMonth([budget(100, "2026-01-01", "2026-06-30")], 8, 2026)).toBe(0);
  });

  it("zählt das volle Monatsbudget bei irgendeiner Überlappung (auch mittmonatlich)", () => {
    const budgets = [budget(80, "2026-08-15", null)];
    expect(approvedHoursForMonth(budgets, 8, 2026)).toBe(80);
    expect(approvedHoursForMonth(budgets, 7, 2026)).toBe(0);
  });

  it("löst alte Vereinbarung zeitraumbezogen ab (Historie bleibt)", () => {
    const budgets = [
      budget(100, "2026-01-01", "2026-05-31"),
      budget(140, "2026-06-01", null),
    ];
    expect(approvedHoursForMonth(budgets, 4, 2026)).toBe(100);
    expect(approvedHoursForMonth(budgets, 6, 2026)).toBe(140);
  });

  it("summiert über mehrere Teams im Scope", () => {
    const budgets = [budget(100, "2026-01-01"), budget(50, "2026-01-01")];
    expect(approvedHoursForMonth(budgets, 3, 2026)).toBe(150);
  });
});

describe("consumedHoursForMonth — Abwesenheits-Ausschluss", () => {
  it("zählt nur echte Arbeitsdienste (valuedHours bevorzugt, sonst Rohdauer)", () => {
    const shifts: BudgetShift[] = [
      workShift("2026-08-10T08:00:00.000Z", "2026-08-10T16:00:00.000Z", 8),
      workShift("2026-08-11T08:00:00.000Z", "2026-08-11T14:00:00.000Z"), // 6h aus Zeiten
      { type: "vacation", startTime: "2026-08-12T00:00:00.000Z", endTime: "2026-08-12T23:59:00.000Z", valuedHours: 8 },
      { type: "sick", startTime: "2026-08-13T08:00:00.000Z", endTime: "2026-08-13T16:00:00.000Z", valuedHours: 8 },
      { type: "freizeitausgleich", startTime: "2026-08-14T00:00:00.000Z", endTime: "2026-08-14T23:59:00.000Z", valuedHours: 8 },
      { type: "freistellung", startTime: "2026-08-15T00:00:00.000Z", endTime: "2026-08-15T23:59:00.000Z", valuedHours: 8 },
      { type: "abgesagt_ag", startTime: "2026-08-16T08:00:00.000Z", endTime: "2026-08-16T16:00:00.000Z", valuedHours: 8 },
      { type: "kind_krank", startTime: "2026-08-17T00:00:00.000Z", endTime: "2026-08-17T23:59:00.000Z", valuedHours: 8 },
      { type: "abgesagt_an", startTime: "2026-08-18T08:00:00.000Z", endTime: "2026-08-18T16:00:00.000Z", valuedHours: 8 },
      { type: "urlaubsabgeltung", startTime: "2026-08-19T00:00:00.000Z", endTime: "2026-08-19T23:59:00.000Z", valuedHours: 8 },
      { type: "team", startTime: "2026-08-20T00:00:00.000Z", endTime: "2026-08-20T23:59:00.000Z" },
    ];
    expect(consumedHoursForMonth(shifts, 8, 2026)).toBe(14);
  });

  it("ordnet den Verbrauch dem Monat des Dienstbeginns zu", () => {
    const shifts = [workShift("2026-07-31T22:00:00.000Z", "2026-08-01T06:00:00.000Z", 8)];
    expect(consumedHoursForMonth(shifts, 7, 2026)).toBe(8);
    expect(consumedHoursForMonth(shifts, 8, 2026)).toBe(0);
  });

  it("Klassifikation deckt alle Ausnahmen ab", () => {
    for (const t of ["work", "active", "standby", "night", "full_day"]) {
      expect(isConsumedShiftType(t)).toBe(true);
    }
    for (const t of [
      "vacation",
      "sick",
      "freizeitausgleich",
      "freistellung",
      "abgesagt_ag",
      "kind_krank",
      "abgesagt_an",
      "urlaubsabgeltung",
      "team",
    ]) {
      expect(isConsumedShiftType(t)).toBe(false);
    }
  });
});

describe("computeHourBudgetBalance — Monatsbilanz, Jahressaldo, Warnschwelle", () => {
  it("rechnet genehmigt / verbraucht / verbleibend für den Monat", () => {
    const result = computeHourBudgetBalance({
      budgets: [budget(100, "2026-01-01")],
      shifts: [workShift("2026-08-10T08:00:00.000Z", "2026-08-10T16:00:00.000Z", 8)],
      month: 8,
      year: 2026,
    });
    expect(result.approvedHours).toBe(100);
    expect(result.consumedHours).toBe(8);
    expect(result.remainingHours).toBe(92);
    expect(result.yearApprovedHours).toBe(800); // 8 Monate × 100 h
    expect(result.yearConsumedHours).toBe(8);
    expect(result.yearBalance).toBe(792);
    // 792 > 1,5 × 100 → Warnung.
    expect(result.warningThresholdHours).toBe(150);
    expect(result.warningActive).toBe(true);
    expect(result.hasBudgets).toBe(true);
  });

  it("Warnschwelle: exakt 1,5 Monatsbudgets löst noch NICHT aus (nur darüber)", () => {
    // Januar–März je 100 genehmigt, nichts verbraucht → Saldo 300 = 1,5 × 200.
    const result = computeHourBudgetBalance({
      budgets: [budget(200, "2026-01-01")],
      shifts: [workShift("2026-01-05T08:00:00.000Z", "2026-01-05T09:40:00.000Z", 0)],
      month: 2,
      year: 2026,
    });
    // 2 × 200 genehmigt, 0 verbraucht → 400 > 300 → Warnung.
    expect(result.yearBalance).toBe(400);
    expect(result.warningActive).toBe(true);

    const atThreshold = computeHourBudgetBalance({
      budgets: [budget(100, "2026-01-01")],
      shifts: [workShift("2026-01-05T08:00:00.000Z", "2026-01-05T09:30:00.000Z", 50)],
      month: 2,
      year: 2026,
    });
    // 200 genehmigt − 50 verbraucht = 150 = genau 1,5 × 100 → KEINE Warnung.
    expect(atThreshold.yearBalance).toBe(150);
    expect(atThreshold.warningActive).toBe(false);
  });

  it("keine Warnung ohne gültige Zielvereinbarung (0 genehmigte Stunden)", () => {
    const result = computeHourBudgetBalance({
      budgets: [],
      shifts: [workShift("2026-08-10T08:00:00.000Z", "2026-08-10T16:00:00.000Z", 8)],
      month: 8,
      year: 2026,
    });
    expect(result.approvedHours).toBe(0);
    expect(result.yearBalance).toBe(-8);
    expect(result.warningThresholdHours).toBe(0);
    expect(result.warningActive).toBe(false);
    expect(result.hasBudgets).toBe(false);
  });

  it("negativer Jahressaldo (Mehrverbrauch) löst keine Warnung aus", () => {
    const result = computeHourBudgetBalance({
      budgets: [budget(20, "2026-01-01")],
      shifts: [workShift("2026-01-10T06:00:00.000Z", "2026-01-10T22:00:00.000Z", 16)],
      month: 1,
      year: 2026,
    });
    expect(result.yearBalance).toBe(4);
    expect(result.warningActive).toBe(false);
  });

  it("berücksichtigt den Wechsel der Zielvereinbarung im Jahressaldo", () => {
    const result = computeHourBudgetBalance({
      budgets: [budget(100, "2026-01-01", "2026-02-29"), budget(60, "2026-03-01")],
      shifts: [],
      month: 3,
      year: 2026,
    });
    expect(result.yearApprovedHours).toBe(260); // 2×100 + 1×60
    expect(result.approvedHours).toBe(60);
  });

  it("Warnschwellen-Faktor ist 1,5", () => {
    expect(BUDGET_WARNING_FACTOR).toBe(1.5);
  });
});

describe("Monatsgrenzen", () => {
  it("monthStartDate / monthEndDate liefern korrekte Kalendertage", () => {
    expect(monthStartDate(2, 2026)).toBe("2026-02-01");
    expect(monthEndDate(2, 2026)).toBe("2026-02-28"); // 2026 ist kein Schaltjahr
    expect(monthEndDate(2, 2024)).toBe("2024-02-29"); // Schaltjahr
    expect(monthEndDate(12, 2026)).toBe("2026-12-31");
  });
});
