import { describe, it, expect } from "vitest";
import type { NightWindow } from "@workspace/db";
import { isAbsenceType, resolveShiftMetrics, averageDailyHours } from "./shift-metrics-resolve";

// Zeitstempel werden in UTC interpretiert (siehe @workspace/db shift-metrics.ts).
// Die Tests konstruieren daher bewusst UTC-Daten.
const NIGHT: NightWindow = { nightStart: "23:00", nightEnd: "06:00" };

function utc(y: number, m: number, d: number, h: number, min = 0): Date {
  return new Date(Date.UTC(y, m, d, h, min));
}

describe("averageDailyHours (§11 BUrlG)", () => {
  it("mittelt Gesamtstunden auf gearbeitete Tage (auf 2 Nachkommastellen)", () => {
    expect(averageDailyHours(160, 20)).toBe(8);
    expect(averageDailyHours(100, 13)).toBe(7.69);
  });

  it("liefert null ohne gearbeitete Tage (Fallback beim Aufrufer)", () => {
    expect(averageDailyHours(0, 0)).toBeNull();
    expect(averageDailyHours(120, 0)).toBeNull();
  });
});

describe("isAbsenceType", () => {
  it("erkennt Urlaub und Krankheit als Abwesenheit", () => {
    expect(isAbsenceType("vacation")).toBe(true);
    expect(isAbsenceType("sick")).toBe(true);
  });

  it("behandelt Arbeitsschicht-Typen nicht als Abwesenheit", () => {
    expect(isAbsenceType("work")).toBe(false);
    expect(isAbsenceType("active")).toBe(false);
    expect(isAbsenceType("standby")).toBe(false);
    expect(isAbsenceType("night")).toBe(false);
    expect(isAbsenceType("full_day")).toBe(false);
  });
});

describe("resolveShiftMetrics — Urlaub/Krank als Sonderfall", () => {
  it("wertet Urlaub mit den geplanten Tagesstunden, ohne Zuschläge", () => {
    const metrics = resolveShiftMetrics(
      {
        type: "vacation",
        startTime: utc(2026, 0, 5, 0),
        endTime: utc(2026, 0, 5, 23, 59),
        plannedHours: 7.6,
        valuationPercent: 100,
      },
      NIGHT
    );
    expect(metrics).toEqual({
      valuedHours: 7.6,
      nightHours: 0,
      sundayHours: 0,
      holidayHours: 0,
    });
  });

  it("wertet Krank ebenfalls plan-basiert und ignoriert valuationPercent", () => {
    const metrics = resolveShiftMetrics(
      {
        type: "sick",
        startTime: utc(2026, 0, 5, 0),
        endTime: utc(2026, 0, 5, 23, 59),
        plannedHours: 8,
        valuationPercent: 50,
      },
      NIGHT
    );
    expect(metrics.valuedHours).toBe(8);
    expect(metrics.nightHours).toBe(0);
    expect(metrics.sundayHours).toBe(0);
    expect(metrics.holidayHours).toBe(0);
  });

  it("berechnet Sonntagsstunden für ganztägige Abwesenheit am Sonntag (§11 BUrlG)", () => {
    // Sonntag 11.01.2026 — ganztägiger Urlaub soll dieselben Sonntagsstunden ergeben
    // wie ein Arbeitsdienst (geplante Stunden = 8h).
    const metrics = resolveShiftMetrics(
      {
        type: "vacation",
        startTime: utc(2026, 0, 11, 0),
        endTime: utc(2026, 0, 11, 23, 59),
        plannedHours: 8,
        valuationPercent: 100,
      },
      NIGHT
    );
    expect(metrics.valuedHours).toBe(8);
    expect(metrics.sundayHours).toBe(8);
    expect(metrics.holidayHours).toBe(0);
    expect(metrics.nightHours).toBe(0);
  });

  it("berechnet Feiertagsstunden für ganztägige Abwesenheit am Feiertag (§2 EFZG)", () => {
    // Neujahr 01.01.2026 (Donnerstag) — bundesweiter Feiertag
    const metrics = resolveShiftMetrics(
      {
        type: "sick",
        startTime: utc(2026, 0, 1, 0),
        endTime: utc(2026, 0, 1, 23, 59),
        plannedHours: 7.6,
        valuationPercent: 100,
      },
      NIGHT
    );
    expect(metrics.valuedHours).toBe(7.6);
    expect(metrics.holidayHours).toBe(7.6);
    expect(metrics.sundayHours).toBe(0);
    expect(metrics.nightHours).toBe(0);
  });

  it("Feiertag hat Vorrang vor Sonntag — kein Doppelzuschlag bei ganztägiger Abwesenheit", () => {
    // Neujahr 01.01.2023 fällt auf einen Sonntag (bundesweiter Feiertag + Sonntag)
    const metrics = resolveShiftMetrics(
      {
        type: "vacation",
        startTime: utc(2023, 0, 1, 0),
        endTime: utc(2023, 0, 1, 23, 59),
        plannedHours: 8,
        valuationPercent: 100,
      },
      NIGHT
    );
    expect(metrics.holidayHours).toBe(8);
    expect(metrics.sundayHours).toBe(0);
    expect(metrics.nightHours).toBe(0);
  });

  it("keine Zuschläge für ganztägige Abwesenheit an einem gewöhnlichen Werktag", () => {
    // Montag 05.01.2026 — normaler Wochentag, kein Feiertag
    const metrics = resolveShiftMetrics(
      {
        type: "vacation",
        startTime: utc(2026, 0, 5, 0),
        endTime: utc(2026, 0, 5, 23, 59),
        plannedHours: 8,
        valuationPercent: 100,
      },
      NIGHT
    );
    expect(metrics.sundayHours).toBe(0);
    expect(metrics.holidayHours).toBe(0);
    expect(metrics.nightHours).toBe(0);
  });

  it("Feiertagsstunden gelten auch bei Krank mit Bundesland (Fronleichnam BY)", () => {
    // Fronleichnam 2026 = Do 04.06.2026 — Feiertag nur in BY und anderen Ländern
    const bayernMetrics = resolveShiftMetrics(
      {
        type: "sick",
        startTime: utc(2026, 5, 4, 0),
        endTime: utc(2026, 5, 4, 23, 59),
        plannedHours: 8,
        valuationPercent: 100,
      },
      NIGHT,
      "BY"
    );
    expect(bayernMetrics.holidayHours).toBe(8);

    const berlinMetrics = resolveShiftMetrics(
      {
        type: "sick",
        startTime: utc(2026, 5, 4, 0),
        endTime: utc(2026, 5, 4, 23, 59),
        plannedHours: 8,
        valuationPercent: 100,
      },
      NIGHT,
      "BE"
    );
    expect(berlinMetrics.holidayHours).toBe(0);
    expect(berlinMetrics.sundayHours).toBe(0);
  });
});

describe("resolveShiftMetrics — Nachtstunden-Schätzung bei ganz freier Ganztags-Abwesenheit", () => {
  const NIGHT_MODEL = { defaultStartTime: "22:00", defaultEndTime: "06:00" };

  it("schätzt Nachtstunden aus dem ersten aktiven Team-Schichtmodell, wenn kein Zeitfenster bekannt ist", () => {
    // Montag 05.01.2026 — normaler Werktag, Modell 22:00-06:00 überlappt das
    // Nachtfenster 23:00-06:00 vollständig mit 7 Stunden.
    const metrics = resolveShiftMetrics(
      {
        type: "vacation",
        startTime: utc(2026, 0, 5, 0),
        endTime: utc(2026, 0, 5, 23, 59),
        plannedHours: 8,
        valuationPercent: 100,
        fallbackNightBasis: NIGHT_MODEL,
      },
      NIGHT
    );
    expect(metrics.nightHours).toBe(7);
    expect(metrics.valuedHours).toBe(8);
  });

  it("bleibt bei 0 Nachtstunden ohne Schätzbasis (Rückwärtskompatibilität)", () => {
    const metrics = resolveShiftMetrics(
      {
        type: "vacation",
        startTime: utc(2026, 0, 5, 0),
        endTime: utc(2026, 0, 5, 23, 59),
        plannedHours: 8,
        valuationPercent: 100,
      },
      NIGHT
    );
    expect(metrics.nightHours).toBe(0);
  });

  it("kombiniert Nachtstunden-Schätzung mit Sonntagszuschlag (kein Doppelzuschlag)", () => {
    // Sonntag 11.01.2026: Sonntagsstunden weiterhin aus plannedHours, Nachtstunden
    // zusätzlich aus der Schätzbasis — beides gleichzeitig möglich (unterschiedliche
    // Zuschlagsarten, kein Konflikt).
    const metrics = resolveShiftMetrics(
      {
        type: "sick",
        startTime: utc(2026, 0, 11, 0),
        endTime: utc(2026, 0, 11, 23, 59),
        plannedHours: 8,
        valuationPercent: 100,
        fallbackNightBasis: NIGHT_MODEL,
      },
      NIGHT
    );
    expect(metrics.nightHours).toBe(7);
    expect(metrics.sundayHours).toBe(8);
  });

  it("Kind-krank bleibt trotz Schätzbasis komplett zuschlagsfrei (unbezahlte Kategorie)", () => {
    const metrics = resolveShiftMetrics(
      {
        type: "kind_krank",
        startTime: utc(2026, 0, 5, 0),
        endTime: utc(2026, 0, 5, 23, 59),
        plannedHours: 8,
        valuationPercent: 100,
        fallbackNightBasis: NIGHT_MODEL,
      },
      NIGHT
    );
    expect(metrics).toEqual({
      valuedHours: 8,
      nightHours: 0,
      sundayHours: 0,
      holidayHours: 0,
    });
  });

  it("Modellzeiten ohne Mitternachtsüberschreitung (z.B. 08:00-16:00) ergeben 0 Nachtstunden", () => {
    const metrics = resolveShiftMetrics(
      {
        type: "vacation",
        startTime: utc(2026, 0, 5, 0),
        endTime: utc(2026, 0, 5, 23, 59),
        plannedHours: 8,
        valuationPercent: 100,
        fallbackNightBasis: { defaultStartTime: "08:00", defaultEndTime: "16:00" },
      },
      NIGHT
    );
    expect(metrics.nightHours).toBe(0);
  });
});

describe("resolveShiftMetrics — Bewertungsprozent je Typ/Schichtmodell", () => {
  it("wertet eine Arbeitsschicht voll bei 100 %", () => {
    const metrics = resolveShiftMetrics(
      {
        type: "work",
        startTime: utc(2026, 0, 5, 8),
        endTime: utc(2026, 0, 5, 16),
        plannedHours: 0,
        valuationPercent: 100,
      },
      NIGHT
    );
    expect(metrics.valuedHours).toBe(8);
  });

  it("reduziert die gewerteten Stunden bei einem niedrigeren Modell-Prozentsatz (z.B. Bereitschaft 50 %)", () => {
    const metrics = resolveShiftMetrics(
      {
        type: "work",
        startTime: utc(2026, 0, 5, 8),
        endTime: utc(2026, 0, 5, 16),
        plannedHours: 0,
        valuationPercent: 50,
      },
      NIGHT
    );
    expect(metrics.valuedHours).toBe(4);
  });

  it("ignoriert plannedHours bei Arbeitsschichten", () => {
    const metrics = resolveShiftMetrics(
      {
        type: "work",
        startTime: utc(2026, 0, 5, 8),
        endTime: utc(2026, 0, 5, 16),
        plannedHours: 999,
        valuationPercent: 100,
      },
      NIGHT
    );
    expect(metrics.valuedHours).toBe(8);
  });
});

describe("resolveShiftMetrics — Nachtanteil", () => {
  it("berechnet die Nachtstunden einer Schicht über Mitternacht (16:00–08:00)", () => {
    const metrics = resolveShiftMetrics(
      {
        type: "work",
        startTime: utc(2026, 0, 5, 16),
        endTime: utc(2026, 0, 6, 8),
        plannedHours: 0,
        valuationPercent: 100,
      },
      NIGHT
    );
    // Nachtfenster 23:00–06:00 über die Datumsgrenze = 7 Stunden
    expect(metrics.nightHours).toBe(7);
    expect(metrics.valuedHours).toBe(16);
  });

  it("zählt am Nachtfenster-Rand exakt (22:00–00:00 = 1 Stunde im Fenster)", () => {
    const metrics = resolveShiftMetrics(
      {
        type: "work",
        startTime: utc(2026, 0, 5, 22),
        endTime: utc(2026, 0, 6, 0),
        plannedHours: 0,
        valuationPercent: 100,
      },
      NIGHT
    );
    // nur 23:00–00:00 liegt im Nachtfenster
    expect(metrics.nightHours).toBe(1);
  });

  it("liefert 0 Nachtstunden für eine Schicht genau bis zum Fensterbeginn (15:00–23:00)", () => {
    const metrics = resolveShiftMetrics(
      {
        type: "work",
        startTime: utc(2026, 0, 5, 15),
        endTime: utc(2026, 0, 5, 23),
        plannedHours: 0,
        valuationPercent: 100,
      },
      NIGHT
    );
    expect(metrics.nightHours).toBe(0);
  });
});

describe("resolveShiftMetrics — Sonntagsanteil", () => {
  it("wertet die Stunden ab Mitternacht als Sonntag, wenn der Folgetag ein Sonntag ist", () => {
    // Sa 10.01.2026 16:00 -> So 11.01.2026 08:00
    const metrics = resolveShiftMetrics(
      {
        type: "work",
        startTime: utc(2026, 0, 10, 16),
        endTime: utc(2026, 0, 11, 8),
        plannedHours: 0,
        valuationPercent: 100,
      },
      NIGHT
    );
    expect(metrics.sundayHours).toBe(8);
    expect(metrics.holidayHours).toBe(0);
  });
});

describe("resolveShiftMetrics — Feiertagserkennung", () => {
  it("erkennt einen bundesweiten Feiertag auch ohne Bundesland (Neujahr)", () => {
    const metrics = resolveShiftMetrics(
      {
        type: "work",
        startTime: utc(2026, 0, 1, 8),
        endTime: utc(2026, 0, 1, 16),
        plannedHours: 0,
        valuationPercent: 100,
      },
      NIGHT
    );
    expect(metrics.holidayHours).toBe(8);
    expect(metrics.sundayHours).toBe(0);
  });

  it("wertet einen beweglichen Landesfeiertag (Fronleichnam) nur mit passendem Bundesland", () => {
    // Fronleichnam 2026 = Do 04.06.2026 (Ostern 05.04. + 60)
    const input = {
      type: "work",
      startTime: utc(2026, 5, 4, 8),
      endTime: utc(2026, 5, 4, 16),
      plannedHours: 0,
      valuationPercent: 100,
    };
    expect(resolveShiftMetrics(input, NIGHT, "BY").holidayHours).toBe(8);
    expect(resolveShiftMetrics(input, NIGHT, "BE").holidayHours).toBe(0);
    expect(resolveShiftMetrics(input, NIGHT).holidayHours).toBe(0);
  });

  it("gibt einem Feiertag Vorrang vor dem Sonntag (kein doppelter Zuschlag)", () => {
    // Neujahr 01.01.2023 fällt auf einen Sonntag
    const metrics = resolveShiftMetrics(
      {
        type: "work",
        startTime: utc(2023, 0, 1, 8),
        endTime: utc(2023, 0, 1, 16),
        plannedHours: 0,
        valuationPercent: 100,
      },
      NIGHT
    );
    expect(metrics.holidayHours).toBe(8);
    expect(metrics.sundayHours).toBe(0);
  });
});

describe("resolveShiftMetrics — kombinierter Fall", () => {
  it("ermittelt Nacht-, Sonntags- und Wertungsanteil einer Nachtschicht in den Sonntag", () => {
    // Sa 10.01.2026 22:00 -> So 11.01.2026 06:00, Modell-Wertung 75 %
    const metrics = resolveShiftMetrics(
      {
        type: "work",
        startTime: utc(2026, 0, 10, 22),
        endTime: utc(2026, 0, 11, 6),
        plannedHours: 0,
        valuationPercent: 75,
      },
      NIGHT
    );
    // 8 Bruttostunden * 75 %
    expect(metrics.valuedHours).toBe(6);
    // 23:00–06:00 = 7 Stunden im Nachtfenster
    expect(metrics.nightHours).toBe(7);
    // 00:00–06:00 am Sonntag = 6 Stunden
    expect(metrics.sundayHours).toBe(6);
    expect(metrics.holidayHours).toBe(0);
  });
});
