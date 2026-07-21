import type { MonthClosingDiffRow } from "@workspace/api-client-react";
import type { StatementRecalculation } from "./pdf-export";

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
