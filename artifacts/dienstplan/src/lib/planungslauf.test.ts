import { describe, it, expect } from "vitest";
import {
  dienstZeiten,
  planeMonat,
  naechsteBesetzung,
  besetzungsStunden,
  offenErklaerung,
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

describe("naechsteBesetzung — Klick-Rotation", () => {
  const alle = [ANNA, BEN, CLARA];
  const immerFrei = () => true;

  it("startet bei einem leeren Platz mit der ersten Person", () => {
    expect(naechsteBesetzung({ aktuelleUserId: null, kandidaten: alle, istEinsatzfaehig: immerFrei }))
      .toEqual(ANNA);
  });

  it("schaltet der Reihe nach weiter", () => {
    expect(naechsteBesetzung({ aktuelleUserId: ANNA.id, kandidaten: alle, istEinsatzfaehig: immerFrei }))
      .toEqual(BEN);
    expect(naechsteBesetzung({ aktuelleUserId: BEN.id, kandidaten: alle, istEinsatzfaehig: immerFrei }))
      .toEqual(CLARA);
  });

  it("leert den Platz nach der letzten Person", () => {
    expect(naechsteBesetzung({ aktuelleUserId: CLARA.id, kandidaten: alle, istEinsatzfaehig: immerFrei }))
      .toBeNull();
  });

  it("ueberspringt, wer an dem Tag nicht kann", () => {
    // Ben ist abwesend -> von Anna aus geht es direkt zu Clara.
    const ohneBen = (id: number) => id !== BEN.id;
    expect(naechsteBesetzung({ aktuelleUserId: ANNA.id, kandidaten: alle, istEinsatzfaehig: ohneBen }))
      .toEqual(CLARA);
  });

  it("prueft die aktuelle Person NICHT gegen ihre eigene Belegung", () => {
    // Anna hat den Dienst, gilt deshalb als „belegt" — sie wuerde sich sonst
    // selbst blockieren und der Rundlauf bliebe stehen.
    const nurAnnaBelegt = (id: number) => id !== ANNA.id;
    expect(naechsteBesetzung({ aktuelleUserId: ANNA.id, kandidaten: alle, istEinsatzfaehig: nurAnnaBelegt }))
      .toEqual(BEN);
  });

  it("leert den Platz, wenn hinter der aktuellen Person niemand mehr kann", () => {
    const nurAnna = (id: number) => id === ANNA.id;
    expect(naechsteBesetzung({ aktuelleUserId: ANNA.id, kandidaten: alle, istEinsatzfaehig: nurAnna }))
      .toBeNull();
  });

  it("bei einer einzigen Person entsteht Kays Folge: waehlen, abwaehlen, waehlen", () => {
    const einer = [ANNA];
    expect(naechsteBesetzung({ aktuelleUserId: null, kandidaten: einer, istEinsatzfaehig: immerFrei }))
      .toEqual(ANNA);
    expect(naechsteBesetzung({ aktuelleUserId: ANNA.id, kandidaten: einer, istEinsatzfaehig: immerFrei }))
      .toBeNull();
  });

  it("liefert ohne Kandidaten nichts", () => {
    expect(naechsteBesetzung({ aktuelleUserId: null, kandidaten: [], istEinsatzfaehig: immerFrei }))
      .toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Kay-Fehlermeldungen 03.09.2026
// ---------------------------------------------------------------------------
// 1. Die automatische Planung liess Tage leer.
// 2. Aushilfen mit erfuelltem Monat bekamen weiter Dienste.
// 3. Abwesenheiten wurden nicht durchgaengig beachtet.
// Die folgenden Tests halten genau diese drei Faelle fest.

/** Ein Monat aus 24-Stunden-Diensten — Kays echter Fall. */
const OKT = (bis = 31) =>
  Array.from({ length: bis }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);

describe("Fehler 1 — kein Tag bleibt grundlos leer", () => {
  it("besetzt bei acht Personen jeden der 31 Tage", () => {
    const personen = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, name: `P${i + 1}` }));
    const { besetzungen, offen } = planeMonat({
      dienste: [{ ...TAG24, standbySlot: true }],
      offeneTageJeDienst: new Map([[TAG24.id, OKT()]]),
      personen,
      grenzen: { blockLaenge: 1, ruhezeitStunden: 11 },
      bestehende: [],
      abwesend: new Map(),
    });
    expect(offen).toEqual([]);
    expect(besetzungen).toHaveLength(31);
  });

  it("laesst auch mit Vertragsstunden keinen Tag offen, solange jemand Bedarf hat", () => {
    const personen = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, name: `P${i + 1}` }));
    // 8 Personen x 120 h = 960 h Bedarf; 31 Tage x 24 h = 744 h Angebot.
    const freieStunden = new Map(personen.map((p) => [p.id, 120]));
    const { besetzungen, offen } = planeMonat({
      dienste: [TAG24],
      offeneTageJeDienst: new Map([[TAG24.id, OKT()]]),
      personen,
      grenzen: { blockLaenge: 1, ruhezeitStunden: 11 },
      bestehende: [],
      abwesend: new Map(),
      freieStunden,
    });
    expect(offen).toEqual([]);
    expect(besetzungen).toHaveLength(31);
  });
});

describe("Fehler 2 — das Monats-Soll steuert die Verteilung", () => {
  it("gibt der Person mit dem groessten Bedarf den Dienst", () => {
    const { besetzungen } = planeMonat({
      dienste: [TAG24],
      offeneTageJeDienst: new Map([[TAG24.id, TAGE(1, 3)]]),
      personen: [ANNA, BEN, CLARA],
      grenzen: { blockLaenge: 1, ruhezeitStunden: 11 },
      bestehende: [],
      abwesend: new Map(),
      // Clara braucht am meisten, dann Ben, dann Anna.
      freieStunden: new Map([[ANNA.id, 24], [BEN.id, 48], [CLARA.id, 96]]),
    });
    expect(vornamenJeTag(besetzungen)).toEqual(["Clara", "Ben", "Clara"]);
  });

  it("ueberspringt, wer sein Soll erfuellt hat (Kays Aushilfen)", () => {
    const { besetzungen, offen } = planeMonat({
      dienste: [TAG24],
      offeneTageJeDienst: new Map([[TAG24.id, TAGE(1, 4)]]),
      personen: [ANNA, BEN, CLARA],
      grenzen: { blockLaenge: 1, ruhezeitStunden: 11 },
      bestehende: [],
      abwesend: new Map(),
      // Anna und Ben sind Aushilfen: Monat durch Absagen bereits erfuellt.
      freieStunden: new Map([[ANNA.id, 0], [BEN.id, -8], [CLARA.id, 96]]),
    });
    expect(besetzungen.every((b) => b.userId === CLARA.id)).toBe(true);
    // Clara bleibt als Einzige uebrig — und der 24-Stunden-Dienst endet
    // genau dann, wenn der naechste beginnt. Zwischen zwei Tagen liegt also
    // NULL Stunden Ruhezeit: Clara kann nur jeden zweiten Tag. Die anderen
    // beiden Tage bleiben offen, mit der Ruhezeit als Grund.
    expect(besetzungen.map((b) => b.datum)).toEqual(["2026-09-01", "2026-09-03"]);
    expect(offen.map((o) => o.datum)).toEqual(["2026-09-02", "2026-09-04"]);
    // Clara scheitert an der Ruhezeit, Anna und Ben am erfuellten Soll — die
    // Erklaerung nennt den haeufigsten Grund.
    expect(offen[0]!.gruende.find((g) => g.userId === CLARA.id)!.grund).toBe("ruhezeit");
    expect(offenErklaerung(offen)).toBe("Monats-Soll erreicht");
  });

  it("laesst den Platz offen, wenn niemand mehr Stunden braucht", () => {
    const { besetzungen, offen } = planeMonat({
      dienste: [TAG24],
      offeneTageJeDienst: new Map([[TAG24.id, TAGE(1, 2)]]),
      personen: [ANNA, BEN],
      grenzen: { blockLaenge: 1, ruhezeitStunden: 11 },
      bestehende: [],
      abwesend: new Map(),
      freieStunden: new Map([[ANNA.id, 0], [BEN.id, 0]]),
    });
    expect(besetzungen).toEqual([]);
    expect(offen).toHaveLength(2);
    expect(offen[0]!.gruende.every((g) => g.grund === "soll_erfuellt")).toBe(true);
    expect(offenErklaerung(offen)).toBe("Monats-Soll erreicht");
  });

  it("bleibt beim reinen Reihum, wenn niemand Vertragsstunden hat", () => {
    const { besetzungen } = planeMonat({
      dienste: [TAG24],
      offeneTageJeDienst: new Map([[TAG24.id, TAGE(1, 3)]]),
      personen: [ANNA, BEN, CLARA],
      grenzen: { blockLaenge: 1, ruhezeitStunden: 11 },
      bestehende: [],
      abwesend: new Map(),
      freieStunden: new Map(),
    });
    expect(vornamenJeTag(besetzungen)).toEqual(["Anna", "Ben", "Clara"]);
  });

  it("laesst Personen ohne Vertragsstunden aussen vor, sobald andere welche haben", () => {
    const { besetzungen, offen } = planeMonat({
      dienste: [TAG24],
      offeneTageJeDienst: new Map([[TAG24.id, TAGE(1, 2)]]),
      personen: [ANNA, BEN],
      grenzen: { blockLaenge: 1, ruhezeitStunden: 11 },
      bestehende: [],
      abwesend: new Map(),
      freieStunden: new Map([[BEN.id, 48]]),
    });
    expect(besetzungen.every((b) => b.userId === BEN.id)).toBe(true);
    // Anna springt nicht ein, obwohl sie koennte: Ohne hinterlegte
    // Vertragsstunden ist ihr Bedarf unbekannt, und den Vertragsleuten
    // Stunden wegzunehmen waere falsch. Der zweite Tag bleibt lieber offen.
    expect(besetzungen).toHaveLength(1);
    expect(offen).toHaveLength(1);
    expect(offen[0]!.gruende.some((g) => g.grund === "keine_vertragsstunden")).toBe(true);
  });

  it("haelt einen laufenden Block an, sobald das Soll erreicht ist", () => {
    const { besetzungen, offen } = planeMonat({
      dienste: [TAG24],
      offeneTageJeDienst: new Map([[TAG24.id, TAGE(1, 4)]]),
      personen: [ANNA, BEN],
      grenzen: { blockLaenge: 3, ruhezeitStunden: 11 },
      bestehende: [],
      abwesend: new Map(),
      // Anna reicht fuer genau zwei Dienste, obwohl der Block drei vorsieht.
      freieStunden: new Map([[ANNA.id, 30], [BEN.id, 10]]),
    });
    // Tag 3 gehoerte noch zu Annas Block — ihr Soll ist aber aufgebraucht,
    // also reisst der Block und Ben rueckt nach. Tag 4 braucht niemand mehr.
    expect(vornamenJeTag(besetzungen)).toEqual(["Anna", "Anna", "Ben"]);
    expect(offen.map((o) => o.datum)).toEqual(["2026-09-04"]);
  });
});

describe("Fehler 3 — Abwesenheiten sperren auch hineinragende Dienste", () => {
  it("laesst keinen 24-Stunden-Dienst in den Urlaubstag hineinlaufen", () => {
    // Urlaub am 2.9. ganztaegig; der Dienst am 1.9. laeuft bis 2.9. 09:00.
    const sperrzeiten = new Map([
      [ANNA.id, [{ start: new Date(2026, 8, 2, 0, 0), ende: new Date(2026, 8, 2, 23, 59) }]],
    ]);
    const { besetzungen } = planeMonat({
      dienste: [TAG24],
      offeneTageJeDienst: new Map([[TAG24.id, TAGE(1, 1)]]),
      personen: [ANNA, BEN],
      grenzen: { blockLaenge: 1, ruhezeitStunden: 11 },
      bestehende: [],
      abwesend: new Map([[ANNA.id, new Set(["2026-09-02"])]]),
      sperrzeiten,
    });
    expect(vornamenJeTag(besetzungen)).toEqual(["Ben"]);
  });

  it("nennt Abwesenheit als Grund, wenn deshalb niemand kann", () => {
    const { offen } = planeMonat({
      dienste: [TAG24],
      offeneTageJeDienst: new Map([[TAG24.id, TAGE(1, 1)]]),
      personen: [ANNA, BEN],
      grenzen: { blockLaenge: 1, ruhezeitStunden: 11 },
      bestehende: [],
      abwesend: new Map([
        [ANNA.id, new Set(["2026-09-01"])],
        [BEN.id, new Set(["2026-09-01"])],
      ]),
    });
    expect(offen).toHaveLength(1);
    expect(offenErklaerung(offen)).toBe("abwesend");
  });
});

describe("Vertretung — jeder Platz wird besetzt, verteilt nach Regel", () => {
  const MIT_VERTRETUNG: PlanDienst = { ...TAG24, standbySlot: true };

  it("laesst keinen Vertretungsplatz leer, solange jemand kann", () => {
    const personen = [ANNA, BEN, CLARA, DORA];
    const { besetzungen } = planeMonat({
      dienste: [MIT_VERTRETUNG],
      offeneTageJeDienst: new Map([[MIT_VERTRETUNG.id, TAGE(1, 12)]]),
      personen,
      grenzen: { blockLaenge: 1, ruhezeitStunden: 11 },
      bestehende: [],
      abwesend: new Map(),
      // Alle laengst ueber dem Soll — die Vertretung haengt trotzdem nicht
      // daran (Kay-Entscheidung 03.09.2026).
      freieStunden: new Map(personen.map((p) => [p.id, 0])),
      monatsSollStunden: new Map(personen.map((p) => [p.id, 80])),
    });
    expect(besetzungen.every((b) => b.standbyUserId != null)).toBe(true);
  });

  it("gibt jeder Person erst eine Vertretung, bevor jemand die zweite bekommt", () => {
    const personen = [ANNA, BEN, CLARA, DORA];
    const { besetzungen } = planeMonat({
      dienste: [MIT_VERTRETUNG],
      offeneTageJeDienst: new Map([[MIT_VERTRETUNG.id, TAGE(1, 4)]]),
      personen,
      grenzen: { blockLaenge: 1, ruhezeitStunden: 11 },
      bestehende: [],
      abwesend: new Map(),
      monatsSollStunden: new Map(personen.map((p) => [p.id, 80])),
    });
    const vorgemerkt = besetzungen.map((b) => b.standbyUserId);
    expect(new Set(vorgemerkt).size, "vier Plaetze, vier verschiedene Personen").toBe(4);
  });

  it("gibt die zweite Vertretung zuerst der Teilzeitkraft", () => {
    // Anna arbeitet, Ben und Clara sind mit je einer Vormerkung dran gewesen.
    // Ben ist Teilzeit (80 h), Clara Vollzeit (180 h) — Ben kommt zuerst.
    const personen = [ANNA, BEN, CLARA];
    const { besetzungen } = planeMonat({
      dienste: [MIT_VERTRETUNG],
      offeneTageJeDienst: new Map([[MIT_VERTRETUNG.id, TAGE(1, 6)]]),
      personen,
      grenzen: { blockLaenge: 1, ruhezeitStunden: 11 },
      bestehende: [],
      abwesend: new Map(),
      monatsSollStunden: new Map([
        [ANNA.id, 180],
        [BEN.id, 80],
        [CLARA.id, 180],
      ]),
    });
    const proPerson = new Map<number, number>();
    for (const b of besetzungen) {
      if (b.standbyUserId == null) continue;
      proPerson.set(b.standbyUserId, (proPerson.get(b.standbyUserId) ?? 0) + 1);
    }
    // Sechs Plaetze auf drei Personen: Die Teilzeitkraft traegt am meisten.
    expect(proPerson.get(BEN.id)!).toBeGreaterThanOrEqual(proPerson.get(ANNA.id) ?? 0);
    expect(proPerson.get(BEN.id)!).toBeGreaterThanOrEqual(proPerson.get(CLARA.id) ?? 0);
  });

  it("ueberspringt, wer an dem Tag abwesend ist", () => {
    const { besetzungen } = planeMonat({
      dienste: [MIT_VERTRETUNG],
      offeneTageJeDienst: new Map([[MIT_VERTRETUNG.id, TAGE(1, 1)]]),
      personen: [ANNA, BEN, CLARA],
      grenzen: { blockLaenge: 1, ruhezeitStunden: 11 },
      bestehende: [],
      abwesend: new Map([[BEN.id, new Set(["2026-09-01"])]]),
      monatsSollStunden: new Map([[ANNA.id, 180], [BEN.id, 80], [CLARA.id, 180]]),
    });
    expect(besetzungen[0]!.userName).toBe("Anna Muster");
    expect(besetzungen[0]!.standbyUserName, "Ben ist abwesend").toBe("Clara Test");
  });

  it("laesst die Vormerkung leer, wenn niemand sonst kann", () => {
    const { besetzungen } = planeMonat({
      dienste: [MIT_VERTRETUNG],
      offeneTageJeDienst: new Map([[MIT_VERTRETUNG.id, TAGE(1, 1)]]),
      personen: [ANNA, BEN],
      grenzen: { blockLaenge: 1, ruhezeitStunden: 11 },
      bestehende: [],
      abwesend: new Map([[BEN.id, new Set(["2026-09-01"])]]),
    });
    expect(besetzungen[0]!.standbyUserId).toBeNull();
  });
});

describe("Kays Monat vom 03.09.2026 — sieben Personen, 24-Stunden-Dienst", () => {
  const LEUTE = [
    { id: 1, name: "Neubert", soll: 191.36 },
    { id: 2, name: "Kennedy", soll: 23.92 },
    { id: 3, name: "Kahraman", soll: 167.44 },
    { id: 4, name: "Thierer", soll: 119.6 },
    { id: 5, name: "Reller", soll: 119.6 },
    { id: 6, name: "Appler", soll: 119.6 },
    { id: 7, name: "Emmendoerfer", soll: 23.92 },
  ];
  const OKTOBER = Array.from(
    { length: 31 },
    (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`,
  );

  function kaysLauf() {
    return planeMonat({
      dienste: [{ id: 1, name: "24-Stunden-Assistenz", startTime: "09:00", endTime: "09:00", standbySlot: true }],
      offeneTageJeDienst: new Map([[1, OKTOBER]]),
      personen: LEUTE.map((p) => ({ id: p.id, name: p.name })),
      grenzen: { blockLaenge: 1, ruhezeitStunden: 11 },
      bestehende: [],
      abwesend: new Map(),
      freieStunden: new Map(LEUTE.map((p) => [p.id, p.soll])),
      monatsSollStunden: new Map(LEUTE.map((p) => [p.id, p.soll])),
    });
  }

  it("besetzt alle 31 Tage und laesst niemanden leer ausgehen", () => {
    const { besetzungen, offen } = kaysLauf();
    expect(offen).toEqual([]);
    expect(besetzungen).toHaveLength(31);
    const stunden = new Map<string, number>();
    for (const b of besetzungen) {
      stunden.set(b.userName, (stunden.get(b.userName) ?? 0) + besetzungsStunden(b));
    }
    for (const p of LEUTE) {
      const h = stunden.get(p.name) ?? 0;
      expect(h, `${p.name} bekam ${h} h bei ${p.soll} h Soll`).toBeGreaterThan(0);
      // Kays Vorgabe: hoechstens eine Schicht ueber dem Soll.
      expect(h, `${p.name}: ${h} h bei ${p.soll} h Soll`).toBeLessThanOrEqual(p.soll + 24);
    }
  });

  it("besetzt jeden Vertretungsplatz und beteiligt alle sieben", () => {
    const { besetzungen } = kaysLauf();
    expect(besetzungen.every((b) => b.standbyUserId != null)).toBe(true);
    const proPerson = new Map<number, number>();
    for (const b of besetzungen) {
      proPerson.set(b.standbyUserId!, (proPerson.get(b.standbyUserId!) ?? 0) + 1);
    }
    expect(proPerson.size, "jede der sieben Personen ist mindestens einmal dran").toBe(
      LEUTE.length,
    );
  });
});
