/**
 * DATEV-konformer Lohnexport als Excel (.xlsx).
 *
 * Layout: eine Kopfzeile (Lohnarten) + eine Datenzeile pro Assistenzkraft
 * + eine Gesamtsummen-Zeile am Ende. Trennzeichen: Excel-intern (keine CSV).
 * Zahlen: native Zahlen (kein Text-Format) für korrekte Excel-Summen.
 *
 * Orientierung: Mitarbeiter als Zeilen, Lohnarten als Spalten — DATEV-Standard.
 */

import type { MatrixBalance, MatrixRecalc } from "@/components/gesamt-auswertung-matrix";
import { formatDays } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Spalten-Definitionen
// ---------------------------------------------------------------------------

type XlsxCol = {
  header: string;
  /** Gibt den Wert zurück — Zahl wo möglich, sonst String. */
  value: (b: MatrixBalance, recalcByUser?: Map<number, MatrixRecalc>) => number | string;
  /** Breite in Zeichen (Excel-Einheit). */
  width?: number;
};

function makeColumns(
  balances: MatrixBalance[],
  recalcByUser?: Map<number, MatrixRecalc>,
  prevMonthLabel?: string,
): XlsxCol[] {
  const any = (pred: (b: MatrixBalance) => boolean) => balances.some(pred);

  const anyNight = any((b) => b.nightPercent > 0);
  const anySunday = any((b) => b.sundayPercent > 0);
  const anyHoliday = any((b) => b.holidayPercent > 0);
  const anyWage = any((b) => b.hourlyWage != null);
  const anyKindKrank = any((b) => (b.kindKrankTage ?? 0) > 0);
  const anyFreistellung = any(
    (b) => (b.freistellungStunden ?? 0) > 0 || (b.freistellungTage ?? 0) > 0,
  );
  const anyAbgesagtAg = any((b) => (b.abgesagtArbeitgeberStunden ?? 0) > 0);
  const anyAbgesagtAn = any((b) => (b.abgesagtArbeitnehmerStunden ?? 0) > 0);
  const anyUrlaubsabgeltung = any((b) => (b.urlaubsabgeltungEuro ?? 0) > 0);
  const anyAbsenceNight = any((b) => (b.absenceNightSurchargeHours ?? 0) > 0);
  const anyAbsenceSunday = any((b) => (b.absenceSundaySurchargeHours ?? 0) > 0);
  const anyAbsenceHoliday = any((b) => (b.absenceHolidaySurchargeHours ?? 0) > 0);
  const anyAbsenceSurcharge = anyAbsenceNight || anyAbsenceSunday || anyAbsenceHoliday;
  const anyRecalc =
    recalcByUser != null && balances.some((b) => recalcByUser.has(b.userId));

  const uniformPercent = (get: (b: MatrixBalance) => number): number | null => {
    const set = new Set(balances.map(get).filter((p) => p > 0));
    return set.size === 1 ? [...set][0]! : null;
  };
  const nightUniform = uniformPercent((b) => b.nightPercent);
  const sundayUniform = uniformPercent((b) => b.sundayPercent);
  const holidayUniform = uniformPercent((b) => b.holidayPercent);

  const cols: XlsxCol[] = [
    // --- Stunden ---
    {
      header: "IST-Stunden",
      value: (b) => b.valuedHours,
      width: 14,
    },
    {
      header: "Soll-Stunden",
      value: (b) => b.plannedHours,
      width: 14,
    },
    {
      header: "Erfüllt gesamt (inkl. Urlaub/Krank)",
      value: (b) => b.totalFulfilledHours,
      width: 32,
    },
    {
      header: "Krankheitsstunden",
      value: (b) => b.sickHours,
      width: 18,
    },
    {
      header: "Urlaubstage",
      value: (b) => b.vacationDaysTaken,
      width: 14,
    },
  ];

  // --- Zuschläge ---
  if (anyNight) {
    cols.push({
      header: nightUniform != null ? `Nachtstunden (${nightUniform}%)` : "Nachtstunden (h)",
      value: (b) => (b.nightPercent > 0 ? b.nightHours : ""),
      width: 20,
    });
    cols.push({
      header: nightUniform != null ? `Nachtzuschlag (+${nightUniform}% h)` : "Nachtzuschlag (+h)",
      value: (b) => (b.nightPercent > 0 ? b.nightSurchargeHours : ""),
      width: 22,
    });
  }
  if (anySunday) {
    cols.push({
      header: sundayUniform != null ? `Sonntagsstunden (${sundayUniform}%)` : "Sonntagsstunden (h)",
      value: (b) => (b.sundayPercent > 0 ? b.sundayHours : ""),
      width: 22,
    });
    cols.push({
      header: sundayUniform != null ? `Sonntagszuschlag (+${sundayUniform}% h)` : "Sonntagszuschlag (+h)",
      value: (b) => (b.sundayPercent > 0 ? b.sundaySurchargeHours : ""),
      width: 24,
    });
  }
  if (anyHoliday) {
    cols.push({
      header: holidayUniform != null ? `Feiertagsstunden (${holidayUniform}%)` : "Feiertagsstunden (h)",
      value: (b) => (b.holidayPercent > 0 ? b.holidayHours : ""),
      width: 22,
    });
    cols.push({
      header: holidayUniform != null ? `Feiertagszuschlag (+${holidayUniform}% h)` : "Feiertagszuschlag (+h)",
      value: (b) => (b.holidayPercent > 0 ? b.holidaySurchargeHours : ""),
      width: 24,
    });
  }
  if (anyAbsenceSurcharge) {
    cols.push({
      header: "SV-pflichtig Basis h (Urlaub/Krank)",
      value: (b) => {
        const total =
          (b.absenceNightHours ?? 0) +
          (b.absenceSundayHours ?? 0) +
          (b.absenceHolidayHours ?? 0);
        return total > 0 ? total : "";
      },
      width: 32,
    });
    cols.push({
      header: "SV-pflichtig Zuschlag h (Urlaub/Krank)",
      value: (b) => {
        const total =
          (b.absenceNightSurchargeHours ?? 0) +
          (b.absenceSundaySurchargeHours ?? 0) +
          (b.absenceHolidaySurchargeHours ?? 0);
        return total > 0 ? total : "";
      },
      width: 34,
    });
  }

  // --- Weitere Kategorien ---
  cols.push({ header: "Teamsitzung (h)", value: (b) => b.teamsitzungStunden ?? 0, width: 16 });
  cols.push({ header: "Bereitschaften (Anz.)", value: (b) => b.bereitschaftenAnzahl ?? 0, width: 20 });
  cols.push({ header: "Bereitschaften (h)", value: (b) => b.bereitschaftsStunden ?? 0, width: 18 });
  cols.push({ header: "Vertretungen (Anz.)", value: (b) => b.vertretungenAnzahl ?? 0, width: 18 });
  cols.push({ header: "Vertretungen (h)", value: (b) => b.vertretungsStunden ?? 0, width: 16 });

  if (anyKindKrank) {
    cols.push({
      header: "Kind krank (Tage)",
      value: (b) => b.kindKrankTage ?? 0,
      width: 16,
    });
  }
  if (anyFreistellung) {
    cols.push({
      header: "Freistellung bezahlt (h)",
      value: (b) => b.freistellungStunden ?? 0,
      width: 22,
    });
  }
  if (anyAbgesagtAg) {
    cols.push({
      header: "Abgesagt AG bezahlt (h)",
      value: (b) => b.abgesagtArbeitgeberStunden ?? 0,
      width: 22,
    });
  }
  if (anyAbgesagtAn) {
    cols.push({
      header: "Abgesagt AN unbezahlt (h)",
      value: (b) => b.abgesagtArbeitnehmerStunden ?? 0,
      width: 24,
    });
  }

  // --- Lohnauswertung (nur wenn Stundenlohn vorhanden) ---
  if (anyWage) {
    cols.push({
      header: "Stundenlohn (€)",
      value: (b) => (b.hourlyWage != null ? b.hourlyWage : ""),
      width: 16,
    });
    cols.push({
      header: "Grundlohn (€)",
      value: (b) => (b.hourlyWage != null ? (b.basePay ?? 0) : ""),
      width: 14,
    });
    if (anyNight) {
      cols.push({
        header: "Nachtzuschlag (€)",
        value: (b) => (b.hourlyWage != null ? (b.nightSurchargePay ?? 0) : ""),
        width: 18,
      });
    }
    if (anySunday) {
      cols.push({
        header: "Sonntagszuschlag (€)",
        value: (b) => (b.hourlyWage != null ? (b.sundaySurchargePay ?? 0) : ""),
        width: 20,
      });
    }
    if (anyHoliday) {
      cols.push({
        header: "Feiertagszuschlag (€)",
        value: (b) => (b.hourlyWage != null ? (b.holidaySurchargePay ?? 0) : ""),
        width: 21,
      });
    }
    if (anyAbsenceSurcharge) {
      cols.push({
        header: "SV-pflichtig Zuschlag (€)",
        value: (b) => {
          if (b.hourlyWage == null) return "";
          return (
            (b.absenceNightSurchargePay ?? 0) +
            (b.absenceSundaySurchargePay ?? 0) +
            (b.absenceHolidaySurchargePay ?? 0)
          );
        },
        width: 24,
      });
    }
    if (anyRecalc) {
      cols.push({
        header: prevMonthLabel
          ? `Nachberechnung ${prevMonthLabel} (€)`
          : "Nachberechnung Vormonat (€)",
        value: (b, recalc) => {
          const r = recalc?.get(b.userId);
          return r ? r.diffPay : "";
        },
        width: 28,
      });
    }
    cols.push({
      header: anyRecalc
        ? "GESAMT brutto inkl. Nachberechnung (€)"
        : "GESAMT brutto (€)",
      value: (b, recalc) => {
        if (b.hourlyWage == null) return "";
        const r = recalc?.get(b.userId)?.diffPay ?? 0;
        return (b.totalPay ?? 0) + r;
      },
      width: 36,
    });
    if (anyUrlaubsabgeltung) {
      cols.push({
        header: "Urlaubsabgeltung zusätzlich (€)",
        value: (b) => ((b.urlaubsabgeltungEuro ?? 0) > 0 ? (b.urlaubsabgeltungEuro ?? 0) : ""),
        width: 30,
      });
    }
  }

  return cols;
}

// ---------------------------------------------------------------------------
// Öffentliche API
// ---------------------------------------------------------------------------

/**
 * Baut das DATEV-konforme Lohnexport-Excel als ArrayBuffer (für ZIP-Export)
 * oder löst direkt einen Browser-Download aus.
 */
export async function buildLohnexportBuffer(
  balances: MatrixBalance[],
  recalcByUser: Map<number, MatrixRecalc> | undefined,
  prevMonthLabel: string | undefined,
  month: number,
  year: number,
): Promise<ArrayBuffer> {
  // Interop-sicher: im Vite-Dev-Modus hat das xlsx-Modul keinen default-Export.
  const XLSX = await import("xlsx").then((m) => m.default ?? m);
  const cols = makeColumns(balances, recalcByUser, prevMonthLabel);

  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString("de-DE", {
    month: "long",
    year: "numeric",
  });

  // Header-Zeile
  const headerRow = ["Mitarbeiter", ...cols.map((c) => c.header)];

  // Daten-Zeilen
  const dataRows = balances.map((b) => [
    b.userName,
    ...cols.map((c) => c.value(b, recalcByUser)),
  ]);

  // Gesamtsummen-Zeile (nur für numerische Spalten)
  const totalsRow: (string | number)[] = ["Gesamtsumme"];
  for (const col of cols) {
    const nums = balances
      .map((b) => col.value(b, recalcByUser))
      .filter((v): v is number => typeof v === "number");
    totalsRow.push(nums.length === balances.length ? nums.reduce((a, b) => a + b, 0) : "");
  }

  const aoa = [
    [`Lohnexport – ${monthLabel}`, ...Array(cols.length).fill("")],
    headerRow,
    ...dataRows,
    totalsRow,
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Spaltenbreiten
  ws["!cols"] = [{ wch: 28 }, ...cols.map((c) => ({ wch: c.width ?? 16 }))];

  // Titel-Zeile (A1) als Merge
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: cols.length } },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Lohnexport");

  return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

export async function downloadLohnexportXlsx(
  balances: MatrixBalance[],
  recalcByUser: Map<number, MatrixRecalc> | undefined,
  prevMonthLabel: string | undefined,
  month: number,
  year: number,
): Promise<void> {
  // Interop-sicher: im Vite-Dev-Modus hat das xlsx-Modul keinen default-Export.
  const XLSX = await import("xlsx").then((m) => m.default ?? m);
  const cols = makeColumns(balances, recalcByUser, prevMonthLabel);

  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString("de-DE", {
    month: "long",
    year: "numeric",
  });

  const headerRow = ["Mitarbeiter", ...cols.map((c) => c.header)];
  const dataRows = balances.map((b) => [
    b.userName,
    ...cols.map((c) => c.value(b, recalcByUser)),
  ]);
  const totalsRow: (string | number)[] = ["Gesamtsumme"];
  for (const col of cols) {
    const nums = balances
      .map((b) => col.value(b, recalcByUser))
      .filter((v): v is number => typeof v === "number");
    totalsRow.push(nums.length === balances.length ? nums.reduce((a, b) => a + b, 0) : "");
  }

  const aoa = [
    [`Lohnexport – ${monthLabel}`, ...Array(cols.length).fill("")],
    headerRow,
    ...dataRows,
    totalsRow,
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 28 }, ...cols.map((c) => ({ wch: c.width ?? 16 }))];
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: cols.length } }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Lohnexport");

  const monthStr = String(month).padStart(2, "0");
  XLSX.writeFile(wb, `lohnexport-${year}-${monthStr}.xlsx`);
}
