/**
 * Rechenkern des Arbeitstage-Rechners (Dialog `arbeitstage-rechner-dialog.tsx`).
 *
 * Aus durchschnittlicher Dienstlänge und Diensten pro Monat entstehen die
 * beiden Vertragswerte Arbeitstage/Woche und Wochenstunden — konsistent, so
 * dass Wochenstunden ÷ Arbeitstage (fast) exakt die Dienstlänge ergibt.
 * `dailyHours` wird mit DERSELBEN Formel wie der Server
 * (vacation-hours.ts: round2(weeklyHours / workdaysPerWeek)) berechnet, damit
 * die Dialog-Vorschau immer den tatsächlich bewerteten Wert zeigt.
 */

// Umrechnung Monat → Woche (52 Wochen / 12 Monate).
export const WEEKS_PER_MONTH = 4.35;

// Plausible Obergrenze für eine Dienstlänge (24-h-Dienste + Puffer).
export const MAX_SHIFT_LENGTH_HOURS = 48;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type ArbeitstageRechnerResult = {
  workdaysPerWeek: number;
  weeklyHours: number;
  /** So bewertet der Server den Urlaubstag (identische Formel). */
  dailyHours: number;
};

export function computeArbeitstage(
  shiftsPerMonth: number,
  shiftLengthHours: number,
): ArbeitstageRechnerResult | null {
  if (!Number.isFinite(shiftsPerMonth) || shiftsPerMonth <= 0) return null;
  if (
    !Number.isFinite(shiftLengthHours) ||
    shiftLengthHours < 0.5 ||
    shiftLengthHours > MAX_SHIFT_LENGTH_HOURS
  )
    return null;
  const workdaysPerWeek = round2(shiftsPerMonth / WEEKS_PER_MONTH);
  if (workdaysPerWeek < 0.5 || workdaysPerWeek > 7) return null;
  // Wochenstunden aus den GERUNDETEN Arbeitstagen ableiten, damit beide
  // Vertragswerte zusammenpassen (statt unabhängig gerundeter Einzelwerte).
  const weeklyHours = round2(workdaysPerWeek * shiftLengthHours);
  // Exakt die Server-Formel — die Vorschau zeigt den wirklich bewerteten Wert.
  const dailyHours = round2(weeklyHours / workdaysPerWeek);
  return { workdaysPerWeek, weeklyHours, dailyHours };
}
