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
//
// ── Wer bekommt den Platz? Wer am meisten Stunden braucht. ──────────────────
// Kay-Fehlermeldung 03.09.2026: Reines Reihum verteilt gleich viele Dienste
// an alle — eine Aushilfe mit 24 Vertragsstunden bekam so 96 h, die
// Vollzeitkraefte blieben im Minus. Kays Vorgabe: „Jeder soll sein Monats-
// Soll erfuellen, Abweichung hoechstens plus/minus eine Schicht."
//
// Deshalb entscheidet nicht mehr die Reihenfolge, sondern der Bedarf: Von
// allen, die den Platz uebernehmen KOENNEN, bekommt ihn die Person mit den
// meisten noch freien Vertragsstunden. Die Reihenfolge bleibt nur als
// Gleichstandsregel — bei gleichen Vertraegen ergibt sich damit von selbst
// das alte Reihum. Wer sein Soll erreicht hat, wird uebersprungen; ein
// Platz, den niemand mehr braucht, bleibt offen (Kays Antwort 4: der Planer
// entscheidet, nicht der Automat). Die Stunden kommen aus dem Stundenkonto —
// derselben Rechnung, die im Raster daneben steht, inklusive bezahlter
// Abwesenheiten und Entwuerfe. So erklaert sich jede Entscheidung des Laufs
// mit den Zahlen, die man ohnehin sieht.
//
// Hat NIEMAND Vertragsstunden hinterlegt, gibt es keinen Bedarf, an dem man
// sich orientieren koennte — dann gilt weiter das reine Reihum. Sobald aber
// eine Person Vertragsstunden hat, bleiben die anderen ohne Vertrag aussen
// vor: Ihr Bedarf ist unbekannt, und den Vertragsleuten Stunden wegzunehmen
// waere falsch.
//
// ── Wenn alle ihr Soll haben, der Monat aber noch Luecken ───────────────────
// Kay-Regel 03.09.2026: „Schwankende Monatsstunden sind in der Assistenz
// üblich." Ein offener Dienst ist schlimmer als eine Ueberstunde. Braucht
// niemand mehr Stunden, wird der Platz deshalb trotzdem vergeben — zuerst an
// Teilzeitkraefte, dann an Vollzeitkraefte (ab 168 Stunden Monats-Soll),
// zuletzt an Personen ohne hinterlegte Vertragsstunden. Innerhalb einer Stufe
// bekommt ihn, wer am wenigsten drueber liegt.
//
// Der Unterschied, auf den es dabei ankommt: „hat schon genug" ist ein Grund
// zurueckzustehen, „kann an dem Tag nicht" ist ein Ausschluss. Wer abwesend,
// schon eingeteilt oder in der Ruhezeit ist, steht auch im Ersatzweg nicht zur
// Wahl — sonst waere die Ruhezeit nur noch eine Empfehlung.
// ---------------------------------------------------------------------------

// ── Die vorgemerkte Vertretung ───────────────────────────────────────────────
// Kay-Entscheidung 03.09.2026 (zweite Fassung): Jeder Vertretungsplatz des
// Monats wird besetzt, solange ueberhaupt jemand kann. Die Reihenfolge:
//   1. Wer im Monat noch GAR KEINE Vertretung hat, kommt zuerst dran.
//   2. Haben alle eine, geht die zweite an die TEILZEITkraefte.
//   3. Erst danach an die Vollzeitkraefte (ab 168 Stunden Monats-Soll).
// Innerhalb einer Stufe entscheidet die Rotationsreihenfolge. Abwesenheit,
// Belegung und Ruhezeit gelten unveraendert — wer an dem Tag nicht kann, wird
// auch nicht vorgemerkt.
//
// Die erste Fassung liess nur vormerken, wessen Vertrag den Dienst noch trug
// (Minijob-Ueberlegung). Kay hat das verworfen: Eine Vertretung ist eine
// Bereitschaft, kein geplanter Dienst — ob sie tatsaechlich geholt wird und
// was das fuer die Geringfuegigkeitsgrenze bedeutet, entscheidet sich erst im
// Ernstfall. Der Verteilungsschluessel oben sorgt dafuer, dass die Last
// trotzdem nicht immer dieselben trifft.

/** Ab hier gilt eine Kraft als Vollzeit (Kay-Vorgabe 03.09.2026). */
export const VOLLZEIT_STUNDEN = 168;

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

/** Ein Zeitfenster, in dem eine Person nicht arbeiten kann (Abwesenheit). */
export type Sperrzeit = { start: Date; ende: Date };

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

export type Hinderungsgrund =
  | "abwesend"
  | "belegt"
  | "ruhezeit"
  /** Monats-Soll erreicht — keine freien Vertragsstunden mehr. */
  | "soll_erfuellt"
  /** Andere haben Vertragsstunden, diese Person nicht — Bedarf unbekannt. */
  | "keine_vertragsstunden";

export const HINDERUNGSGRUND_TEXT: Record<Hinderungsgrund, string> = {
  abwesend: "abwesend",
  belegt: "schon eingeteilt",
  ruhezeit: "Ruhezeit",
  soll_erfuellt: "Monats-Soll erreicht",
  keine_vertragsstunden: "keine Vertragsstunden hinterlegt",
};

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
   * Abwesenheiten sperren zweifach: den Kalendertag (`abwesend`) UND ihr
   * Zeitfenster (`sperrzeiten`). Letzteres faengt, was der Tag allein nicht
   * sieht — ein 24-Stunden-Dienst vom Vortag reicht bis in den Urlaubstag
   * hinein (Kays Punkt 3, 03.09.2026). Auf Sperrzeiten gilt keine Ruhezeit:
   * Wer am Tag nach dem Urlaub um 9 Uhr beginnt, hatte frei genug.
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
    sperrzeiten: Map<number, Sperrzeit[]>,
    ohne: Intervall | null = null,
  ): Hinderungsgrund | null {
    if (abwesend.get(personId)?.has(datum)) return "abwesend";
    for (const sperre of sperrzeiten.get(personId) ?? []) {
      if (ueberlappt(sperre, neu)) return "abwesend";
    }
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

/**
 * Buchfuehrung ueber die noch freien Vertragsstunden je Person — Startwert
 * aus dem Stundenkonto, abzueglich allem, was dieser Lauf vergibt.
 */
class Stundenbedarf {
  /** false = niemand hat Vertragsstunden, es gilt reines Reihum. */
  readonly aktiv: boolean;
  private readonly frei = new Map<number, number>();

  constructor(personen: PlanPerson[], freieStunden: Map<number, number> | undefined) {
    this.aktiv = freieStunden !== undefined && personen.some((p) => freieStunden.has(p.id));
    if (!this.aktiv) return;
    for (const p of personen) {
      const wert = freieStunden!.get(p.id);
      if (wert !== undefined) this.frei.set(p.id, wert);
    }
  }

  /** Warum diese Person den Platz NICHT bekommen soll; null = sie braucht ihn. */
  hindernis(personId: number): Hinderungsgrund | null {
    if (!this.aktiv) return null;
    const rest = this.frei.get(personId);
    if (rest === undefined) return "keine_vertragsstunden";
    // Wer noch irgendetwas braucht, darf den Dienst nehmen — auch wenn er
    // damit ueber das Soll rutscht. Das ist Kays „hoechstens eine Schicht
    // Abweichung": vorher unter Soll, danach hoechstens einen Dienst drueber.
    return rest > 0 ? null : "soll_erfuellt";
  }

  /** Vergleichswert: je groesser, desto dringender braucht die Person Stunden. */
  bedarf(personId: number): number {
    return this.aktiv ? (this.frei.get(personId) ?? Number.NEGATIVE_INFINITY) : 0;
  }



  abbuchen(personId: number, stunden: number): void {
    if (!this.aktiv) return;
    const rest = this.frei.get(personId);
    if (rest !== undefined) this.frei.set(personId, rest - stunden);
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
  /** In Rotationsreihenfolge — die erste Person beginnt (bei gleichem Bedarf). */
  personen: PlanPerson[];
  grenzen: LaufGrenzen;
  /** ALLE bestehenden Arbeits-Schichten des Zeitraums. */
  bestehende: BestehendeSchicht[];
  /** Abwesenheitstage je Person ("YYYY-MM-DD"). */
  abwesend: Map<number, Set<string>>;
  /** Abwesenheiten als Zeitfenster je Person — fuer Dienste, die hineinragen. */
  sperrzeiten?: Map<number, Sperrzeit[]>;
  /**
   * Noch freie Vertragsstunden des Monats je Person (Stundenkonto: Soll minus
   * Verplantes inkl. Entwuerfen und bezahlten Abwesenheiten). Nur Personen MIT
   * Vertragsstunden stehen darin. Weggelassen oder leer = reines Reihum.
   */
  freieStunden?: Map<number, number>;
  /**
   * Vertragliches Monats-Soll je Person. Entscheidet allein darueber, wer als
   * Teilzeit gilt und damit die zweite Vertretung frueher bekommt.
   */
  monatsSollStunden?: Map<number, number>;
  /**
   * Zufallsquelle (0 ≤ x < 1) zum Mischen (Kay-Auftrag 05.09.2026: „Neuer
   * Entwurf muss die Dienste neu mischen"). Ohne sie ist der Lauf
   * vollstaendig vorhersagbar — derselbe Stand ergibt denselben Plan.
   *
   * Gemischt wird nur, wo es das Soll nicht kostet: Unter allen, die den
   * Platz nehmen koennen und deren Bedarf hoechstens EINE Schicht unter dem
   * Spitzenreiter liegt, entscheidet der Zufall (Kays Toleranz „plus/minus
   * eine Schicht"). Ausserdem beginnt jede Rotation an zufaelliger Stelle.
   */
  zufall?: () => number;
}): LaufErgebnis {
  const { dienste, offeneTageJeDienst, personen, bestehende, abwesend } = eingabe;
  const zufall = eingabe.zufall;
  const wuerfel = (n: number): number =>
    zufall === undefined ? 0 : Math.min(n - 1, Math.floor(zufall() * n));
  const sperrzeiten = eingabe.sperrzeiten ?? new Map<number, Sperrzeit[]>();
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
  const bedarf = new Stundenbedarf(personen, eingabe.freieStunden);
  /** Wie oft ist jede Person bisher als Vertretung vorgemerkt? Verteilt die
   *  Vormerkungen, statt sie immer derselben Person zu geben. */
  const vormerkungen = new Map<number, number>();
  /** Ohne hinterlegtes Monats-Soll gilt niemand als Vollzeit — dann entscheidet
   *  allein die Zahl der bisherigen Vormerkungen. */
  const monatsSoll = eingabe.monatsSollStunden;
  const istVollzeit = (personId: number): boolean =>
    (monatsSoll?.get(personId) ?? 0) >= VOLLZEIT_STUNDEN;
  const rotationen = new Map<number, Rotation>(
    dienste.map((d) => [
      d.id,
      { person: null, rest: 0, vorheriges: null, naechsterStart: wuerfel(personen.length) },
    ]),
  );

  // Tagweise, damit sich die Dienste eines Tages gegenseitig sehen: Wer den
  // Fruehdienst uebernommen hat, ist fuer den Spaetdienst desselben Tages
  // belegt. Ein Durchlauf Dienst-fuer-Dienst wuerde das erst zu spaet merken.
  const alleTage = [...new Set([...offeneTageJeDienst.values()].flat())].sort();

  for (const datum of alleTage) {
    for (const dienst of dienste) {
      if (!(offeneTageJeDienst.get(dienst.id) ?? []).includes(datum)) continue;

      const neu = dienstZeiten(datum, dienst);
      const stunden = (neu.ende.getTime() - neu.start.getTime()) / (60 * 60 * 1000);
      const rot = rotationen.get(dienst.id)!;
      const gruende: OffenGeblieben["gruende"] = [];
      let vergeben: PlanPerson | null = null;
      let eingetragen: Intervall | null = null;

      // 1. Laeuft ein Block? Dann hat dessen Person Vorrang — solange sie
      //    noch Stunden braucht.
      if (rot.person !== null && rot.rest > 0) {
        const grund =
          bedarf.hindernis(rot.person.id) ??
          belegungen.hindernis(
            rot.person.id, datum, neu, ruhezeitMs, abwesend, sperrzeiten, rot.vorheriges,
          );
        if (grund === null) {
          eingetragen = { ...neu, tag: datum };
          belegungen.eintragen(rot.person.id, eingetragen);
          bedarf.abbuchen(rot.person.id, stunden);
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

      // 2. Sonst: Von allen, die koennen, die Person mit dem groessten Bedarf.
      //    Reihenfolge ab dem Rotationszeiger — bei gleichem Bedarf gewinnt,
      //    wer als Naechstes dran ist (reines Reihum ohne Vertragsstunden).
      //
      //    Braucht NIEMAND mehr Stunden, bleibt der Platz trotzdem nicht leer
      //    (Kay-Regel 03.09.2026: „Schwankende Monatsstunden sind in der
      //    Assistenz üblich"). Dann greift der Ersatzweg, und zwar in dieser
      //    Reihenfolge: erst Teilzeitkraefte, dann Vollzeitkraefte, zuletzt
      //    Personen ohne hinterlegte Vertragsstunden. Innerhalb einer Stufe
      //    bekommt sie, wer am wenigsten drueber liegt.
      //
      //    Wer an dem Tag WIRKLICH nicht kann — abwesend, schon eingeteilt,
      //    Ruhezeit — steht auch im Ersatzweg nicht zur Wahl. Das ist der
      //    Unterschied zwischen „hat schon genug" und „geht nicht".
      if (vergeben === null) {
        rot.person = null;
        rot.rest = 0;
        rot.vorheriges = null;
        let beste: { idx: number; person: PlanPerson } | null = null;
        /** Alle, die koennen UND noch Stunden brauchen — fuers Mischen. */
        const frei: { idx: number; person: PlanPerson }[] = [];
        let ersatz: { idx: number; person: PlanPerson; stufe: number; rest: number } | null = null;
        for (let versuch = 0; versuch < personen.length; versuch++) {
          const idx = (rot.naechsterStart + versuch) % personen.length;
          const p = personen[idx]!;
          const verhindert = belegungen.hindernis(
            p.id, datum, neu, ruhezeitMs, abwesend, sperrzeiten,
          );
          if (verhindert !== null) {
            gruende.push({ userId: p.id, name: p.name, grund: verhindert });
            continue;
          }
          const stundenGrund = bedarf.hindernis(p.id);
          if (stundenGrund !== null) {
            gruende.push({ userId: p.id, name: p.name, grund: stundenGrund });
            const stufe =
              stundenGrund === "keine_vertragsstunden" ? 2 : istVollzeit(p.id) ? 1 : 0;
            const kandidat = { idx, person: p, stufe, rest: bedarf.bedarf(p.id) };
            if (
              ersatz === null ||
              kandidat.stufe < ersatz.stufe ||
              (kandidat.stufe === ersatz.stufe && kandidat.rest > ersatz.rest)
            ) {
              ersatz = kandidat;
            }
            continue;
          }
          frei.push({ idx, person: p });
          if (beste === null || bedarf.bedarf(p.id) > bedarf.bedarf(beste.person.id)) {
            beste = { idx, person: p };
          }
          if (!bedarf.aktiv) break; // Reihum: die erste freie Person nimmt.
        }
        if (beste !== null && zufall !== undefined && bedarf.aktiv) {
          // Mischen innerhalb der Toleranz: Wer hoechstens eine Schicht
          // weniger braucht als der Spitzenreiter, darf ihn vertreten.
          const spitze = bedarf.bedarf(beste.person.id);
          const kandidaten = frei.filter((k) => bedarf.bedarf(k.person.id) > spitze - stunden);
          beste = kandidaten[wuerfel(kandidaten.length)] ?? beste;
        }
        beste ??= ersatz;
        if (beste !== null) {
          eingetragen = { ...neu, tag: datum };
          belegungen.eintragen(beste.person.id, eingetragen);
          bedarf.abbuchen(beste.person.id, stunden);
          vergeben = beste.person;
          rot.person = beste.person;
          rot.rest = blockLaenge - 1;
          rot.vorheriges = eingetragen;
          rot.naechsterStart = (beste.idx + 1) % personen.length;
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
      //    steht ja ausserhalb jedes Blocks. Vertragsstunden spielen hier
      //    keine Rolle — eine Vormerkung verbraucht keine.
      let standby: PlanPerson | null = null;
      if (dienst.standbySlot) {
        // Kay-Regel 03.09.2026: Jeder Platz wird besetzt, solange jemand kann.
        // Sortiert wird nach (1) bisherige Vormerkungen, (2) Teilzeit vor
        // Vollzeit, (3) Rotationsreihenfolge — siehe Kopf der Datei.
        let bester:
          | { kandidat: PlanPerson; bisher: number; vollzeit: boolean }
          | null = null;
        for (let versuch = 0; versuch < personen.length; versuch++) {
          const idx = (rot.naechsterStart + versuch) % personen.length;
          const kandidat = personen[idx]!;
          if (kandidat.id === vergeben.id) continue;
          if (
            belegungen.hindernis(kandidat.id, datum, neu, ruhezeitMs, abwesend, sperrzeiten) !==
            null
          ) {
            continue;
          }
          const eintrag = {
            kandidat,
            bisher: vormerkungen.get(kandidat.id) ?? 0,
            vollzeit: istVollzeit(kandidat.id),
          };
          if (
            bester === null ||
            eintrag.bisher < bester.bisher ||
            (eintrag.bisher === bester.bisher && !eintrag.vollzeit && bester.vollzeit)
          ) {
            bester = eintrag;
          }
        }
        if (bester !== null) {
          standby = bester.kandidat;
          vormerkungen.set(standby.id, (vormerkungen.get(standby.id) ?? 0) + 1);
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

/**
 * Kurze Erklaerung, warum Plaetze offen geblieben sind — der haeufigste
 * Grund ueber alle offenen Plaetze, fuer den Hinweis nach dem Lauf.
 */
export function offenErklaerung(offen: OffenGeblieben[]): string | null {
  const zaehler = new Map<Hinderungsgrund, number>();
  for (const o of offen) {
    for (const g of o.gruende) zaehler.set(g.grund, (zaehler.get(g.grund) ?? 0) + 1);
  }
  let top: Hinderungsgrund | null = null;
  for (const [grund, n] of zaehler) {
    if (top === null || n > (zaehler.get(top) ?? 0)) top = grund;
  }
  if (top === null) return offen.length > 0 ? "niemand zur Auswahl" : null;
  return HINDERUNGSGRUND_TEXT[top];
}

// ---------------------------------------------------------------------------
// Klick-Rotation im Planungsmodus
// ---------------------------------------------------------------------------
// Kay-Auftrag: Im Planungsmodus schaltet ein Klick auf die Pille die Person
// weiter, statt den Bearbeiten-Dialog zu oeffnen.
//
// Der Rundlauf ist ein RINGSCHLUSS: hinter der letzten Person kommt wieder die
// erste. Er endet nie im Leeren.
//
// Bis zum 03.09.2026 wurde der Platz am Ende des Rundlaufs GELEERT — der
// Dienst also geloescht. Kay hat das als Fehler gemeldet, und zu Recht: Bei
// einem 24-Stunden-Dienst sperrt die Ruhezeit fast alle Nachbarn, oft bleiben
// ein oder zwei waehlbare Personen uebrig. Der Rundlauf war damit nach einem
// Klick zu Ende und der naechste Klick loeschte den Dienst — es sah aus, als
// bliebe die Rotation haengen und wuerfe dann alles weg. Geloescht wird jetzt
// ausschliesslich ueber den Muelleimer an der Pille; ein Klick wechselt nur
// noch die Person.
//
// Uebersprungen wird, wer an dem Tag nicht kann (abwesend, schon eingeteilt,
// Ruhezeit) — Kays Wahl. So klickt man sich nie in eine Besetzung, die der
// Server danach abweist oder die eine Doppelbelegung waere. Die aktuell
// eingeteilte Person ist von dieser Pruefung ausgenommen: Sie HAT den Dienst
// ja, sie wuerde sich sonst selbst blockieren.

/**
 * Die naechste Person im Rundlauf; null heisst „es gibt keine andere".
 *
 * `istEinsatzfaehig` kapselt Abwesenheit, Belegung und Ruhezeit — die
 * Rotation selbst kennt diese Regeln nicht, sie fragt nur.
 */
export function naechsteBesetzung(eingabe: {
  /** Wer den Platz gerade hat; null = offener Platz. */
  aktuelleUserId: number | null;
  /** Alle waehlbaren Personen in Anzeigereihenfolge. */
  kandidaten: PlanPerson[];
  istEinsatzfaehig: (userId: number) => boolean;
}): PlanPerson | null {
  const { aktuelleUserId, kandidaten, istEinsatzfaehig } = eingabe;
  if (kandidaten.length === 0) return null;

  // Ab welcher Stelle wird weitergesucht? Steht die aktuelle Person nicht in
  // der Liste (etwa weil sie herausgefiltert ist), beginnt der Rundlauf vorn.
  const start =
    aktuelleUserId == null ? 0 : kandidaten.findIndex((p) => p.id === aktuelleUserId) + 1;

  for (let i = 0; i < kandidaten.length; i++) {
    const p = kandidaten[(start + i) % kandidaten.length]!;
    if (p.id !== aktuelleUserId && istEinsatzfaehig(p.id)) return p;
  }
  // Niemand sonst kann an diesem Tag — der Dienst bleibt, wie er ist.
  return null;
}

/** Stunden einer Besetzung (brutto, ohne Pausen/Wertung). */
export function besetzungsStunden(b: Pick<Besetzung, "start" | "ende">): number {
  return (b.ende.getTime() - b.start.getTime()) / (60 * 60 * 1000);
}
