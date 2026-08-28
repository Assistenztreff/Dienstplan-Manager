import { listShifts, getBrandingSettings } from "@workspace/api-client-react";
import { format, differenceInMinutes } from "date-fns";
import { de } from "date-fns/locale";
import logoUrl from "@/assets/assistenzplaner-logo.png";
import { logoSrcFromPath } from "@/lib/logo";
import { formatDays } from "@/lib/utils";

const DEFAULT_LOGO_ASPECT = 3973 / 848;

// Rundet auf zwei Dezimalstellen (Client-seitige Hilfsfunktion für
// Differenzberechnungen aus bereits gerundeten API-Werten).
const r2 = (n: number) => Math.round(n * 100) / 100;

type LoadedImage = { dataUrl: string; aspect: number };

async function loadImageDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function imageAspectFromDataUrl(dataUrl: string): Promise<number | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : null);
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

async function brandingLogoPath(teamId?: number | null): Promise<string | null> {
  try {
    const branding = await getBrandingSettings(teamId != null ? { teamId } : undefined);
    return (branding as { logoPath?: string | null }).logoPath ?? null;
  } catch {
    return null;
  }
}

async function loadLogoImage(teamId?: number | null): Promise<LoadedImage | null> {
  // Logo-Fallback-Kette: teamspezifisches Logo → Konto-Logo des Team-Eigentümers
  // (server-seitig aufgelöst, siehe GET /branding-settings) → Standard-Logo.
  let path: string | null = null;
  if (teamId != null) path = await brandingLogoPath(teamId);
  if (!path) path = await brandingLogoPath();

  const customPath = logoSrcFromPath(path);
  if (customPath) {
    const dataUrl = await loadImageDataUrl(customPath);
    if (dataUrl) {
      const aspect = await imageAspectFromDataUrl(dataUrl);
      return { dataUrl, aspect: aspect ?? DEFAULT_LOGO_ASPECT };
    }
  }

  const fallback = await loadImageDataUrl(logoUrl);
  if (fallback) return { dataUrl: fallback, aspect: DEFAULT_LOGO_ASPECT };
  return null;
}

function logoImageFormat(dataUrl: string): "PNG" | "JPEG" {
  return dataUrl.startsWith("data:image/jpeg") || dataUrl.startsWith("data:image/jpg")
    ? "JPEG"
    : "PNG";
}

const SHIFT_TYPE_LABELS: Record<string, string> = {
  active: "Aktiv",
  standby: "Bereitschaft",
  night: "Nacht",
  full_day: "24h",
  vacation: "Urlaub",
  sick: "Krank",
  team: "Teamsitzung",
  freizeitausgleich: "Freizeitausgleich",
  kind_krank: "Kind krank",
  freistellung: "Freistellung",
  abgesagt_ag: "Abgesagt (AG)",
  abgesagt_an: "Abgesagt (AN)",
  urlaubsabgeltung: "Urlaubsabgeltung",
};

function hoursFromShift(startTime: string, endTime: string): number {
  const mins = differenceInMinutes(new Date(endTime), new Date(startTime));
  return Math.round((mins / 60) * 100) / 100;
}

/** Rendert eine Seite des Stundennachweises und gibt zurück, ob FIX-Schichten
 *  vorhanden waren (true) oder nur der "Keine Schichten"-Platzhalter gedruckt
 *  wurde (false). Der Rückgabewert steuert das Abort-Verhalten in
 *  exportStatementSectionsPdf. */
async function renderStatementPage(
  doc: any,
  autoTable: any,
  pageWidth: number,
  logo: LoadedImage | null,
  balance: any,
  month: number,
  year: number,
  monthLabel: string,
  teamId?: number | null,
): Promise<boolean> {
  // --- Header ---
  if (logo) {
    const logoW = 48;
    const logoH = logoW / logo.aspect;
    const logoX = pageWidth - 14 - logoW;
    const logoY = 12;
    doc.addImage(logo.dataUrl, logoImageFormat(logo.dataUrl), logoX, logoY, logoW, logoH);
  }

  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("Stundennachweis", 14, 20);

  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  doc.text(`Assistenzkraft: ${balance.userName}`, 14, 32);
  doc.text(`Monat: ${monthLabel}`, 14, 39);

  // --- Summary box ---
  const eur = (n: number) =>
    n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });

  const summaryRows: string[][] = [
    ["Soll-Stunden", `${balance.plannedHours} h`],
    ["Geleistete Stunden (gewertet)", `${balance.valuedHours} h`],
    [
      "Differenz",
      `${balance.balance > 0 ? "+" : ""}${balance.balance} h`,
    ],
    ["Erfuellt gesamt (inkl. Urlaub/Krank)", `${balance.totalFulfilledHours} h`],
    ["Urlaubsstunden (erfuellt)", `${balance.vacationFulfilledHours} h`],
    ["Krankheitsstunden", `${balance.sickHours} h`],
    [
      "Urlaubstage (genommen)",
      `${formatDays(balance.vacationDaysTaken)} Tage`,
    ],
    [
      "Urlaubstage (verbleibend)",
      `${formatDays(balance.vacationDaysRemaining)} Tage`,
    ],
  ];

  // Teamsitzung: nur ausweisen, wenn Stunden gutgeschrieben wurden (konsistent
  // zur Matrix-Zeile "Teamsitzung" in der Auswertung).
  if ((balance.teamsitzungStunden ?? 0) > 0) {
    summaryRows.push([
      "Teamsitzung (Gutschrift)",
      `${balance.teamsitzungStunden} h${
        balance.hourlyWage != null ? ` (${eur(balance.teamsitzungEuro ?? 0)})` : ""
      }`,
    ]);
  }

  // Neue Kategorien (konsistent zur Auswertungs-Matrix): nur ausweisen,
  // wenn Werte vorliegen — 0-Positionen blaehen den Nachweis nicht auf.
  // Info-Kennzahlen (nicht lohnrelevant) sind als solche gekennzeichnet.
  if ((balance.vertretungenAnzahl ?? 0) > 0 || (balance.vertretungsStunden ?? 0) > 0) {
    summaryRows.push([
      "Vertretungen (Info)",
      `${balance.vertretungenAnzahl ?? 0} (Anz.) / ${balance.vertretungsStunden ?? 0} h`,
    ]);
  }
  if ((balance.pausenzeitStunden ?? 0) > 0) {
    summaryRows.push(["Pausen (unbezahlt, Info)", `${balance.pausenzeitStunden} h`]);
  }
  if ((balance.kindKrankTage ?? 0) > 0) {
    summaryRows.push([
      "Kind krank (unbezahlt, Info)",
      `${formatDays(balance.kindKrankTage)} Tage`,
    ]);
  }
  if ((balance.freistellungStunden ?? 0) > 0 || (balance.freistellungTage ?? 0) > 0) {
    summaryRows.push([
      "Freistellung (bezahlt)",
      `${balance.freistellungStunden ?? 0} h (${formatDays(balance.freistellungTage ?? 0)} Tage)`,
    ]);
  }
  if ((balance.abgesagtArbeitgeberStunden ?? 0) > 0) {
    summaryRows.push([
      "Abgesagt durch Arbeitgeber (bezahlt)",
      `${balance.abgesagtArbeitgeberStunden} h`,
    ]);
  }
  if ((balance.abgesagtArbeitnehmerStunden ?? 0) > 0) {
    summaryRows.push([
      "Abgesagt durch Arbeitnehmer (unbezahlt, Info)",
      `${balance.abgesagtArbeitnehmerStunden} h`,
    ]);
  }

  // Zuschlaege: 0%-Zuschlaege werden NICHT aufgelistet.
  // Wenn Abwesenheits-Anteile vorhanden sind, wird je Zuschlags-Art in zwei
  // Zeilen aufgeteilt:
  //   1. Arbeitstag-Zuschlag (§ 3b EStG steuerfrei)
  //   2. Urlaub/Krank-Zuschlag (SV-pflichtig nach § 11 BUrlG / § 2 EFZG)
  // Ohne Abwesenheitsanteil erscheint eine einzige Zeile wie bisher.
  const absenceNightH = balance.absenceNightHours ?? 0;
  const absenceNightSurchargeH = balance.absenceNightSurchargeHours ?? 0;
  const absenceSundayH = balance.absenceSundayHours ?? 0;
  const absenceSundaySurchargeH = balance.absenceSundaySurchargeHours ?? 0;
  const absenceHolidayH = balance.absenceHolidayHours ?? 0;
  const absenceHolidaySurchargeH = balance.absenceHolidaySurchargeHours ?? 0;

  const workNightH = (balance.nightHours ?? 0) - absenceNightH;
  const workNightSurchargeH = (balance.nightSurchargeHours ?? 0) - absenceNightSurchargeH;
  const workSundayH = (balance.sundayHours ?? 0) - absenceSundayH;
  const workSundaySurchargeH = (balance.sundaySurchargeHours ?? 0) - absenceSundaySurchargeH;
  const workHolidayH = (balance.holidayHours ?? 0) - absenceHolidayH;
  const workHolidaySurchargeH = (balance.holidaySurchargeHours ?? 0) - absenceHolidaySurchargeH;

  if (balance.nightPercent > 0) {
    if (absenceNightH > 0 && workNightH > 0) {
      // Geteilte Anzeige: Arbeitstag (steuerfrei) + Abwesenheit (SV-pflichtig)
      summaryRows.push([
        `Nachtstunden, Arbeitstag (${balance.nightPercent}%, § 3b EStG)`,
        `${r2(workNightH)} h (+${r2(workNightSurchargeH)} h)`,
      ]);
      summaryRows.push([
        `Nachtstunden, Urlaub/Krank (${balance.nightPercent}%, SV-pflichtig)`,
        `${r2(absenceNightH)} h (+${r2(absenceNightSurchargeH)} h)`,
      ]);
    } else if (absenceNightH > 0) {
      // Nur Abwesenheits-Anteil vorhanden
      summaryRows.push([
        `Nachtstunden, Urlaub/Krank (${balance.nightPercent}%, SV-pflichtig)`,
        `${r2(absenceNightH)} h (+${r2(absenceNightSurchargeH)} h)`,
      ]);
    } else {
      // Nur Arbeitstag-Anteil (bisheriges Verhalten)
      summaryRows.push([
        `Nachtstunden (Zuschlag ${balance.nightPercent}%)`,
        `${balance.nightHours} h (+${balance.nightSurchargeHours} h)`,
      ]);
    }
  }
  if (balance.sundayPercent > 0) {
    if (absenceSundayH > 0 && workSundayH > 0) {
      summaryRows.push([
        `Sonntagsstunden, Arbeitstag (${balance.sundayPercent}%, § 3b EStG)`,
        `${r2(workSundayH)} h (+${r2(workSundaySurchargeH)} h)`,
      ]);
      summaryRows.push([
        `Sonntagsstunden, Urlaub/Krank (${balance.sundayPercent}%, SV-pflichtig)`,
        `${r2(absenceSundayH)} h (+${r2(absenceSundaySurchargeH)} h)`,
      ]);
    } else if (absenceSundayH > 0) {
      summaryRows.push([
        `Sonntagsstunden, Urlaub/Krank (${balance.sundayPercent}%, SV-pflichtig)`,
        `${r2(absenceSundayH)} h (+${r2(absenceSundaySurchargeH)} h)`,
      ]);
    } else {
      summaryRows.push([
        `Sonntagsstunden (Zuschlag ${balance.sundayPercent}%)`,
        `${balance.sundayHours} h (+${balance.sundaySurchargeHours} h)`,
      ]);
    }
  }
  if (balance.holidayPercent > 0) {
    if (absenceHolidayH > 0 && workHolidayH > 0) {
      summaryRows.push([
        `Feiertagsstunden, Arbeitstag (${balance.holidayPercent}%, § 3b EStG)`,
        `${r2(workHolidayH)} h (+${r2(workHolidaySurchargeH)} h)`,
      ]);
      summaryRows.push([
        `Feiertagsstunden, Urlaub/Krank (${balance.holidayPercent}%, SV-pflichtig)`,
        `${r2(absenceHolidayH)} h (+${r2(absenceHolidaySurchargeH)} h)`,
      ]);
    } else if (absenceHolidayH > 0) {
      summaryRows.push([
        `Feiertagsstunden, Urlaub/Krank (${balance.holidayPercent}%, SV-pflichtig)`,
        `${r2(absenceHolidayH)} h (+${r2(absenceHolidaySurchargeH)} h)`,
      ]);
    } else {
      summaryRows.push([
        `Feiertagsstunden (Zuschlag ${balance.holidayPercent}%)`,
        `${balance.holidayHours} h (+${balance.holidaySurchargeHours} h)`,
      ]);
    }
  }

  // Lohnauswertung (Premium): nur wenn ein Stundenlohn hinterlegt ist. Geld
  // folgt der Abrechnungsart (SOLL/IST) — gleiche Basis wie die Stunden-
  // Spalten. 0%-Zuschlaege werden nicht aufgelistet.
  if (balance.hourlyWage != null) {
    const basisLabel = balance.billingMethod === "IST" ? "Ist" : "Soll";
    summaryRows.push(["Stundenlohn", eur(balance.hourlyWage)]);
    summaryRows.push([`Grundlohn (${basisLabel})`, eur(balance.basePay ?? 0)]);
    if (balance.nightPercent > 0 && (balance.nightSurchargePay ?? 0) !== 0) {
      const absenceNightPay = balance.absenceNightSurchargePay ?? 0;
      const workNightPay = (balance.nightSurchargePay ?? 0) - absenceNightPay;
      if (absenceNightPay > 0 && workNightPay > 0) {
        summaryRows.push([`Nachtzuschlag (§ 3b EStG steuerfrei)`, eur(workNightPay)]);
        summaryRows.push([`Nachtzuschlag (SV-pflichtig)`, eur(absenceNightPay)]);
      } else if (absenceNightPay > 0) {
        summaryRows.push([`Nachtzuschlag (SV-pflichtig)`, eur(absenceNightPay)]);
      } else {
        summaryRows.push(["Nachtzuschlag", eur(balance.nightSurchargePay ?? 0)]);
      }
    }
    if (balance.sundayPercent > 0 && (balance.sundaySurchargePay ?? 0) !== 0) {
      const absenceSundayPay = balance.absenceSundaySurchargePay ?? 0;
      const workSundayPay = (balance.sundaySurchargePay ?? 0) - absenceSundayPay;
      if (absenceSundayPay > 0 && workSundayPay > 0) {
        summaryRows.push([`Sonntagszuschlag (§ 3b EStG steuerfrei)`, eur(workSundayPay)]);
        summaryRows.push([`Sonntagszuschlag (SV-pflichtig)`, eur(absenceSundayPay)]);
      } else if (absenceSundayPay > 0) {
        summaryRows.push([`Sonntagszuschlag (SV-pflichtig)`, eur(absenceSundayPay)]);
      } else {
        summaryRows.push(["Sonntagszuschlag", eur(balance.sundaySurchargePay ?? 0)]);
      }
    }
    if (balance.holidayPercent > 0 && (balance.holidaySurchargePay ?? 0) !== 0) {
      const absenceHolidayPay = balance.absenceHolidaySurchargePay ?? 0;
      const workHolidayPay = (balance.holidaySurchargePay ?? 0) - absenceHolidayPay;
      if (absenceHolidayPay > 0 && workHolidayPay > 0) {
        summaryRows.push([`Feiertagszuschlag (§ 3b EStG steuerfrei)`, eur(workHolidayPay)]);
        summaryRows.push([`Feiertagszuschlag (SV-pflichtig)`, eur(absenceHolidayPay)]);
      } else if (absenceHolidayPay > 0) {
        summaryRows.push([`Feiertagszuschlag (SV-pflichtig)`, eur(absenceHolidayPay)]);
      } else {
        summaryRows.push(["Feiertagszuschlag", eur(balance.holidaySurchargePay ?? 0)]);
      }
    }
    summaryRows.push(["Gesamtlohn (brutto)", eur(balance.totalPay ?? 0)]);
    // Urlaubsabgeltung ist eine separate Auszahlung und bewusst NICHT im
    // Gesamtlohn enthalten — eigene, klar beschriftete Euro-Position danach.
    if ((balance.urlaubsabgeltungEuro ?? 0) > 0) {
      summaryRows.push([
        "Urlaubsabgeltung (zusaetzlich, nicht im Gesamtlohn)",
        eur(balance.urlaubsabgeltungEuro ?? 0),
      ]);
    }
  }

  autoTable(doc, {
    startY: 46,
    head: [["Kennzahl", "Wert"]],
    body: summaryRows,
    theme: "grid",
    headStyles: { fillColor: [40, 40, 40], textColor: 255, fontStyle: "bold" },
    columnStyles: { 0: { fontStyle: "bold" }, 1: { halign: "right" } },
    styles: { fontSize: 10 },
    margin: { left: 14, right: 14 },
  });

  // --- Shift detail table ---
  let shifts: any[] = [];
  try {
    shifts = await listShifts({
      userId: balance.userId,
      month,
      year,
      ...(teamId != null ? { teamId } : {}),
    });
  } catch {
    shifts = [];
  }

  const detailRows = shifts
    // Nur verbindlich bestätigte (FIX) Schichten gehören in den offiziellen
    // Stundennachweis; Entwürfe/Vorschläge bleiben unverbindlich.
    .filter((s: any) => s.planningStatus === "FIX")
    .map((s: any) => {
      const date = format(new Date(s.startTime), "dd.MM.yyyy", { locale: de });
      const type = SHIFT_TYPE_LABELS[s.type] ?? s.type;
      const hours = hoursFromShift(s.startTime, s.endTime);
      const timeRange = `${format(new Date(s.startTime), "HH:mm")} – ${format(new Date(s.endTime), "HH:mm")}`;
      return [date, type, timeRange, `${hours} h`];
    });

  const tableY = (doc as any).lastAutoTable?.finalY
    ? (doc as any).lastAutoTable.finalY + 10
    : 100;

  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("Schichtdetails", 14, tableY);

  if (detailRows.length > 0) {
    autoTable(doc, {
      startY: tableY + 5,
      head: [["Datum", "Typ", "Uhrzeit", "Stunden"]],
      body: detailRows,
      theme: "striped",
      headStyles: { fillColor: [40, 40, 40], textColor: 255, fontStyle: "bold" },
      columnStyles: { 3: { halign: "right" } },
      styles: { fontSize: 9 },
      margin: { left: 14, right: 14, bottom: 40 },
    });
  } else {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text("Keine Schichten in diesem Monat.", 14, tableY + 10);
  }

  return detailRows.length > 0;
}

export type StatementSection = {
  balance: any;
  month: number;
  year: number;
  monthLabel: string;
};

// Nachberechnungs-Anhang je exportiertem Monat: Differenzen des (abgeschlossenen)
// Vormonats, die in die Abrechnung dieses Monats einfließen.
export type StatementRecalculation = {
  monthLabel: string; // Monat, in dessen Abrechnung die Nachberechnung einfließt
  prevLabel: string; // abgeschlossener Vormonat
  closedAt?: string;
  rows: Array<{
    userName: string;
    diffHours: number;
    diffPay: number | null;
    diffBasePay: number | null;
    diffSurchargePay: number | null;
    // Abwesenheits-Anteil (Lohnfortzahlung) im aktuellen Stand des Vormonats —
    // analog zur Infokarte („davon Urlaub / Krankheit").
    vacationHours?: number;
    vacationPay?: number | null;
    sickHours?: number;
    sickPay?: number | null;
  }>;
  // Geld-Summen des exportierten Monats (nur Balances mit Lohnwerten); null,
  // wenn keine Lohnauswertung vorliegt.
  monthTotals: { basePay: number; surchargePay: number; totalPay: number } | null;
};

export type ExportStatementSectionsOptions = {
  sections: StatementSection[];
  teamId?: number | null;
  filename: string;
  recalculations?: StatementRecalculation[];
};

// Eigene Seite je Nachberechnung: Differenz-Tabelle des Vormonats + Summen
// des exportierten Monats inkl. der Nachberechnung als eigene Position.
export function renderRecalculationPage(
  doc: any,
  autoTable: any,
  recalc: StatementRecalculation,
) {
  const eur = (n: number) =>
    n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
  const signedEur = (n: number) => `${n > 0 ? "+" : ""}${eur(n)}`;

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(`Nachberechnung ${recalc.prevLabel}`, 14, 20);

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(
    `Der Monat ${recalc.prevLabel} wurde nach dem Abschluss geändert. Die Differenzen`,
    14,
    30,
  );
  doc.text(`sind in der Abrechnung ${recalc.monthLabel} zu berücksichtigen.`, 14, 36);

  const hoursDe = (n: number) =>
    n.toLocaleString("de-DE", { maximumFractionDigits: 2 });
  // Abwesenheits-Spalte („davon Urlaub / Krankheit") nur rendern, wenn
  // mindestens eine Zeile einen Urlaubs-/Krankheitsanteil trägt.
  const hasAbsence = recalc.rows.some(
    (r) => (r.vacationHours ?? 0) > 0 || (r.sickHours ?? 0) > 0,
  );
  const absenceCell = (r: StatementRecalculation["rows"][number]) => {
    const parts: string[] = [];
    if ((r.vacationHours ?? 0) > 0) {
      parts.push(
        `Urlaub ${hoursDe(r.vacationHours ?? 0)} h${r.vacationPay != null ? ` (${eur(r.vacationPay)})` : ""}`,
      );
    }
    if ((r.sickHours ?? 0) > 0) {
      parts.push(
        `Krankheit ${hoursDe(r.sickHours ?? 0)} h${r.sickPay != null ? ` (${eur(r.sickPay)})` : ""}`,
      );
    }
    return parts.length > 0 ? parts.join("\n") : "—";
  };

  autoTable(doc, {
    startY: 44,
    head: [
      [
        "Assistenzkraft",
        "Differenz Stunden",
        "Grundlohn",
        "Zuschläge",
        "Gesamt",
        ...(hasAbsence ? ["davon Urlaub / Krankheit"] : []),
      ],
    ],
    body: recalc.rows.map((r) => [
      r.userName,
      `${r.diffHours > 0 ? "+" : ""}${hoursDe(r.diffHours)} h`,
      r.diffBasePay != null ? signedEur(r.diffBasePay) : "—",
      r.diffSurchargePay != null ? signedEur(r.diffSurchargePay) : "—",
      r.diffPay != null ? signedEur(r.diffPay) : "—",
      ...(hasAbsence ? [absenceCell(r)] : []),
    ]),
    theme: "grid",
    headStyles: { fillColor: [40, 40, 40], textColor: 255, fontStyle: "bold" },
    columnStyles: {
      1: { halign: "right" },
      2: { halign: "right" },
      3: { halign: "right" },
      4: { halign: "right" },
      ...(hasAbsence ? { 5: { halign: "right" } } : {}),
    },
    styles: { fontSize: 10 },
    margin: { left: 14, right: 14 },
  });

  if (recalc.monthTotals) {
    const recalcTotal = recalc.rows.reduce((s, r) => s + (r.diffPay ?? 0), 0);
    const y = ((doc as any).lastAutoTable?.finalY ?? 80) + 10;
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text(`Gesamtsummen ${recalc.monthLabel}`, 14, y);
    autoTable(doc, {
      startY: y + 5,
      head: [["Position", "Betrag"]],
      body: [
        ["Grundlohn", eur(recalc.monthTotals.basePay)],
        ["Zuschläge (Nacht/Sonntag/Feiertag)", eur(recalc.monthTotals.surchargePay)],
        [`Gesamtlohn ${recalc.monthLabel}`, eur(recalc.monthTotals.totalPay)],
        [`Nachberechnung ${recalc.prevLabel}`, signedEur(recalcTotal)],
        ["Gesamt inkl. Nachberechnung", eur(recalc.monthTotals.totalPay + recalcTotal)],
      ],
      theme: "grid",
      headStyles: { fillColor: [40, 40, 40], textColor: 255, fontStyle: "bold" },
      columnStyles: { 0: { fontStyle: "bold" }, 1: { halign: "right" } },
      styles: { fontSize: 10 },
      margin: { left: 14, right: 14 },
    });
  }
}

/**
 * Kern-Export: rendert pro Section eine eigene Seite (Kennzahlen + Schichtdetails).
 * Wird sowohl vom Einzel-/Monats-Export als auch vom Zeitraum-Export genutzt.
 */
/** Erzeugt den Premium-Stundennachweis als PDF und gibt `true` zurück, wenn
 *  mindestens eine Seite tatsächliche FIX-Schichten oder Nachberechnungen
 *  enthielt. Gibt `false` zurück wenn für alle Assistentinnen im gewählten
 *  Zeitraum keine bestätigten (FIX) Einträge vorliegen — analog zum Abort-Pfad
 *  des Free-Plan-Exports (exportSimpleMonthPdf). */
export async function exportStatementSectionsPdf({
  sections,
  teamId,
  filename,
  recalculations,
}: ExportStatementSectionsOptions): Promise<boolean> {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const logo = await loadLogoImage(teamId);
  let firstPage = true;
  let hasAnyFixContent = false;

  for (const section of sections) {
    if (!firstPage) doc.addPage();
    firstPage = false;

    const hadContent = await renderStatementPage(
      doc,
      autoTable,
      pageWidth,
      logo,
      section.balance,
      section.month,
      section.year,
      section.monthLabel,
      teamId,
    );
    if (hadContent) hasAnyFixContent = true;
  }

  for (const recalc of recalculations ?? []) {
    if (recalc.rows.length === 0) continue;
    if (!firstPage) doc.addPage();
    firstPage = false;
    renderRecalculationPage(doc, autoTable, recalc);
    hasAnyFixContent = true;
  }

  // Kein einziger bestätigter Eintrag im gesamten Zeitraum → PDF nicht speichern.
  if (!hasAnyFixContent) return false;

  addSignatureFooter(doc, pageWidth);
  doc.save(filename);
  return true;
}

// Unterschriftsfeld + Footer auf jeder Seite — geteilt zwischen dem
// Premium-Stundennachweis und dem einfachen Monats-Export.
function addSignatureFooter(doc: any, pageWidth: number) {
  const pageHeight = doc.internal.pageSize.getHeight();
  const createdLabel = `Erstellt am ${format(new Date(), "dd.MM.yyyy", { locale: de })}`;
  const pageCount = doc.getNumberOfPages();

  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);

    const sigY = pageHeight - 24;
    doc.setDrawColor(60);
    doc.setLineWidth(0.3);
    doc.line(14, sigY, 64, sigY);
    doc.line(80, sigY, pageWidth - 14, sigY);

    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(60);
    doc.text("Datum", 14, sigY + 5);
    doc.text("Unterschrift Arbeitgeber", 80, sigY + 5);

    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(createdLabel, 14, pageHeight - 10);
    doc.text(`Seite ${i} von ${pageCount}`, pageWidth - 14, pageHeight - 10, {
      align: "right",
    });
    doc.setTextColor(0);
  }
}

// ---------------------------------------------------------------------------
// Einfacher Monats-Export (Free-Feature "basicExport")
// ---------------------------------------------------------------------------
// Basiert AUSSCHLIESSLICH auf der Schichtliste (GET /shifts) — KEINE
// Zeiterfassung, kein Soll/Ist, keine Zuschlaege (das bleibt Premium via
// hours-balance). Enthaelt bestaetigte (FIX) Dienste UND Abwesenheiten
// (Urlaub/Krank), damit auch Free-Konten und Assistenzkraefte einen
// vollstaendigen Monatsueberblick als PDF bekommen.

const ABSENCE_TYPES = new Set([
  "vacation",
  "sick",
  "freizeitausgleich",
  "kind_krank",
  "freistellung",
  "abgesagt_ag",
  "abgesagt_an",
  "urlaubsabgeltung",
]);

export type SimpleMonthShift = {
  userId: number;
  startTime: string;
  endTime: string;
  type: string;
  planningStatus?: string | null;
  user?: { name?: string } | null;
};

export type ExportSimpleMonthOptions = {
  shifts: SimpleMonthShift[];
  users: Array<{ id: number; name: string }>;
  month: number;
  year: number;
  monthLabel: string;
  teamId?: number | null;
  filename?: string;
};

// ---------------------------------------------------------------------------
// Hilfsfunktionen für das neue Zwei-Seiten-Übersichts-Layout
// ---------------------------------------------------------------------------

function getDaysInMonth(year: number, month: number): Date[] {
  const days: Date[] = [];
  const d = new Date(year, month - 1, 1);
  while (d.getMonth() === month - 1) {
    days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

const WEEKDAY_ABBR = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

/** Einfacher Footer ohne Unterschriftsfeld (für die Übersichtsseiten). */
function addSimpleFooter(doc: any, pageWidth: number) {
  const pageHeight = doc.internal.pageSize.getHeight();
  const createdLabel = `Erstellt am ${format(new Date(), "dd.MM.yyyy", { locale: de })}`;
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(120);
    doc.text(createdLabel, 14, pageHeight - 8);
    doc.text(`Seite ${i} von ${pageCount}`, pageWidth - 14, pageHeight - 8, { align: "right" });
    doc.setTextColor(0);
  }
}

/** Kompakter Text für eine Schicht in einer Tabellenzelle. */
function shiftCellText(s: SimpleMonthShift): string {
  if (ABSENCE_TYPES.has(s.type)) return SHIFT_TYPE_LABELS[s.type] ?? s.type;
  if (s.type === "team") return "Teamsitzung";
  const start = format(new Date(s.startTime), "HH:mm");
  const end = format(new Date(s.endTime), "HH:mm");
  const h = hoursFromShift(s.startTime, s.endTime);
  return `${start}–${end}\n${h} h`;
}

/**
 * Seite 1: Kalenderübersicht — alle Tage des Monats als Zeilen,
 * je eine Spalte pro Assistenzkraft.
 */
function renderCalendarOverviewPage(
  doc: any,
  autoTable: any,
  pageWidth: number,
  logo: LoadedImage | null,
  sections: Array<{ user: { id: number; name: string }; rows: SimpleMonthShift[] }>,
  monthLabel: string,
  year: number,
  month: number,
): void {
  if (logo) {
    const logoW = 40;
    const logoH = logoW / logo.aspect;
    doc.addImage(logo.dataUrl, logoImageFormat(logo.dataUrl), pageWidth - 14 - logoW, 7, logoW, logoH);
  }
  doc.setFontSize(15);
  doc.setFont("helvetica", "bold");
  doc.text("Monatsübersicht", 14, 15);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(`Monat: ${monthLabel}`, 14, 21);

  // Lookup: userId → dateKey → shifts[]
  const byUserByDay = new Map<number, Map<string, SimpleMonthShift[]>>();
  for (const section of sections) {
    const byDay = new Map<string, SimpleMonthShift[]>();
    for (const shift of section.rows) {
      const day = format(new Date(shift.startTime), "yyyy-MM-dd");
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day)!.push(shift);
    }
    byUserByDay.set(section.user.id, byDay);
  }

  const days = getDaysInMonth(year, month);

  const head = [["Datum", ...sections.map((s) => s.user.name)]];
  const body = days.map((day) => {
    const dateKey = format(day, "yyyy-MM-dd");
    const dateLabel = `${WEEKDAY_ABBR[day.getDay()]}, ${format(day, "dd.MM.")}`;
    const cells = sections.map((section) => {
      const dayShifts = byUserByDay.get(section.user.id)?.get(dateKey) ?? [];
      if (dayShifts.length === 0) return "";
      return dayShifts
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
        .map(shiftCellText)
        .join("\n");
    });
    return [dateLabel, ...cells];
  });

  const contentWidth = pageWidth - 28; // 14 mm Rand je Seite
  const dateColW = 20;
  const assistantColW = Math.max(18, (contentWidth - dateColW) / sections.length);

  const columnStyles: Record<number, any> = {
    0: { cellWidth: dateColW, fontStyle: "bold", halign: "left" },
  };
  for (let i = 1; i <= sections.length; i++) {
    columnStyles[i] = { cellWidth: assistantColW, halign: "center" };
  }

  autoTable(doc, {
    startY: 26,
    head,
    body,
    theme: "grid",
    headStyles: {
      fillColor: [40, 40, 40],
      textColor: 255,
      fontStyle: "bold",
      fontSize: 7,
      halign: "center",
    },
    columnStyles,
    styles: { fontSize: 7, cellPadding: 1.5, overflow: "linebreak" },
    margin: { left: 14, right: 14, bottom: 16 },
    didParseCell: (data: any) => {
      if (data.section === "body") {
        const day = days[data.row.index];
        if (day && (day.getDay() === 0 || day.getDay() === 6)) {
          data.cell.styles.fillColor = [242, 242, 242];
          data.cell.styles.textColor = [100, 100, 100];
        }
      }
    },
  });
}

/**
 * Seite 2: Kennzahlen-Übersicht — KPIs als Zeilen,
 * je eine Spalte pro Assistenzkraft.
 */
function renderKennzahlenOverviewPage(
  doc: any,
  autoTable: any,
  pageWidth: number,
  logo: LoadedImage | null,
  sections: Array<{ user: { id: number; name: string }; rows: SimpleMonthShift[] }>,
  monthLabel: string,
): void {
  if (logo) {
    const logoW = 40;
    const logoH = logoW / logo.aspect;
    doc.addImage(logo.dataUrl, logoImageFormat(logo.dataUrl), pageWidth - 14 - logoW, 7, logoW, logoH);
  }
  doc.setFontSize(15);
  doc.setFont("helvetica", "bold");
  doc.text("Kennzahlen-Übersicht", 14, 15);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(`Monat: ${monthLabel}`, 14, 21);

  const stats = sections.map(({ rows }) => {
    const workShifts = rows.filter((s) => !ABSENCE_TYPES.has(s.type) && s.type !== "team");
    const vacationDays = rows.filter((s) => s.type === "vacation").length;
    const sickDays = rows.filter((s) => s.type === "sick").length;
    const teamDays = rows.filter((s) => s.type === "team").length;
    const plannedHours =
      Math.round(
        workShifts.reduce((sum, s) => sum + hoursFromShift(s.startTime, s.endTime), 0) * 100,
      ) / 100;
    return { plannedHours, serviceCount: workShifts.length, vacationDays, sickDays, teamDays };
  });

  const head = [["Kennzahl", ...sections.map((s) => s.user.name)]];
  const body: string[][] = [
    ["Geplante Stunden (bestätigte Dienste)", ...stats.map((s) => `${s.plannedHours} h`)],
    ["Anzahl Dienste", ...stats.map((s) => `${s.serviceCount}`)],
    ["Urlaubstage", ...stats.map((s) => `${s.vacationDays} ${s.vacationDays === 1 ? "Tag" : "Tage"}`)],
    ["Krankheitstage", ...stats.map((s) => `${s.sickDays} ${s.sickDays === 1 ? "Tag" : "Tage"}`)],
    ...(stats.some((s) => s.teamDays > 0)
      ? [["Teamsitzungen", ...stats.map((s) => `${s.teamDays} ${s.teamDays === 1 ? "Tag" : "Tage"}`)] as string[]]
      : []),
  ];

  const contentWidth = pageWidth - 28;
  const kennzahlColW = Math.min(80, contentWidth * 0.35);
  const assistantColW = Math.max(18, (contentWidth - kennzahlColW) / sections.length);

  const columnStyles: Record<number, any> = {
    0: { cellWidth: kennzahlColW, fontStyle: "bold" },
  };
  for (let i = 1; i <= sections.length; i++) {
    columnStyles[i] = { cellWidth: assistantColW, halign: "center" };
  }

  autoTable(doc, {
    startY: 26,
    head,
    body,
    theme: "grid",
    headStyles: {
      fillColor: [40, 40, 40],
      textColor: 255,
      fontStyle: "bold",
      fontSize: 9,
      halign: "center",
    },
    columnStyles,
    styles: { fontSize: 9, cellPadding: 3 },
    margin: { left: 14, right: 14, bottom: 16 },
  });
}

/**
 * Einfacher Monats-Export (Free): kompakte Zwei-Seiten-Übersicht.
 *
 * Seite 1 — Kalenderübersicht: alle Tage des Monats als Zeilen,
 *   je eine Spalte pro Assistenzkraft mit ihren bestätigten Diensten/Abwesenheiten.
 * Seite 2 — Kennzahlen: KPIs (Stunden, Dienste, Urlaub, Krank) als Zeilen,
 *   je eine Spalte pro Assistenzkraft für den schnellen Quervergleich.
 *
 * Basiert ausschließlich auf FIX-Schichten (keine Zeiterfassung).
 */
export async function exportSimpleMonthPdf({
  shifts,
  users,
  month,
  year,
  monthLabel,
  teamId,
  filename,
}: ExportSimpleMonthOptions): Promise<boolean> {
  // Nur verbindlich bestaetigte (FIX) Eintraege.
  const fixShifts = shifts.filter((s) => (s.planningStatus ?? "FIX") === "FIX");

  const byUser = new Map<number, SimpleMonthShift[]>();
  for (const s of fixShifts) {
    if (!byUser.has(s.userId)) byUser.set(s.userId, []);
    byUser.get(s.userId)!.push(s);
  }

  // Alle übergebenen Nutzer behalten — auch ohne Einträge erscheinen sie als
  // leere Spalten (gibt dem Dienstleister den vollständigen Teamüberblick).
  const sections = users.map((u) => ({ user: u, rows: byUser.get(u.id) ?? [] }));

  // Abbrechen nur, wenn wirklich niemand einen Eintrag hat.
  if (sections.every((s) => s.rows.length === 0)) return false;

  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const logo = await loadLogoImage(teamId);

  // Seite 1: Kalenderübersicht (Datum × Assistenzkraft)
  renderCalendarOverviewPage(doc, autoTable, pageWidth, logo, sections, monthLabel, year, month);

  // Seite 2: Kennzahlen-Übersicht (KPI × Assistenzkraft)
  doc.addPage();
  renderKennzahlenOverviewPage(doc, autoTable, pageWidth, logo, sections, monthLabel);

  addSimpleFooter(doc, pageWidth);

  doc.save(
    filename ?? `Monatsuebersicht_${year}_${String(month).padStart(2, "0")}.pdf`,
  );
  return true;
}

/**
 * Erzeugt den Stundennachweis für EINE Assistenzkraft als Uint8Array-Blob
 * (statt als Datei-Download). Wird vom ZIP-Sammel-Export genutzt.
 *
 * Gibt `null` zurück, wenn der Assistent keine bestätigten Dienste hat —
 * konsistent mit dem Abort-Verhalten von exportStatementSectionsPdf.
 */
export async function generateLohnnachweisPdfBlob(
  balance: any,
  month: number,
  year: number,
  monthLabel: string,
  teamId?: number | null,
): Promise<Uint8Array | null> {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const logo = await loadLogoImage(teamId);

  const hadContent = await renderStatementPage(
    doc,
    autoTable,
    pageWidth,
    logo,
    balance,
    month,
    year,
    monthLabel,
    teamId,
  );
  if (!hadContent) return null;

  addSignatureFooter(doc, pageWidth);
  return new Uint8Array(doc.output("arraybuffer") as ArrayBuffer);
}

export type ExportHoursStatementOptions = {
  balances: any[];
  month: number;
  year: number;
  monthLabel: string;
  teamId?: number | null;
  filename?: string;
};

/**
 * Einzel-/Monats-Export: alle übergebenen Balances betreffen denselben Monat,
 * eine Seite pro Balance. Baut auf der gemeinsamen PDF-Logik auf.
 */
export async function exportHoursStatementPdf({
  balances,
  month,
  year,
  monthLabel,
  teamId,
  filename,
}: ExportHoursStatementOptions) {
  await exportStatementSectionsPdf({
    sections: balances.map((balance) => ({ balance, month, year, monthLabel })),
    teamId,
    filename:
      filename ?? `Stundennachweis_${year}_${String(month).padStart(2, "0")}.pdf`,
  });
}
