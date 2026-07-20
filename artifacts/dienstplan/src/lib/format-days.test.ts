import { describe, expect, it } from "vitest";
import { formatDays, formatDaysWithUnit } from "./utils";

// Halbe Urlaubstage entstehen, seit Tage überall aus der Stunden-Buchhaltung
// abgeleitet werden (vacationHoursUsed / hoursPerDay, gerundet auf 0,1).
// Diese Tests frieren das deutsche Anzeigeformat ein: Dezimalkomma statt
// Punkt, ganze Tage ohne ",0", Einheit "Tag"/"Tage" grammatikalisch korrekt.
describe("formatDays", () => {
  it("zeigt ganze Tage ohne Nachkommastelle", () => {
    expect(formatDays(3)).toBe("3");
    expect(formatDays(0)).toBe("0");
    expect(formatDays(30)).toBe("30");
  });

  it("zeigt Bruchteile mit einer Stelle und Dezimalkomma", () => {
    expect(formatDays(3.5)).toBe("3,5");
    expect(formatDays(0.5)).toBe("0,5");
    expect(formatDays(2.4)).toBe("2,4");
  });

  it("rundet auf höchstens eine Nachkommastelle", () => {
    expect(formatDays(3.75)).toBe("3,8");
    expect(formatDays(3.04)).toBe("3");
  });
});

describe("formatDaysWithUnit", () => {
  it("nutzt 'Tag' nur bei exakt 1", () => {
    expect(formatDaysWithUnit(1)).toBe("1 Tag");
    expect(formatDaysWithUnit(1.5)).toBe("1,5 Tage");
    expect(formatDaysWithUnit(0)).toBe("0 Tage");
    expect(formatDaysWithUnit(3.5)).toBe("3,5 Tage");
  });
});
