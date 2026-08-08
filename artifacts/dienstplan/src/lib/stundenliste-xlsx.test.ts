import { describe, it, expect } from "vitest";
import { buildStundenlisteRows, type StundenlisteShift } from "./stundenliste-xlsx";

function shift(over: Partial<StundenlisteShift>): StundenlisteShift {
  return {
    userId: 1,
    startTime: "2026-08-10T06:00:00.000Z",
    endTime: "2026-08-10T14:00:00.000Z",
    type: "work",
    planningStatus: "FIX",
    valuedHours: 8,
    user: { name: "Ada Assistentin" },
    ...over,
  };
}

describe("buildStundenlisteRows", () => {
  it("nimmt nur bestätigte (FIX) Einträge auf", () => {
    const rows = buildStundenlisteRows([
      shift({}),
      shift({ planningStatus: "VORLAEUFIG" }),
      shift({ planningStatus: "ANGEBOTEN" }),
      // fehlender Status gilt als FIX (DB-Default)
      shift({ planningStatus: null, startTime: "2026-08-11T06:00:00.000Z" }),
    ]);
    expect(rows).toHaveLength(2);
  });

  it("beschriftet Abwesenheiten als ganztägig und Dienste mit Zeitspanne", () => {
    const rows = buildStundenlisteRows([
      shift({ type: "vacation", startTime: "2026-08-12T00:00:00.000Z", endTime: "2026-08-12T23:59:00.000Z" }),
      shift({ type: "sick", startTime: "2026-08-13T00:00:00.000Z", endTime: "2026-08-13T23:59:00.000Z" }),
      shift({}),
    ]);
    const urlaub = rows.find((r) => r.typ === "Urlaub");
    const krank = rows.find((r) => r.typ === "Krank");
    const dienst = rows.find((r) => r.typ === "Dienst");
    expect(urlaub?.zeit).toBe("ganztägig");
    expect(krank?.zeit).toBe("ganztägig");
    expect(dienst?.zeit).toMatch(/^\d{2}:\d{2}–\d{2}:\d{2}$/);
  });

  it("enthält keine Geldwerte oder Zuschläge — nur Datum, Name, Art, Zeit, Stunden", () => {
    const rows = buildStundenlisteRows([shift({})]);
    expect(Object.keys(rows[0]).sort()).toEqual(["datum", "name", "stunden", "typ", "zeit"]);
  });

  it("sortiert nach Datum, dann nach Name", () => {
    const rows = buildStundenlisteRows([
      shift({ startTime: "2026-08-12T06:00:00.000Z", user: { name: "Zora" } }),
      shift({ startTime: "2026-08-10T06:00:00.000Z", user: { name: "Berta" } }),
      shift({ startTime: "2026-08-10T06:00:00.000Z", user: { name: "Anna" } }),
    ]);
    expect(rows.map((r) => r.name)).toEqual(["Anna", "Berta", "Zora"]);
  });

  it("fällt ohne valuedHours auf die Zeitspanne zurück", () => {
    const rows = buildStundenlisteRows([
      shift({ valuedHours: null, endTime: "2026-08-10T12:30:00.000Z" }),
    ]);
    expect(rows[0].stunden).toBe(6.5);
  });
});
