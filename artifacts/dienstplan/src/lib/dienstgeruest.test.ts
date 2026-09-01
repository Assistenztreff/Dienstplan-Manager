import { describe, it, expect } from "vitest";
import {
  wochentagIso,
  tagesSchluessel,
  regelGiltAnTag,
  offenePlaetzeFuerTag,
  schichtenNachTag,
  hatRegelplan,
  type GeruestDienst,
} from "./dienstgeruest";

/** Basis-Dienst; die Tests überschreiben nur, worum es ihnen geht. */
function dienst(over: Partial<GeruestDienst> = {}): GeruestDienst {
  return {
    id: 1,
    name: "24h Assistenz",
    color: "purple",
    defaultStartTime: "09:00",
    defaultEndTime: "09:00",
    defaultWeekdays: [1, 2, 3, 4, 5, 6, 7],
    isActive: true,
    imRegelplan: true,
    validFrom: null,
    standbySlot: true,
    ...over,
  };
}

// 1. September 2026 ist ein Dienstag, der 5. ein Samstag, der 6. ein Sonntag.
const DIENSTAG = new Date(2026, 8, 1);
const SAMSTAG = new Date(2026, 8, 5);
const SONNTAG = new Date(2026, 8, 6);

describe("wochentagIso", () => {
  it("zählt Montag als 1 und Sonntag als 7", () => {
    expect(wochentagIso(DIENSTAG)).toBe(2);
    expect(wochentagIso(SAMSTAG)).toBe(6);
    expect(wochentagIso(SONNTAG)).toBe(7);
  });
});

describe("tagesSchluessel", () => {
  it("formatiert lokal als YYYY-MM-DD, ohne UTC-Verschiebung", () => {
    expect(tagesSchluessel(DIENSTAG)).toBe("2026-09-01");
    // 23:30 Ortszeit bleibt derselbe Tag — ein UTC-Umweg würde hier auf den
    // Folgetag springen und das Gerüst um einen Tag verschieben.
    expect(tagesSchluessel(new Date(2026, 8, 1, 23, 30))).toBe("2026-09-01");
  });
});

describe("regelGiltAnTag", () => {
  it("greift, wenn Dienst aktiv, im Regelplan und der Wochentag passt", () => {
    expect(regelGiltAnTag(dienst(), DIENSTAG)).toBe(true);
  });

  it("greift nicht ohne Regelplan — das ist der Bestandsschutz", () => {
    expect(regelGiltAnTag(dienst({ imRegelplan: false }), DIENSTAG)).toBe(false);
  });

  it("greift nicht bei stillgelegtem Dienst", () => {
    expect(regelGiltAnTag(dienst({ isActive: false }), DIENSTAG)).toBe(false);
  });

  it("achtet auf die Wochentage", () => {
    const werktags = dienst({ defaultWeekdays: [1, 2, 3, 4, 5] });
    expect(regelGiltAnTag(werktags, DIENSTAG)).toBe(true);
    expect(regelGiltAnTag(werktags, SAMSTAG)).toBe(false);
    expect(regelGiltAnTag(werktags, SONNTAG)).toBe(false);
  });

  it("beachtet drei feste Tage in der Woche", () => {
    const dreiTage = dienst({ defaultWeekdays: [1, 3, 5] });
    expect(regelGiltAnTag(dreiTage, new Date(2026, 8, 7))).toBe(true); // Montag
    expect(regelGiltAnTag(dreiTage, new Date(2026, 8, 8))).toBe(false); // Dienstag
    expect(regelGiltAnTag(dreiTage, new Date(2026, 8, 9))).toBe(true); // Mittwoch
  });

  it("greift erst ab validFrom, am Stichtag selbst schon", () => {
    const abMitte = dienst({ validFrom: "2026-09-15" });
    expect(regelGiltAnTag(abMitte, new Date(2026, 8, 14))).toBe(false);
    expect(regelGiltAnTag(abMitte, new Date(2026, 8, 15))).toBe(true);
    expect(regelGiltAnTag(abMitte, new Date(2026, 8, 16))).toBe(true);
  });

  it("gilt ohne validFrom seit jeher", () => {
    expect(regelGiltAnTag(dienst({ validFrom: null }), new Date(2020, 0, 1))).toBe(true);
  });
});

describe("offenePlaetzeFuerTag", () => {
  it("gibt einen Platz je Regeldienst zurück", () => {
    const plaetze = offenePlaetzeFuerTag([dienst()], DIENSTAG, []);
    expect(plaetze).toHaveLength(1);
    expect(plaetze[0]).toMatchObject({
      dienstId: 1,
      name: "24h Assistenz",
      startTime: "09:00",
      endTime: "09:00",
      standbySlot: true,
    });
  });

  it("bildet drei Achtstundendienste als drei Plätze ab", () => {
    const dienste = [
      dienst({ id: 1, name: "Frühdienst", defaultStartTime: "06:00", defaultEndTime: "14:00" }),
      dienst({ id: 2, name: "Spätdienst", defaultStartTime: "14:00", defaultEndTime: "22:00" }),
      dienst({ id: 3, name: "Nachtdienst", defaultStartTime: "22:00", defaultEndTime: "06:00" }),
    ];
    const plaetze = offenePlaetzeFuerTag(dienste, DIENSTAG, []);
    expect(plaetze.map((p) => p.name)).toEqual(["Frühdienst", "Spätdienst", "Nachtdienst"]);
  });

  it("lässt einen besetzten Platz weg", () => {
    const plaetze = offenePlaetzeFuerTag(
      [dienst({ id: 7 })],
      DIENSTAG,
      [{ shiftModelId: 7, startTime: "2026-09-01T09:00:00.000Z" }],
    );
    expect(plaetze).toHaveLength(0);
  });

  it("besetzt nur den Platz des eigenen Dienstes", () => {
    const dienste = [dienst({ id: 1, name: "Früh" }), dienst({ id: 2, name: "Spät" })];
    const plaetze = offenePlaetzeFuerTag(dienste, DIENSTAG, [
      { shiftModelId: 1, startTime: "2026-09-01T06:00:00.000Z" },
    ]);
    expect(plaetze.map((p) => p.name)).toEqual(["Spät"]);
  });

  it("lässt eine Schicht ohne Schichtmodell den Platz NICHT besetzen", () => {
    // Eine freihändig angelegte Schicht gehört zu keinem Regeldienst. Die
    // Lücke im Regelplan bleibt damit sichtbar — sie ist ja auch eine.
    const plaetze = offenePlaetzeFuerTag(
      [dienst({ id: 7 })],
      DIENSTAG,
      [{ shiftModelId: null, startTime: "2026-09-01T09:00:00.000Z" }],
    );
    expect(plaetze).toHaveLength(1);
  });

  it("gibt ohne Regelplan gar nichts zurück — Bestandsteams sehen nichts", () => {
    expect(offenePlaetzeFuerTag([dienst({ imRegelplan: false })], DIENSTAG, [])).toEqual([]);
  });

  it("behält die Reihenfolge der übergebenen Dienste bei", () => {
    const dienste = [
      dienst({ id: 3, name: "Nacht" }),
      dienst({ id: 1, name: "Früh" }),
      dienst({ id: 2, name: "Spät" }),
    ];
    expect(offenePlaetzeFuerTag(dienste, DIENSTAG, []).map((p) => p.name)).toEqual([
      "Nacht",
      "Früh",
      "Spät",
    ]);
  });
});

describe("schichtenNachTag", () => {
  it("gruppiert nach dem lokalen Starttag", () => {
    const map = schichtenNachTag([
      { shiftModelId: 1, startTime: new Date(2026, 8, 1, 9, 0) },
      { shiftModelId: 2, startTime: new Date(2026, 8, 1, 21, 0) },
      { shiftModelId: 1, startTime: new Date(2026, 8, 2, 9, 0) },
    ]);
    expect(map.get("2026-09-01")).toHaveLength(2);
    expect(map.get("2026-09-02")).toHaveLength(1);
    expect(map.get("2026-09-03")).toBeUndefined();
  });

  it("ordnet einen Dienst über Mitternacht seinem STARTTAG zu", () => {
    // Ein 24-Stunden-Dienst vom 1. 09:00 bis zum 2. 09:00 gehört in die Zelle
    // des 1. — sonst stünde er an zwei Tagen oder am falschen.
    const map = schichtenNachTag([{ shiftModelId: 1, startTime: new Date(2026, 8, 1, 9, 0) }]);
    expect([...map.keys()]).toEqual(["2026-09-01"]);
  });
});

describe("hatRegelplan", () => {
  it("erkennt, ob überhaupt ein Dienst teilnimmt", () => {
    expect(hatRegelplan([])).toBe(false);
    expect(hatRegelplan([dienst({ imRegelplan: false })])).toBe(false);
    expect(hatRegelplan([dienst({ isActive: false })])).toBe(false);
    expect(hatRegelplan([dienst({ imRegelplan: false }), dienst({ id: 2 })])).toBe(true);
  });
});
