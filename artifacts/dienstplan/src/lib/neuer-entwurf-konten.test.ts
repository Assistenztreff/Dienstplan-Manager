import { describe, it, expect } from "vitest";
import { berechneStundenkontoEintraege } from "@/components/stundenkonto-leiste";
import { planeMonat, type PlanDienst, type PlanPerson } from "./planungslauf";

/**
 * Kays Fehlermeldung 05.09.2026: „Nach jedem zweiten Entwurf bekommt Camillo
 * Neubert keine Stunden und Timo/Oliver Dienste weit ueber ihrem Soll."
 *
 * Der zweite Lauf raeumt erst die Entwuerfe des ersten ab und plant dann neu.
 * Rechnet er die freien Stunden dabei aus dem Stand VOR dem Abraeumen, sind
 * alle Konten scheinbar voll — dann greift nur noch der Ersatzweg (Teilzeit,
 * dann Vollzeit, dann Aushilfen ohne Vertrag) und die Vollzeitkraft ganz
 * hinten geht leer aus. Dieser Test bildet die ganze Kette nach.
 */

const TAG24: PlanDienst = {
  id: 1,
  name: "24h Assistenz",
  startTime: "09:00",
  endTime: "09:00",
  standbySlot: false,
};

/** Oktober 2026 hat 31 Tage. */
const TAGE = Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);

const NEUBERT: PlanPerson = { id: 1, name: "Camillo Neubert" };
const KAHRAMAN: PlanPerson = { id: 2, name: "Tolga Kahraman" };
const THIERER: PlanPerson = { id: 3, name: "Fiona Thierer" };
const APPLER: PlanPerson = { id: 4, name: "Rita Appler" };
const RELLER: PlanPerson = { id: 5, name: "Tom Reller" };
const TIMO: PlanPerson = { id: 6, name: "Timo Aushilf" };
const OLIVER: PlanPerson = { id: 7, name: "Oliver Aushilf" };

const PERSONEN = [NEUBERT, KAHRAMAN, THIERER, APPLER, RELLER, TIMO, OLIVER];

/** Vertragsstunden wie in Kays Oktober; Timo und Oliver sind Aushilfen. */
const BILANZEN = [
  { userId: NEUBERT.id, contractMonthlyTargetHours: 191.36 },
  { userId: KAHRAMAN.id, contractMonthlyTargetHours: 167.44 },
  { userId: THIERER.id, contractMonthlyTargetHours: 119.6 },
  { userId: APPLER.id, contractMonthlyTargetHours: 119.6 },
  { userId: RELLER.id, contractMonthlyTargetHours: 119.6 },
] as unknown as Parameters<typeof berechneStundenkontoEintraege>[2];

type Schicht = {
  userId: number;
  type: string;
  planningStatus: string;
  startTime: string;
  endTime: string;
};

function lauf(bestand: Schicht[]) {
  const konten = berechneStundenkontoEintraege(PERSONEN, bestand, BILANZEN);
  const freieStunden = new Map<number, number>();
  const monatsSollStunden = new Map<number, number>();
  for (const e of konten) {
    if (!e.hasContract) continue;
    freieStunden.set(e.id, e.frei);
    monatsSollStunden.set(e.id, e.contractTarget);
  }
  return planeMonat({
    dienste: [TAG24],
    offeneTageJeDienst: new Map([[TAG24.id, TAGE]]),
    personen: PERSONEN,
    grenzen: { blockLaenge: 1, ruhezeitStunden: 11 },
    bestehende: bestand.map((s) => ({
      userId: s.userId,
      startTime: s.startTime,
      endTime: s.endTime,
    })),
    abwesend: new Map(),
    freieStunden,
    monatsSollStunden,
  });
}

/** Aus den Besetzungen des Laufs werden die Entwuerfe im Raster. */
function alsEntwuerfe(besetzungen: { userId: number; start: Date; ende: Date }[]): Schicht[] {
  return besetzungen.map((b) => ({
    userId: b.userId,
    type: "work",
    planningStatus: "VORLAEUFIG",
    startTime: b.start.toISOString(),
    endTime: b.ende.toISOString(),
  }));
}

function stundenJePerson(bestand: Schicht[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const s of bestand) {
    const h = (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 3_600_000;
    map.set(s.userId, (map.get(s.userId) ?? 0) + h);
  }
  return map;
}

describe("Neuer Entwurf — Konten nach dem Abraeumen", () => {
  it("verteilt nach dem Soll und laesst Aushilfen aussen vor", () => {
    const stunden = stundenJePerson(alsEntwuerfe(lauf([]).besetzungen));

    // Wer das groesste Soll hat, bekommt auch die meisten Stunden.
    expect(stunden.get(NEUBERT.id)).toBe(192);
    expect(stunden.get(KAHRAMAN.id)).toBe(168);
    // Niemand kommt weit ueber sein Soll.
    expect(stunden.get(APPLER.id)).toBeLessThanOrEqual(144);
    expect(stunden.get(RELLER.id)).toBeLessThanOrEqual(144);
    // Aushilfen ohne Vertrag sind der letzte Ausweg, hier nicht noetig.
    expect(stunden.get(TIMO.id) ?? 0).toBe(0);
    expect(stunden.get(OLIVER.id) ?? 0).toBe(0);
  });

  it("meldet nach dem Abraeumen wieder das volle Konto als frei", () => {
    const entwuerfe = alsEntwuerfe(lauf([]).besetzungen);
    const mitEntwuerfen = berechneStundenkontoEintraege(PERSONEN, entwuerfe, BILANZEN);
    expect(mitEntwuerfen.find((e) => e.id === NEUBERT.id)!.frei).toBeLessThan(1);

    const abgeraeumt = berechneStundenkontoEintraege(PERSONEN, [], BILANZEN);
    expect(abgeraeumt.find((e) => e.id === NEUBERT.id)!.frei).toBeCloseTo(191.36, 2);
  });

  it("erzeugt mit dem Stand von VOR dem Abraeumen genau Kays Fehlerbild", () => {
    // Gegenprobe: Konten aus den alten Entwuerfen, geplant auf dem leeren
    // Raster. So lief der zweite Entwurf, bevor starteAutomatik die Konten
    // selbst ausrechnete.
    const alteEntwuerfe = alsEntwuerfe(lauf([]).besetzungen);
    const alteKonten = berechneStundenkontoEintraege(PERSONEN, alteEntwuerfe, BILANZEN);
    const freieStunden = new Map<number, number>();
    const monatsSollStunden = new Map<number, number>();
    for (const e of alteKonten) {
      if (!e.hasContract) continue;
      freieStunden.set(e.id, e.frei);
      monatsSollStunden.set(e.id, e.contractTarget);
    }
    const kaputt = planeMonat({
      dienste: [TAG24],
      offeneTageJeDienst: new Map([[TAG24.id, TAGE]]),
      personen: PERSONEN,
      grenzen: { blockLaenge: 1, ruhezeitStunden: 11 },
      bestehende: [],
      abwesend: new Map(),
      freieStunden,
      monatsSollStunden,
    });
    const stunden = stundenJePerson(alsEntwuerfe(kaputt.besetzungen));

    // Kays Screenshot vom 05.09.2026: Neubert 0 h, andere weit ueber Soll.
    expect(stunden.get(NEUBERT.id) ?? 0).toBe(0);
    expect(stunden.get(APPLER.id) ?? 0).toBeGreaterThan(144);
  });
});
