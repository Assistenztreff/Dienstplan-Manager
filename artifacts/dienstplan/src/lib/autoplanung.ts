// ---------------------------------------------------------------------------
// Automatische Planung — Rotation BERECHNEN, Anlegen entscheidet der Mensch
// ---------------------------------------------------------------------------
// Kay-Entscheidung 01.09.2026 (Baustein 3). Der Planungs-Assistent verteilt
// die offenen Plaetze EINES Regelplan-Dienstes reihum auf die gewaehlten
// Personen. Diese Datei ist die reine Rechenlogik: kein React, keine API —
// dieselbe Bauart wie dienstgeruest.ts, damit sie vollstaendig testbar ist.
// Ergebnis ist immer nur ein VORSCHLAG; angelegt wird erst, wenn der Mensch
// die Vorschau bestaetigt (und dann als ENTWURF, nie als FIX).
//
// Drei Regeln, in dieser Reihenfolge geprueft:
//  1. Abwesenheit — wer an dem Tag abwesend ist, bekommt keinen Dienst.
//  2. Ein Dienst pro Tag — wer an dem Tag schon irgendetwas hat, ebenso.
//  3. Ruhezeit — zwischen zwei Diensten einer Person liegen mindestens
//     `ruhezeitStunden` Stunden. AUSSER innerhalb eines Blocks: Wer laut
//     `blockLaenge` mehrere Dienste am Stueck uebernimmt, tut das bewusst —
//     der Block selbst ist die quittierte Abweichung (s. ArbZG-Gespraech
//     31.08.2026: § 7 laesst tarifliche Abweichungen zu, die Verantwortung
//     liegt beim Arbeitgeber; der Assistent erzwingt hier nichts).
// ---------------------------------------------------------------------------

export type PlanPerson = { id: number; name: string };

export type PlanDienst = {
  id: number;
  name: string;
  /** "HH:MM"; Ende gleich Start = 24-Stunden-Dienst, Ende davor = Tagesuebergang. */
  startTime: string;
  endTime: string;
};

export type BestehendeSchicht = {
  userId: number;
  startTime: string | Date;
  endTime: string | Date;
};

export type Zuweisung = {
  /** "YYYY-MM-DD" */
  datum: string;
  userId: number;
  name: string;
  start: Date;
  ende: Date;
};

export type OffenerRest = {
  datum: string;
  /** Warum niemand eingeteilt werden konnte — je Person der erste Hinderungsgrund. */
  gruende: { userId: number; name: string; grund: "abwesend" | "belegt" | "ruhezeit" }[];
};

export type PlanungsErgebnis = {
  zuweisungen: Zuweisung[];
  offenGeblieben: OffenerRest[];
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

/** Datum "YYYY-MM-DD" des LOKALEN Starttags einer Schicht. */
function lokalerTag(d: Date): string {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

export function planeRotation(eingabe: {
  dienst: PlanDienst;
  /** Aufsteigend sortierte offene Tage ("YYYY-MM-DD") dieses Dienstes. */
  offeneTage: string[];
  /** In Rotationsreihenfolge — die erste Person beginnt. */
  personen: PlanPerson[];
  /** Dienste am Stueck je Person, mindestens 1. */
  blockLaenge: number;
  /** Mindestabstand zwischen zwei Diensten einer Person (zwischen Bloecken). */
  ruhezeitStunden: number;
  /** ALLE Schichten des Zeitraums (alle Personen, auch fremde Dienste). */
  bestehende: BestehendeSchicht[];
  /** Abwesenheitstage je Person ("YYYY-MM-DD"). */
  abwesend: Map<number, Set<string>>;
}): PlanungsErgebnis {
  const { dienst, offeneTage, personen, bestehende, abwesend } = eingabe;
  const blockLaenge = Math.max(1, Math.floor(eingabe.blockLaenge));
  const ruhezeitMs = Math.max(0, eingabe.ruhezeitStunden) * 60 * 60 * 1000;

  if (personen.length === 0) {
    return { zuweisungen: [], offenGeblieben: offeneTage.map((datum) => ({ datum, gruende: [] })) };
  }

  // Belegungen je Person: bestehende Schichten plus die hier neu vergebenen.
  const belegt = new Map<number, Intervall[]>();
  for (const p of personen) belegt.set(p.id, []);
  for (const s of bestehende) {
    const liste = belegt.get(s.userId);
    if (!liste) continue; // Schichten nicht gewaehlter Personen sind egal
    const start = s.startTime instanceof Date ? s.startTime : new Date(s.startTime);
    const ende = s.endTime instanceof Date ? s.endTime : new Date(s.endTime);
    liste.push({ start, ende, tag: lokalerTag(start) });
  }

  /** Erster Hinderungsgrund einer Person an einem Tag; null = verfuegbar. */
  function hindernis(
    personId: number,
    datum: string,
    neu: { start: Date; ende: Date },
    ohneVortagsBlock: Intervall | null,
  ): "abwesend" | "belegt" | "ruhezeit" | null {
    if (abwesend.get(personId)?.has(datum)) return "abwesend";
    for (const i of belegt.get(personId) ?? []) {
      if (i === ohneVortagsBlock) continue; // Block-Fortsetzung: bewusst am Stueck
      if (i.tag === datum) return "belegt"; // hoechstens ein Dienst pro Tag
      if (ueberlappt(i, neu)) return "belegt";
      // Ruhezeit auf der Seite, auf der die Intervalle aneinandergrenzen.
      const abstand = i.ende <= neu.start
        ? neu.start.getTime() - i.ende.getTime()
        : i.start.getTime() - neu.ende.getTime();
      if (abstand < ruhezeitMs) return "ruhezeit";
    }
    return null;
  }

  const zuweisungen: Zuweisung[] = [];
  const offenGeblieben: OffenerRest[] = [];

  // Rotationszustand: Wer haelt gerade einen Block, wie viele Dienste sind
  // darin noch offen, und bei wem beginnt der NAECHSTE Block (Fairness:
  // reihum, auch wenn ein Block frueher abbricht)?
  let blockPerson: PlanPerson | null = null;
  let blockRest = 0;
  let blockVorherig: Intervall | null = null; // Zuweisung des VORHERIGEN offenen Tages
  let naechsterStart = 0;

  for (const datum of offeneTage) {
    const neu = dienstZeiten(datum, dienst);
    let vergeben = false;
    const gruende: OffenerRest["gruende"] = [];

    // Ein Block laeuft ueber die naechsten OFFENEN Tage dieses Dienstes —
    // liegt dazwischen ein Tag, der gar nicht offen war (Wochenende eines
    // Mo-Fr-Dienstes, ein bereits besetzter Tag), setzt der Block dahinter
    // fort: Jede Runde der Rotation umfasst blockLaenge Dienste. Die
    // Ruhezeit-Ausnahme bleibt dabei ungefaehrlich, weil zwischen zwei
    // nicht benachbarten Diensttagen immer mindestens ein voller Tag liegt.
    if (blockPerson !== null && blockRest > 0) {
      const grund = hindernis(blockPerson.id, datum, neu, blockVorherig);
      if (grund === null) {
        const intervall: Intervall = { ...neu, tag: datum };
        belegt.get(blockPerson.id)!.push(intervall);
        zuweisungen.push({
          datum,
          userId: blockPerson.id,
          name: blockPerson.name,
          start: neu.start,
          ende: neu.ende,
        });
        blockRest -= 1;
        blockVorherig = intervall;
        vergeben = true;
      }
      // sonst: Block endet vorzeitig — der Tag geht regulaer in die Rotation.
    }

    if (!vergeben) {
      blockPerson = null;
      blockRest = 0;
      blockVorherig = null;
      for (let versuch = 0; versuch < personen.length; versuch++) {
        const idx = (naechsterStart + versuch) % personen.length;
        const p = personen[idx];
        const grund = hindernis(p.id, datum, neu, null);
        if (grund !== null) {
          gruende.push({ userId: p.id, name: p.name, grund });
          continue;
        }
        const intervall: Intervall = { ...neu, tag: datum };
        belegt.get(p.id)!.push(intervall);
        zuweisungen.push({ datum, userId: p.id, name: p.name, start: neu.start, ende: neu.ende });
        blockPerson = p;
        blockRest = blockLaenge - 1;
        blockVorherig = intervall;
        naechsterStart = (idx + 1) % personen.length;
        vergeben = true;
        break;
      }
    }

    if (!vergeben) offenGeblieben.push({ datum, gruende });
  }

  return { zuweisungen, offenGeblieben };
}

/** Stunden einer Zuweisung (brutto, ohne Pausen/Wertung — Vorschau-Anzeige). */
export function zuweisungsStunden(z: Pick<Zuweisung, "start" | "ende">): number {
  return (z.ende.getTime() - z.start.getTime()) / (60 * 60 * 1000);
}
