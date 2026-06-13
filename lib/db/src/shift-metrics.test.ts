import { describe, it, expect } from "vitest";
import {
  computeShiftMetrics,
  computeNightHours,
  computeDayCategoryHours,
  type NightWindow,
} from "./shift-metrics";

// Zeitstempel werden in UTC interpretiert (siehe shift-metrics.ts). Die Tests
// konstruieren daher bewusst UTC-Daten.
const NIGHT: NightWindow = { nightStart: "23:00", nightEnd: "06:00" };

function utc(y: number, m: number, d: number, h: number, min = 0): Date {
  return new Date(Date.UTC(y, m, d, h, min));
}

describe("computeShiftMetrics — reguläre Schicht", () => {
  it("berechnet Bruttostunden und Wertung ohne Tagesübergang", () => {
    // Mo 05.01.2026, 08:00–16:00
    const metrics = computeShiftMetrics(
      {
        startTime: utc(2026, 0, 5, 8),
        endTime: utc(2026, 0, 5, 16),
        isAbsence: false,
        valuationPercent: 100,
      },
      NIGHT
    );
    expect(metrics.valuedHours).toBe(8);
    expect(metrics.nightHours).toBe(0);
    expect(metrics.sundayHours).toBe(0);
    expect(metrics.holidayHours).toBe(0);
  });
});

describe("computeShiftMetrics — Schicht über Mitternacht", () => {
  it("liefert positive Dauer und korrekte Nachtstunden (16:00–08:00)", () => {
    // Mo 05.01.2026 16:00 -> Di 06.01.2026 08:00
    const start = utc(2026, 0, 5, 16);
    const end = utc(2026, 0, 6, 8);
    const metrics = computeShiftMetrics(
      { startTime: start, endTime: end, isAbsence: false, valuationPercent: 100 },
      NIGHT
    );
    // 16 Stunden brutto, voll gewertet
    expect(metrics.valuedHours).toBe(16);
    // Nachtfenster 23:00–06:00 = 7 Stunden über die Datumsgrenze
    expect(metrics.nightHours).toBe(7);
    expect(computeNightHours(start, end, "23:00", "06:00")).toBe(7);
    // Werktag -> kein Sonntag/Feiertag
    expect(metrics.sundayHours).toBe(0);
    expect(metrics.holidayHours).toBe(0);
  });

  it("wertet die Reststunden ab 00:00 als Sonntag, wenn der Folgetag ein Sonntag ist", () => {
    // Sa 10.01.2026 16:00 -> So 11.01.2026 08:00
    const start = utc(2026, 0, 10, 16);
    const end = utc(2026, 0, 11, 8);
    const { sundayHours, holidayHours } = computeDayCategoryHours(start, end);
    // 8 Stunden am Samstag (kein Zuschlag), 8 Stunden Sonntag (00:00–08:00)
    expect(sundayHours).toBe(8);
    expect(holidayHours).toBe(0);
  });

  it("wertet die Reststunden ab 00:00 als Feiertag, wenn der Folgetag ein Feiertag ist", () => {
    // Mi 31.12.2025 16:00 -> Do 01.01.2026 08:00 (Neujahr)
    const start = utc(2025, 11, 31, 16);
    const end = utc(2026, 0, 1, 8);
    const { sundayHours, holidayHours } = computeDayCategoryHours(start, end);
    // 8 Stunden am 31.12. (Werktag), 8 Stunden Feiertag (Neujahr 00:00–08:00)
    expect(holidayHours).toBe(8);
    expect(sundayHours).toBe(0);
  });

  it("zählt Feiertag und Sonntag nicht doppelt (Feiertag hat Vorrang)", () => {
    // Neujahr 01.01.2023 ist ein Sonntag. Schicht 00:00–08:00 an diesem Tag.
    const { sundayHours, holidayHours } = computeDayCategoryHours(
      utc(2023, 0, 1, 0),
      utc(2023, 0, 1, 8)
    );
    expect(holidayHours).toBe(8);
    expect(sundayHours).toBe(0);
  });
});

describe("computeShiftMetrics — 24h-Dienst über Mitternacht", () => {
  it("zählt volle 24 Stunden und das volle Nachtfenster", () => {
    // 08:00 -> 08:00 Folgetag
    const start = utc(2026, 0, 5, 8);
    const end = utc(2026, 0, 6, 8);
    const metrics = computeShiftMetrics(
      { startTime: start, endTime: end, isAbsence: false, valuationPercent: 100 },
      NIGHT
    );
    expect(metrics.valuedHours).toBe(24);
    // ein vollständiges Nachtfenster 23:00–06:00 = 7 Stunden
    expect(metrics.nightHours).toBe(7);
  });
});
