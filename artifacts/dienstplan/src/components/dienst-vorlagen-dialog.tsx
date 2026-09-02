// ---------------------------------------------------------------------------
// Schicht-Wizard: Dienste aus Vorlagen-Paketen anlegen (Baustein 4, 01.09.2026)
// ---------------------------------------------------------------------------
// Der Wizard bietet fertige Dienst-Saetze fuer typische Assistenz-
// Konstellationen (24h, Drei-Schicht, ...) und legt sie mit einem Klick an —
// inklusive Regelplan-Voreinstellung, damit das Monatsraster sofort offene
// Plaetze zeigt. Er legt NUR AN: bestehende Dienste werden nie veraendert
// oder geloescht, doppelte Namen werden vorab erkannt und uebersprungen.
// Das Free-Limit steht VOR dem Anlegen sichtbar dran (Kay: keine
// Ueberraschung erst beim Fehlschlag).
import { useState } from "react";
import { useCreateShiftModel, getListShiftModelsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { VORLAGEN_PAKETE, type VorlagenPaket } from "@workspace/shift-defaults";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PlanUpgradeLink } from "@/components/plan-limit-banner";
import { readableApiError } from "@/lib/api-error";

const WOCHENTAGE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

function tageLabel(tage: readonly number[]): string {
  if (tage.length === 0 || tage.length === 7) return "täglich";
  return tage.map((t) => WOCHENTAGE[t - 1] ?? t).join(", ");
}

type Props = {
  open: boolean;
  onClose: () => void;
  /** Namen der bereits vorhandenen Dienste (fuers Ueberspringen von Doubletten). */
  vorhandeneNamen: string[];
  vorhandeneAnzahl: number;
  hoechsterSortOrder: number;
  /** null = unbegrenzt (Premium). */
  modelLimit: number | null;
  targetTeamId: number | null;
};

export function DienstVorlagenDialog({
  open,
  onClose,
  vorhandeneNamen,
  vorhandeneAnzahl,
  hoechsterSortOrder,
  modelLimit,
  targetTeamId,
}: Props) {
  const queryClient = useQueryClient();
  const createModel = useCreateShiftModel();
  const [anlegen, setAnlegen] = useState<string | null>(null);

  const frei = modelLimit === null ? null : Math.max(0, modelLimit - vorhandeneAnzahl);
  const namenKlein = new Set(vorhandeneNamen.map((n) => n.trim().toLowerCase()));

  async function paketAnlegen(paket: VorlagenPaket) {
    if (anlegen) return;
    const neu = paket.dienste.filter((d) => !namenKlein.has(d.name.trim().toLowerCase()));
    if (neu.length === 0) {
      toast.info("Alle Dienste dieser Vorlage existieren bereits.");
      return;
    }
    if (frei !== null && neu.length > frei) return; // Knopf ist dann ohnehin gesperrt
    setAnlegen(paket.key);
    try {
      let angelegt = 0;
      const fehler: string[] = [];
      for (const [i, d] of neu.entries()) {
        try {
          await createModel.mutateAsync({
            data: {
              name: d.name,
              color: d.color,
              valuationPercent: 100,
              sortOrder: hoechsterSortOrder + 1 + i,
              isActive: true,
              defaultStartTime: d.defaultStartTime,
              defaultEndTime: d.defaultEndTime,
              defaultWeekdays: [...d.defaultWeekdays],
              compensationType: "regular",
              imRegelplan: d.imRegelplan,
              standbySlot: d.standbySlot,
              ...(targetTeamId != null ? { teamId: targetTeamId } : {}),
            },
          });
          angelegt += 1;
        } catch (err) {
          fehler.push(`${d.name}: ${readableApiError(err, "Anlegen fehlgeschlagen")}`);
        }
      }
      await queryClient.invalidateQueries({ queryKey: getListShiftModelsQueryKey() });
      if (fehler.length === 0) {
        const uebersprungen = paket.dienste.length - neu.length;
        toast.success(
          `${angelegt} Dienste angelegt${uebersprungen > 0 ? `, ${uebersprungen} gab es schon` : ""} — im Regelplan, das Monatsraster zeigt jetzt die offenen Plätze.`,
        );
        onClose();
      } else {
        toast.error(`${angelegt} angelegt, Fehler: ${fehler.join(" · ")}`);
      }
    } finally {
      setAnlegen(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-[560px]"
        data-testid="vorlagen-dialog"
      >
        <DialogHeader>
          <DialogTitle>Dienste aus Vorlage anlegen</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Fertige Dienst-Sätze für typische Assistenz-Konstellationen — mit Regelplan, damit das
          Monatsraster sofort die offenen Plätze zeigt. Bestehende Dienste bleiben unangetastet.
        </p>

        {/* Free-Limit VORAB sichtbar, nicht erst beim Fehlschlag. */}
        {frei !== null && (
          <p
            className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900"
            data-testid="vorlagen-limit-hinweis"
          >
            Im Free-Plan sind maximal {modelLimit} Dienste möglich — aktuell{" "}
            {frei === 0 ? "ist kein weiterer" : `${frei === 1 ? "ist noch ein" : `sind noch ${frei}`}`}{" "}
            frei. <PlanUpgradeLink />
          </p>
        )}

        <div className="space-y-3">
          {VORLAGEN_PAKETE.map((paket) => {
            const neu = paket.dienste.filter(
              (d) => !namenKlein.has(d.name.trim().toLowerCase()),
            );
            const gesperrt = frei !== null && neu.length > frei;
            return (
              <div
                key={paket.key}
                className="rounded-md border border-border p-3"
                data-testid={`vorlage-${paket.key}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{paket.name}</p>
                    <p className="text-xs text-muted-foreground">{paket.beschreibung}</p>
                    <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                      {paket.dienste.map((d) => (
                        <li key={d.name}>
                          {d.name} · {d.defaultStartTime}–{d.defaultEndTime} ·{" "}
                          {tageLabel(d.defaultWeekdays)}
                          {namenKlein.has(d.name.trim().toLowerCase()) && " — gibt es schon"}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <Button
                    size="sm"
                    className="shrink-0"
                    disabled={gesperrt || neu.length === 0 || anlegen !== null}
                    onClick={() => void paketAnlegen(paket)}
                    title={
                      gesperrt
                        ? "Dafür reichen die freien Dienst-Plätze im Free-Plan nicht."
                        : neu.length === 0
                          ? "Alle Dienste dieser Vorlage existieren bereits."
                          : undefined
                    }
                    data-testid={`vorlage-anlegen-${paket.key}`}
                  >
                    {anlegen === paket.key
                      ? "Lege an..."
                      : neu.length === paket.dienste.length
                        ? `${neu.length} anlegen`
                        : `${neu.length} fehlende anlegen`}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        <DialogFooter className="pt-2">
          <Button variant="outline" onClick={onClose} disabled={anlegen !== null}>
            Schließen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
