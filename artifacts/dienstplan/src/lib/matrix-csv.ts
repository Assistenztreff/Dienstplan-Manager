/**
 * buildMatrixCsv — generiert eine UTF-8-BOM-CSV-Zeichenkette aus dem
 * hours-balance-Array der GesamtAuswertungMatrix.
 *
 * Layout: eine Kopfzeile (Kategorie-Labels) + eine Datenzeile pro Assistenz.
 * Trennzeichen: Semikolon (Excel/DE-Standard).
 * Zahlen: Dezimalkomma (deutsches Format, für DATEV / Excel kompatibel).
 */

import type { MatrixBalance, MatrixRecalc } from "@/components/gesamt-auswertung-matrix";
import { formatDays } from "@/lib/utils";

// ---- Formatierungs-Hilfsfunktionen ----------------------------------------

/** Deutsches Dezimalformat ohne Einheit (z. B. "160,5"). */
function deNum(n: number, fractions = 2): string {
  return n.toLocaleString("de-DE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractions,
  });
}

/** Deutsches Währungsformat (z. B. "1.234,56 €"). */
function deEur(n: number): string {
  return n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

/** CSV-Cell: schützt Semikolons und Anführungszeichen. */
function csvCell(s: string): string {
  if (s.includes(";") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// ---- Spaltendefinitionen ---------------------------------------------------

type CsvColumn = {
  header: string;
  value: (b: MatrixBalance) => string;
};

function makeColumns(
  balances: MatrixBalance[],
  recalcByUser?: Map<number, MatrixRecalc>,
  prevMonthLabel?: string,
): CsvColumn[] {
  const any = (pred: (b: MatrixBalance) => boolean) => balances.some(pred);

  const anyNight = any((b) => b.nightPercent > 0);
  const anySunday = any((b) => b.sundayPercent > 0);
  const anyHoliday = any((b) => b.holidayPercent > 0);
  const anyWage = any((b) => b.hourlyWage != null);
  const anyPausen = any((b) => (b.pausenzeitStunden ?? 0) > 0);
  const anyKindKrank = any((b) => (b.kindKrankTage ?? 0) > 0);
  const anyFreistellung = any(
    (b) => (b.freistellungStunden ?? 0) > 0 || (b.freistellungTage ?? 0) > 0,
  );
  const anyAbgesagtAg = any((b) => (b.abgesagtArbeitgeberStunden ?? 0) > 0);
  const anyAbgesagtAn = any((b) => (b.abgesagtArbeitnehmerStunden ?? 0) > 0);
  const anyUrlaubsabgeltung = any((b) => (b.urlaubsabgeltungEuro ?? 0) > 0);
  const anyAbsenceNightSurcharge = any((b) => (b.absenceNightSurchargeHours ?? 0) > 0);
  const anyAbsenceSundaySurcharge = any((b) => (b.absenceSundaySurchargeHours ?? 0) > 0);
  const anyAbsenceHolidaySurcharge = any((b) => (b.absenceHolidaySurchargeHours ?? 0) > 0);
  const anyAbsenceSurcharge =
    anyAbsenceNightSurcharge || anyAbsenceSundaySurcharge || anyAbsenceHolidaySurcharge;
  const anyRecalc =
    recalcByUser != null && balances.some((b) => recalcByUser.has(b.userId));

  const uniformPercent = (get: (b: MatrixBalance) => number): number | null => {
    const set = new Set(balances.map(get).filter((p) => p > 0));
    return set.size === 1 ? [...set][0]! : null;
  };
  const nightUniform = uniformPercent((b) => b.nightPercent);
  const sundayUniform = uniformPercent((b) => b.sundayPercent);
  const holidayUniform = uniformPercent((b) => b.holidayPercent);

  const cols: CsvColumn[] = [
    // --- Stunden ---
    {
      header: "Geleistete Stunden (IST)",
      value: (b) => deNum(b.valuedHours),
    },
    {
      header: "Soll-Stunden",
      value: (b) => deNum(b.plannedHours),
    },
    {
      header: "Erfüllt gesamt (inkl. Urlaub/Krank)",
      value: (b) => deNum(b.totalFulfilledHours),
    },
    {
      header: "Krankheitsstunden",
      value: (b) => deNum(b.sickHours),
    },
    {
      header: "Urlaubstage (genommen)",
      value: (b) => formatDays(b.vacationDaysTaken),
    },
  ];

  // --- Zuschläge ---
  if (anyNight) {
    const label =
      nightUniform != null
        ? `Nachtstunden (${nightUniform}%)`
        : "Nachtstunden (Basis h)";
    const labelSurcharge =
      nightUniform != null
        ? `Nachtzuschlag (+${nightUniform}% h)`
        : "Nachtzuschlag (+h)";
    cols.push({
      header: label,
      value: (b) => (b.nightPercent > 0 ? deNum(b.nightHours) : ""),
    });
    cols.push({
      header: labelSurcharge,
      value: (b) => (b.nightPercent > 0 ? deNum(b.nightSurchargeHours) : ""),
    });
  }
  if (anySunday) {
    const label =
      sundayUniform != null
        ? `Sonntagsstunden (${sundayUniform}%)`
        : "Sonntagsstunden (Basis h)";
    const labelSurcharge =
      sundayUniform != null
        ? `Sonntagszuschlag (+${sundayUniform}% h)`
        : "Sonntagszuschlag (+h)";
    cols.push({
      header: label,
      value: (b) => (b.sundayPercent > 0 ? deNum(b.sundayHours) : ""),
    });
    cols.push({
      header: labelSurcharge,
      value: (b) => (b.sundayPercent > 0 ? deNum(b.sundaySurchargeHours) : ""),
    });
  }
  if (anyHoliday) {
    const label =
      holidayUniform != null
        ? `Feiertagsstunden (${holidayUniform}%)`
        : "Feiertagsstunden (Basis h)";
    const labelSurcharge =
      holidayUniform != null
        ? `Feiertagszuschlag (+${holidayUniform}% h)`
        : "Feiertagszuschlag (+h)";
    cols.push({
      header: label,
      value: (b) => (b.holidayPercent > 0 ? deNum(b.holidayHours) : ""),
    });
    cols.push({
      header: labelSurcharge,
      value: (b) => (b.holidayPercent > 0 ? deNum(b.holidaySurchargeHours) : ""),
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
        return total > 0 ? deNum(total) : "";
      },
    });
    cols.push({
      header: "SV-pflichtig Zuschlag h (Urlaub/Krank)",
      value: (b) => {
        const total =
          (b.absenceNightSurchargeHours ?? 0) +
          (b.absenceSundaySurchargeHours ?? 0) +
          (b.absenceHolidaySurchargeHours ?? 0);
        return total > 0 ? deNum(total) : "";
      },
    });
  }

  // --- Weitere Kategorien ---
  cols.push({
    header: "Teamsitzung (h)",
    value: (b) => deNum(b.teamsitzungStunden ?? 0),
  });
  cols.push({
    header: "Bereitschaften (Anz.)",
    value: (b) => String(b.bereitschaftenAnzahl ?? 0),
  });
  cols.push({
    header: "Bereitschaften (h)",
    value: (b) => deNum(b.bereitschaftsStunden ?? 0),
  });
  cols.push({
    header: "Vertretungen (Anz.)",
    value: (b) => String(b.vertretungenAnzahl ?? 0),
  });
  cols.push({
    header: "Vertretungen (h)",
    value: (b) => deNum(b.vertretungsStunden ?? 0),
  });

  if (anyPausen) {
    cols.push({
      header: "Pausen unbezahlt (h)",
      value: (b) => deNum(b.pausenzeitStunden ?? 0),
    });
  }
  if (anyKindKrank) {
    cols.push({
      header: "Kind krank (Tage)",
      value: (b) => formatDays(b.kindKrankTage ?? 0),
    });
  }
  if (anyFreistellung) {
    cols.push({
      header: "Freistellung bezahlt (h)",
      value: (b) => deNum(b.freistellungStunden ?? 0),
    });
  }
  if (anyAbgesagtAg) {
    cols.push({
      header: "Abgesagt AG bezahlt (h)",
      value: (b) => deNum(b.abgesagtArbeitgeberStunden ?? 0),
    });
  }
  if (anyAbgesagtAn) {
    cols.push({
      header: "Abgesagt AN unbezahlt (h)",
      value: (b) => deNum(b.abgesagtArbeitnehmerStunden ?? 0),
    });
  }

  // --- Lohnauswertung (nur wenn Stundenlohn vorhanden) ---
  if (anyWage) {
    cols.push({
      header: "Stundenlohn (€)",
      value: (b) => (b.hourlyWage != null ? deEur(b.hourlyWage) : ""),
    });
    cols.push({
      header: "Grundlohn (€)",
      value: (b) => (b.hourlyWage != null ? deEur(b.basePay ?? 0) : ""),
    });
    if (anyNight) {
      cols.push({
        header: "Nachtzuschlag (€)",
        value: (b) => (b.hourlyWage != null ? deEur(b.nightSurchargePay ?? 0) : ""),
      });
    }
    if (anySunday) {
      cols.push({
        header: "Sonntagszuschlag (€)",
        value: (b) => (b.hourlyWage != null ? deEur(b.sundaySurchargePay ?? 0) : ""),
      });
    }
    if (anyHoliday) {
      cols.push({
        header: "Feiertagszuschlag (€)",
        value: (b) => (b.hourlyWage != null ? deEur(b.holidaySurchargePay ?? 0) : ""),
      });
    }
    if (anyAbsenceSurcharge) {
      cols.push({
        header: "SV-pflichtig Zuschlag (€)",
        value: (b) => {
          if (b.hourlyWage == null) return "";
          const total =
            (b.absenceNightSurchargePay ?? 0) +
            (b.absenceSundaySurchargePay ?? 0) +
            (b.absenceHolidaySurchargePay ?? 0);
          return deEur(total);
        },
      });
    }
    if (anyRecalc) {
      const recalcHeader = prevMonthLabel
        ? `Nachberechnung ${prevMonthLabel} (€)`
        : "Nachberechnung Vormonat (€)";
      cols.push({
        header: recalcHeader,
        value: (b) => {
          const r = recalcByUser?.get(b.userId);
          return r ? deEur(r.diffPay) : "";
        },
      });
    }
    cols.push({
      header: anyRecalc ? "GESAMT brutto inkl. Nachberechnung (€)" : "GESAMT brutto (€)",
      value: (b) => {
        if (b.hourlyWage == null) return "";
        const recalc = recalcByUser?.get(b.userId)?.diffPay ?? 0;
        return deEur((b.totalPay ?? 0) + recalc);
      },
    });
    if (anyUrlaubsabgeltung) {
      cols.push({
        header: "Urlaubsabgeltung zusätzlich (€)",
        value: (b) =>
          (b.urlaubsabgeltungEuro ?? 0) > 0 ? deEur(b.urlaubsabgeltungEuro ?? 0) : "",
      });
    }
  }

  return cols;
}

// ---- Öffentliche API -------------------------------------------------------

/**
 * Baut eine Semikolon-CSV-Zeichenkette aus den Matrix-Balances.
 * Rückgabe beginnt mit UTF-8-BOM (\uFEFF) für Excel-Kompatibilität.
 *
 * @param balances    Das hours-balance-Array (gleiche Quelle wie die Matrix).
 * @param recalcByUser  Optionale Nachberechnungs-Map (userId → Differenzen).
 * @param prevMonthLabel  Label des Vormonats für die Nachberechnungs-Spalte.
 */
export function buildMatrixCsv(
  balances: MatrixBalance[],
  recalcByUser?: Map<number, MatrixRecalc>,
  prevMonthLabel?: string,
): string {
  const cols = makeColumns(balances, recalcByUser, prevMonthLabel);

  const header = ["Name", ...cols.map((c) => c.header)].map(csvCell).join(";");

  const dataRows = balances.map((b) => {
    const cells = [b.userName, ...cols.map((c) => c.value(b))].map(csvCell);
    return cells.join(";");
  });

  return "\uFEFF" + [header, ...dataRows].join("\r\n");
}

/**
 * Löst einen CSV-Download im Browser aus.
 *
 * @param csv      Inhalt der CSV-Datei (von buildMatrixCsv).
 * @param filename Dateiname inkl. .csv-Endung.
 */
export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
