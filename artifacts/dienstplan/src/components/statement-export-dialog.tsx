import { useState } from "react";
import {
  getHoursBalance,
  getMonthClosingDiff,
  ApiError,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { toast } from "sonner";
import { exportStatementSectionsPdf, type StatementRecalculation } from "@/lib/pdf-export";
import {
  computeRecalculationMonthTotals,
  mapDiffRowsToRecalculationRows,
} from "@/lib/recalculation-mapping";

function monthIndex(date: Date): number {
  return date.getFullYear() * 12 + date.getMonth();
}

export type StatementExportDialogProps = {
  open: boolean;
  onClose: () => void;
  teamId?: number | null;
  /** Auf eine Assistenzkraft filtern oder alle exportieren. */
  assistantFilter: number | "all";
  /** Name der gefilterten Assistenzkraft (fuer Beschreibung + Dateiname). */
  assistantName?: string;
  /** Beschreibungstext oberhalb der Monatsauswahl (Standard: Auswertungs-Variante). */
  description?: React.ReactNode;
  /** Transparenz-Hinweis "nur bestaetigte Dienste" anzeigen. */
  showFixOnlyHint?: boolean;
  /**
   * Dateinamens-Zeitraum aus den tatsaechlich gefundenen Sections ableiten
   * (Assistenten-Seite) statt aus dem gewaehlten Monatsbereich (Auswertung).
   */
  rangeFromSections?: boolean;
};

/**
 * Gemeinsamer Export-Dialog fuer den PDF-Stundennachweis (Auswertungen- und
 * Assistenten-Seite). Buendelt Monats-Schleife, Nachberechnungs-Fetch
 * (Soft-Close-Diff des jeweiligen Vormonats) und Fehlerbehandlung an einer
 * Stelle, damit die beiden Seiten nicht wieder auseinanderlaufen.
 */
export function StatementExportDialog({
  open,
  onClose,
  teamId,
  assistantFilter,
  assistantName,
  description,
  showFixOnlyHint = false,
  rangeFromSections = false,
}: StatementExportDialogProps) {
  const [fromDate, setFromDate] = useState(new Date());
  const [toDate, setToDate] = useState(new Date());
  const [isExporting, setIsExporting] = useState(false);

  const fromIndex = monthIndex(fromDate);
  const toIndex = monthIndex(toDate);
  const rangeInvalid = toIndex < fromIndex;
  const monthCount = rangeInvalid ? 0 : toIndex - fromIndex + 1;

  const fromLabel = format(fromDate, "MMMM yyyy", { locale: de });
  const toLabel = format(toDate, "MMMM yyyy", { locale: de });

  const stepFrom = (delta: number) =>
    setFromDate((d) => new Date(d.getFullYear(), d.getMonth() + delta, 1));
  const stepTo = (delta: number) =>
    setToDate((d) => new Date(d.getFullYear(), d.getMonth() + delta, 1));

  async function handleExport() {
    if (rangeInvalid) {
      toast.error("Der Bis-Monat darf nicht vor dem Von-Monat liegen.");
      return;
    }
    setIsExporting(true);
    try {
      // Pro Monat alle (bzw. die gefilterten) Assistenten-Balances laden.
      const months: Array<{
        month: number;
        year: number;
        monthLabel: string;
        balances: any[];
      }> = [];

      for (let i = 0; i < monthCount; i++) {
        const cursor = new Date(fromDate.getFullYear(), fromDate.getMonth() + i, 1);
        const month = cursor.getMonth() + 1;
        const year = cursor.getFullYear();
        const monthLabel = format(cursor, "MMMM yyyy", { locale: de });

        const raw = (await getHoursBalance({
          month,
          year,
          ...(teamId != null ? { teamId } : {}),
        })) as any[];
        const balances =
          assistantFilter !== "all"
            ? raw.filter((b) => b.userId === assistantFilter)
            : raw;

        months.push({ month, year, monthLabel, balances });
      }

      // Reihenfolge: pro Assistent gruppiert, darin chronologisch nach Monat.
      const assistantOrder: Array<{ userId: number; userName: string }> = [];
      const seen = new Set<number>();
      for (const m of months) {
        for (const b of m.balances) {
          if (!seen.has(b.userId)) {
            seen.add(b.userId);
            assistantOrder.push({ userId: b.userId, userName: b.userName });
          }
        }
      }
      assistantOrder.sort((a, b) =>
        a.userName.localeCompare(b.userName, "de", { sensitivity: "base" }),
      );

      const sections: Array<{ balance: any; month: number; year: number; monthLabel: string }> = [];
      for (const assistant of assistantOrder) {
        for (const m of months) {
          const balance = m.balances.find((b) => b.userId === assistant.userId);
          if (balance) {
            sections.push({ balance, month: m.month, year: m.year, monthLabel: m.monthLabel });
          }
        }
      }

      if (sections.length === 0) {
        toast.error("Keine Auswertungsdaten fuer den gewaehlten Zeitraum gefunden.");
        return;
      }

      // Nachberechnung: je exportiertem Monat die Differenzen des jeweiligen
      // Vormonats laden (sofern dieser abgeschlossen wurde) und als eigene,
      // klar beschriftete Position in den PDF-Nachweis aufnehmen.
      const recalculations: StatementRecalculation[] = [];
      let recalcFetchFailed = false;
      for (const m of months) {
        const prev = new Date(m.year, m.month - 2, 1);
        try {
          const diff = await getMonthClosingDiff({
            month: prev.getMonth() + 1,
            year: prev.getFullYear(),
            ...(teamId != null ? { teamId } : {}),
          });
          if (!diff.closed || diff.rows.length === 0) continue;
          const rows = mapDiffRowsToRecalculationRows(diff.rows, assistantFilter);
          if (rows.length === 0) continue;
          recalculations.push({
            monthLabel: m.monthLabel,
            prevLabel: format(prev, "MMMM yyyy", { locale: de }),
            closedAt: diff.closedAt,
            rows,
            monthTotals: computeRecalculationMonthTotals(m.balances),
          });
        } catch (err) {
          // Kein Abschluss/kein Zugriff (403/404) → PDF ohne Nachberechnungs-
          // Seite. Echte Fehler (Netz/Server) NICHT verschlucken: der Export
          // läuft weiter, aber der Nutzer bekommt eine sichtbare Warnung,
          // dass die Nachberechnung im PDF fehlen kann.
          if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
            continue;
          }
          recalcFetchFailed = true;
          console.error(err);
        }
      }
      if (recalcFetchFailed) {
        toast.warning(
          "Nachberechnung konnte nicht geladen werden — das PDF wird ohne Nachberechnungs-Seite erstellt.",
        );
      }

      // Dateiname: Zeitraum wahlweise aus dem gewaehlten Monatsbereich oder
      // aus den Monaten mit tatsaechlichen Daten (Assistenten-Seite).
      const range: Array<{ month: number; year: number }> = rangeFromSections
        ? sections
        : months;
      const first = range[0];
      const last = range[range.length - 1];
      const rangePart =
        range.length === 1
          ? `${first.year}_${String(first.month).padStart(2, "0")}`
          : `${first.year}_${String(first.month).padStart(2, "0")}-${last.year}_${String(last.month).padStart(2, "0")}`;
      const namePart = assistantName
        ? assistantName.replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "")
        : "Alle";

      const exported = await exportStatementSectionsPdf({
        sections,
        teamId,
        filename: `Stundennachweis_${namePart}_${rangePart}.pdf`,
        recalculations,
      });
      if (!exported) {
        toast.error(
          "Keine bestätigten Dienste oder Abwesenheiten in diesem Monat.",
        );
        return;
      }
      onClose();
    } catch (err) {
      toast.error("PDF-Export fehlgeschlagen.");
      console.error(err);
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">Stundennachweis exportieren</DialogTitle>
        </DialogHeader>

        <div className="py-2 space-y-4">
          <p className="text-sm text-muted-foreground">
            {description ?? (
              <>
                {assistantName ? (
                  <>
                    Einzelnachweis fuer{" "}
                    <span className="font-medium text-foreground">{assistantName}</span> als PDF.
                  </>
                ) : (
                  <>Gesamt-Nachweis aller Assistenten als PDF.</>
                )}{" "}
                Waehle den gewuenschten Zeitraum – pro Assistent und Monat entsteht eine Seite.
              </>
            )}
          </p>
          {showFixOnlyHint && (
            /* Transparenz-Hinweis: der PDF-Nachweis basiert auf hours-balance
               und enthält nur FIX-Dienste. */
            <p className="text-xs text-muted-foreground" data-testid="export-fix-only-hint">
              Der Stundennachweis enthält nur bestätigte Dienste. Entwürfe und Vorschläge werden
              nicht mitgezählt.
            </p>
          )}

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Von-Monat</Label>
              <div className="flex items-center justify-between gap-2">
                <Button variant="outline" size="icon" onClick={() => stepFrom(-1)} disabled={isExporting}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="font-medium text-sm flex-1 text-center" data-testid="export-from-label">
                  {fromLabel}
                </span>
                <Button variant="outline" size="icon" onClick={() => stepFrom(1)} disabled={isExporting}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Bis-Monat</Label>
              <div className="flex items-center justify-between gap-2">
                <Button variant="outline" size="icon" onClick={() => stepTo(-1)} disabled={isExporting}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="font-medium text-sm flex-1 text-center" data-testid="export-to-label">
                  {toLabel}
                </span>
                <Button variant="outline" size="icon" onClick={() => stepTo(1)} disabled={isExporting}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          {rangeInvalid ? (
            <p className="text-xs text-destructive">
              Der Bis-Monat darf nicht vor dem Von-Monat liegen.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {monthCount === 1 ? "1 Monat" : `${monthCount} Monate`} werden exportiert.
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={isExporting}>
            Abbrechen
          </Button>
          <Button onClick={handleExport} disabled={isExporting || rangeInvalid} className="gap-2">
            <Download className="h-4 w-4" />
            {isExporting ? "Exportiere..." : "Als PDF exportieren"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
