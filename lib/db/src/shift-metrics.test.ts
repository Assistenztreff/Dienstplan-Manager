import { describe, it, expect } from "vitest";
import {
  computeShiftMetrics,
  computeNightHours,
  computeDayCategoryHours,
  germanHolidays,
  isGermanHoliday,
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

describe("germanHolidays — regionale Feiertage", () => {
  it("enthält ohne Bundesland nur die bundesweiten Feiertage", () => {
    const set = germanHolidays(2026);
    expect(set.has("2026-01-01")).toBe(true); // Neujahr (bundesweit)
    expect(set.has("2026-01-06")).toBe(false); // Heilige Drei Könige (nur einige Länder)
    expect(set.has("2026-06-04")).toBe(false); // Fronleichnam 2026 (Ostern+60)
  });

  it("fügt Fronleichnam für Bayern hinzu (Ostern 2026 = 05.04. -> +60 = 04.06.)", () => {
    expect(germanHolidays(2026, "BY").has("2026-06-04")).toBe(true);
    expect(germanHolidays(2026, "BE").has("2026-06-04")).toBe(false);
  });

  it("kennt Heilige Drei Könige in BW/BY/ST, aber nicht in NRW", () => {
    expect(isGermanHoliday(utc(2026, 0, 6, 12), "BW")).toBe(true);
    expect(isGermanHoliday(utc(2026, 0, 6, 12), "BY")).toBe(true);
    expect(isGermanHoliday(utc(2026, 0, 6, 12), "ST")).toBe(true);
    expect(isGermanHoliday(utc(2026, 0, 6, 12), "NW")).toBe(false);
  });

  it("berechnet Buß- und Bettag (Mittwoch vor dem 23.11.) nur für Sachsen", () => {
    // 2026: der Mittwoch vor dem 23.11. ist der 18.11.2026
    expect(isGermanHoliday(utc(2026, 10, 18, 12), "SN")).toBe(true);
    expect(germanHolidays(2026, "SN").has("2026-11-18")).toBe(true);
    expect(isGermanHoliday(utc(2026, 10, 18, 12), "TH")).toBe(false);
  });

  it("kennt den Internationalen Frauentag (08.03.) in Berlin", () => {
    expect(isGermanHoliday(utc(2026, 2, 8, 12), "BE")).toBe(true);
    expect(isGermanHoliday(utc(2026, 2, 8, 12), "BW")).toBe(false);
  });

  it("kennt Ostersonntag/Pfingstsonntag nur in Brandenburg", () => {
    // Ostern 2026 = So 05.04., Pfingstsonntag = Ostern+49 = So 24.05.2026
    expect(isGermanHoliday(utc(2026, 3, 5, 12), "BB")).toBe(true);
    expect(isGermanHoliday(utc(2026, 4, 24, 12), "BB")).toBe(true);
    expect(isGermanHoliday(utc(2026, 3, 5, 12), "BW")).toBe(false);
    expect(isGermanHoliday(utc(2026, 4, 24, 12), "BW")).toBe(false);
  });
});

describe("computeDayCategoryHours — Brandenburg: Ostersonntag als Feiertag statt Sonntag", () => {
  it("wertet Ostersonntag in BB als Feiertag (Vorrang vor Sonntag), sonst als Sonntag", () => {
    // Ostersonntag 05.04.2026, Schicht 08:00–16:00
    const start = utc(2026, 3, 5, 8);
    const end = utc(2026, 3, 5, 16);
    const bb = computeDayCategoryHours(start, end, "BB");
    expect(bb.holidayHours).toBe(8);
    expect(bb.sundayHours).toBe(0);
    // Ohne Bundesland: gewöhnlicher Sonntag
    const none = computeDayCategoryHours(start, end);
    expect(none.holidayHours).toBe(0);
    expect(none.sundayHours).toBe(8);
  });
});

describe("computeDayCategoryHours — mit Bundesland", () => {
  it("wertet Fronleichnam in Bayern als Feiertag, bundesweit nicht", () => {
    // Fronleichnam 2026 = Do 04.06.2026, Schicht 08:00–16:00
    const start = utc(2026, 5, 4, 8);
    const end = utc(2026, 5, 4, 16);
    expect(computeDayCategoryHours(start, end, "BY").holidayHours).toBe(8);
    expect(computeDayCategoryHours(start, end).holidayHours).toBe(0);
  });
});
