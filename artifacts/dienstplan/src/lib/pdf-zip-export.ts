/**
 * Sammel-Export: Alle Lohnnachweise eines Monats als ZIP-Archiv.
 *
 * Generierung bleibt vollständig client-seitig (jspdf + JSZip). Fehler für
 * einzelne Assistenzkräfte brechen den Export nicht ab — sie werden als
 * `<name>.fehler.txt` im Archiv dokumentiert.
 */

import { generateLohnnachweisPdfBlob } from "./pdf-export";
import { format } from "date-fns";
import { de } from "date-fns/locale";

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

/** Sanitiert einen Namen für den Einsatz im Dateinamen. */
function sanitizeName(name: string): string {
  return name
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    || "assistent";
}

// ---------------------------------------------------------------------------
// Kern-Batch-Logik (testbar: _generatePdf injizierbar)
// ---------------------------------------------------------------------------

export type LohnnachweisBatchEntry = {
  /** Dateiname im ZIP (*.pdf oder *.fehler.txt). */
  filename: string;
  /** PDF-Daten — null bedeutet: kein Inhalt, wird als .fehler.txt gespeichert. */
  data: Uint8Array | null;
  /** Fehlernachricht, wenn data === null. */
  errorMessage?: string;
};

export type BuildLohnnachweisBatchOptions = {
  balances: any[];
  month: number;
  year: number;
  monthLabel: string;
  teamId?: number | null;
  /** Fortschritts-Callback: (erledigt, gesamt) */
  onProgress?: (done: number, total: number) => void;
  /** Injizierbar für Tests; Standard: generateLohnnachweisPdfBlob */
  _generatePdf?: (
    balance: any,
    month: number,
    year: number,
    monthLabel: string,
    teamId?: number | null,
  ) => Promise<Uint8Array | null>;
};

/**
 * Iteriert über alle Balances und erzeugt je eine PDF-Datei.
 * Schlägt für einzelne Assistenzkräfte fehl → Fehler-Datei statt Abbruch.
 *
 * Diese Funktion ist separat exportiert, damit Unit-Tests die PDF-Erzeugung
 * mocken können ohne einen Browser / jspdf zu benötigen.
 */
export async function buildLohnnachweisBatch({
  balances,
  month,
  year,
  monthLabel,
  teamId,
  onProgress,
  _generatePdf = generateLohnnachweisPdfBlob,
}: BuildLohnnachweisBatchOptions): Promise<LohnnachweisBatchEntry[]> {
  const monthStr = `${year}-${String(month).padStart(2, "0")}`;
  const entries: LohnnachweisBatchEntry[] = [];

  for (let i = 0; i < balances.length; i++) {
    const balance = balances[i];
    const safeName = sanitizeName(balance.userName ?? "assistent");
    const pdfName = `lohnnachweis-${safeName}-${monthStr}.pdf`;

    try {
      const data = await _generatePdf(balance, month, year, monthLabel, teamId);
      if (data) {
        entries.push({ filename: pdfName, data });
      } else {
        const errorMessage = `Kein Stundennachweis für ${balance.userName}: Keine bestätigten Dienste im Monat ${monthLabel}.`;
        entries.push({
          filename: pdfName.replace(/\.pdf$/, ".fehler.txt"),
          data: null,
          errorMessage,
        });
      }
    } catch (err) {
      const errorMessage = `Fehler bei ${balance.userName}: ${err instanceof Error ? err.message : String(err)}`;
      entries.push({
        filename: pdfName.replace(/\.pdf$/, ".fehler.txt"),
        data: null,
        errorMessage,
      });
    }

    onProgress?.(i + 1, balances.length);
  }

  return entries;
}

// ---------------------------------------------------------------------------
// ZIP-Download
// ---------------------------------------------------------------------------

export type DownloadLohnnachweiseAsZipOptions = {
  balances: any[];
  month: number;
  year: number;
  teamId?: number | null;
  onProgress?: (done: number, total: number) => void;
};

/**
 * Erzeugt einen ZIP-Download aller Lohnnachweise für den angegebenen Monat.
 * ZIP-Dateiname: `lohnnachweise-YYYY-MM.zip`.
 * Einzelne Fehler werden als `*.fehler.txt` im Archiv dokumentiert.
 */
export async function downloadLohnnachweiseAsZip({
  balances,
  month,
  year,
  teamId,
  onProgress,
}: DownloadLohnnachweiseAsZipOptions): Promise<void> {
  const JSZip = (await import("jszip")).default;
  const monthLabel = format(new Date(year, month - 1, 1), "MMMM yyyy", { locale: de });
  const monthStr = `${year}-${String(month).padStart(2, "0")}`;

  const entries = await buildLohnnachweisBatch({
    balances,
    month,
    year,
    monthLabel,
    teamId,
    onProgress,
  });

  const zip = new JSZip();
  const errorMessages: string[] = [];

  for (const entry of entries) {
    if (entry.data) {
      zip.file(entry.filename, entry.data);
    } else {
      zip.file(entry.filename, entry.errorMessage ?? "Unbekannter Fehler");
      if (entry.errorMessage) errorMessages.push(entry.errorMessage);
    }
  }

  if (errorMessages.length > 0) {
    zip.file("fehler.txt", errorMessages.join("\n\n"));
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `lohnnachweise-${monthStr}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
