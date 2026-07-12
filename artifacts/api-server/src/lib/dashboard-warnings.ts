// Reine Berechnungslogik für die Dashboard-Warnhinweise (Admin-Zweig von
// /dashboard/summary). Bewusst frei von DB- und Express-Abhängigkeiten, damit die
// kniffligen Randfälle (Nachtdienste über Mitternacht, Resturlaub-Schwelle,
// Datumsschlüssel in lokaler Zeitzone) isoliert per Unit-Test abgesichert werden
// können.

export const LOW_VACATION_THRESHOLD = 5;
export const HORIZON_DAYS = 14;

/**
 * Lokaler Datumsschlüssel (YYYY-MM-DD) in der Zeitzone der Laufzeitumgebung.
 * Bewusst NICHT `toISOString()`, da das in UTC umrechnet und Tage an der
 * Mitternachtsgrenze verschieben kann.
 */
export function localDateKey(d: Date | string): string {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export interface CoverageShift {
  startTime: Date | string;
  endTime: Date | string;
}

/**
 * Menge aller Kalendertage, die von mindestens einer Schicht überlappt werden.
 * Eine Schicht deckt jeden Tag ab, den sie berührt — auch über Mitternacht
 * laufende Nachtdienste decken damit ihren Folgetag mit ab, nicht nur den
 * Starttag.
 */
export function computeCoveredDates(shifts: CoverageShift[]): Set<string> {
  const coveredDates = new Set<string>();
  for (const s of shifts) {
    const end = new Date(s.endTime);
    const startDate = new Date(s.startTime);
    let cur = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    while (cur < end) {
      coveredDates.add(localDateKey(cur));
      cur.setDate(cur.getDate() + 1);
    }
  }
  return coveredDates;
}

/**
 * Liste der unbesetzten Tage (YYYY-MM-DD) im Planungshorizont ab `todayStart`.
 * `todayStart` sollte lokale Mitternacht des heutigen Tages sein.
 */
export function computeUncoveredDays(
  shifts: CoverageShift[],
  todayStart: Date,
  horizonDays: number = HORIZON_DAYS
): string[] {
  const coveredDates = computeCoveredDates(shifts);
  const uncoveredDays: string[] = [];
  for (let i = 0; i < horizonDays; i++) {
    const d = new Date(todayStart);
    d.setDate(d.getDate() + i);
    const key = localDateKey(d);
    if (!coveredDates.has(key)) uncoveredDays.push(key);
  }
  return uncoveredDays;
}

export interface VacationCandidate {
  userId: number;
  userName: string;
  vacationDays: number | null;
  /** Stundengenau verbrauchter Urlaub (maßgeblicher Zähler). */
  vacationHoursUsed: number | null;
  /** Umrechnungsfaktor Stunden je Urlaubstag (vacationHoursPerDay des Team-Kontos). */
  hoursPerDay: number;
}

export interface LowVacationAssistant {
  userId: number;
  userName: string;
  vacationDaysRemaining: number;
}

/**
 * Assistenten, deren Resturlaub die Schwelle erreicht oder unterschreitet,
 * aufsteigend nach Resttagen sortiert. Erwartet nur Kandidaten mit aktivem
 * Vertrag (das Auflösen/Überspringen ohne Vertrag passiert beim Aufrufer).
 */
export function computeLowVacationAssistants(
  candidates: VacationCandidate[],
  threshold: number = LOW_VACATION_THRESHOLD
): LowVacationAssistant[] {
  const result: LowVacationAssistant[] = [];
  for (const c of candidates) {
    // Resttage aus der stundengenauen Urlaubsbuchhaltung ableiten (der
    // Alt-Zähler vacation_days_used existiert nicht mehr), gerundet auf 0,1.
    const hoursPerDay = c.hoursPerDay > 0 ? c.hoursPerDay : 8;
    const daysUsed = Math.round(((c.vacationHoursUsed ?? 0) / hoursPerDay) * 10) / 10;
    const remaining = Math.round(((c.vacationDays ?? 0) - daysUsed) * 10) / 10;
    if (remaining <= threshold) {
      result.push({ userId: c.userId, userName: c.userName, vacationDaysRemaining: remaining });
    }
  }
  result.sort((a, b) => a.vacationDaysRemaining - b.vacationDaysRemaining);
  return result;
}
