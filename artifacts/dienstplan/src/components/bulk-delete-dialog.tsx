import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { useBulkDeleteShifts } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  chunkIds,
  invalidateShiftDerivedQueries,
  removeShiftsFromCache,
} from "@/lib/shift-cache";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Trash2 } from "lucide-react";
import { readableApiError } from "@/lib/api-error";

type Assistant = { id: number; name: string };

type Shift = {
  id: number;
  userId: number;
  startTime: string;
};

type BulkDeleteDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Ausgewählte Tage als lokale Datumsschlüssel (yyyy-MM-dd). */
  dates: string[];
  /** Alle aktuell geladenen Schichten des Monats (zur Ziel-Ermittlung). */
  shifts: Shift[];
  assistants: Assistant[];
  /** Wird nach erfolgreichem Löschen aufgerufen (Auswahl leeren + Modus beenden). */
  onDeleted: () => void;
};

/** Lokaler Datumsschlüssel (yyyy-MM-dd) aus einem ISO-Zeitstempel. */
function localDayKey(isoString: string): string {
  return format(new Date(isoString), "yyyy-MM-dd");
}

/**
 * Dialog für die Massenlöschung: löscht alle Schichten der gewählten Tage,
 * optional gefiltert auf einen Assistenten ("Alle Assistenten" oder eine
 * bestimmte Person). Fragt bewusst NUR nach dem Assistenten — die Tage stehen
 * über die zuvor getroffene Auswahl bereits fest.
 */
export function BulkDeleteDialog({
  open,
  onClose,
  dates,
  shifts,
  assistants,
  onDeleted,
}: BulkDeleteDialogProps) {
  const queryClient = useQueryClient();
  const bulkDelete = useBulkDeleteShifts();

  // "all" = alle Assistenten, sonst eine konkrete userId.
  const [userId, setUserId] = useState<"all" | number>("all");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Beim Öffnen Auswahl/Fehler zurücksetzen.
  useEffect(() => {
    if (open) {
      setUserId("all");
      setError(null);
    }
  }, [open]);

  // Zu löschende Schichten: Tag in der Auswahl UND (alle oder passender User).
  const targets = useMemo(() => {
    const dateSet = new Set(dates);
    return shifts.filter(
      (s) =>
        dateSet.has(localDayKey(s.startTime)) &&
        (userId === "all" || s.userId === userId),
    );
  }, [dates, shifts, userId]);

  async function handleDelete() {
    if (targets.length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    // Sammelauftrag (Task #751): EIN Request statt N Einzel-DELETEs, server-
    // seitig transaktional (ganz oder gar nicht). Sehr große Auswahlen laufen
    // in Blöcken à 200 (API-Limit) — jeder Block atomar.
    const deleted: number[] = [];
    try {
      for (const chunk of chunkIds(targets.map((s) => s.id))) {
        const result = await bulkDelete.mutateAsync({ data: { ids: chunk } });
        deleted.push(...result.deletedIds);
      }
      // Sofort reagieren: gelöschte Einträge aus dem Cache entfernen; der
      // Abgleich aller abgeleiteten Daten (Monat, Salden, Urlaubszähler)
      // läuft danach im Hintergrund (kein Warten mehr).
      removeShiftsFromCache(queryClient, deleted);
      void invalidateShiftDerivedQueries(queryClient);
      onDeleted();
      onClose();
    } catch (err) {
      // Ganz oder gar nicht: bei 404 wurde in diesem Block NICHTS gelöscht
      // (z. B. weil ein Eintrag inzwischen anderweitig entfernt wurde).
      // Bereits gelöschte Blöcke sofort aus der Ansicht nehmen und die Liste
      // im Hintergrund abgleichen, damit die Ziel-Zählung wieder stimmt.
      removeShiftsFromCache(queryClient, deleted);
      void invalidateShiftDerivedQueries(queryClient);
      setError(readableApiError(err, "Löschen fehlgeschlagen. Bitte erneut versuchen."));
    } finally {
      setSaving(false);
    }
  }

  // Kompakte, lesbare Zusammenfassung der gewählten Tage (chronologisch).
  const sortedDates = [...dates].sort();
  const dateSummary = sortedDates
    .map((d) => format(new Date(`${d}T00:00:00`), "d. MMM", { locale: de }))
    .join(", ");

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md" data-testid="bulk-delete-dialog">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">Einträge löschen</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
            <p className="font-medium">
              {dates.length} {dates.length === 1 ? "Tag" : "Tage"} ausgewählt
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">{dateSummary}</p>
          </div>

          <div className="space-y-1.5">
            <Label>Assistenzkraft</Label>
            <Select
              value={userId === "all" ? "all" : String(userId)}
              onValueChange={(v) => setUserId(v === "all" ? "all" : Number(v))}
            >
              <SelectTrigger data-testid="bulk-delete-user">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Assistenzkräfte</SelectItem>
                {assistants.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <p className="text-sm" data-testid="bulk-delete-count">
            {targets.length === 0 ? (
              <span className="text-muted-foreground">
                An den gewählten Tagen gibt es keine passenden Einträge.
              </span>
            ) : (
              <span>
                Es {targets.length === 1 ? "wird" : "werden"}{" "}
                <span className="font-semibold text-destructive">{targets.length}</span>{" "}
                {targets.length === 1 ? "Eintrag" : "Einträge"} unwiderruflich gelöscht.
              </span>
            )}
          </p>

          {error && (
            <p className="text-sm text-destructive" data-testid="bulk-delete-error">
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Abbrechen
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={saving || targets.length === 0}
            className="gap-1.5"
            data-testid="bulk-delete-confirm"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {saving ? "Löschen..." : "Endgültig löschen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
