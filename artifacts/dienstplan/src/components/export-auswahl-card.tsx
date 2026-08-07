/**
 * Export-Auswahl — als schwebender Popover über einem Header-Button.
 *
 * ExportPopoverButton: Trigger-Button für den AuswertungenHeader.
 *   Öffnet einen Popover mit Download-Optionen:
 *   - Stundenliste (Dienste, Urlaub, Krank — ohne Geldwerte) .xlsx
 *     → einzige Option im Free-Tarif
 *   - Lohnexport (DATEV-konform) .xlsx           → Premium
 *   - Zeitkonto (Soll/Ist) .xlsx                 → Premium
 *   - Beide Dateien als ZIP (exklusiv)           → Premium
 *
 * Im Free-Tarif (payrollLocked) bleiben die Premium-Optionen sichtbar, aber
 * gesperrt (Lock-Icon + Upgrade-Hinweis) — Muster wie bei den Free-Limits.
 */

import { useState } from "react";
import {
  Download,
  FileSpreadsheet,
  Archive,
  Loader2,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "sonner";
import { PlanUpgradeLink } from "@/components/plan-limit-banner";
import type { MatrixBalance, MatrixRecalc } from "@/components/gesamt-auswertung-matrix";
import type { StundenlisteShift } from "@/lib/stundenliste-xlsx";

type ExportMode = "stundenliste" | "lohn" | "zeitkonto" | "zip";

type ExportData = {
  balances: MatrixBalance[];
  /** FIX-Dienste + Abwesenheiten des Monats (Quelle: GET /shifts, kein Premium-Gate). */
  shifts?: StundenlisteShift[];
  recalcByUser?: Map<number, MatrixRecalc>;
  prevMonthLabel?: string;
  month: number;
  year: number;
  disabled?: boolean;
  /** true im Free-Tarif: Lohn-/Zeitkonto-Exporte gesperrt, Stundenliste frei. */
  payrollLocked?: boolean;
};

// ---------------------------------------------------------------------------
// Kern-Logik (geteilt zwischen Popover und Card)
// ---------------------------------------------------------------------------

function ExportContent({ balances, shifts, recalcByUser, prevMonthLabel, month, year, disabled, payrollLocked, onDone }: ExportData & { onDone?: () => void }) {
  const [selected, setSelected] = useState<Set<ExportMode>>(new Set());
  const [isPending, setIsPending] = useState(false);

  const hasStundenliste = selected.has("stundenliste");
  const hasLohn = selected.has("lohn");
  const hasZeitk = selected.has("zeitkonto");
  const hasZip = selected.has("zip");

  function toggle(mode: ExportMode) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (mode === "zip") {
        if (next.has("zip")) {
          next.delete("zip");
        } else {
          next.clear();
          next.add("zip");
        }
      } else {
        if (next.has("zip")) next.delete("zip");
        if (next.has(mode)) {
          next.delete(mode);
        } else {
          next.add(mode);
        }
      }
      return next;
    });
  }

  // Die Stundenliste braucht Schichtdaten, die Premium-Exporte die Bilanzen.
  const needsShifts = hasStundenliste;
  const needsBalances = hasLohn || hasZeitk || hasZip;
  const dataReady =
    (!needsShifts || (shifts?.length ?? 0) > 0) &&
    (!needsBalances || balances.length > 0);
  const canExport = selected.size > 0 && !disabled && dataReady;

  async function handleExport() {
    if (!canExport) return;
    setIsPending(true);
    try {
      if (hasZip) {
        const [{ buildLohnexportBuffer }, { buildZeitkontBuffer }, JSZip] =
          await Promise.all([
            import("@/lib/lohnexport-xlsx"),
            import("@/lib/zeitkonto-xlsx"),
            // Interop-sicher: CJS-Pakete haben im Vite-Dev-Modus ggf. keinen default-Export.
            import("jszip").then((m) => m.default ?? m),
          ]);
        const [lohnBuf, zeitBuf] = await Promise.all([
          buildLohnexportBuffer(balances, recalcByUser, prevMonthLabel, month, year),
          buildZeitkontBuffer(balances, month, year),
        ]);
        const zip = new JSZip();
        const monthStr = String(month).padStart(2, "0");
        zip.file(`lohnexport-${year}-${monthStr}.xlsx`, lohnBuf);
        zip.file(`zeitkonto-${year}-${monthStr}.xlsx`, zeitBuf);
        const blob = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `lohnexport-${year}-${monthStr}.zip`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        if (hasStundenliste) {
          const { downloadStundenlisteXlsx } = await import("@/lib/stundenliste-xlsx");
          await downloadStundenlisteXlsx(shifts ?? [], month, year);
        }
        if (hasLohn) {
          const { downloadLohnexportXlsx } = await import("@/lib/lohnexport-xlsx");
          await downloadLohnexportXlsx(balances, recalcByUser, prevMonthLabel, month, year);
        }
        if (hasZeitk) {
          const { downloadZeitkontXlsx } = await import("@/lib/zeitkonto-xlsx");
          await downloadZeitkontXlsx(balances, month, year);
        }
      }
      toast.success(
        hasZip
          ? "ZIP-Datei heruntergeladen"
          : selected.size === 2
            ? "Beide Dateien heruntergeladen"
            : "Datei heruntergeladen",
      );
      onDone?.();
    } catch (err) {
      console.error("Export fehlgeschlagen:", err);
      if (!navigator.onLine) {
        toast.error("Keine Internetverbindung. Bitte später erneut versuchen.");
        return;
      }
      toast.error("Export fehlgeschlagen. Bitte erneut versuchen.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="space-y-1" data-testid="export-auswahl-content">
      <p className="text-[11px] text-muted-foreground pb-2 border-b border-border/50">
        {payrollLocked
          ? "Die Stundenliste zum Weitergeben an Dienstleister oder Lohnbüro."
          : "DATEV-konformes Excel — direkt für die Lohnbuchhaltung geeignet."}
      </p>

      {/* Stundenliste — einzige Option im Free-Tarif, in Premium zusätzlich. */}
      <div className="flex items-center gap-2.5 py-1">
        <Checkbox
          id="export-stundenliste"
          checked={hasStundenliste}
          onCheckedChange={() => toggle("stundenliste")}
          disabled={isPending || hasZip}
          data-testid="export-check-stundenliste"
        />
        <Label
          htmlFor="export-stundenliste"
          className={`flex items-center gap-2 cursor-pointer text-sm leading-none ${hasZip ? "text-muted-foreground" : ""}`}
        >
          <FileSpreadsheet className="h-3.5 w-3.5 text-assistenz-brand shrink-0" />
          <span>Stundenliste</span>
          <span className="text-muted-foreground font-normal">.xlsx</span>
          <span className="text-muted-foreground font-normal text-xs">(Dienste, Urlaub, Krank)</span>
        </Label>
      </div>

      {/* Lohnexport — Premium */}
      <div className="flex items-center gap-2.5 py-1">
        <Checkbox
          id="export-lohn"
          checked={hasLohn}
          onCheckedChange={() => toggle("lohn")}
          disabled={isPending || hasZip || payrollLocked}
          data-testid="export-check-lohn"
        />
        <Label
          htmlFor="export-lohn"
          className={`flex items-center gap-2 text-sm leading-none ${hasZip || payrollLocked ? "text-muted-foreground" : "cursor-pointer"}`}
        >
          <FileSpreadsheet className="h-3.5 w-3.5 text-green-700 shrink-0" />
          <span>Lohnexport</span>
          <span className="text-muted-foreground font-normal">.xlsx</span>
          <span className="text-[9px] uppercase tracking-wide bg-muted text-muted-foreground rounded px-1 py-0.5 ml-0.5">
            DATEV
          </span>
          {payrollLocked && (
            <Lock className="h-3 w-3 shrink-0" data-testid="export-lock-lohn" aria-label="Premium-Feature" />
          )}
        </Label>
      </div>

      {/* Zeitkonto — Premium */}
      <div className="flex items-center gap-2.5 py-1">
        <Checkbox
          id="export-zeitkonto"
          checked={hasZeitk}
          onCheckedChange={() => toggle("zeitkonto")}
          disabled={isPending || hasZip || payrollLocked}
          data-testid="export-check-zeitkonto"
        />
        <Label
          htmlFor="export-zeitkonto"
          className={`flex items-center gap-2 text-sm leading-none ${hasZip || payrollLocked ? "text-muted-foreground" : "cursor-pointer"}`}
        >
          <FileSpreadsheet className="h-3.5 w-3.5 text-blue-700 shrink-0" />
          <span>Zeitkonto (Soll/Ist)</span>
          <span className="text-muted-foreground font-normal">.xlsx</span>
          {payrollLocked && (
            <Lock className="h-3 w-3 shrink-0" data-testid="export-lock-zeitkonto" aria-label="Premium-Feature" />
          )}
        </Label>
      </div>

      {/* ZIP — exklusiv, Premium */}
      <div className="flex items-center gap-2.5 py-1 pt-2 border-t border-border/50 mt-1">
        <Checkbox
          id="export-zip"
          checked={hasZip}
          onCheckedChange={() => toggle("zip")}
          disabled={isPending || payrollLocked}
          data-testid="export-check-zip"
        />
        <Label
          htmlFor="export-zip"
          className={`flex items-center gap-2 text-sm leading-none ${payrollLocked ? "text-muted-foreground" : "cursor-pointer"}`}
        >
          <Archive className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span>Beide als ZIP</span>
          <span className="text-muted-foreground font-normal text-xs">(Lohnexport + Zeitkonto)</span>
          {payrollLocked && (
            <Lock className="h-3 w-3 shrink-0" data-testid="export-lock-zip" aria-label="Premium-Feature" />
          )}
        </Label>
      </div>

      {/* Premium-Verweis für gesperrte Exporte (Free-Tarif). */}
      {payrollLocked && (
        <div
          className="mt-2 rounded-md border border-brand-yellow/40 bg-brand-yellow/10 px-3 py-2 text-xs text-foreground space-y-1.5"
          data-testid="export-premium-hint"
        >
          <p>
            Lohnexport, Zeitkonto und ZIP sind Teil von Premium. Die Stundenliste
            kannst du auch im Free-Tarif exportieren.
          </p>
          <PlanUpgradeLink className="text-xs" />
        </div>
      )}

      <div className="pt-3">
        <Button
          onClick={handleExport}
          disabled={!canExport || isPending}
          className="w-full gap-2"
          size="sm"
          data-testid="export-auswahl-button"
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          {isPending ? "Wird exportiert…" : "Exportieren"}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header-Button mit schwebendem Popover
// ---------------------------------------------------------------------------

export function ExportPopoverButton({
  showLabels,
  stacked,
  ...exportData
}: ExportData & {
  showLabels: boolean;
  stacked: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={showLabels ? "gap-1.5" : `h-9 shrink-0 px-0 ${stacked ? "w-8" : "w-9"}`}
          disabled={exportData.disabled}
          title="Lohnexport / Zeitkonto exportieren"
          aria-label="Export"
          data-testid="export-popover-button"
        >
          <Download className="h-4 w-4" />
          {showLabels && <span>Export</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-72 p-4"
        align="end"
        sideOffset={8}
        data-testid="export-popover-content"
      >
        <h3 className="text-sm font-semibold text-foreground mb-3">Export auswählen</h3>
        <ExportContent {...exportData} onDone={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
