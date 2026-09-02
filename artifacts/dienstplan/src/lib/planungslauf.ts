// ---------------------------------------------------------------------------
// Planungslauf — einen ganzen Monat besetzen, Dienst fuer Dienst
// ---------------------------------------------------------------------------
// Etappe 2, Kay-Auftrag 02.09.2026. Der Vorgaenger (lib/autoplanung.ts) konnte
// nur EINEN Dienst verteilen und zeigte erst eine Vorschau. Kay will beides
// anders: alle Regelplan-Dienste auf einmal, und direkt Entwuerfe statt eines
// Zwischenschritts — im Planungsmodus sieht man das Ergebnis ja im Raster und
// kann jede Pille einzeln weiterdrehen.
//
// Diese Datei ist reine Rechenlogik: kein React, keine API. Dieselbe Bauart
// wie dienstgeruest.ts, damit sie vollstaendig testbar bleibt.
//
// ── Was der Lauf NICHT anfasst ───────────────────────────────────────────────
// Die Teamsitzung (Kay-Entscheidung 02.09.2026): Sie gilt fuer ALLE
// Assistenzkraefte gleichzeitig und wird vom Planer einmal im Monat von Hand
// gesetzt. Ein Rotationsverfahren, das eine einzelne Person je Platz einteilt,
// passt darauf nicht. Der Lauf sieht sie gar nicht erst, weil sie nicht im
// Regelplan steht — und das ist Absicht, kein Zufall: `imRegelplan` steht bei
// ihr auf false, und der Aufrufer reicht nur Regelplan-Dienste herein.
//
// Ebenso unberuehrt bleiben bestehende Dienste und bestehende Vertretungen
// (Kays Antwort 2). Der Lauf fuellt ausschliesslich LUECKEN.
//
// ── Zwei Rotationen, nicht eine ──────────────────────────────────────────────
// Jeder Dienst hat seinen EIGENEN Rotationszeiger. Im Drei-Schicht-Modell
// heisst „drei Dienste am Stueck" naemlich: drei Fruehdienste hintereinander,
// dann wechselt die Person — nicht Frueh/Spaet/Nacht am selben Tag
// durchgereicht. Ein gemeinsamer Zeiger ueber alle Dienste wuerde genau das
// erzeugen und damit jede Ruhezeit sprengen.
// ---------------------------------------------------------------------------

export type PlanPerson = { id: number; name: string };

export type PlanDienst = {
  id: number;
  name: string;
  /** "HH:MM"; Ende gleich Start = 24-Stunden-Dienst, Ende davor = Tagesuebergang. */
  startTime: string;
  endTime: string;
  /** Sieht dieser Dienst eine vorgemerkte Vertretung vor? */
  standbySlot: boolean;
};

export type BestehendeSchicht = {
  userId: number;
  startTime: string | Date;
  endTime: string | Date;
};

/** Ein Platz, den der Lauf besetzt hat. */
export type Besetzung = {
  /** "YYYY-MM-DD" */
  datum: string;
  dienstId: number;
  dienstName: string;
  userId: number;
  userName: string;
  start: Date;
  ende: Date;
  /** Vorgemerkte Vertretung — null, wenn keine passt oder keine vorgesehen ist. */
  standbyUserId: number | null;
  standbyUserName: string | null;
};

/** Ein Platz, den niemand uebernehmen konnte. */
export type OffenGeblieben = {
  datum: string;
  dienstId: number;
  dienstName: string;
  /** Je Person der erste Hinderungsgrund — Grundlage der Erklaerung im Hinweis. */
  gruende: { userId: number; name: string; grund: Hinderungsgrund }[];
};

export type Hinderungsgrund = "abwesend" | "belegt" | "ruhezeit";

export type LaufErgebnis = {
  besetzungen: Besetzung[];
  offen: OffenGeblieben[];
};

export type LaufGrenzen = {
  /** Dienste am Stueck je Person und Dienst, mindestens 1. */
  blockLaenge: number;
  /** Mindestabstand zwischen zwei Diensten einer Person, in Stunden. */
  ruhezeitStunden: number;
};

/** Konkrete Zeiten eines Dienstes an einem Tag (Tagesuebergang inklusive). */
export function dienstZeiten(
  datum: string,
  dienst: Pick<PlanDienst, "startTime" | "endTime">,
): { start: Date; ende: Date } {
  const start = new Date(`${datum}T${dienst.startTime}:00`);
  const ende = new Date(`${datum}T${dienst.endTime}:00`);
  if (dienst.endTime <= dienst.startTime) ende.setDate(ende.getDate() + 1);
  return { start, ende };
}

type Intervall = { start: Date; ende: Date; tag: string };

function ueberlappt(a: { start: Date; ende: Date }, b: { start: Date; ende: Date }): boolean {
  return a.start < b.ende && b.start < a.ende;
}

/** "YYYY-MM-DD" des LOKALEN Starttags — das Raster denkt lokal, nicht UTC. */
function lokalerTag(d: Date): string {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

/**
 * Buchfuehrung ueber die Belegung jeder Person — bestehende Schichten plus
 * alles, was dieser Lauf selbst vergibt.
 */
class Belegungen {
  private readonly proPerson = new Map<number, Intervall[]>();

  constructor(personen: PlanPerson[], bestehende: BestehendeSchicht[]) {
    for (const p of personen) this.proPerson.set(p.id, []);
    for (const s of bestehende) {
      const liste = this.proPerson.get(s.userId);
      if (!liste) continue; // Schichten nicht gewaehlter Personen sind egal
      const start = s.startTime instanceof Date ? s.startTime : new Date(s.startTime);
      const ende = s.endTime instanceof Date ? s.endTime : new Date(s.endTime);
      liste.push({ start, ende, tag: lokalerTag(start) });
    }
  }

  eintragen(personId: number, intervall: Intervall): void {
    this.proPerson.get(personId)?.push(intervall);
  }

  /**
   * Erster Hinderungsgrund einer Person fuer diesen Platz; null = frei.
   *
   * `ohne` klammert genau EIN Intervall aus: den unmittelbar vorangegangenen
   * Dienst desselben Blocks. Wer laut Blocklaenge mehrere Dienste am Stueck
   * uebernimmt, tut das bewusst — der Block selbst ist die quittierte
   * Abweichung von der Ruhezeit (ArbZG § 7 laesst tarifliche Abweichungen zu;
   * die Verantwortung liegt beim Arbeitgeber, der Lauf erzwingt hier nichts).
   */
  hindernis(
    personId: number,
    datum: string,
    neu: { start: Date; ende: Date },
    ruhezeitMs: number,
    abwesend: Map<number, Set<string>>,
    ohne: Intervall | null = null,
  ): Hinderungsgrund | null {
    if (abwesend.get(personId)?.has(datum)) return "abwesend";
    for (const i of this.proPerson.get(personId) ?? []) {
      if (i === ohne) continue;
      if (i.tag === datum) return "belegt"; // hoechstens ein Dienst pro Tag
      if (ueberlappt(i, neu)) return "belegt";
      const abstand =
        i.ende <= neu.start
          ? neu.start.getTime() - i.ende.getTime()
          : i.start.getTime() - neu.ende.getTime();
      if (abstand < ruhezeitMs) return "ruhezeit";
    }
    return null;
  }
}

/** Rotationszustand EINES Dienstes: wer haelt gerade den Block, wie lang noch. */
type Rotation = {
  person: PlanPerson | null;
  rest: number;
  /** Der zuletzt vergebene Platz dieses Blocks — von der Ruhezeit ausgenommen. */
  vorheriges: Intervall | null;
  /** Bei wem beginnt der naechste Block. */
  naechsterStart: number;
};

/**
 * Besetzt die offenen Plaetze eines Monats.
 *
 * `offeneTageJeDienst` kommt aus dem Dienstgeruest (dienstgeruest.ts) und
 * enthaelt nur, was wirklich noch frei ist — bestehende Dienste sind dort
 * bereits herausgefallen. Der Lauf fuellt also ausschliesslich Luecken.
 */
export function planeMonat(eingabe: {
  dienste: PlanDienst[];
  /** Je Dienst-ID die noch offenen Tage ("YYYY-MM-DD"), aufsteigend sortiert. */
  offeneTageJeDienst: Map<number, string[]>;
  /** In Rotationsreihenfolge — die erste Person beginnt. */
  personen: PlanPerson[];
  grenzen: LaufGrenzen;
  /** ALLE bestehenden Arbeits-Schichten des Zeitraums. */
  bestehende: BestehendeSchicht[];
  /** Abwesenheitstage je Person ("YYYY-MM-DD"). */
  abwesend: Map<number, Set<string>>;
}): LaufErgebnis {
  const { dienste, offeneTageJeDienst, personen, bestehende, abwesend } = eingabe;
  const blockLaenge = Math.max(1, Math.floor(eingabe.grenzen.blockLaenge));
  const ruhezeitMs = Math.max(0, eingabe.grenzen.ruhezeitStunden) * 60 * 60 * 1000;

  const besetzungen: Besetzung[] = [];
  const offen: OffenGeblieben[] = [];

  if (personen.length === 0) {
    for (const dienst of dienste) {
      for (const datum of offeneTageJeDienst.get(dienst.id) ?? []) {
        offen.push({ datum, dienstId: dienst.id, dienstName: dienst.name, gruende: [] });
      }
    }
    return { besetzungen, offen };
  }

  const belegungen = new Belegungen(personen, bestehende);
  const rotationen = new Map<number, Rotation>(
    dienste.map((d) => [d.id, { person: null, rest: 0, vorheriges: null, naechsterStart: 0 }]),
  );

  // Tagweise, damit sich die Dienste eines Tages gegenseitig sehen: Wer den
  // Fruehdienst uebernommen hat, ist fuer den Spaetdienst desselben Tages
  // belegt. Ein Durchlauf Dienst-fuer-Dienst wuerde das erst zu spaet merken.
  const alleTage = [...new Set([...offeneTageJeDienst.values()].flat())].sort();

  for (const datum of alleTage) {
    for (const dienst of dienste) {
      if (!(offeneTageJeDienst.get(dienst.id) ?? []).includes(datum)) continue;

      const neu = dienstZeiten(datum, dienst);
      const rot = rotationen.get(dienst.id)!;
      const gruende: OffenGeblieben["gruende"] = [];
      let vergeben: PlanPerson | null = null;
      let eingetragen: Intervall | null = null;

      // 1. Laeuft ein Block? Dann hat dessen Person Vorrang.
      if (rot.person !== null && rot.rest > 0) {
        const grund = belegungen.hindernis(
          rot.person.id, datum, neu, ruhezeitMs, abwesend, rot.vorheriges,
        );
        if (grund === null) {
          eingetragen = { ...neu, tag: datum };
          belegungen.eintragen(rot.person.id, eingetragen);
          vergeben = rot.person;
          rot.rest -= 1;
          rot.vorheriges = eingetragen;
        } else {
          // Block reisst — der Platz geht regulaer in die Rotation.
          rot.person = null;
          rot.rest = 0;
          rot.vorheriges = null;
        }
      }

      // 2. Sonst reihum die naechste verfuegbare Person.
      if (vergeben === null) {
        rot.person = null;
        rot.rest = 0;
        rot.vorheriges = null;
        for (let versuch = 0; versuch < personen.length; versuch++) {
          const idx = (rot.naechsterStart + versuch) % personen.length;
          const p = personen[idx]!;
          const grund = belegungen.hindernis(p.id, datum, neu, ruhezeitMs, abwesend);
          if (grund !== null) {
            gruende.push({ userId: p.id, name: p.name, grund });
            continue;
          }
          eingetragen = { ...neu, tag: datum };
          belegungen.eintragen(p.id, eingetragen);
          vergeben = p;
          rot.person = p;
          rot.rest = blockLaenge - 1;
          rot.vorheriges = eingetragen;
          rot.naechsterStart = (idx + 1) % personen.length;
          break;
        }
      }

      if (vergeben === null) {
        // Kays Antwort 4: Geht es nicht auf, bleibt der Platz leer — der
        // Planer entscheidet, nicht der Automat.
        offen.push({ datum, dienstId: dienst.id, dienstName: dienst.name, gruende });
        continue;
      }

      // 3. Vertretung vormerken, falls der Dienst eine vorsieht.
      //    Kays Antwort 1: Wuerde die Vertretung die Ruhezeit verletzen,
      //    bleibt die Pille leer — eine Vormerkung, die nicht einspringen
      //    KANN, ist keine. Geprueft wird deshalb mit denselben Regeln wie
      //    fuer den Dienst selbst, nur ohne Block-Ausnahme: Die Vertretung
      //    steht ja ausserhalb jedes Blocks.
      let standby: PlanPerson | null = null;
      if (dienst.standbySlot) {
        for (let versuch = 0; versuch < personen.length; versuch++) {
          const idx = (rot.naechsterStart + versuch) % personen.length;
          const kandidat = personen[idx]!;
          if (kandidat.id === vergeben.id) continue;
          if (belegungen.hindernis(kandidat.id, datum, neu, ruhezeitMs, abwesend) !== null) continue;
          standby = kandidat;
          break;
        }
      }

      besetzungen.push({
        datum,
        dienstId: dienst.id,
        dienstName: dienst.name,
        userId: vergeben.id,
        userName: vergeben.name,
        start: neu.start,
        ende: neu.ende,
        standbyUserId: standby?.id ?? null,
        standbyUserName: standby?.name ?? null,
      });
    }
  }

  return { besetzungen, offen };
}

/** Stunden einer Besetzung (brutto, ohne Pausen/Wertung). */
export function besetzungsStunden(b: Pick<Besetzung, "start" | "ende">): number {
  return (b.ende.getTime() - b.start.getTime()) / (60 * 60 * 1000);
}
