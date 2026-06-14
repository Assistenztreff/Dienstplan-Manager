import { describe, it, expect } from "vitest";
import {
  LOW_VACATION_THRESHOLD,
  HORIZON_DAYS,
  localDateKey,
  computeCoveredDates,
  computeUncoveredDays,
  computeLowVacationAssistants,
  type CoverageShift,
  type VacationCandidate,
} from "./dashboard-warnings";

// Schichten werden in lokaler Zeit interpretiert (computeCoveredDays nutzt
// getFullYear/getMonth/getDate). Wir konstruieren daher bewusst lokale Daten,
// damit die Tests unabhängig von der Zeitzone der Testumgebung stabil bleiben.
function local(y: number, m: number, d: number, h = 0, min = 0): Date {
  return new Date(y, m - 1, d, h, min, 0);
}

describe("computeLowVacationAssistants — Resturlaub-Schwelle", () => {
  it("listet nur Assistenten <= Schwelle, aufsteigend nach Resttagen", () => {
    const candidates: VacationCandidate[] = [
      { userId: 1, userName: "Anna", vacationDays: 30, vacationDaysUsed: 28 }, // 2 -> warn
      { userId: 2, userName: "Bea", vacationDays: 30, vacationDaysUsed: 20 }, // 10 -> ok
      { userId: 3, userName: "Cem", vacationDays: 30, vacationDaysUsed: 25 }, // 5 -> warn (Grenze)
      { userId: 4, userName: "Dan", vacationDays: 30, vacationDaysUsed: 24 }, // 6 -> ok
    ];
    const result = computeLowVacationAssistants(candidates);
    expect(result.map((r) => r.userId)).toEqual([1, 3]);
    expect(result.map((r) => r.vacationDaysRemaining)).toEqual([2, 5]);
  });

  it("schließt genau die Schwelle (<=) ein und behandelt negativen Resturlaub", () => {
    const candidates: VacationCandidate[] = [
      { userId: 1, userName: "Über", vacationDays: 30, vacationDaysUsed: 33 }, // -3
      { userId: 2, userName: "Genau", vacationDays: 30, vacationDaysUsed: 25 }, // 5
    ];
    const result = computeLowVacationAssistants(candidates);
    expect(result.map((r) => r.vacationDaysRemaining)).toEqual([-3, 5]);
    expect(LOW_VACATION_THRESHOLD).toBe(5);
  });

  it("behandelt null-Felder als 0", () => {
    const candidates: VacationCandidate[] = [
      { userId: 1, userName: "Leer", vacationDays: null, vacationDaysUsed: null },
    ];
    const result = computeLowVacationAssistants(candidates);
    expect(result).toEqual([{ userId: 1, userName: "Leer", vacationDaysRemaining: 0 }]);
  });

  it("liefert eine leere Liste, wenn niemand die Schwelle erreicht (ruhiger Zustand)", () => {
    const candidates: VacationCandidate[] = [
      { userId: 1, userName: "Anna", vacationDays: 30, vacationDaysUsed: 0 },
      { userId: 2, userName: "Bea", vacationDays: 30, vacationDaysUsed: 10 },
    ];
    expect(computeLowVacationAssistants(candidates)).toEqual([]);
  });
});

describe("computeUncoveredDays — Abdeckung im Planungshorizont", () => {
  it("markiert jeden Tag als unbesetzt, wenn es keine Schichten gibt", () => {
    const todayStart = local(2026, 6, 1);
    const uncovered = computeUncoveredDays([], todayStart, HORIZON_DAYS);
    expect(uncovered).toHaveLength(HORIZON_DAYS);
    expect(uncovered[0]).toBe("2026-06-01");
    expect(uncovered[HORIZON_DAYS - 1]).toBe("2026-06-14");
  });

  it("zählt einen Tag mit einer Tagschicht als abgedeckt", () => {
    const todayStart = local(2026, 6, 1);
    const shifts: CoverageShift[] = [
      { startTime: local(2026, 6, 1, 8), endTime: local(2026, 6, 1, 16) },
    ];
    const uncovered = computeUncoveredDays(shifts, todayStart, HORIZON_DAYS);
    expect(uncovered).not.toContain("2026-06-01");
    expect(uncovered).toHaveLength(HORIZON_DAYS - 1);
  });

  it("Nachtdienst über Mitternacht deckt Start- UND Folgetag ab (kein Falsch-Alarm)", () => {
    const todayStart = local(2026, 6, 1);
    // Mo 01.06.2026 20:00 -> Di 02.06.2026 06:00
    const shifts: CoverageShift[] = [
      { startTime: local(2026, 6, 1, 20), endTime: local(2026, 6, 2, 6) },
    ];
    const uncovered = computeUncoveredDays(shifts, todayStart, HORIZON_DAYS);
    expect(uncovered).not.toContain("2026-06-01");
    expect(uncovered).not.toContain("2026-06-02");
    // alle übrigen Tage bleiben unbesetzt
    expect(uncovered).toHaveLength(HORIZON_DAYS - 2);
  });

  it("24h-Schicht über zwei Mitternachtsgrenzen deckt alle drei berührten Tage ab", () => {
    const todayStart = local(2026, 6, 1);
    // 01.06. 12:00 -> 03.06. 12:00 (berührt 01., 02., 03.)
    const shifts: CoverageShift[] = [
      { startTime: local(2026, 6, 1, 12), endTime: local(2026, 6, 3, 12) },
    ];
    const uncovered = computeUncoveredDays(shifts, todayStart, HORIZON_DAYS);
    for (const day of ["2026-06-01", "2026-06-02", "2026-06-03"]) {
      expect(uncovered).not.toContain(day);
    }
    expect(uncovered).toHaveLength(HORIZON_DAYS - 3);
  });

  it("eine Schicht, die exakt um Mitternacht endet, deckt den Folgetag NICHT ab", () => {
    const todayStart = local(2026, 6, 1);
    // 01.06. 16:00 -> 02.06. 00:00 (endet genau an der Grenze)
    const shifts: CoverageShift[] = [
      { startTime: local(2026, 6, 1, 16), endTime: local(2026, 6, 2, 0) },
    ];
    const uncovered = computeUncoveredDays(shifts, todayStart, HORIZON_DAYS);
    expect(uncovered).not.toContain("2026-06-01");
    expect(uncovered).toContain("2026-06-02");
  });

  it("liefert eine leere Liste, wenn jeder Horizont-Tag abgedeckt ist (ruhiger Zustand)", () => {
    const todayStart = local(2026, 6, 1);
    const shifts: CoverageShift[] = [];
    for (let i = 0; i < HORIZON_DAYS; i++) {
      const d = new Date(todayStart);
      d.setDate(d.getDate() + i);
      shifts.push({
        startTime: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 8),
        endTime: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 16),
      });
    }
    expect(computeUncoveredDays(shifts, todayStart, HORIZON_DAYS)).toEqual([]);
  });

  it("ignoriert Schichten außerhalb des Horizonts nicht fälschlich als Abdeckung", () => {
    const todayStart = local(2026, 6, 1);
    // Schicht weit in der Zukunft deckt keinen Horizont-Tag ab
    const shifts: CoverageShift[] = [
      { startTime: local(2026, 7, 10, 8), endTime: local(2026, 7, 10, 16) },
    ];
    const uncovered = computeUncoveredDays(shifts, todayStart, HORIZON_DAYS);
    expect(uncovered).toHaveLength(HORIZON_DAYS);
  });
});

describe("localDateKey / computeCoveredDates — Datumsschlüssel in lokaler Zeit", () => {
  it("formatiert den Schlüssel als YYYY-MM-DD mit führenden Nullen", () => {
    expect(localDateKey(local(2026, 1, 5))).toBe("2026-01-05");
    expect(localDateKey(local(2026, 12, 31))).toBe("2026-12-31");
  });

  it("nimmt den lokalen Kalendertag, nicht den UTC-Tag eines Nachtdienstes", () => {
    const covered = computeCoveredDates([
      { startTime: local(2026, 6, 1, 22), endTime: local(2026, 6, 2, 5) },
    ]);
    expect(covered.has("2026-06-01")).toBe(true);
    expect(covered.has("2026-06-02")).toBe(true);
    expect(covered.size).toBe(2);
  });
});
