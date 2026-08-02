/**
 * Zeitkonto-Export als Excel (.xlsx).
 *
 * Layout: Mitarbeiter als Zeilen, Soll/IST-Felder als Spalten.
 * Enthält: IST-Stunden, Soll-Stunden, Differenz, Erfüllungsgrad %,
 *          Krankheitsstunden, Urlaubstage, Bereitschaften, Vertretungen.
 */

import type { MatrixBalance } from "@/components/gesamt-auswertung-matrix";

type ZeitkontoCols = {
  header: string;
  value: (b: MatrixBalance) => number | string;
  format?: "percent" | "hours" | "days" | "count";
  width?: number;
};

function buildColumns(balances: MatrixBalance[]): ZeitkontoCols[] {
  const any = (pred: (b: MatrixBalance) => boolean) => balances.some(pred);
  const anyBereitschaft = any((b) => (b.bereitschaftenAnzahl ?? 0) > 0 || (b.bereitschaftsStunden ?? 0) > 0);
  const anyVertretung = any((b) => (b.vertretungenAnzahl ?? 0) > 0 || (b.vertretungsStunden ?? 0) > 0);
  const anyKindKrank = any((b) => (b.kindKrankTage ?? 0) > 0);
  const anyFreistellung = any((b) => (b.freistellungStunden ?? 0) > 0);

  const cols: ZeitkontoCols[] = [
    {
      header: "Soll-Stunden",
      value: (b) => b.plannedHours,
      format: "hours",
      width: 14,
    },
    {
      header: "IST-Stunden",
      value: (b) => b.valuedHours,
      format: "hours",
      width: 14,
    },
    {
      header: "Differenz (h)",
      value: (b) => b.valuedHours - b.plannedHours,
      format: "hours",
      width: 14,
    },
    {
      header: "Erfüllt %",
      value: (b) =>
        b.plannedHours > 0
          ? Math.round((b.totalFulfilledHours / b.plannedHours) * 100) / 100
          : 1,
      format: "percent",
      width: 12,
    },
    {
      header: "Krankheitsstunden",
      value: (b) => b.sickHours,
      format: "hours",
      width: 18,
    },
    {
      header: "Urlaubstage",
      value: (b) => b.vacationDaysTaken,
      format: "days",
      width: 14,
    },
    {
      header: "Teamsitzung (h)",
      value: (b) => b.teamsitzungStunden ?? 0,
      format: "hours",
      width: 16,
    },
  ];

  if (anyBereitschaft) {
    cols.push({
      header: "Bereitschaften",
      value: (b) => b.bereitschaftenAnzahl ?? 0,
      format: "count",
      width: 14,
    });
    cols.push({
      header: "Bereitschaftsstunden",
      value: (b) => b.bereitschaftsStunden ?? 0,
      format: "hours",
      width: 20,
    });
  }
  if (anyVertretung) {
    cols.push({
      header: "Vertretungen",
      value: (b) => b.vertretungenAnzahl ?? 0,
      format: "count",
      width: 14,
    });
    cols.push({
      header: "Vertretungsstunden",
      value: (b) => b.vertretungsStunden ?? 0,
      format: "hours",
      width: 18,
    });
  }
  if (anyKindKrank) {
    cols.push({
      header: "Kind krank (Tage)",
      value: (b) => b.kindKrankTage ?? 0,
      format: "days",
      width: 16,
    });
  }
  if (anyFreistellung) {
    cols.push({
      header: "Freistellung bezahlt (h)",
      value: (b) => b.freistellungStunden ?? 0,
      format: "hours",
      width: 22,
    });
  }

  return cols;
}

function buildAoa(
  balances: MatrixBalance[],
  cols: ZeitkontoCols[],
  monthLabel: string,
): (string | number)[][] {
  const headerRow = ["Mitarbeiter", ...cols.map((c) => c.header)];

  const dataRows = balances.map((b) => [
    b.userName,
    ...cols.map((c) => c.value(b)),
  ] as (string | number)[]);

  // Gesamtsummen-Zeile (Summen für Stunden/Tage, Durchschnitt für %)
  const totalsRow: (string | number)[] = ["Gesamtsumme"];
  for (const col of cols) {
    if (col.format === "percent") {
      // Gewichteter Durchschnitt (gesamte erfüllte Stunden / gesamte Soll-Stunden)
      const totalFulfilled = balances.reduce((s, b) => s + b.totalFulfilledHours, 0);
      const totalPlanned = balances.reduce((s, b) => s + b.plannedHours, 0);
      totalsRow.push(totalPlanned > 0 ? Math.round((totalFulfilled / totalPlanned) * 100) / 100 : 1);
    } else {
      const nums = balances
        .map((b) => col.value(b))
        .filter((v): v is number => typeof v === "number");
      totalsRow.push(nums.reduce((a, b) => a + b, 0));
    }
  }

  return [
    [`Zeitkonto – ${monthLabel}`, ...Array(cols.length).fill("")],
    headerRow,
    ...dataRows,
    totalsRow,
  ];
}

export async function buildZeitkontBuffer(
  balances: MatrixBalance[],
  month: number,
  year: number,
): Promise<ArrayBuffer> {
  const XLSX = (await import("xlsx")).default;
  const cols = buildColumns(balances);

  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString("de-DE", {
    month: "long",
    year: "numeric",
  });

  const aoa = buildAoa(balances, cols, monthLabel);
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Prozent-Spalten als %-Format markieren
  const percentColIdxs = cols.reduce<number[]>((acc, c, i) => {
    if (c.format === "percent") acc.push(i + 1); // +1 wegen "Mitarbeiter"-Spalte
    return acc;
  }, []);
  if (percentColIdxs.length > 0 && ws["!ref"]) {
    const range = XLSX.utils.decode_range(ws["!ref"]);
    for (let r = range.s.r + 1; r <= range.e.r; r++) {
      for (const c of percentColIdxs) {
        const addr = XLSX.utils.encode_cell({ r, c });
        if (ws[addr]?.t === "n") {
          ws[addr].z = "0%";
        }
      }
    }
  }

  ws["!cols"] = [{ wch: 28 }, ...cols.map((c) => ({ wch: c.width ?? 14 }))];
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: cols.length } }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Zeitkonto");

  return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

export async function downloadZeitkontXlsx(
  balances: MatrixBalance[],
  month: number,
  year: number,
): Promise<void> {
  const XLSX = (await import("xlsx")).default;
  const cols = buildColumns(balances);

  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString("de-DE", {
    month: "long",
    year: "numeric",
  });

  const aoa = buildAoa(balances, cols, monthLabel);
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  const percentColIdxs = cols.reduce<number[]>((acc, c, i) => {
    if (c.format === "percent") acc.push(i + 1);
    return acc;
  }, []);
  if (percentColIdxs.length > 0 && ws["!ref"]) {
    const range = XLSX.utils.decode_range(ws["!ref"]);
    for (let r = range.s.r + 1; r <= range.e.r; r++) {
      for (const c of percentColIdxs) {
        const addr = XLSX.utils.encode_cell({ r, c });
        if (ws[addr]?.t === "n") ws[addr].z = "0%";
      }
    }
  }

  ws["!cols"] = [{ wch: 28 }, ...cols.map((c) => ({ wch: c.width ?? 14 }))];
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: cols.length } }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Zeitkonto");

  const monthStr = String(month).padStart(2, "0");
  XLSX.writeFile(wb, `zeitkonto-${year}-${monthStr}.xlsx`);
}
