import type { MonthClosingDiffRow } from "@workspace/api-client-react";
import type { StatementRecalculation } from "./pdf-export";

// Minimaler struktureller Ausschnitt der Monats-Balance aus
// GET /dashboard/hours-balance, den die Summenbildung benötigt.
export type RecalculationBalance = {
  basePay?: number | null;
  nightSurchargePay?: number | null;
  sundaySurchargePay?: number | null;
  holidaySurchargePay?: number | null;
  totalPay?: number | null;
};

// Geld-Summen des exportierten Monats für die PDF-Nachberechnungs-Seite:
// Summe über alle Monats-Balances (basePay, Nacht/Sonntag/Feiertag-Zuschläge,
// totalPay). null, wenn KEINE Balance einen Lohnwert (totalPay) trägt — dann
// liegt keine Lohnauswertung vor und die Summenzeile entfällt im PDF.
// Als pure Funktion ausgelagert, damit ein Unit-Test falsche Gesamtsummen
// (vergessene Zuschlagsart, falsches Feld) sofort erkennt.
export function computeRecalculationMonthTotals(
  balances: RecalculationBalance[],
): StatementRecalculation["monthTotals"] {
  const hasPayValues = balances.some((b) => b.totalPay != null);
  if (!hasPayValues) return null;
  return {
    basePay: balances.reduce((s, b) => s + (b.basePay ?? 0), 0),
    surchargePay: balances.reduce(
      (s, b) =>
        s +
        (b.nightSurchargePay ?? 0) +
        (b.sundaySurchargePay ?? 0) +
        (b.holidaySurchargePay ?? 0),
      0,
    ),
    totalPay: balances.reduce((s, b) => s + (b.totalPay ?? 0), 0),
  };
}

// Übergabe-Strecke Diff-API → PDF-Export: mappt die Zeilen aus
// GET /month-closings/diff 1:1 in die StatementRecalculation-Zeilen des
// PDF-Stundennachweises (inkl. Abwesenheits-Felder „davon Urlaub/Krankheit").
// Als pure Funktion ausgelagert, damit ein Unit-Test Feld-Vertauschungen oder
// vergessene Felder sofort erkennt.
export function mapDiffRowsToRecalculationRows(
  rows: MonthClosingDiffRow[],
  assistantFilter: number | "all",
): StatementRecalculation["rows"] {
  const filtered =
    assistantFilter !== "all"
      ? rows.filter((r) => r.userId === assistantFilter)
      : rows;
  return filtered.map((r) => ({
    userName: r.userName,
    diffHours: r.diffHours,
    diffPay: r.diffPay ?? null,
    diffBasePay: r.diffBasePay ?? null,
    diffSurchargePay: r.diffSurchargePay ?? null,
    vacationHours: r.vacationHours ?? 0,
    vacationPay: r.vacationPay ?? null,
    sickHours: r.sickHours ?? 0,
    sickPay: r.sickPay ?? null,
  }));
}
