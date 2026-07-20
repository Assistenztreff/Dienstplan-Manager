// ---------------------------------------------------------------------------
// Nachberechnungs-Differenz: eingefrorener Monatsabschluss vs. aktueller Stand.
// ---------------------------------------------------------------------------
// Pure Funktion (unit-getestet): vergleicht die beim Abschluss eingefrorenen
// Zeilen mit den aktuell berechneten und liefert NUR die Assistenzkräfte mit
// tatsächlicher Abweichung (Stunden ODER Geld). Assistenzkräfte, die nur auf
// einer Seite vorkommen (neu hinzugekommen bzw. entfernt), zählen als 0 auf
// der fehlenden Seite.
// ---------------------------------------------------------------------------

import type { MonthClosingEntry } from "@workspace/db";

export type DiffSourceRow = {
  userId: number;
  userName: string;
  totalFulfilledHours: number;
  totalPay: number | null;
};

export type MonthClosingDiffRow = {
  userId: number;
  userName: string;
  reportedHours: number;
  currentHours: number;
  diffHours: number;
  reportedPay: number | null;
  currentPay: number | null;
  diffPay: number | null;
};

// Toleranz gegen Fließkomma-Rauschen: Werte sind auf 2 Stellen gerundet,
// alles unterhalb eines halben Cents/Hundertstels gilt als unverändert.
const EPS = 0.005;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeMonthClosingDiff(
  reported: MonthClosingEntry[],
  current: DiffSourceRow[],
): MonthClosingDiffRow[] {
  const reportedById = new Map(reported.map((r) => [r.userId, r]));
  const currentById = new Map(current.map((r) => [r.userId, r]));
  const userIds = [...new Set([...reportedById.keys(), ...currentById.keys()])];

  const rows: MonthClosingDiffRow[] = [];
  for (const userId of userIds) {
    const rep = reportedById.get(userId);
    const cur = currentById.get(userId);
    const reportedHours = rep?.totalFulfilledHours ?? 0;
    const currentHours = cur?.totalFulfilledHours ?? 0;
    const reportedPay = rep ? (rep.totalPay ?? null) : null;
    const currentPay = cur ? (cur.totalPay ?? null) : null;
    const diffHours = round2(currentHours - reportedHours);
    // Geld-Differenz nur, wenn mindestens eine Seite einen Geldwert hat;
    // fehlende Seite zählt als 0 (z. B. Stundenlohn nachträglich gesetzt).
    const hasPay = reportedPay != null || currentPay != null;
    const diffPay = hasPay ? round2((currentPay ?? 0) - (reportedPay ?? 0)) : null;

    const hoursChanged = Math.abs(diffHours) > EPS;
    const payChanged = diffPay != null && Math.abs(diffPay) > EPS;
    if (!hoursChanged && !payChanged) continue;

    rows.push({
      userId,
      userName: cur?.userName ?? rep?.userName ?? "",
      reportedHours: round2(reportedHours),
      currentHours: round2(currentHours),
      diffHours,
      reportedPay,
      currentPay,
      diffPay,
    });
  }
  rows.sort((a, b) => a.userName.localeCompare(b.userName, "de"));
  return rows;
}
