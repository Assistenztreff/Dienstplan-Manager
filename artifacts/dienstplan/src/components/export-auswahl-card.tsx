/**
 * Export-Auswahl-Karte für die Auswertungen-Seite.
 *
 * Bietet drei Download-Optionen:
 * - Lohnexport (DATEV-konform) .xlsx
 * - Zeitkonto (Soll/Ist) .xlsx
 * - Beide Dateien als ZIP (exklusiv zu Einzelauswahl)
 *
 * Nur für Admins mit payrollExport-Recht sichtbar.
 */

import { useState } from "react";
import { Download, FileSpreadsheet, Archive, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import type { MatrixBalance, MatrixRecalc } from "@/components/gesamt-auswertung-matrix";

type ExportMode = "lohn" | "zeitkonto" | "zip";

export function ExportAuswahlCard({
  balances,
  recalcByUser,
  prevMonthLabel,
  month,
  year,
  disabled,
}: {
  balances: MatrixBalance[];
  recalcByUser?: Map<number, MatrixRecalc>;
  prevMonthLabel?: string;
  month: number;
  year: number;
  /** true wenn keine Daten geladen (isLoading) */
  disabled?: boolean;
}) {
  const [selected, setSelected] = useState<Set<ExportMode>>(new Set());
  const [isPending, setIsPending] = useState(false);

  const hasLohn = selected.has("lohn");
  const hasZeitk = selected.has("zeitkonto");
  const hasZip = selected.has("zip");

  function toggle(mode: ExportMode) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (mode === "zip") {
        // ZIP ist exklusiv — deselektiert Einzelauswahl
        if (next.has("zip")) {
          next.delete("zip");
        } else {
          next.clear();
          next.add("zip");
        }
      } else {
        // Einzelauswahl deselektiert ZIP
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
        // Beide Dateien als ZIP
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
        // Einzelne Dateien
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
    } catch {
      if (!navigator.onLine) return;
      toast.error("Export fehlgeschlagen. Bitte erneut versuchen.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Card className="border-border/50 shadow-sm" data-testid="export-auswahl-card">
      <CardContent className="p-5 md:p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="text-base font-semibold text-foreground">Export auswählen</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              DATEV-konformes Excel-Format — direkt für die Lohnbuchhaltung geeignet.
            </p>
          </div>
          <FileSpreadsheet className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
        </div>

        <div className="space-y-3">
          {/* Lohnexport */}
          <div className="flex items-center gap-3">
            <Checkbox
              id="export-lohn"
              checked={hasLohn}
              onCheckedChange={() => toggle("lohn")}
              disabled={isPending || hasZip}
              data-testid="export-check-lohn"
            />
            <Label
              htmlFor="export-lohn"
              className={`flex items-center gap-2 cursor-pointer text-sm ${hasZip ? "text-muted-foreground" : ""}`}
            >
              <FileSpreadsheet className="h-4 w-4 text-green-700" />
              <span>
                Lohnexport <span className="text-muted-foreground font-normal">.xlsx</span>
              </span>
              <span className="text-[10px] uppercase tracking-wide bg-muted text-muted-foreground rounded px-1 py-0.5">
                DATEV
              </span>
            </Label>
          </div>

          {/* Zeitkonto */}
          <div className="flex items-center gap-3">
            <Checkbox
              id="export-zeitkonto"
              checked={hasZeitk}
              onCheckedChange={() => toggle("zeitkonto")}
              disabled={isPending || hasZip}
              data-testid="export-check-zeitkonto"
            />
            <Label
              htmlFor="export-zeitkonto"
              className={`flex items-center gap-2 cursor-pointer text-sm ${hasZip ? "text-muted-foreground" : ""}`}
            >
              <FileSpreadsheet className="h-4 w-4 text-blue-700" />
              <span>
                Zeitkonto (Soll/Ist) <span className="text-muted-foreground font-normal">.xlsx</span>
              </span>
            </Label>
          </div>

          {/* Trennlinie */}
          <div className="border-t border-border/50 pt-3">
            <div className="flex items-center gap-3">
              <Checkbox
                id="export-zip"
                checked={hasZip}
                onCheckedChange={() => toggle("zip")}
                disabled={isPending}
                data-testid="export-check-zip"
              />
              <Label
                htmlFor="export-zip"
                className="flex items-center gap-2 cursor-pointer text-sm"
              >
                <Archive className="h-4 w-4 text-muted-foreground" />
                <span>
                  Beide Dateien als ZIP{" "}
                  <span className="text-muted-foreground font-normal text-xs">
                    (Lohnexport + Zeitkonto)
                  </span>
                </span>
              </Label>
            </div>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <Button
            onClick={handleExport}
            disabled={!canExport || isPending}
            className="gap-2"
            data-testid="export-auswahl-button"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {isPending ? "Wird exportiert…" : "Exportieren"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
