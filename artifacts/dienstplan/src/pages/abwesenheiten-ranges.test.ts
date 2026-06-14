import { describe, it, expect } from "vitest";
import {
  buildRanges,
  dayKey,
  type AbsenceShift,
} from "./abwesenheiten-ranges";

// Hilfsfunktion: erzeugt einen Tageseintrag wie ihn die App speichert. Die Seite
// legt Urlaub/Krank als lokalen Mitternachts-Zeitstempel an und liest ihn über
// `new Date(startTime)` wieder lokal aus. Wir spiegeln das hier, indem wir die
// Daten als lokale Mitternacht konstruieren und als ISO ablegen. Dadurch sind die
// Tests unabhängig von der Zeitzone der Testumgebung: der Round-Trip
// lokal -> ISO -> lokal ergibt wieder denselben Kalendertag.
function absence(
  id: number,
  userId: number,
  type: "vacation" | "sick",
  year: number,
  month: number,
  day: number
): AbsenceShift {
  const start = new Date(year, month - 1, day, 0, 0, 0);
  const end = new Date(year, month - 1, day, 23, 59, 59);
  return {
    id,
    userId,
    type,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
  };
}

describe("buildRanges — einzelner Tag vs. mehrtägiger Zeitraum", () => {
  it("liefert für einen einzelnen Tag einen 1-Tages-Zeitraum", () => {
    const ranges = buildRanges([absence(1, 10, "vacation", 2026, 3, 5)]);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].days).toBe(1);
    expect(dayKey(ranges[0].startDate)).toBe("2026-03-05");
    expect(dayKey(ranges[0].endDate)).toBe("2026-03-05");
    expect(ranges[0].shiftIds).toEqual([1]);
  });

  it("fasst aufeinanderfolgende Tage zu einem Zeitraum zusammen", () => {
    const ranges = buildRanges([
      absence(1, 10, "vacation", 2026, 3, 5),
      absence(2, 10, "vacation", 2026, 3, 6),
      absence(3, 10, "vacation", 2026, 3, 7),
    ]);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].days).toBe(3);
    expect(dayKey(ranges[0].startDate)).toBe("2026-03-05");
    expect(dayKey(ranges[0].endDate)).toBe("2026-03-07");
    expect(ranges[0].shiftIds).toEqual([1, 2, 3]);
  });

  it("trennt einen Tageslückenbruch in zwei Zeiträume", () => {
    const ranges = buildRanges([
      absence(1, 10, "vacation", 2026, 3, 5),
      absence(2, 10, "vacation", 2026, 3, 6),
      // Lücke am 7., dann wieder am 8.
      absence(3, 10, "vacation", 2026, 3, 8),
    ]);
    // Sortierung absteigend nach Startdatum: der spätere Zeitraum zuerst.
    expect(ranges).toHaveLength(2);
    expect(dayKey(ranges[0].startDate)).toBe("2026-03-08");
    expect(ranges[0].days).toBe(1);
    expect(dayKey(ranges[1].startDate)).toBe("2026-03-05");
    expect(ranges[1].days).toBe(2);
  });

  it("akzeptiert unsortierte Eingaben und gruppiert chronologisch", () => {
    const ranges = buildRanges([
      absence(3, 10, "vacation", 2026, 3, 7),
      absence(1, 10, "vacation", 2026, 3, 5),
      absence(2, 10, "vacation", 2026, 3, 6),
    ]);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].days).toBe(3);
    expect(ranges[0].shiftIds).toEqual([1, 2, 3]);
  });
});

describe("buildRanges — verschachtelte Einträge mehrerer Assistenten/Typen", () => {
  it("hält gleiche Tage verschiedener Assistenten als getrennte Zeiträume", () => {
    const ranges = buildRanges([
      absence(1, 10, "vacation", 2026, 3, 5),
      absence(2, 20, "vacation", 2026, 3, 5),
    ]);
    expect(ranges).toHaveLength(2);
    expect(ranges.every((r) => r.days === 1)).toBe(true);
    expect(new Set(ranges.map((r) => r.userId))).toEqual(new Set([10, 20]));
  });

  it("trennt Urlaub und Krank desselben Assistenten trotz aufeinanderfolgender Tage", () => {
    const ranges = buildRanges([
      absence(1, 10, "vacation", 2026, 3, 5),
      absence(2, 10, "sick", 2026, 3, 6),
    ]);
    expect(ranges).toHaveLength(2);
    const vacation = ranges.find((r) => r.type === "vacation")!;
    const sick = ranges.find((r) => r.type === "sick")!;
    expect(vacation.days).toBe(1);
    expect(sick.days).toBe(1);
  });

  it("gruppiert verschachtelte Einträge zweier Assistenten korrekt pro (Assistent, Typ)", () => {
    // Tage der beiden Assistenten greifen ineinander: würde nur global sortiert
    // ohne Gruppierung verglichen, würden zusammenhängende Tage fälschlich
    // auseinandergerissen.
    const ranges = buildRanges([
      absence(1, 10, "vacation", 2026, 3, 5),
      absence(2, 20, "vacation", 2026, 3, 5),
      absence(3, 10, "vacation", 2026, 3, 6),
      absence(4, 20, "vacation", 2026, 3, 6),
      absence(5, 10, "vacation", 2026, 3, 7),
      absence(6, 20, "vacation", 2026, 3, 7),
    ]);
    expect(ranges).toHaveLength(2);
    for (const r of ranges) {
      expect(r.days).toBe(3);
      expect(dayKey(r.startDate)).toBe("2026-03-05");
      expect(dayKey(r.endDate)).toBe("2026-03-07");
    }
    const user10 = ranges.find((r) => r.userId === 10)!;
    const user20 = ranges.find((r) => r.userId === 20)!;
    expect(user10.shiftIds).toEqual([1, 3, 5]);
    expect(user20.shiftIds).toEqual([2, 4, 6]);
  });
});

describe("buildRanges — Monats- und Jahresgrenzen", () => {
  it("fasst einen Zeitraum über die Monatsgrenze zusammen (31.01 -> 01.02)", () => {
    const ranges = buildRanges([
      absence(1, 10, "vacation", 2026, 1, 30),
      absence(2, 10, "vacation", 2026, 1, 31),
      absence(3, 10, "vacation", 2026, 2, 1),
      absence(4, 10, "vacation", 2026, 2, 2),
    ]);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].days).toBe(4);
    expect(dayKey(ranges[0].startDate)).toBe("2026-01-30");
    expect(dayKey(ranges[0].endDate)).toBe("2026-02-02");
  });

  it("fasst einen Zeitraum über die Jahresgrenze zusammen (31.12 -> 01.01)", () => {
    const ranges = buildRanges([
      absence(1, 10, "vacation", 2025, 12, 30),
      absence(2, 10, "vacation", 2025, 12, 31),
      absence(3, 10, "vacation", 2026, 1, 1),
      absence(4, 10, "vacation", 2026, 1, 2),
    ]);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].days).toBe(4);
    expect(dayKey(ranges[0].startDate)).toBe("2025-12-30");
    expect(dayKey(ranges[0].endDate)).toBe("2026-01-02");
  });

  it("berücksichtigt Schaltjahr-Februar korrekt (28.02 -> 29.02.2028)", () => {
    const ranges = buildRanges([
      absence(1, 10, "vacation", 2028, 2, 28),
      absence(2, 10, "vacation", 2028, 2, 29),
      absence(3, 10, "vacation", 2028, 3, 1),
    ]);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].days).toBe(3);
    expect(dayKey(ranges[0].endDate)).toBe("2028-03-01");
  });
});

describe("buildRanges — leere Eingabe", () => {
  it("liefert eine leere Liste ohne Einträge", () => {
    expect(buildRanges([])).toEqual([]);
  });
});
