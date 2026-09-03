// ---------------------------------------------------------------------------
// Wie lange dauert ein Dienst — nach der Uhr an der Wand?
// ---------------------------------------------------------------------------
// Kay-Fehlermeldung 03.09.2026: Die automatische Planung besetzte den Monat
// Oktober 2026, und der Sammelauftrag EINER Person wurde mit 400 abgewiesen —
// „Ende muss nach dem Beginn liegen und innerhalb eines Kalendertags enden."
// Da ein Sammelauftrag ganz oder gar nicht angelegt wird, verlor diese Person
// ihren kompletten Monat, und im Raster blieben sieben Luecken.
//
// Schuld war die Zeitumstellung. Am 25. Oktober 2026 wird die Uhr um 03:00 von
// Sommer- auf Winterzeit zurueckgestellt. Ein 24-Stunden-Dienst vom 24. um
// 09:00 bis zum 25. um 09:00 dauert an diesem Wochenende real 25 Stunden — auf
// der Uhr aber unveraendert 24. Die Pruefung rechnete in Millisekunden und
// hielt den Dienst deshalb faelschlich fuer einen Mehrtages-Dienst.
//
// Umgekehrt gilt dasselbe: Im Fruehjahr, wenn die Uhr vorgestellt wird, dauert
// derselbe Dienst real nur 23 Stunden.
//
// Gerechnet wird deshalb in Europe/Berlin. Die App ist auf deutsches
// Arbeitsrecht zugeschnitten (ArbZG, MiLoG, SGB IV); eine Zeitzone je Team
// gibt es bewusst nicht, und solange das so ist, waere ein konfigurierbarer
// Wert nur eine Attrappe.
// ---------------------------------------------------------------------------

const ZEITZONE = "Europe/Berlin";

/** Abstand der Ortszeit zur Weltzeit an diesem Zeitpunkt, in Millisekunden. */
function zeitzonenVersatzMs(zeitpunkt: Date): number {
  // Intl liefert die Wanduhrzeit der Zone; die Differenz zur selben Uhrzeit in
  // UTC ist der gesuchte Versatz. Bewusst ohne Zusatzpaket — es geht um zwei
  // Zeitpunkte je Anfrage, nicht um eine Kalenderrechnung.
  const alsUtc = new Date(zeitpunkt.toLocaleString("en-US", { timeZone: "UTC" }));
  const alsOrtszeit = new Date(zeitpunkt.toLocaleString("en-US", { timeZone: ZEITZONE }));
  return alsOrtszeit.getTime() - alsUtc.getTime();
}

/**
 * Dauer eines Dienstes, wie sie auf der Uhr an der Wand ablaufen wuerde.
 *
 * An einem Tag der Zeitumstellung weicht sie um eine Stunde von der echten
 * Dauer ab — und genau das ist gewollt: Wer 09:00 bis 09:00 plant, plant einen
 * Tagesdienst, egal ob real 23, 24 oder 25 Stunden vergehen. Fuer die
 * Bezahlung zaehlt weiterhin die echte Dauer; diese Funktion beantwortet nur
 * die Frage „ist das noch EIN Tag?".
 */
export function wanduhrDauerMs(start: Date, ende: Date): number {
  return ende.getTime() - start.getTime() + (zeitzonenVersatzMs(ende) - zeitzonenVersatzMs(start));
}

/** Obergrenze eines Tagesdienstes: 24 Stunden auf der Uhr. */
export const TAGESDIENST_MAX_MS = 24 * 60 * 60 * 1000;

/** Passt dieser Dienst noch in einen Kalendertag? */
export function istTagesdienst(start: Date, ende: Date): boolean {
  return wanduhrDauerMs(start, ende) <= TAGESDIENST_MAX_MS;
}
