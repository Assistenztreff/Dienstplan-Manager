import { listShifts, getBrandingSettings } from "@workspace/api-client-react";
import { format, differenceInMinutes } from "date-fns";
import { de } from "date-fns/locale";
import logoUrl from "@assets/logo dunkel.png";
import { logoSrcFromPath } from "@/lib/logo";

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

async function loadLogoImage(): Promise<LoadedImage | null> {
  // Eigenes Firmenlogo (aus den Einstellungen) bevorzugen, sonst Standard-Logo.
  let customPath: string | null = null;
  try {
    const branding = await getBrandingSettings();
    customPath = logoSrcFromPath((branding as { logoPath?: string | null }).logoPath);
  } catch {
    customPath = null;
  }

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
  const summaryRows = [
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
      `${balance.vacationDaysTaken} Tage`,
    ],
    [
      "Urlaubstage (verbleibend)",
      `${balance.vacationDaysRemaining} Tage`,
    ],
    [
      `Nachtstunden (Zuschlag ${balance.nightPercent}%)`,
      `${balance.nightHours} h (+${balance.nightSurchargeHours} h)`,
    ],
    [
      `Sonntagsstunden (Zuschlag ${balance.sundayPercent}%)`,
      `${balance.sundayHours} h (+${balance.sundaySurchargeHours} h)`,
    ],
    [
      `Feiertagsstunden (Zuschlag ${balance.holidayPercent}%)`,
      `${balance.holidayHours} h (+${balance.holidaySurchargeHours} h)`,
    ],
  ];

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

  const detailRows = shifts.map((s: any) => {
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
  const logo = await loadLogoImage();
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

  // --- Unterschriftsfeld + Footer auf jeder Seite ---
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

  doc.save(filename);
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
