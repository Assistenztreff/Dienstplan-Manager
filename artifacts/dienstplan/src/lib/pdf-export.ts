import { listShifts, getBrandingSettings } from "@workspace/api-client-react";
import { format, differenceInMinutes } from "date-fns";
import { de } from "date-fns/locale";
import logoUrl from "@assets/20260626_094418_0000_1782459883949.png";
import { logoSrcFromPath } from "@/lib/logo";
import { formatDays } from "@/lib/utils";

const DEFAULT_LOGO_ASPECT = 3973 / 848;

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
};

function hoursFromShift(startTime: string, endTime: string): number {
  const mins = differenceInMinutes(new Date(endTime), new Date(startTime));
  return Math.round((mins / 60) * 100) / 100;
}

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
) {
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
  doc.text(`Assistent: ${balance.userName}`, 14, 32);
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

  // Zuschlaege: 0%-Zuschlaege werden NICHT aufgelistet (Point 6).
  if (balance.nightPercent > 0) {
    summaryRows.push([
      `Nachtstunden (Zuschlag ${balance.nightPercent}%)`,
      `${balance.nightHours} h (+${balance.nightSurchargeHours} h)`,
    ]);
  }
  if (balance.sundayPercent > 0) {
    summaryRows.push([
      `Sonntagsstunden (Zuschlag ${balance.sundayPercent}%)`,
      `${balance.sundayHours} h (+${balance.sundaySurchargeHours} h)`,
    ]);
  }
  if (balance.holidayPercent > 0) {
    summaryRows.push([
      `Feiertagsstunden (Zuschlag ${balance.holidayPercent}%)`,
      `${balance.holidayHours} h (+${balance.holidaySurchargeHours} h)`,
    ]);
  }

  // Lohnauswertung (Premium): nur wenn ein Stundenlohn hinterlegt ist. Geld
  // ist stets IST-basiert (bestaetigte Ist-Zeiten). 0%-Zuschlaege werden nicht
  // aufgelistet.
  if (balance.hourlyWage != null) {
    summaryRows.push(["Stundenlohn", eur(balance.hourlyWage)]);
    summaryRows.push(["Grundlohn (Ist)", eur(balance.basePay ?? 0)]);
    if (balance.nightPercent > 0 && (balance.nightSurchargePay ?? 0) !== 0) {
      summaryRows.push(["Nachtzuschlag", eur(balance.nightSurchargePay ?? 0)]);
    }
    if (balance.sundayPercent > 0 && (balance.sundaySurchargePay ?? 0) !== 0) {
      summaryRows.push(["Sonntagszuschlag", eur(balance.sundaySurchargePay ?? 0)]);
    }
    if (balance.holidayPercent > 0 && (balance.holidaySurchargePay ?? 0) !== 0) {
      summaryRows.push(["Feiertagszuschlag", eur(balance.holidaySurchargePay ?? 0)]);
    }
    summaryRows.push(["Gesamtlohn (brutto)", eur(balance.totalPay ?? 0)]);
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
}

export type StatementSection = {
  balance: any;
  month: number;
  year: number;
  monthLabel: string;
};

export type ExportStatementSectionsOptions = {
  sections: StatementSection[];
  teamId?: number | null;
  filename: string;
};

/**
 * Kern-Export: rendert pro Section eine eigene Seite (Kennzahlen + Schichtdetails).
 * Wird sowohl vom Einzel-/Monats-Export als auch vom Zeitraum-Export genutzt.
 */
export async function exportStatementSectionsPdf({
  sections,
  teamId,
  filename,
}: ExportStatementSectionsOptions) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const logo = await loadLogoImage(teamId);
  let firstPage = true;

  for (const section of sections) {
    if (!firstPage) doc.addPage();
    firstPage = false;

    await renderStatementPage(
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
  }

  addSignatureFooter(doc, pageWidth);

  doc.save(filename);
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

const ABSENCE_TYPES = new Set(["vacation", "sick"]);

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

function renderSimpleMonthPage(
  doc: any,
  autoTable: any,
  pageWidth: number,
  logo: LoadedImage | null,
  userName: string,
  shifts: SimpleMonthShift[],
  monthLabel: string,
) {
  // --- Header ---
  if (logo) {
    const logoW = 48;
    const logoH = logoW / logo.aspect;
    doc.addImage(logo.dataUrl, logoImageFormat(logo.dataUrl), pageWidth - 14 - logoW, 12, logoW, logoH);
  }

  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("Monatsübersicht", 14, 20);

  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  doc.text(`Assistent: ${userName}`, 14, 32);
  doc.text(`Monat: ${monthLabel}`, 14, 39);

  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(
    "Einfacher Monats-Export: geplante, bestätigte Dienste und Abwesenheiten — ohne Zeiterfassung.",
    14,
    45,
  );
  doc.setTextColor(0);

  const workShifts = shifts.filter((s) => !ABSENCE_TYPES.has(s.type));
  const vacationDays = shifts.filter((s) => s.type === "vacation").length;
  const sickDays = shifts.filter((s) => s.type === "sick").length;
  const plannedHours =
    Math.round(
      workShifts.reduce((sum, s) => sum + hoursFromShift(s.startTime, s.endTime), 0) * 100,
    ) / 100;

  const summaryRows = [
    ["Geplante Stunden (bestätigte Dienste)", `${plannedHours} h`],
    ["Anzahl Dienste", `${workShifts.length}`],
    ["Urlaubstage", `${vacationDays} ${vacationDays === 1 ? "Tag" : "Tage"}`],
    ["Krankheitstage", `${sickDays} ${sickDays === 1 ? "Tag" : "Tage"}`],
  ];

  autoTable(doc, {
    startY: 50,
    head: [["Kennzahl", "Wert"]],
    body: summaryRows,
    theme: "grid",
    headStyles: { fillColor: [40, 40, 40], textColor: 255, fontStyle: "bold" },
    columnStyles: { 0: { fontStyle: "bold" }, 1: { halign: "right" } },
    styles: { fontSize: 10 },
    margin: { left: 14, right: 14 },
  });

  // --- Detail table (chronologisch, Abwesenheiten ganztaegig ohne Uhrzeit) ---
  const detailRows = [...shifts]
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    .map((s) => {
      const date = format(new Date(s.startTime), "dd.MM.yyyy", { locale: de });
      const type = SHIFT_TYPE_LABELS[s.type] ?? s.type;
      if (ABSENCE_TYPES.has(s.type)) {
        return [date, type, "ganztägig", "1 Tag"];
      }
      const timeRange = `${format(new Date(s.startTime), "HH:mm")} – ${format(new Date(s.endTime), "HH:mm")}`;
      return [date, type, timeRange, `${hoursFromShift(s.startTime, s.endTime)} h`];
    });

  const tableY = (doc as any).lastAutoTable?.finalY
    ? (doc as any).lastAutoTable.finalY + 10
    : 100;

  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("Dienste und Abwesenheiten", 14, tableY);

  if (detailRows.length > 0) {
    autoTable(doc, {
      startY: tableY + 5,
      head: [["Datum", "Typ", "Uhrzeit", "Umfang"]],
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
    doc.text("Keine bestätigten Dienste oder Abwesenheiten in diesem Monat.", 14, tableY + 10);
  }
}

/**
 * Einfacher Monats-Export (Free): eine Seite pro Assistent mit bestätigten
 * (FIX) Diensten und Abwesenheiten (Urlaub/Krank) — ohne Zeiterfassungsdaten.
 * Fuer Team-Admins (alle bzw. gefilterte Assistenten) und Assistenzkraefte
 * (nur die eigenen Dienste, serverseitig gescoped).
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
  // Nur verbindlich bestaetigte (FIX) Eintraege — Entwuerfe/Vorschlaege bleiben
  // unverbindlich (gleiche Regel wie beim Premium-Stundennachweis).
  const fixShifts = shifts.filter((s) => (s.planningStatus ?? "FIX") === "FIX");

  const byUser = new Map<number, SimpleMonthShift[]>();
  for (const s of fixShifts) {
    if (!byUser.has(s.userId)) byUser.set(s.userId, []);
    byUser.get(s.userId)!.push(s);
  }

  // Nur Assistenten mit mindestens einem Eintrag — sonst entstehen beim
  // "Alle"-Export viele leere Seiten.
  const sections = users
    .map((u) => ({ user: u, rows: byUser.get(u.id) ?? [] }))
    .filter((s) => s.rows.length > 0);

  if (sections.length === 0) return false;

  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const logo = await loadLogoImage(teamId);
  let firstPage = true;

  for (const section of sections) {
    if (!firstPage) doc.addPage();
    firstPage = false;
    renderSimpleMonthPage(
      doc,
      autoTable,
      pageWidth,
      logo,
      section.user.name,
      section.rows,
      monthLabel,
    );
  }

  addSignatureFooter(doc, pageWidth);

  doc.save(
    filename ?? `Monatsuebersicht_${year}_${String(month).padStart(2, "0")}.pdf`,
  );
  return true;
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
