// Reine Berechnungslogik für die Roh-Kennzahlen einer Schicht (analog zu
// dashboard-warnings.ts und dashboard-hours-balance.ts). Bewusst frei von DB- und
// Express-Abhängigkeiten, damit die Fallunterscheidung Arbeit vs. Abwesenheit und
// das Zusammenspiel mit der eigentlichen Zuschlagsrechnung (computeShiftMetrics)
// isoliert per Unit-Test abgesichert werden kann.
//
// Die eigentliche Nacht-/Sonntags-/Feiertagsberechnung lebt in
// @workspace/db (shift-metrics.ts); hier wird nur entschieden, ob eine Schicht
// als Abwesenheit (Urlaub/Krank) plan-basiert gewertet wird oder als Arbeit
// durch computeShiftMetrics läuft.

import {
  computeShiftMetrics,
  type NightWindow,
  type GermanState,
  type ShiftMetrics,
} from "@workspace/db";

// Urlaub und Krankheit sind Abwesenheiten: sie referenzieren kein Schichtmodell
// und lösen keine Zuschlagsberechnung aus.
export function isAbsenceType(type: string): boolean {
  return type === "vacation" || type === "sick";
}

export interface ResolveShiftMetricsInput {
  type: string;
  startTime: Date;
  endTime: Date;
  // Vertragliche Soll-Stunden des Tages — gelten bei Abwesenheit als gewertete
  // Stunden (Lohnfortzahlung). Bei Arbeitsschichten ignoriert.
  plannedHours: number;
  // Zeitwertung des Schichtmodells in Prozent. Legacy-Schichten ohne Modell: 100.
  valuationPercent: number;
}

// Ermittelt die Roh-Kennzahlen einer Schicht ohne jede DB-Abhängigkeit.
//
// - Urlaub/Krankheit: die vollen geplanten Tagesstunden gelten als erfüllt
//   (gewertete Stunden = Vertrags-Soll des Tages), keine Zuschläge.
// - Arbeitsschicht: delegiert an computeShiftMetrics (Wertung + Nacht-/Sonntags-/
//   Feiertagsstunden inkl. landesspezifischer Feiertage).
export function resolveShiftMetrics(
  input: ResolveShiftMetricsInput,
  window: NightWindow,
  state?: GermanState | null
): ShiftMetrics {
  if (isAbsenceType(input.type)) {
    // Zuschlagsfortzahlung (Lohnausfallprinzip): Deckt die Abwesenheit einen
    // geplanten 24h-Dienst ab (identische Start-/Enduhrzeit über die
    // Tagesgrenze, ≥23h), so werden die Nacht-/Sonntags-/Feiertagsstunden aus
    // dem Zeitfenster berechnet und fortgezahlt. Ein normaler ganztägiger
    // Abwesenheitstag (00:00–23:59) löst KEINE Zuschläge aus, sonst würde jede
    // Nacht/jeder Sonntag fälschlich mitgezählt.
    const start = new Date(input.startTime);
    const end = new Date(input.endTime);
    const durationH = (end.getTime() - start.getTime()) / 3_600_000;
    const sameClock =
      start.getHours() === end.getHours() && start.getMinutes() === end.getMinutes();
    if (sameClock && durationH >= 23) {
      const m = computeShiftMetrics(
        { startTime: start, endTime: end, isAbsence: false, valuationPercent: 100 },
        window,
        state
      );
      return {
        valuedHours: input.plannedHours,
        nightHours: m.nightHours,
        sundayHours: m.sundayHours,
        holidayHours: m.holidayHours,
      };
    }
    return {
      valuedHours: input.plannedHours,
      nightHours: 0,
      sundayHours: 0,
      holidayHours: 0,
    };
  }
  return computeShiftMetrics(
    {
      startTime: new Date(input.startTime),
      endTime: new Date(input.endTime),
      isAbsence: false,
      valuationPercent: input.valuationPercent,
    },
    window,
    state
  );
}
