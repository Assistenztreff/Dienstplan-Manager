/**
 * Reine Kalender-Hilfsfunktion fuer das Anker-Datumsschema in e2e-Specs
 * (siehe .agents/memory/e2e-absence-date-anchor-pattern.md): ein Referenz-
 * Datum ("Anker", typischerweise heute + kleiner Puffer) plus Monats-/
 * Tages-Offsets, statt unabhaengig pro Kalendermonat aufgeloester Jahre.
 *
 * WICHTIG: `Date.UTC` normalisiert einen ungueltigen Tag NIE mit einem
 * Fehler, sondern rollt ihn still in den Folgemonat (z. B. `Date.UTC(2027, 1,
 * 30)` -> 2. Maerz 2027, weil Februar nur 28/29 Tage hat). Das macht jeden
 * einzelnen Aufruf "sicher" im Sinne von "wirft nie", verhindert aber NICHT,
 * dass zwei eigentlich verschiedene, fuer unterschiedliche Kalendermonate
 * gedachte Tage auf denselben realen Kalendertag kollabieren, sobald der
 * fruehere Monat (durch den Anker) zufaellig kurz ist. Aufrufer, die mehrere
 * garantiert unterscheidbare Tage im selben Monats-Offset brauchen, muessen
 * Tageszahlen <= 28 verwenden (jeder Kalendermonat hat mindestens 28 Tage,
 * auch Februar in einem Gemeinjahr) statt sich auf 29/30/31 zu verlassen.
 */
export function computeAnchorOffsetDay(
  anchorYear: number,
  anchorMonth0: number,
  monthOffset: number,
  day: number,
): string {
  const d = new Date(Date.UTC(anchorYear, anchorMonth0 + monthOffset, day));
  return d.toISOString().slice(0, 10);
}
