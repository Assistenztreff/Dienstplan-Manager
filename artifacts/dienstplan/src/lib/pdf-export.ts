import { listShifts } from "@workspace/api-client-react";
import { format, differenceInMinutes } from "date-fns";
import { de } from "date-fns/locale";

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

export type ExportHoursStatementOptions = {
  balances: any[];
  month: number;
  year: number;
  monthLabel: string;
  teamId?: number | null;
  filename?: string;
};

export async function exportHoursStatementPdf({
  balances,
  month,
  year,
  monthLabel,
  teamId,
  filename,
}: ExportHoursStatementOptions) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  let firstPage = true;

  for (const balance of balances) {
    if (!firstPage) doc.addPage();
    firstPage = false;

    // --- Header ---
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.text("Stundennachweis", pageWidth / 2, 20, { align: "center" });

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
        margin: { left: 14, right: 14 },
      });
    } else {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text("Keine Schichten in diesem Monat.", 14, tableY + 10);
    }

    // --- Footer ---
    const pageHeight = doc.internal.pageSize.getHeight();
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(120);
    doc.text(
      `Erstellt am ${format(new Date(), "dd.MM.yyyy", { locale: de })}`,
      14,
      pageHeight - 10
    );
    doc.setTextColor(0);
  }

  const outName =
    filename ?? `Stundennachweis_${year}_${String(month).padStart(2, "0")}.pdf`;
  doc.save(outName);
}
