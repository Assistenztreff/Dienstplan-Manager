/**
 * Export-Auswahl — als schwebender Popover über einem Header-Button.
 *
 * ExportPopoverButton: Trigger-Button für den AuswertungenHeader.
 *   Öffnet einen Popover mit drei Download-Optionen:
 *   - Lohnexport (DATEV-konform) .xlsx
 *   - Zeitkonto (Soll/Ist) .xlsx
 *   - Beide Dateien als ZIP (exklusiv zu Einzelauswahl)
 */

import { useState } from "react";
import {
  Download,
  FileSpreadsheet,
  Archive,
  Loader2,
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
import type { MatrixBalance, MatrixRecalc } from "@/components/gesamt-auswertung-matrix";

type ExportMode = "lohn" | "zeitkonto" | "zip";

type ExportData = {
  balances: MatrixBalance[];
  recalcByUser?: Map<number, MatrixRecalc>;
  prevMonthLabel?: string;
  month: number;
  year: number;
  disabled?: boolean;
};

// ---------------------------------------------------------------------------
// Kern-Logik (geteilt zwischen Popover und Card)
// ---------------------------------------------------------------------------

function ExportContent({ balances, recalcByUser, prevMonthLabel, month, year, disabled, onDone }: ExportData & { onDone?: () => void }) {
  const [selected, setSelected] = useState<Set<ExportMode>>(new Set());
  const [isPending, setIsPending] = useState(false);

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

  const canExport = selected.size > 0 && !disabled && balances.length > 0;

  async function handleExport() {
    if (!canExport) return;
    setIsPending(true);
    try {
      if (hasZip) {
        const [{ buildLohnexportBuffer }, { buildZeitkontBuffer }, { default: JSZip }] =
          await Promise.all([
            import("@/lib/lohnexport-xlsx"),
            import("@/lib/zeitkonto-xlsx"),
            import("jszip"),
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
    } catch {
      if (!navigator.onLine) return;
      toast.error("Export fehlgeschlagen. Bitte erneut versuchen.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="space-y-1" data-testid="export-auswahl-content">
      <p className="text-[11px] text-muted-foreground pb-2 border-b border-border/50">
        DATEV-konformes Excel — direkt für die Lohnbuchhaltung geeignet.
      </p>

      {/* Lohnexport */}
      <div className="flex items-center gap-2.5 py-1">
        <Checkbox
          id="export-lohn"
          checked={hasLohn}
          onCheckedChange={() => toggle("lohn")}
          disabled={isPending || hasZip}
          data-testid="export-check-lohn"
        />
        <Label
          htmlFor="export-lohn"
          className={`flex items-center gap-2 cursor-pointer text-sm leading-none ${hasZip ? "text-muted-foreground" : ""}`}
        >
          <FileSpreadsheet className="h-3.5 w-3.5 text-green-700 shrink-0" />
          <span>Lohnexport</span>
          <span className="text-muted-foreground font-normal">.xlsx</span>
          <span className="text-[9px] uppercase tracking-wide bg-muted text-muted-foreground rounded px-1 py-0.5 ml-0.5">
            DATEV
          </span>
        </Label>
      </div>

      {/* Zeitkonto */}
      <div className="flex items-center gap-2.5 py-1">
        <Checkbox
          id="export-zeitkonto"
          checked={hasZeitk}
          onCheckedChange={() => toggle("zeitkonto")}
          disabled={isPending || hasZip}
          data-testid="export-check-zeitkonto"
        />
        <Label
          htmlFor="export-zeitkonto"
          className={`flex items-center gap-2 cursor-pointer text-sm leading-none ${hasZip ? "text-muted-foreground" : ""}`}
        >
          <FileSpreadsheet className="h-3.5 w-3.5 text-blue-700 shrink-0" />
          <span>Zeitkonto (Soll/Ist)</span>
          <span className="text-muted-foreground font-normal">.xlsx</span>
        </Label>
      </div>

      {/* ZIP — exklusiv */}
      <div className="flex items-center gap-2.5 py-1 pt-2 border-t border-border/50 mt-1">
        <Checkbox
          id="export-zip"
          checked={hasZip}
          onCheckedChange={() => toggle("zip")}
          disabled={isPending}
          data-testid="export-check-zip"
        />
        <Label
          htmlFor="export-zip"
          className="flex items-center gap-2 cursor-pointer text-sm leading-none"
        >
          <Archive className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span>Beide als ZIP</span>
          <span className="text-muted-foreground font-normal text-xs">(Lohnexport + Zeitkonto)</span>
        </Label>
      </div>

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
