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
  contract?: { vacationDays?: number | null; vacationHoursUsed?: number | null } | null;
  vacationHoursPerDay?: number | null;
}) {
  return computeHoursBalanceRow({
    userId: 1,
    userName: "Anna",
    shifts: overrides.shifts ?? [],
    timeEntries: overrides.timeEntries ?? [],
    allowance: overrides.allowance ?? STD_ALLOWANCE,
    contract: overrides.contract ?? null,
    vacationHoursPerDay: overrides.vacationHoursPerDay,
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

  it("ignoriert ganztägigen Urlaub und Krank in den geplanten Stunden", () => {
    const shifts: BalanceShift[] = [
      { type: "active", startTime: local(2026, 6, 1, 8), endTime: local(2026, 6, 1, 16) }, // 8h
      { type: "vacation", startTime: local(2026, 6, 2, 0), endTime: local(2026, 6, 2, 23, 59), valuedHours: 8 },
      { type: "sick", startTime: local(2026, 6, 4, 0), endTime: local(2026, 6, 4, 23, 59), valuedHours: 8 },
    ];
    const result = row({ shifts });
    expect(result.plannedHours).toBe(8);
  });

  it("zählt eine geerbte 24h-Abwesenheit ins Soll (Bilanz-Neutralität)", () => {
    // Ein 24h-Dienst, der zu Krankheit wird, erbt echte Schichtzeiten (09:00 →
    // Folgetag 09:00) und ersetzt den Dienst. Er zählt daher wie der ersetzte
    // Dienst zum Soll (24h) und wird zugleich fortgezahlt (valuedHours 24):
    // Soll +24, Ist +24 -> Bilanz 0. Ein reiner Ganztags-Eintrag zählt NICHT.
    const shifts: BalanceShift[] = [
      { type: "sick", startTime: local(2026, 6, 2, 9), endTime: local(2026, 6, 3, 9), valuedHours: 24 },
    ];
    const result = row({ shifts });
    expect(result.plannedHours).toBe(24);
    expect(result.totalFulfilledHours).toBe(24);
    expect(result.balance).toBe(0);
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

  it("summiert Roh-Zuschlagsstunden aus Arbeit und rechnet Abwesenheits-Zuschläge (Fortzahlung) hinzu", () => {
    // Ein normaler Ganztags-Urlaub trägt 0 Zuschlagsstunden (resolveShiftMetrics
    // speichert sie so); ein 24h-Dienst-Urlaub trägt die fortzuzahlenden Nacht-/
    // Sonntagsstunden und wird der Auswertung zugeschlagen (Punkt 3).
    const shifts: BalanceShift[] = [
      { type: "active", startTime: local(2026, 6, 1, 0), endTime: local(2026, 6, 1, 8), nightHours: 2, sundayHours: 1, holidayHours: 0 },
      { type: "night", startTime: local(2026, 6, 2, 0), endTime: local(2026, 6, 2, 8), nightHours: 3, sundayHours: 0, holidayHours: 4 },
      { type: "vacation", startTime: local(2026, 6, 3, 0), endTime: local(2026, 6, 3, 23, 59), nightHours: 0, sundayHours: 0, holidayHours: 0, valuedHours: 8 },
      { type: "sick", startTime: local(2026, 6, 5, 9), endTime: local(2026, 6, 6, 9), nightHours: 7, sundayHours: 0, holidayHours: 0, valuedHours: 24 },
    ];
    const result = row({ shifts });
    // Arbeit: Nacht 2+3=5, Sonntag 1, Feiertag 4. Abwesenheit (24h-Krank): +7 Nacht.
    expect(result.nightHours).toBe(12);
    expect(result.sundayHours).toBe(1);
    expect(result.holidayHours).toBe(4);
    // Zuschlagsstunden: Nacht 25% von 12 = 3; Sonntag 50% von 1 = 0.5; Feiertag 100% von 4 = 4
    expect(result.nightSurchargeHours).toBe(3);
    expect(result.sundaySurchargeHours).toBe(0.5);
    expect(result.holidaySurchargeHours).toBe(4);
  });

  it("zahlt Zuschläge einer 24h-Dienst-Abwesenheit fort (Geldwert), auch ohne Ist-Zeit", () => {
    // 24h-Urlaubsdienst mit 7 Nacht- und 9 Sonntagsstunden, Stundenlohn 20.
    // Keine erfassten Ist-Zeiten -> Grundlohn = Lohnfortzahlung (24h Urlaub),
    // dazu die Zuschlagsfortzahlung der Abwesenheit.
    const result = computeHoursBalanceRow({
      userId: 1,
      userName: "Anna",
      shifts: [
        { type: "vacation", startTime: local(2026, 6, 3, 9), endTime: local(2026, 6, 4, 9), nightHours: 7, sundayHours: 9, holidayHours: 0, valuedHours: 24 },
      ],
      timeEntries: [],
      allowance: STD_ALLOWANCE,
      contract: null,
      hourlyWage: 20,
    });
    // Lohnfortzahlung: 24h * 20 = 480.
    // Nacht 25% von 7 = 1.75 -> 1.75*20 = 35; Sonntag 50% von 9 = 4.5 -> 4.5*20 = 90
    expect(result.basePay).toBe(480);
    expect(result.nightSurchargePay).toBe(35);
    expect(result.sundaySurchargePay).toBe(90);
    expect(result.holidaySurchargePay).toBe(0);
    expect(result.totalPay).toBe(605);
  });

  it("rechnet Geldwerte im SOLL-Modus aus geplanten Schichten inkl. Vergütungstypen", () => {
    // Drei geplante Dienste mit unterschiedlichen Vergütungstypen, keine
    // Ist-Zeiten. Stundenlohn 20:
    // - regular: 8h * 20 = 160
    // - percentage 50%: 10h * 20 * 0.5 = 100
    // - flat 5000 Cent = 50 (dauerunabhängig)
    const result = computeHoursBalanceRow({
      userId: 1,
      userName: "Anna",
      shifts: [
        { type: "active", startTime: local(2026, 6, 1, 8), endTime: local(2026, 6, 1, 16), valuedHours: 8, compensationType: "regular" },
        { type: "active", startTime: local(2026, 6, 2, 8), endTime: local(2026, 6, 2, 18), valuedHours: 10, compensationType: "percentage", compensationPercent: 50 },
        { type: "active", startTime: local(2026, 6, 3, 8), endTime: local(2026, 6, 3, 20), valuedHours: 12, compensationType: "flat", compensationFlatCents: 5000 },
      ],
      timeEntries: [],
      allowance: STD_ALLOWANCE,
      contract: null,
      billingMethod: "SOLL",
      hourlyWage: 20,
    });
    expect(result.billingMethod).toBe("SOLL");
    expect(result.basePay).toBe(310);
    expect(result.nightSurchargePay).toBe(0);
    expect(result.totalPay).toBe(310);
  });

  it("Camillo-Beispiel: SOLL-Nachtzuschlag 63 h * 25 % * 20,40 € = 321,30 €", () => {
    const result = computeHoursBalanceRow({
      userId: 1,
      userName: "Camillo",
      shifts: [
        { type: "active", startTime: local(2026, 6, 1, 20), endTime: local(2026, 6, 2, 6), valuedHours: 90, nightHours: 63, compensationType: "regular" },
      ],
      timeEntries: [],
      allowance: STD_ALLOWANCE,
      contract: null,
      billingMethod: "SOLL",
      hourlyWage: 20.4,
    });
    // Grundlohn: 90h * 20.40 = 1836; Nachtzuschlag: 63 * 25% = 15.75h * 20.40 = 321.30
    expect(result.nightSurchargePay).toBe(321.3);
    expect(result.basePay).toBe(1836);
    expect(result.totalPay).toBe(2157.3);
  });

  it("rechnet Geldwerte im IST-Modus aus bestätigten Ist-Zeiten plus Lohnfortzahlung", () => {
    // Geplante Schicht 10h, bestätigte Ist-Zeit nur 8h (2 Nachtstunden), dazu
    // ein Urlaubstag mit 8 gewerteten Stunden. Stundenlohn 20, IST-Modus:
    // Grundlohn = 8*20 (Ist) + 8*20 (Urlaub) = 320; Nacht 25% von 2 = 0.5h -> 10.
    const result = computeHoursBalanceRow({
      userId: 1,
      userName: "Anna",
      shifts: [
        { type: "active", startTime: local(2026, 6, 1, 20), endTime: local(2026, 6, 2, 6), valuedHours: 10, nightHours: 7, compensationType: "regular" },
        { type: "vacation", startTime: local(2026, 6, 3, 0), endTime: local(2026, 6, 3, 23), valuedHours: 8 },
      ],
      timeEntries: [
        { actualHours: 8, valuedHours: 8, nightHours: 2, sundayHours: 0, holidayHours: 0, compensationType: "regular" },
      ],
      allowance: STD_ALLOWANCE,
      contract: null,
      billingMethod: "IST",
      hourlyWage: 20,
    });
    expect(result.billingMethod).toBe("IST");
    expect(result.basePay).toBe(320);
    expect(result.nightSurchargePay).toBe(10);
    expect(result.totalPay).toBe(330);
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
      { type: "vacation", startTime: local(2026, 6, 3, 0), endTime: local(2026, 6, 3, 23, 59), valuedHours: 7 },
      { type: "sick", startTime: local(2026, 6, 5, 0), endTime: local(2026, 6, 5, 23, 59), valuedHours: 5 },
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
      { type: "vacation", startTime: local(2026, 6, 2, 0), endTime: local(2026, 6, 2, 23, 59), valuedHours: 8 },
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
      { type: "vacation", startTime: local(2026, 6, 1, 0), endTime: local(2026, 6, 1, 23, 59), valuedHours: 8 },
      { type: "vacation", startTime: local(2026, 6, 2, 0), endTime: local(2026, 6, 2, 23, 59), valuedHours: 8 },
      { type: "vacation", startTime: local(2026, 6, 3, 0), endTime: local(2026, 6, 3, 23, 59), valuedHours: 8 },
    ];
    // 96 Urlaubsstunden / 8 h/Tag = 12 Tage Jahresverbrauch (abgeleitet).
    const result = row({ shifts, contract: { vacationDays: 30, vacationHoursUsed: 96 } });
    expect(result.vacationDaysTaken).toBe(3);
    expect(result.vacationDaysUsed).toBe(12); // Jahreszähler aus Stunden abgeleitet
    expect(result.vacationDaysRemaining).toBe(18);
  });

  it("nutzt Vertragswerte für Resturlaub und Default ohne Vertrag", () => {
    const withContract = row({ contract: { vacationDays: 28, vacationHoursUsed: 80 } });
    expect(withContract.vacationDaysRemaining).toBe(18);

    const noContract = row({});
    expect(noContract.vacationDaysUsed).toBe(0);
    expect(noContract.vacationDaysRemaining).toBe(DEFAULT_VACATION_DAYS);
    expect(DEFAULT_VACATION_DAYS).toBe(30);
  });

  it("leitet Tage über vacationHoursPerDay ab und rundet auf 0,1", () => {
    // 24h-Urlaubsdienst bei 8 h/Tag = 3,0 Tage; 12h bei 7,5 h/Tag = 1,6 Tage.
    const std = row({ contract: { vacationDays: 30, vacationHoursUsed: 24 } });
    expect(std.vacationDaysUsed).toBe(3);
    expect(std.vacationDaysRemaining).toBe(27);

    const custom = row({
      contract: { vacationDays: 30, vacationHoursUsed: 12 },
      vacationHoursPerDay: 7.5,
    });
    expect(custom.vacationDaysUsed).toBe(1.6);
    expect(custom.vacationDaysRemaining).toBe(28.4);
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
