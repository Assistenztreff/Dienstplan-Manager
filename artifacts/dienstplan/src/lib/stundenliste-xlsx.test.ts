import { describe, it, expect } from "vitest";
import {
  buildStundenlisteRows,
  buildAenderungsRows,
  type StundenlisteShift,
  type StundenlisteChange,
} from "./stundenliste-xlsx";

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

// ---------------------------------------------------------------------------
// Vormonats-Block (Stufe 4)
// ---------------------------------------------------------------------------

function change(over: Partial<StundenlisteChange> = {}): StundenlisteChange {
  return {
    id: 1,
    changeSource: "planner_edit",
    changedByName: "Kay Straub",
    shiftType: "work",
    createdAt: "2026-08-05T12:12:00.000Z",
    before: {
      startTime: "2026-07-07T06:00:00.000Z",
      endTime: "2026-07-07T14:00:00.000Z",
      pauseMinutes: 0,
      userId: 1,
      userName: "Ada Assistentin",
    },
    after: {
      startTime: "2026-07-07T06:00:00.000Z",
      endTime: "2026-07-07T15:00:00.000Z",
      pauseMinutes: 0,
      userId: 1,
      userName: "Ada Assistentin",
    },
    ...over,
  };
}

describe("buildAenderungsRows", () => {
  it("stellt alten und neuen Wert nebeneinander", () => {
    const [row] = buildAenderungsRows([change()]);
    expect(row.stunden).toBe(9);
    expect(row.stundenVorher).toBe(8);
    expect(row.zeit).toMatch(/–/);
    expect(row.vorher).toMatch(/–/);
    expect(row.name).toBe("Ada Assistentin");
  });

  it("nennt wer geändert hat und wodurch", () => {
    expect(buildAenderungsRows([change()])[0].geaendertVon).toBe(
      "Kay Straub (Planer-Korrektur)",
    );
    expect(
      buildAenderungsRows([change({ changeSource: "deviation_accepted" })])[0].geaendertVon,
    ).toBe("Kay Straub (Meldung angenommen)");
    expect(
      buildAenderungsRows([change({ changeSource: "correction_withdrawn" })])[0].geaendertVon,
    ).toBe("Kay Straub (Korrektur zurückgenommen)");
  });

  it("rechnet die Pause aus beiden Seiten heraus", () => {
    const [row] = buildAenderungsRows([
      change({
        before: { ...change().before, pauseMinutes: 30 },
        after: { ...change().after, pauseMinutes: 60 },
      }),
    ]);
    expect(row.stundenVorher).toBe(7.5);
    expect(row.stunden).toBe(8);
    expect(row.vorher).toContain("30 Min Pause");
    expect(row.zeit).toContain("60 Min Pause");
  });

  it("nennt die alte Assistenzkraft nur bei einem Wechsel", () => {
    const ohneWechsel = buildAenderungsRows([change()])[0];
    expect(ohneWechsel.vorher).not.toContain("Ada Assistentin");

    const mitWechsel = buildAenderungsRows([
      change({
        before: { ...change().before, userId: 2, userName: "Berta Vertretung" },
      }),
    ])[0];
    expect(mitWechsel.vorher).toContain("Berta Vertretung");
    expect(mitWechsel.name).toBe("Ada Assistentin");
  });

  it("nennt das alte Datum nur bei einem verschobenen Dienst", () => {
    const verschoben = buildAenderungsRows([
      change({
        before: {
          ...change().before,
          startTime: "2026-07-06T06:00:00.000Z",
          endTime: "2026-07-06T14:00:00.000Z",
        },
      }),
    ])[0];
    expect(verschoben.vorher).toContain("06.07.2026");
    expect(buildAenderungsRows([change()])[0].vorher).not.toContain("07.07.2026");
  });

  it("listet einen mehrfach geänderten Dienst mehrfach, in Änderungsreihenfolge", () => {
    const rows = buildAenderungsRows([
      change({ id: 2, createdAt: "2026-08-06T09:00:00.000Z" }),
      change({ id: 1, createdAt: "2026-08-05T09:00:00.000Z" }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].geaendertAm).toContain("05.08.2026");
    expect(rows[1].geaendertAm).toContain("06.08.2026");
  });

  it("sortiert nach dem Dienst-Datum, nicht nach dem Änderungszeitpunkt", () => {
    const rows = buildAenderungsRows([
      change({
        id: 1,
        createdAt: "2026-08-01T09:00:00.000Z",
        before: { ...change().before, startTime: "2026-07-20T06:00:00.000Z", endTime: "2026-07-20T14:00:00.000Z" },
        after: { ...change().after, startTime: "2026-07-20T06:00:00.000Z", endTime: "2026-07-20T15:00:00.000Z" },
      }),
      change({ id: 2, createdAt: "2026-08-09T09:00:00.000Z" }),
    ]);
    expect(rows.map((r) => r.datum)).toEqual([
      expect.stringContaining("07.07.2026"),
      expect.stringContaining("20.07.2026"),
    ]);
  });

  it("fällt bei fehlendem Diensttyp auf „Dienst“ zurück", () => {
    expect(buildAenderungsRows([change({ shiftType: null })])[0].typ).toBe("Dienst");
    expect(buildAenderungsRows([change({ shiftType: "night" })])[0].typ).toBe("Nachtdienst");
  });
});
