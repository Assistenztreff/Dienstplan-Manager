import { describe, it, expect } from "vitest";
import {
  dienstZeiten,
  planeMonat,
  besetzungsStunden,
  type PlanDienst,
  type PlanPerson,
} from "./planungslauf";

const FRUEH: PlanDienst = { id: 1, name: "Frühdienst", startTime: "06:00", endTime: "14:00", standbySlot: false };
const SPAET: PlanDienst = { id: 2, name: "Spätdienst", startTime: "14:00", endTime: "22:00", standbySlot: false };
const NACHT: PlanDienst = { id: 3, name: "Nachtdienst", startTime: "22:00", endTime: "06:00", standbySlot: false };
const TAG24: PlanDienst = { id: 4, name: "24h Assistenz", startTime: "09:00", endTime: "09:00", standbySlot: false };

const ANNA: PlanPerson = { id: 10, name: "Anna Muster" };
const BEN: PlanPerson = { id: 11, name: "Ben Beispiel" };
const CLARA: PlanPerson = { id: 12, name: "Clara Test" };
const DORA: PlanPerson = { id: 13, name: "Dora Vier" };

/** September 2026: der 1. ist ein Dienstag. */
const TAGE = (von: number, bis: number) =>
  Array.from({ length: bis - von + 1 }, (_, i) => `2026-09-${String(von + i).padStart(2, "0")}`);

function lauf(over: Partial<Parameters<typeof planeMonat>[0]> = {}) {
  const dienste = over.dienste ?? [TAG24];
  return planeMonat({
    dienste,
    offeneTageJeDienst:
      over.offeneTageJeDienst ?? new Map(dienste.map((d) => [d.id, TAGE(1, 6)])),
    personen: over.personen ?? [ANNA, BEN, CLARA],
    grenzen: over.grenzen ?? { blockLaenge: 1, ruhezeitStunden: 11 },
    bestehende: over.bestehende ?? [],
    abwesend: over.abwesend ?? new Map(),
  });
}

/** Kurzform „Vorname je Tag" für lesbare Erwartungen. */
function vornamenJeTag(besetzungen: { datum: string; userName: string }[]): string[] {
  return besetzungen.map((b) => b.userName.split(" ")[0]!);
}

describe("dienstZeiten", () => {
  it("legt bei Ende gleich Start den 24-Stunden-Dienst auf den Folgetag", () => {
    const { start, ende } = dienstZeiten("2026-09-01", TAG24);
    expect(start).toEqual(new Date(2026, 8, 1, 9, 0));
    expect(ende).toEqual(new Date(2026, 8, 2, 9, 0));
    expect(besetzungsStunden({ start, ende })).toBe(24);
  });

  it("legt bei Ende vor Start den Tagesuebergang an", () => {
    expect(dienstZeiten("2026-09-01", NACHT).ende).toEqual(new Date(2026, 8, 2, 6, 0));
  });
});

describe("planeMonat — ein Dienst", () => {
  it("wechselt bei Blocklaenge 1 jeden Tag die Person", () => {
    const { besetzungen, offen } = lauf();
    expect(offen).toEqual([]);
    expect(vornamenJeTag(besetzungen)).toEqual(["Anna", "Ben", "Clara", "Anna", "Ben", "Clara"]);
  });

  it("gibt bei Blocklaenge 2 jeder Person zwei Dienste am Stueck", () => {
    const { besetzungen } = lauf({ grenzen: { blockLaenge: 2, ruhezeitStunden: 11 } });
    expect(vornamenJeTag(besetzungen)).toEqual(["Anna", "Anna", "Ben", "Ben", "Clara", "Clara"]);
  });

  it("laesst die Ruhezeit INNERHALB eines Blocks bewusst zu", () => {
    // Zwei 24h-Dienste am Stueck haben 0 h Abstand — genau das ist der Block.
    const { besetzungen, offen } = lauf({
      grenzen: { blockLaenge: 2, ruhezeitStunden: 11 },
      personen: [ANNA, BEN],
    });
    expect(offen).toEqual([]);
    expect(besetzungen).toHaveLength(6);
  });
});

describe("planeMonat — mehrere Dienste (Drei-Schicht)", () => {
  it("besetzt alle drei Dienste jedes Tages mit verschiedenen Personen", () => {
    const { besetzungen, offen } = lauf({
      dienste: [FRUEH, SPAET, NACHT],
      personen: [ANNA, BEN, CLARA, DORA],
      offeneTageJeDienst: new Map([
        [FRUEH.id, TAGE(1, 2)],
        [SPAET.id, TAGE(1, 2)],
        [NACHT.id, TAGE(1, 2)],
      ]),
    });
    expect(offen).toEqual([]);
    expect(besetzungen).toHaveLength(6);
    // Innerhalb eines Tages darf niemand zweimal vorkommen.
    for (const tag of TAGE(1, 2)) {
      const desTages = besetzungen.filter((b) => b.datum === tag).map((b) => b.userId);
      expect(new Set(desTages).size, `${tag}: Person doppelt eingeteilt`).toBe(desTages.length);
    }
  });

  it("haelt je Dienst eine EIGENE Rotation — drei Fruehdienste am Stueck, nicht Frueh/Spaet/Nacht", () => {
    const { besetzungen } = lauf({
      dienste: [FRUEH, SPAET],
      personen: [ANNA, BEN, CLARA, DORA],
      grenzen: { blockLaenge: 3, ruhezeitStunden: 11 },
      offeneTageJeDienst: new Map([
        [FRUEH.id, TAGE(1, 3)],
        [SPAET.id, TAGE(1, 3)],
      ]),
    });
    const frueh = besetzungen.filter((b) => b.dienstId === FRUEH.id);
    const spaet = besetzungen.filter((b) => b.dienstId === SPAET.id);
    // Eine Person haelt ihren Fruehdienst-Block ueber alle drei Tage.
    expect(new Set(frueh.map((b) => b.userId)).size).toBe(1);
    expect(new Set(spaet.map((b) => b.userId)).size).toBe(1);
    // Und es sind zwei verschiedene Personen.
    expect(frueh[0]!.userId).not.toBe(spaet[0]!.userId);
  });

  it("laesst einen Platz offen, wenn die Ruhezeit niemanden mehr zulaesst", () => {
    // Nur zwei Personen auf drei Schichten am selben Tag: der dritte Platz
    // findet niemanden mehr, der nicht schon arbeitet.
    const { besetzungen, offen } = lauf({
      dienste: [FRUEH, SPAET, NACHT],
      personen: [ANNA, BEN],
      offeneTageJeDienst: new Map([
        [FRUEH.id, TAGE(1, 1)],
        [SPAET.id, TAGE(1, 1)],
        [NACHT.id, TAGE(1, 1)],
      ]),
    });
    expect(besetzungen).toHaveLength(2);
    expect(offen).toHaveLength(1);
    expect(offen[0]!.dienstName).toBe("Nachtdienst");
    expect(offen[0]!.gruende.map((g) => g.grund)).toEqual(["belegt", "belegt"]);
  });
});

describe("planeMonat — Hindernisse", () => {
  it("ueberspringt eine abwesende Person", () => {
    const abwesend = new Map([[BEN.id, new Set(["2026-09-02"])]]);
    const { besetzungen } = lauf({ abwesend });
    expect(vornamenJeTag(besetzungen)).toEqual(["Anna", "Clara", "Anna", "Ben", "Clara", "Anna"]);
  });

  it("wertet einen bestehenden Dienst am selben Tag als belegt", () => {
    const bestehende = [
      { userId: BEN.id, startTime: "2026-09-02T18:00:00", endTime: "2026-09-02T20:00:00" },
    ];
    const { besetzungen } = lauf({ bestehende });
    expect(besetzungen.find((b) => b.datum === "2026-09-02")!.userId).toBe(CLARA.id);
  });

  it("haelt die Ruhezeit gegen bestehende Dienste ein", () => {
    // Anna arbeitet am 31.08. bis 23:00 — ein Fruehdienst am 1.9. um 06:00
    // haette nur 7 h Abstand und faellt bei 11 h Ruhezeit an Ben.
    const bestehende = [
      { userId: ANNA.id, startTime: "2026-08-31T15:00:00", endTime: "2026-08-31T23:00:00" },
    ];
    const { besetzungen } = lauf({
      dienste: [FRUEH],
      offeneTageJeDienst: new Map([[FRUEH.id, TAGE(1, 2)]]),
      bestehende,
    });
    expect(besetzungen.map((b) => b.userId)).toEqual([BEN.id, CLARA.id]);
  });

  it("meldet einen Tag als offen, wenn niemand kann — mit Gruenden je Person", () => {
    const abwesend = new Map([
      [ANNA.id, new Set(["2026-09-01"])],
      [BEN.id, new Set(["2026-09-01"])],
      [CLARA.id, new Set(["2026-09-01"])],
    ]);
    const { besetzungen, offen } = lauf({
      offeneTageJeDienst: new Map([[TAG24.id, TAGE(1, 1)]]),
      abwesend,
    });
    expect(besetzungen).toEqual([]);
    expect(offen).toHaveLength(1);
    expect(offen[0]!.gruende.map((g) => g.grund)).toEqual(["abwesend", "abwesend", "abwesend"]);
  });

  it("liefert ohne Personen alle Plaetze als offen", () => {
    const { besetzungen, offen } = lauf({ personen: [] });
    expect(besetzungen).toEqual([]);
    expect(offen).toHaveLength(6);
  });
});

describe("planeMonat — Vertretung vormerken", () => {
  const MIT_VERTRETUNG: PlanDienst = { ...TAG24, standbySlot: true };

  it("merkt eine zweite Person vor, wenn der Dienst eine Vertretung vorsieht", () => {
    const { besetzungen } = lauf({
      dienste: [MIT_VERTRETUNG],
      offeneTageJeDienst: new Map([[MIT_VERTRETUNG.id, TAGE(1, 1)]]),
    });
    expect(besetzungen).toHaveLength(1);
    const b = besetzungen[0]!;
    expect(b.standbyUserId, "Es gibt freie Personen — eine muss vorgemerkt sein").not.toBeNull();
    expect(b.standbyUserId, "Die Vertretung darf nicht die Person selbst sein").not.toBe(b.userId);
  });

  it("laesst die Vertretung leer, wenn keiner die Ruhezeit einhaelt", () => {
    // Zwei Personen, drei Schichten: Ben hat den Spaetdienst, Anna den Frueh —
    // fuer die Nacht-Vertretung bleibt niemand, der nicht schon arbeitet.
    const nachtMitVertretung: PlanDienst = { ...NACHT, standbySlot: true };
    const { besetzungen } = lauf({
      dienste: [FRUEH, nachtMitVertretung],
      personen: [ANNA, BEN],
      offeneTageJeDienst: new Map([
        [FRUEH.id, TAGE(1, 1)],
        [nachtMitVertretung.id, TAGE(1, 1)],
      ]),
    });
    const nacht = besetzungen.find((b) => b.dienstId === NACHT.id)!;
    expect(nacht.standbyUserId, "Wer nicht einspringen KANN, ist keine Vertretung").toBeNull();
  });

  it("merkt gar nichts vor, wenn der Dienst keine Vertretung vorsieht", () => {
    const { besetzungen } = lauf({
      offeneTageJeDienst: new Map([[TAG24.id, TAGE(1, 1)]]),
    });
    expect(besetzungen[0]!.standbyUserId).toBeNull();
    expect(besetzungen[0]!.standbyUserName).toBeNull();
  });
});

describe("planeMonat — was der Lauf nicht anfasst", () => {
  it("fuellt nur die uebergebenen offenen Tage, nie einen besetzten", () => {
    // Der 3. fehlt in der Liste der offenen Tage — er ist bereits besetzt.
    const offeneTage = ["2026-09-01", "2026-09-02", "2026-09-04"];
    const { besetzungen } = lauf({
      offeneTageJeDienst: new Map([[TAG24.id, offeneTage]]),
    });
    expect(besetzungen.map((b) => b.datum)).toEqual(offeneTage);
  });

  it("sieht einen Dienst gar nicht, der nicht uebergeben wurde (z. B. die Teamsitzung)", () => {
    // Die Teamsitzung steht nicht im Regelplan und erreicht den Lauf deshalb
    // nie — Kay-Entscheidung 02.09.2026: sie gilt fuer alle und wird von Hand
    // gesetzt, ein Rotationsverfahren passt darauf nicht.
    const teamsitzung: PlanDienst = {
      id: 99, name: "Teamsitzung", startTime: "15:00", endTime: "16:00", standbySlot: false,
    };
    const { besetzungen } = lauf({
      dienste: [TAG24], // Teamsitzung bewusst NICHT dabei
      offeneTageJeDienst: new Map([
        [TAG24.id, TAGE(1, 2)],
        [teamsitzung.id, TAGE(1, 2)], // selbst wenn Tage dafuer da waeren
      ]),
    });
    expect(besetzungen.every((b) => b.dienstId === TAG24.id)).toBe(true);
    expect(besetzungen).toHaveLength(2);
  });
});
