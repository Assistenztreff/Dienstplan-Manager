import { describe, expect, it } from "vitest";
import {
  earnedVacationHoursFromMonthlyTotals,
  monthlyActualHoursWithinContract,
  monthlyOvertimeHours,
} from "./vacation-hours";

describe("monthlyOvertimeHours", () => {
  it("zählt nur den positiven Monatsüberhang", () => {
    const actual = new Map([
      ["2026-01", 80],
      ["2026-02", 130],
    ]);

    expect(
      monthlyOvertimeHours(
        24,
        new Date("2026-01-01T00:00:00.000Z"),
        new Date("2026-03-01T00:00:00.000Z"),
        actual,
      ),
    ).toBeCloseTo(26.08, 2);
  });

  it("reduziert den Sockel bei fehlenden Stunden nicht", () => {
    expect(
      monthlyOvertimeHours(
        40,
        new Date("2026-01-01T00:00:00.000Z"),
        new Date("2026-02-01T00:00:00.000Z"),
        new Map(),
      ),
    ).toBe(0);
  });

  it("rechnet einen Vertragsbeginn mitten im Monat zeitanteilig", () => {
    expect(
      monthlyOvertimeHours(
        24,
        new Date("2026-06-16T00:00:00.000Z"),
        new Date("2026-07-01T00:00:00.000Z"),
        new Map([["2026-06", 60]]),
      ),
    ).toBeCloseTo(8.04, 2);
  });

  it("trennt Überhänge über Monatsgrenzen", () => {
    expect(
      monthlyOvertimeHours(
        40,
        new Date("2026-01-20T00:00:00.000Z"),
        new Date("2026-02-11T00:00:00.000Z"),
        new Map([
          ["2026-01", 80],
          ["2026-02", 20],
        ]),
      ),
    ).toBeGreaterThan(0);
  });
});

describe("monthlyActualHoursWithinContract", () => {
  it("schließt Stunden vor Beginn und nach Ende desselben Monats aus", () => {
    const result = monthlyActualHoursWithinContract(
      [
        { day: "2026-06-10", actualHours: 12 },
        { day: "2026-06-16", actualHours: 8 },
        { day: "2026-06-20", actualHours: 10 },
        { day: "2026-06-26", actualHours: 14 },
      ],
      { startDate: "2026-06-16", endDate: "2026-06-25" },
    );

    expect(result.get("2026-06")).toBe(18);
  });
});

describe("earnedVacationHoursFromMonthlyTotals", () => {
  it("wandelt nur den Monatsüberhang mit dem aus Urlaubswochen abgeleiteten Faktor um", () => {
    const result = earnedVacationHoursFromMonthlyTotals(
      {
        vacationDays: 30,
        weeklyHours: 40,
        startDate: "2026-01-01",
      },
      { fulltimeWorkdaysPerWeek: 5 },
      new Date("2026-01-31T12:00:00.000Z"),
      new Map([["2026-01", 200]]),
    );

    expect(result.overtimeHours).toBeCloseTo(26.8, 1);
    expect(result.vacationHours).toBeCloseTo(3.09, 1);
  });
});