import { describe, it, expect } from "vitest";
import { computeArbeitstage, MAX_SHIFT_LENGTH_HOURS } from "./arbeitstage-rechner";

/**
 * Rechenkern des Arbeitstage-Rechners (#706): Konsistenz der Vertragswerte
 * und Grenzfälle. `dailyHours` muss immer der Server-Formel
 * round2(weeklyHours / workdaysPerWeek) entsprechen.
 */
describe("computeArbeitstage", () => {
  it("5 × 24-h-Dienste → 1,15 Arbeitstage, 27,6 Wochenstunden, exakt 24 h/Urlaubstag", () => {
    expect(computeArbeitstage(5, 24)).toEqual({
      workdaysPerWeek: 1.15,
      weeklyHours: 27.6,
      dailyHours: 24,
    });
  });

  it("4 × 12-h-Dienste → konsistente Werte, Urlaubstag = 12 h", () => {
    const r = computeArbeitstage(4, 12);
    expect(r).not.toBeNull();
    expect(r!.workdaysPerWeek).toBeCloseTo(0.92, 2);
    expect(r!.weeklyHours).toBeCloseTo(11.04, 2);
    expect(r!.dailyHours).toBeCloseTo(12, 2);
  });

  it("krumme Dezimalwerte: dailyHours bleibt die Server-Bewertung (keine exakte Dienstlänge versprochen)", () => {
    const r = computeArbeitstage(2.175, 24.01);
    expect(r).not.toBeNull();
    expect(r!.workdaysPerWeek).toBe(0.5);
    // dailyHours ist die gerundete Server-Bewertung, nicht die Eingabe —
    // Abweichung bleibt aber im Cent-Bereich.
    expect(r!.dailyHours).toBeCloseTo(
      Math.round((r!.weeklyHours / r!.workdaysPerWeek) * 100) / 100,
      10,
    );
    expect(Math.abs(r!.dailyHours - 24.01)).toBeLessThanOrEqual(0.02);
  });

  it("Grenze 0,5 Arbeitstage: 2,17 Dienste ok, 2,1 Dienste zu wenig", () => {
    expect(computeArbeitstage(2.17, 8)).not.toBeNull();
    expect(computeArbeitstage(2.1, 8)).toBeNull();
  });

  it("Grenze 7 Arbeitstage: 30,4 Dienste ok, 30,5 Dienste zu viel", () => {
    expect(computeArbeitstage(30.4, 8)).not.toBeNull();
    expect(computeArbeitstage(30.5, 8)).toBeNull();
  });

  it("Dienstlänge: 0,5 und Maximum erlaubt, darüber/darunter nicht", () => {
    expect(computeArbeitstage(5, 0.5)).not.toBeNull();
    expect(computeArbeitstage(5, MAX_SHIFT_LENGTH_HOURS)).not.toBeNull();
    expect(computeArbeitstage(5, 0.4)).toBeNull();
    expect(computeArbeitstage(5, MAX_SHIFT_LENGTH_HOURS + 1)).toBeNull();
  });

  it("ungültige Eingaben (0, negativ, NaN, Infinity) liefern null", () => {
    expect(computeArbeitstage(0, 24)).toBeNull();
    expect(computeArbeitstage(-3, 24)).toBeNull();
    expect(computeArbeitstage(Number.NaN, 24)).toBeNull();
    expect(computeArbeitstage(5, Number.POSITIVE_INFINITY)).toBeNull();
    expect(computeArbeitstage(5, Number.NaN)).toBeNull();
  });
});
