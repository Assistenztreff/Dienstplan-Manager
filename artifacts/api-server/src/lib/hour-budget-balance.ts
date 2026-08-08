// ---------------------------------------------------------------------------
// Stundenbilanz zum Monatsbudget (Zielvereinbarung, Bedarfsseite) — reine
// Berechnungslogik, bewusst frei von DB- und Express-Abhängigkeiten (gleiches
// Muster wie dashboard-hours-balance.ts), damit sie isoliert per Unit-Test
// abgesichert werden kann.
// ---------------------------------------------------------------------------
// Fachlichkeit (Arbeitsanweisung 06.08.2026, Punkt 2.2):
// - "Genehmigt" kommt aus den Zielvereinbarungen (hour_budgets): ein Budget
//   zählt für einen Monat, sobald sein Gültigkeitszeitraum den Monat IRGENDWO
//   überlappt (gleiche Regel wie contractForMonth) — ein mittmonatlich
//   beginnender Zeitraum zählt voll, Monate ohne gültige Vereinbarung mit 0.
// - "Verbraucht" zählt NUR echte Arbeitsdienste. Abwesenheitsstunden (Urlaub,
//   Krankheit, Freizeitausgleich, bezahlte Freistellung) sind in der
//   Budgetkalkulation bereits enthalten und zählen NICHT als Verbrauch; rein
//   informative Kategorien (Kind-krank, vom AN abgesagt, Urlaubsabgeltung)
//   und Teamsitzungs-Einträge ebenfalls nicht.
// - Jahressaldo = kumuliert genehmigt minus verbraucht seit Jahresbeginn
//   (Januar bis einschließlich Auswertungsmonat).
// - Warnschwelle: mehr als 1,5 angesparte Monatsbudgets (nur ausgewertet,
//   wenn für den Monat eine Zielvereinbarung existiert — ohne Budget gibt es
//   keine sinnvolle Schwelle).

// Abwesenheits- und Info-Kategorien: müssen mit isAbsenceType /
// isUnpaidAbsenceType (shift-metrics-resolve) und den Sätzen in
// dashboard-hours-balance.ts übereinstimmen; bewusst lokal dupliziert, damit
// dieses Modul DB-/Express-frei bleibt.
const ABSENCE_SHIFT_TYPES = new Set([
  "vacation",
  "sick",
  "freizeitausgleich",
  "freistellung",
  "abgesagt_ag",
]);
const INFO_ONLY_SHIFT_TYPES = new Set(["kind_krank", "abgesagt_an", "urlaubsabgeltung"]);

/** Faktor der Warnschwelle: mehr als 1,5 angesparte Monatsbudgets. */
export const BUDGET_WARNING_FACTOR = 1.5;

/** Offenes Ende als Sentinel für Datumsvergleiche (lexikographisch). */
const OPEN_END = "9999-12-31";

/** Zeitraum einer Zielvereinbarung (Datumswerte als "YYYY-MM-DD"). */
export interface BudgetPeriod {
  monthlyHours: number;
  startDate: string;
  endDate: string | null;
}

/** Schicht-Felder, die in den Verbrauch einfließen. */
export interface BudgetShift {
  type: string;
  startTime: Date | string;
  endTime: Date | string;
  valuedHours?: number | null;
}

/** Ergebnis der Bilanz eines Monats inkl. Jahressaldo (API-Shape). */
export interface HourBudgetBalanceResult {
  month: number;
  year: number;
  approvedHours: number;
  consumedHours: number;
  remainingHours: number;
  yearApprovedHours: number;
  yearConsumedHours: number;
  yearBalance: number;
  warningThresholdHours: number;
  warningActive: boolean;
  /** true, sobald im Scope mindestens eine Zielvereinbarung existiert (Dashboard-Gating). */
  hasBudgets: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Erster Kalendertag eines Monats als "YYYY-MM-DD". */
export function monthStartDate(month: number, year: number): string {
  return `${year}-${pad2(month)}-01`;
}

/** Letzter Kalendertag eines Monats als "YYYY-MM-DD" (UTC, Tag 0 des Folgemonats). */
export function monthEndDate(month: number, year: number): string {
  return new Date(Date.UTC(year, month, 0)).toISOString().split("T")[0]!;
}

/** Überlappen sich zwei Gültigkeitszeiträume (Ende jeweils inklusive, null = offen)? */
export function budgetPeriodsOverlap(
  a: { startDate: string; endDate: string | null },
  b: { startDate: string; endDate: string | null },
): boolean {
  const aEnd = a.endDate ?? OPEN_END;
  const bEnd = b.endDate ?? OPEN_END;
  return a.startDate <= bEnd && b.startDate <= aEnd;
}

/**
 * Erste überlappende Zielvereinbarung aus `existing` für `candidate`
 * (z. B. für die 409-Validierung). `excludeId` ignoriert einen Eintrag
 * (für PATCH: der Datensatz darf sich nicht mit sich selbst schneiden).
 */
export function findOverlappingBudget<T extends { startDate: string; endDate: string | null }>(
  existing: (T & { id: number })[],
  candidate: { startDate: string; endDate: string | null },
  excludeId?: number,
): (T & { id: number }) | null {
  for (const row of existing) {
    if (excludeId != null && row.id === excludeId) continue;
    if (budgetPeriodsOverlap(row, candidate)) return row;
  }
  return null;
}

/** Zählt diese Schicht als Verbrauch (echter Arbeitsdienst)? */
export function isConsumedShiftType(type: string): boolean {
  return type !== "team" && !ABSENCE_SHIFT_TYPES.has(type) && !INFO_ONLY_SHIFT_TYPES.has(type);
}

function shiftConsumedHours(s: BudgetShift): number {
  if (s.valuedHours != null) return s.valuedHours;
  return (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 3_600_000;
}

/**
 * Genehmigte Stunden eines Monats: Summe der Monatsbudgets aller
 * Zielvereinbarungen, deren Gültigkeitszeitraum den Monat überlappt.
 * (Pro Team schließt die API Überlappungen aus — je Team also max. ein
 * Budget pro Monat; über mehrere Teams im Scope wird summiert.)
 */
export function approvedHoursForMonth(
  budgets: BudgetPeriod[],
  month: number,
  year: number,
): number {
  const start = monthStartDate(month, year);
  const end = monthEndDate(month, year);
  return budgets
    .filter((b) => b.startDate <= end && (b.endDate ?? OPEN_END) >= start)
    .reduce((acc, b) => acc + b.monthlyHours, 0);
}

/**
 * Verbrauchte Stunden eines Monats: nur echte Arbeitsdienste, zugeordnet über
 * den Monat des Dienstbeginns (gleiche Monatszuschneidung wie die übrigen
 * Auswertungen: EXTRACT(MONTH/YEAR FROM startTime)).
 */
export function consumedHoursForMonth(
  shifts: BudgetShift[],
  month: number,
  year: number,
): number {
  return shifts
    .filter((s) => {
      if (!isConsumedShiftType(s.type)) return false;
      const d = new Date(s.startTime);
      return d.getFullYear() === year && d.getMonth() + 1 === month;
    })
    .reduce((acc, s) => acc + shiftConsumedHours(s), 0);
}

/**
 * Monatsbilanz + laufender Jahressaldo. `budgets`/`shifts` müssen bereits auf
 * den Team-Scope eingeschränkt und alle Monate Januar..`month` abdecken
 * (liefert die Route; die Funktion selbst filtert nur noch fachlich).
 */
export function computeHourBudgetBalance(params: {
  budgets: BudgetPeriod[];
  shifts: BudgetShift[];
  month: number;
  year: number;
}): HourBudgetBalanceResult {
  const { budgets, shifts, month, year } = params;

  const approvedHours = approvedHoursForMonth(budgets, month, year);
  const consumedHours = consumedHoursForMonth(shifts, month, year);

  let yearApprovedHours = 0;
  let yearConsumedHours = 0;
  for (let m = 1; m <= month; m += 1) {
    yearApprovedHours += approvedHoursForMonth(budgets, m, year);
    yearConsumedHours += consumedHoursForMonth(shifts, m, year);
  }
  const yearBalance = yearApprovedHours - yearConsumedHours;

  // Warnschwelle nur bei vorhandener Zielvereinbarung: ohne Budget (0
  // genehmigte Stunden) gibt es kein "Monatsbudget", auf das sich die
  // 1,5-fache Schwelle beziehen könnte — sonst würde jede gearbeitete
  // Stunde ohne Vereinbarung sofort als "angespart" (negativ verbraucht
  // wäre hier ohnehin unmöglich) fehlgedeutet.
  const warningThresholdHours = approvedHours * BUDGET_WARNING_FACTOR;
  const warningActive = approvedHours > 0 && yearBalance > warningThresholdHours;

  return {
    month,
    year,
    approvedHours: round2(approvedHours),
    consumedHours: round2(consumedHours),
    remainingHours: round2(approvedHours - consumedHours),
    yearApprovedHours: round2(yearApprovedHours),
    yearConsumedHours: round2(yearConsumedHours),
    yearBalance: round2(yearBalance),
    warningThresholdHours: round2(warningThresholdHours),
    warningActive,
    hasBudgets: budgets.length > 0,
  };
}
