// ---------------------------------------------------------------------------
// Melde-Regel fuer Zeit-Korrekturen (Single Source of Truth)
// ---------------------------------------------------------------------------
// Wer darf wann "Zeit korrigieren" melden? Diese Regel lag frueher DOPPELT vor:
//
//   1. Server  — artifacts/api-server/src/routes/shifts-deviations.ts (POST)
//   2. Frontend— artifacts/dienstplan/src/pages/dienstplan.tsx
//                (meldungWiederMoeglichShiftIds) + day-detail-row.tsx
//                (isPastFixWorkShift)
//
// Genau daran ist am 28.08.2026 ein Fehler entstanden (Kay-Test, Punkt 4): die
// Wieder-Oeffnungs-Regel wurde nur im Server gebaut, das Frontend prueft weiter
// "gibt es ueberhaupt eine Meldung?" — der Knopf "Zeit korrigieren" blieb nach
// einer erneuten Korrektur des Planers fuer immer weg. Eine Regel an zwei
// Stellen ist eine Regel, die frueher oder spaeter auseinanderlaeuft. Deshalb
// steht sie ab jetzt nur noch hier.
//
// Bewusst OHNE Abhaengigkeit zu Drizzle, Express oder React: reine Daten rein,
// Entscheidung raus. Deshalb nimmt die Funktion `istAbwesenheit` als Boolean
// entgegen statt die Abwesenheits-Typenliste zu kennen — die Aufrufer haben
// dafuer schon ihre eigene Quelle (isAbsenceType im Server, isAbsence in der
// UI).

/** Zeitpunkt-Eingaben kommen im Server als Date, im Frontend als ISO-String. */
export type Zeitpunkt = string | Date;

function alsMillis(wert: Zeitpunkt): number {
  return wert instanceof Date ? wert.getTime() : new Date(wert).getTime();
}

/** Der Dienst, um den es geht — nur die Felder, die die Regel wirklich liest. */
export type MeldungDienst = {
  /** VORLAEUFIG | ANGEBOTEN | FIX */
  readonly planningStatus: string;
  /** Ende des Dienstes. */
  readonly endTime: Zeitpunkt;
  /** Urlaub/Krankheit/Freizeitausgleich etc. — dafuer gibt es keine Meldung. */
  readonly istAbwesenheit: boolean;
  /** Team-Termin (Besprechung o.ae.) — ebenfalls keine Arbeitszeit-Meldung. */
  readonly istTeamTermin: boolean;
};

/** Die JUENGSTE Meldung zu diesem Dienst (hoechste id), falls es eine gibt. */
export type LetzteMeldung = {
  /** PENDING | ACCEPTED | DISPUTED */
  readonly status: string;
  readonly reportedAt: Zeitpunkt;
  readonly resolvedAt?: Zeitpunkt | null;
};

/** Der JUENGSTE Historien-Eintrag zu diesem Dienst (hoechste id), falls vorhanden. */
export type LetzteAenderung = {
  /** planner_edit | deviation_accepted | ... */
  readonly changeSource: string;
  readonly createdAt: Zeitpunkt;
};

export type MeldungBlockGrund =
  /** Kein bestaetigter Arbeitsdienst (Entwurf/Vorschlag, Abwesenheit, Team). */
  | "kein_bestaetigter_arbeitsdienst"
  /** Dienst laeuft noch oder liegt in der Zukunft. */
  | "nicht_vergangen"
  /** Es liegt bereits eine unbearbeitete Meldung vor. */
  | "offene_meldung"
  /** Erledigt ist erledigt — der Planer hat seither nicht erneut korrigiert. */
  | "abschliessend_bearbeitet";

export type MeldungPruefung =
  | { readonly erlaubt: true }
  | { readonly erlaubt: false; readonly grund: MeldungBlockGrund };

/** Klartext-Meldungen fuer die Blockgruende (Server-Antwort und UI-Hinweis). */
export const MELDUNG_BLOCK_TEXTE: Readonly<Record<MeldungBlockGrund, string>> = {
  kein_bestaetigter_arbeitsdienst:
    "Abweichungen können nur für bestätigte Arbeitsdienste gemeldet werden.",
  nicht_vergangen: "Der Dienst liegt noch nicht in der Vergangenheit.",
  offene_meldung: "Für diesen Dienst wurde bereits eine Korrektur gemeldet.",
  abschliessend_bearbeitet: "Diese Korrektur wurde bereits abschließend bearbeitet.",
};

/**
 * Darf zu diesem Dienst (erneut) eine Zeit-Korrektur gemeldet werden?
 *
 * Die Regel in Worten:
 *   - Nur bestaetigte (FIX) Arbeitsdienste, die vorbei sind.
 *   - Eine offene Meldung blockiert eine zweite.
 *   - Eine erledigte Meldung blockiert dauerhaft — AUSSER der Planer hat den
 *     Dienst DANACH erneut korrigiert. Dann ist es ein neuer Sachverhalt und
 *     die Assistenzkraft muss dazu wieder eine Stimme haben ("Zeit korrigieren"
 *     ist seit dem Wegfall des Widerspruchs ihr einziger Weg,
 *     Kay-Entscheidung 28.08.2026).
 */
export function pruefeMeldungMoeglich(input: {
  readonly shift: MeldungDienst;
  readonly letzteMeldung?: LetzteMeldung | null;
  readonly letzteAenderung?: LetzteAenderung | null;
  /** Testbarkeit: fester "jetzt"-Zeitpunkt in Millis. */
  readonly jetzt?: number;
}): MeldungPruefung {
  const { shift, letzteMeldung, letzteAenderung } = input;
  const jetzt = input.jetzt ?? Date.now();

  if (shift.planningStatus !== "FIX" || shift.istAbwesenheit || shift.istTeamTermin) {
    return { erlaubt: false, grund: "kein_bestaetigter_arbeitsdienst" };
  }
  if (alsMillis(shift.endTime) >= jetzt) {
    return { erlaubt: false, grund: "nicht_vergangen" };
  }
  if (!letzteMeldung) return { erlaubt: true };
  if (letzteMeldung.status === "PENDING") {
    return { erlaubt: false, grund: "offene_meldung" };
  }
  if (!istSeitherKorrigiert(letzteMeldung, letzteAenderung)) {
    return { erlaubt: false, grund: "abschliessend_bearbeitet" };
  }
  return { erlaubt: true };
}

/**
 * Hat der PLANER den Dienst nach dem Abschluss der letzten Meldung erneut
 * korrigiert? Nur dann oeffnet sich der Melde-Kanal wieder.
 *
 * Bewusst separat exportiert: das Frontend braucht genau diese Teil-Antwort,
 * um im Listen-/Kalender-Rendering (ohne Dienst-Objekt zur Hand) zu
 * entscheiden, ob eine erledigte Meldung "ueberholt" ist.
 */
export function istSeitherKorrigiert(
  letzteMeldung: LetzteMeldung | null | undefined,
  letzteAenderung: LetzteAenderung | null | undefined,
): boolean {
  if (!letzteMeldung || !letzteAenderung) return false;
  if (letzteAenderung.changeSource !== "planner_edit") return false;
  const erledigtAm = alsMillis(letzteMeldung.resolvedAt ?? letzteMeldung.reportedAt);
  return alsMillis(letzteAenderung.createdAt) > erledigtAm;
}
