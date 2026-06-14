import { describe, it, expect } from "vitest";
import {
  computeHoursBalanceRow,
  round2,
  DEFAULT_NIGHT_PERCENT,
  DEFAULT_SUNDAY_PERCENT,
  DEFAULT_HOLIDAY_PERCENT,
  DEFAULT_VACATION_DAYS,
  type BalanceShift,
  type BalanceTimeEntry,
  type AllowancePercents,
} from "./dashboard-hours-balance";

// Schichten werden in lokaler Zeit konstruiert, damit die Stundenberechnung
// (Differenz aus Start/Ende) zeitzonenunabhängig stabil bleibt.
function local(y: number, m: number, d: number, h = 0, min = 0): Date {
  return new Date(y, m - 1, d, h, min, 0);
}

const STD_ALLOWANCE: AllowancePercents = {
  nightPercent: DEFAULT_NIGHT_PERCENT,
  sundayPercent: DEFAULT_SUNDAY_PERCENT,
  holidayPercent: DEFAULT_HOLIDAY_PERCENT,
};

function row(overrides: {
  shifts?: BalanceShift[];
  timeEntries?: BalanceTimeEntry[];
  allowance?: AllowancePercents;
  contract?: { vacationDays?: number | null; vacationDaysUsed?: number | null } | null;
}) {
  return computeHoursBalanceRow({
    userId: 1,
    userName: "Anna",
    shifts: overrides.shifts ?? [],
    timeEntries: overrides.timeEntries ?? [],
    allowance: overrides.allowance ?? STD_ALLOWANCE,
    contract: overrides.contract ?? null,
  });
}

describe("computeHoursBalanceRow — geplante Stunden", () => {
  it("summiert nur echte Arbeitsschichten aus Start-/Endzeit", () => {
    const shifts: BalanceShift[] = [
      { type: "active", startTime: local(2026, 6, 1, 8), endTime: local(2026, 6, 1, 16) }, // 8h
      { type: "night", startTime: local(2026, 6, 2, 20), endTime: local(2026, 6, 3, 6) }, // 10h über Mitternacht
    ];
    const result = row({ shifts });
    expect(result.plannedHours).toBe(18);
  });

  it("ignoriert Urlaub und Krank in den geplanten Stunden", () => {
    const shifts: BalanceShift[] = [
      { type: "active", startTime: local(2026, 6, 1, 8), endTime: local(2026, 6, 1, 16) }, // 8h
      { type: "vacation", startTime: local(2026, 6, 2, 0), endTime: local(2026, 6, 3, 0), valuedHours: 8 },
      { type: "sick", startTime: local(2026, 6, 4, 0), endTime: local(2026, 6, 5, 0), valuedHours: 8 },
    ];
    const result = row({ shifts });
    expect(result.plannedHours).toBe(8);
  });

  it("liefert für einen Assistenten ohne Schichten lauter Nullen", () => {
    const result = row({});
    expect(result.plannedHours).toBe(0);
    expect(result.actualHours).toBe(0);
    expect(result.balance).toBe(0);
    expect(result.valuedHours).toBe(0);
    expect(result.vacationDaysTaken).toBe(0);
  });
});

describe("computeHoursBalanceRow — Zuschlagsberechnung (Prozentsätze)", () => {
  it("rechnet Nacht-, Sonntags- und Feiertagszuschläge aus den Roh-Stunden", () => {
    const shifts: BalanceShift[] = [
      {
        type: "active",
        startTime: local(2026, 6, 1, 8),
        endTime: local(2026, 6, 1, 16),
        valuedHours: 8,
        nightHours: 4,
        sundayHours: 6,
        holidayHours: 2,
      },
    ];
    const result = row({ shifts });
    // 25% von 4 = 1; 50% von 6 = 3; 100% von 2 = 2
    expect(result.nightHours).toBe(4);
    expect(result.nightSurchargeHours).toBe(1);
    expect(result.sundayHours).toBe(6);
    expect(result.sundaySurchargeHours).toBe(3);
    expect(result.holidayHours).toBe(2);
    expect(result.holidaySurchargeHours).toBe(2);
    expect(result.nightPercent).toBe(25);
    expect(result.sundayPercent).toBe(50);
    expect(result.holidayPercent).toBe(100);
  });

  it("wendet abweichende (rückwirkende) Prozentsätze an", () => {
    const shifts: BalanceShift[] = [
      { type: "active", startTime: local(2026, 6, 1, 0), endTime: local(2026, 6, 1, 10), nightHours: 10, sundayHours: 10, holidayHours: 10 },
    ];
    const result = row({
      shifts,
      allowance: { nightPercent: 30, sundayPercent: 40, holidayPercent: 90 },
    });
    expect(result.nightSurchargeHours).toBe(3);
    expect(result.sundaySurchargeHours).toBe(4);
    expect(result.holidaySurchargeHours).toBe(9);
  });

  it("summiert Roh-Zuschlagsstunden über mehrere Schichten und ignoriert Urlaub/Krank dabei", () => {
    const shifts: BalanceShift[] = [
      { type: "active", startTime: local(2026, 6, 1, 0), endTime: local(2026, 6, 1, 8), nightHours: 2, sundayHours: 1, holidayHours: 0 },
      { type: "night", startTime: local(2026, 6, 2, 0), endTime: local(2026, 6, 2, 8), nightHours: 3, sundayHours: 0, holidayHours: 4 },
      { type: "vacation", startTime: local(2026, 6, 3, 0), endTime: local(2026, 6, 4, 0), nightHours: 99, sundayHours: 99, holidayHours: 99, valuedHours: 8 },
    ];
    const result = row({ shifts });
    expect(result.nightHours).toBe(5);
    expect(result.sundayHours).toBe(1);
    expect(result.holidayHours).toBe(4);
  });

  it("behandelt fehlende (null/undefined) Roh-Stunden als 0", () => {
    const shifts: BalanceShift[] = [
      { type: "active", startTime: local(2026, 6, 1, 8), endTime: local(2026, 6, 1, 16), valuedHours: null, nightHours: null, sundayHours: undefined, holidayHours: null },
    ];
    const result = row({ shifts });
    expect(result.valuedHours).toBe(0);
    expect(result.nightSurchargeHours).toBe(0);
    expect(result.sundaySurchargeHours).toBe(0);
    expect(result.holidaySurchargeHours).toBe(0);
  });
});

describe("computeHoursBalanceRow — Trennung Arbeit vs. Urlaub/Krank", () => {
  it("summiert gewertete Stunden aus Arbeit, Urlaub und Krank zu actualHours/totalFulfilledHours", () => {
    const shifts: BalanceShift[] = [
      { type: "active", startTime: local(2026, 6, 1, 8), endTime: local(2026, 6, 1, 16), valuedHours: 8 },
      { type: "work", startTime: local(2026, 6, 2, 8), endTime: local(2026, 6, 2, 14), valuedHours: 6 },
      { type: "vacation", startTime: local(2026, 6, 3, 0), endTime: local(2026, 6, 4, 0), valuedHours: 7 },
      { type: "sick", startTime: local(2026, 6, 5, 0), endTime: local(2026, 6, 6, 0), valuedHours: 5 },
    ];
    const result = row({ shifts });
    expect(result.valuedHours).toBe(14); // nur Arbeit
    expect(result.vacationFulfilledHours).toBe(7);
    expect(result.sickHours).toBe(5);
    expect(result.totalFulfilledHours).toBe(26);
    expect(result.actualHours).toBe(26);
  });

  it("berechnet balance als erfüllte minus geplante Stunden", () => {
    const shifts: BalanceShift[] = [
      // geplant 8h, gewertet nur 6h -> balance -2
      { type: "active", startTime: local(2026, 6, 1, 8), endTime: local(2026, 6, 1, 16), valuedHours: 6 },
      // Urlaubstag fügt 8 erfüllte Stunden hinzu, aber 0 geplante -> balance +8
      { type: "vacation", startTime: local(2026, 6, 2, 0), endTime: local(2026, 6, 3, 0), valuedHours: 8 },
    ];
    const result = row({ shifts });
    expect(result.plannedHours).toBe(8);
    expect(result.totalFulfilledHours).toBe(14);
    expect(result.balance).toBe(6);
  });
});

describe("computeHoursBalanceRow — Zählung der Urlaubstage pro Monat", () => {
  it("zählt eine Urlaubs-Schicht als einen Tag (nicht den Jahreszähler aus dem Vertrag)", () => {
    const shifts: BalanceShift[] = [
      { type: "vacation", startTime: local(2026, 6, 1, 0), endTime: local(2026, 6, 2, 0), valuedHours: 8 },
      { type: "vacation", startTime: local(2026, 6, 2, 0), endTime: local(2026, 6, 3, 0), valuedHours: 8 },
      { type: "vacation", startTime: local(2026, 6, 3, 0), endTime: local(2026, 6, 4, 0), valuedHours: 8 },
    ];
    const result = row({ shifts, contract: { vacationDays: 30, vacationDaysUsed: 12 } });
    expect(result.vacationDaysTaken).toBe(3);
    expect(result.vacationDaysUsed).toBe(12); // Jahreszähler unverändert
    expect(result.vacationDaysRemaining).toBe(18);
  });

  it("nutzt Vertragswerte für Resturlaub und Default ohne Vertrag", () => {
    const withContract = row({ contract: { vacationDays: 28, vacationDaysUsed: 10 } });
    expect(withContract.vacationDaysRemaining).toBe(18);

    const noContract = row({});
    expect(noContract.vacationDaysUsed).toBe(0);
    expect(noContract.vacationDaysRemaining).toBe(DEFAULT_VACATION_DAYS);
    expect(DEFAULT_VACATION_DAYS).toBe(30);
  });
});

describe("computeHoursBalanceRow — erfasste Ist-Stunden (workedHours)", () => {
  it("summiert nur bestätigte Arbeits-Ist-Zeiten und ignoriert Urlaub/Krank-Einträge", () => {
    const timeEntries: BalanceTimeEntry[] = [
      { actualHours: 8, shiftType: "active" },
      { actualHours: 4, shiftType: "work" },
      { actualHours: 8, shiftType: "vacation" }, // ignoriert
      { actualHours: 8, shiftType: "sick" }, // ignoriert
      { actualHours: 2, shiftType: null }, // null-Typ zählt als Arbeit
    ];
    const result = row({ timeEntries });
    expect(result.workedHours).toBe(14);
  });

  it("behandelt fehlende actualHours als 0", () => {
    const timeEntries: BalanceTimeEntry[] = [
      { actualHours: null, shiftType: "active" },
      { actualHours: undefined, shiftType: "work" },
    ];
    const result = row({ timeEntries });
    expect(result.workedHours).toBe(0);
  });
});

describe("round2", () => {
  it("rundet auf zwei Nachkommastellen", () => {
    expect(round2(1.005)).toBe(1.0); // klassisches Float-Verhalten
    expect(round2(2.345)).toBe(2.35);
    expect(round2(8.333333)).toBe(8.33);
  });
});
