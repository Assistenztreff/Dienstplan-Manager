import { describe, expect, it } from "vitest";
import {
  earnedVacationHoursFromMonthlyTotals,
  monthlyActualHoursWithinContract,
  monthlyOvertimeHours,
  vacationPoolHours,
  waitingPeriodProrationFactor,
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

describe("waitingPeriodProrationFactor", () => {
  it("liefert 0 vor Vertragsbeginn", () => {
    expect(
      waitingPeriodProrationFactor("2026-03-15", new Date("2026-03-01T00:00:00.000Z")),
    ).toBe(0);
  });

  it("zählt volle Monate ab dem Eintrittsdatum (Anniversary), nicht nach Kalendermonaten", () => {
    // Start 15.03. -> am 14.04. noch kein voller Monat, am 15.04. genau einer.
    expect(
      waitingPeriodProrationFactor("2026-03-15", new Date("2026-04-14T00:00:00.000Z")),
    ).toBe(0);
    expect(
      waitingPeriodProrationFactor("2026-03-15", new Date("2026-04-15T00:00:00.000Z")),
    ).toBeCloseTo(1 / 12, 6);
    expect(
      waitingPeriodProrationFactor("2026-03-15", new Date("2026-05-15T00:00:00.000Z")),
    ).toBeCloseTo(2 / 12, 6);
  });

  it("springt am Tag des 6. vollen Monats sofort auf den vollen Anspruch (Faktor 1)", () => {
    expect(
      waitingPeriodProrationFactor("2026-01-01", new Date("2026-06-30T00:00:00.000Z")),
    ).toBeCloseTo(5 / 12, 6);
    expect(
      waitingPeriodProrationFactor("2026-01-01", new Date("2026-07-01T00:00:00.000Z")),
    ).toBe(1);
  });

  it("bleibt bei Faktor 1 für Verträge, die schon deutlich länger als 6 Monate laufen", () => {
    expect(
      waitingPeriodProrationFactor("2020-01-01", new Date("2026-06-01T00:00:00.000Z")),
    ).toBe(1);
  });
});

describe("vacationPoolHours mit Wartezeit", () => {
  const contract = { vacationDays: 30, weeklyHours: 40, startDate: "2026-01-01" };
  const ops = { fulltimeWorkdaysPerWeek: 5 };

  it("proportioniert den Sockel innerhalb der ersten 6 Monate", () => {
    // Voller Sockel: 30/5 Wochen * 40h = 240h. Nach 2 vollen Monaten: 2/12.
    const full = vacationPoolHours(contract, ops, undefined, new Date("2027-01-01T00:00:00.000Z"));
    const prorated = vacationPoolHours(
      contract,
      ops,
      undefined,
      new Date("2026-03-01T00:00:00.000Z"),
    );
    expect(full).toBe(240);
    expect(prorated).toBeCloseTo(240 * (2 / 12), 2);
  });

  it("gewährt ab dem 6. vollen Monat sofort den vollen Sockel", () => {
    expect(
      vacationPoolHours(contract, ops, undefined, new Date("2026-07-01T00:00:00.000Z")),
    ).toBe(240);
  });

  it("bleibt ohne bekanntes Vertragsdatum beim vollen Sockel (Bestandsschutz)", () => {
    expect(
      vacationPoolHours(
        { vacationDays: 30, weeklyHours: 40 },
        ops,
        undefined,
        new Date("2026-01-15T00:00:00.000Z"),
      ),
    ).toBe(240);
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