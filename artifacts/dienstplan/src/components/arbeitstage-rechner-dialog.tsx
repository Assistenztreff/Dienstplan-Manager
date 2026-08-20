/**
 * Arbeitstage-Rechner (Dialog).
 *
 * Rechnet aus durchschnittlicher Dienstlänge und Diensten pro Monat die
 * Arbeitstage pro Woche (Dienste ÷ 4,35) und die dazu passenden Wochenstunden
 * aus — beide Werte werden konsistent übernommen, damit die Urlaubstag-
 * Bewertung aufgeht (Beispiel: 5 × 24-h-Dienste → 1,15 Arbeitstage,
 * 27,6 Wochenstunden → 1 Urlaubstag = 24 h). Rechenkern: lib/arbeitstage-rechner.ts
 * (die Vorschau zeigt exakt den Wert, den der Server bewerten wird).
 *
 * Zwei Modi:
 * - Vertrags-Modus (Prop `contract`): Übernehmen schreibt per PATCH in den
 *   Vertrag (setzt serverseitig auch workdaysConfirmedAt).
 * - Formular-Modus (Prop `onApply`): Übernehmen reicht die Werte nur an den
 *   Aufrufer (z. B. Vertragsformular), es wird nichts gespeichert.
 */
import { useMemo, useState } from "react";
import {
  useUpdateContract,
  useGetAllowanceSettings,
  type AllowanceSettings,
  type Contract,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatHours } from "@/lib/utils";
import {
  computeArbeitstage,
  MAX_SHIFT_LENGTH_HOURS,
  type ArbeitstageRechnerResult,
} from "@/lib/arbeitstage-rechner";

const PRESET_LENGTHS = ["8", "12", "24"] as const;

export type { ArbeitstageRechnerResult };

export function ArbeitstageRechnerDialog({
  contract,
  onApply,
  open,
  onOpenChange,
}: {
  contract?: Contract;
  onApply?: (result: ArbeitstageRechnerResult) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateContract = useUpdateContract();
  const [preset, setPreset] = useState<string>("24");
  const [customLength, setCustomLength] = useState("");
  const [shiftsPerMonth, setShiftsPerMonth] = useState("");
  const [saving, setSaving] = useState(false);

  const length = preset === "custom" ? Number(customLength) : Number(preset);
  const shifts = Number(shiftsPerMonth);

  const result = useMemo<ArbeitstageRechnerResult | null>(
    () => computeArbeitstage(shifts, length),
    [length, shifts],
  );

  // Vollzeit-Referenz (AP 2) für die dritte Vorschau-Zeile "Urlaub: ...".
  // Konto-globale Einstellung (nicht team-überschreibbar), daher ohne
  // teamId abgefragt — Contract trägt teamId nicht in seinem DTO.
  const { data: allowanceSettings } = useGetAllowanceSettings(
    undefined,
    { query: { enabled: !!contract } } as Parameters<typeof useGetAllowanceSettings>[1],
  ) as { data?: AllowanceSettings };
  const vacationPreview = useMemo(() => {
    const fulltimeWorkdays = allowanceSettings?.fulltimeWorkdaysPerWeek;
    if (!result || !contract || !fulltimeWorkdays || !(contract.vacationDays >= 0)) return null;
    const eigeneUrlaubstage = contract.vacationDays * (result.workdaysPerWeek / fulltimeWorkdays);
    const vacationWeeksValue = contract.vacationDays / fulltimeWorkdays;
    const poolHours = vacationWeeksValue * result.weeklyHours;
    return { eigeneUrlaubstage, poolHours };
  }, [result, contract, allowanceSettings]);

  async function handleApply() {
    if (!result) return;
    if (onApply) {
      onApply(result);
      onOpenChange(false);
      return;
    }
    if (!contract) return;
    setSaving(true);
    try {
      await updateContract.mutateAsync({
        id: contract.id,
        data: {
          workdaysPerWeek: result.workdaysPerWeek,
          weeklyHours: result.weeklyHours,
        },
      });
      await queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey[0];
          return (
            k === "/api/contracts" ||
            k === `/api/contracts/${contract.id}/vacation-balance`
          );
        },
      });
      toast({
        title: "Arbeitstage übernommen",
        description: `Der Vertrag rechnet jetzt mit ${formatHours(result.workdaysPerWeek)} Arbeitstagen pro Woche.`,
      });
      onOpenChange(false);
    } catch {
      if (!navigator.onLine) return; // Banner erklärt den Grund bereits.
      toast({ title: "Übernehmen fehlgeschlagen", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto" data-testid="arbeitstage-rechner-dialog">
        <DialogHeader>
          <DialogTitle>Arbeitstage berechnen</DialogTitle>
          <DialogDescription>
            Gib Dienstlänge und Dienste pro Monat ein — den Rest rechnen wir
            für dich.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rechner-dienstlaenge-custom">
              Wie lange dauert ein Dienst?
            </Label>
            <div className="flex gap-2">
              <Select value={preset} onValueChange={setPreset}>
                <SelectTrigger
                  className="w-full"
                  data-testid="rechner-dienstlaenge"
                  aria-label="Dienstlänge wählen"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRESET_LENGTHS.map((h) => (
                    <SelectItem key={h} value={h}>
                      {h} Stunden
                    </SelectItem>
                  ))}
                  <SelectItem value="custom">Andere Länge</SelectItem>
                </SelectContent>
              </Select>
              {preset === "custom" && (
                <Input
                  id="rechner-dienstlaenge-custom"
                  type="number"
                  min="0.5"
                  max={MAX_SHIFT_LENGTH_HOURS}
                  step="any"
                  placeholder="Stunden"
                  className="w-28"
                  value={customLength}
                  onChange={(e) => setCustomLength(e.target.value)}
                  data-testid="rechner-dienstlaenge-custom"
                />
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rechner-dienste-pro-monat">
              Wie viele Dienste pro Monat?
            </Label>
            <Input
              id="rechner-dienste-pro-monat"
              type="number"
              min="0.5"
              step="any"
              placeholder="z. B. 5"
              value={shiftsPerMonth}
              onChange={(e) => setShiftsPerMonth(e.target.value)}
              data-testid="rechner-dienste-pro-monat"
            />
          </div>

          {result && (
            <div
              className="rounded-md border border-border/60 bg-muted/40 px-3 py-2.5 text-sm"
              data-testid="rechner-vorschau"
            >
              <p>
                ≈ {formatHours(result.workdaysPerWeek)} Arbeitstage pro Woche ·{" "}
                ≈ {formatHours(result.weeklyHours)} Wochenstunden
              </p>
              <p className="font-medium mt-0.5">
                1 Urlaubstag = {formatHours(result.dailyHours)} h
              </p>
              {vacationPreview && (
                <p className="mt-0.5" data-testid="rechner-vorschau-urlaub">
                  Urlaub: {vacationPreview.eigeneUrlaubstage.toFixed(1)} Tage ·{" "}
                  {vacationPreview.poolHours.toFixed(1)} h im Jahr
                </p>
              )}
            </div>
          )}
          {!result && shiftsPerMonth !== "" && Number(shiftsPerMonth) > 0 && (
            <p className="text-sm text-muted-foreground" data-testid="rechner-hinweis">
              Mit diesen Angaben kommen wir nicht zwischen 0,1 und 7
              Arbeitstage pro Woche — bitte prüfe die Eingaben.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            onClick={handleApply}
            disabled={!result || saving}
            data-testid="rechner-uebernehmen"
          >
            {saving ? "Übernehmen..." : "Übernehmen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
