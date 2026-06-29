import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import {
  useUpdateShift,
  getListShiftsQueryKey,
  ApiError,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Pencil } from "lucide-react";

type Assistant = { id: number; name: string };

type Shift = {
  id: number;
  userId: number;
  startTime: string;
  type: string;
};

type BulkEditDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Ausgewählte Tage als lokale Datumsschlüssel (yyyy-MM-dd). */
  dates: string[];
  /** Alle aktuell geladenen Schichten des Monats (zur Ziel-Ermittlung). */
  shifts: Shift[];
  assistants: Assistant[];
  month: number;
  year: number;
  /** Wird nach erfolgreichem Ändern aufgerufen (Auswahl leeren + Modus beenden). */
  onSaved: () => void;
};

/** Lokaler Datumsschlüssel (yyyy-MM-dd) aus einem ISO-Zeitstempel. */
function localDayKey(isoString: string): string {
  return format(new Date(isoString), "yyyy-MM-dd");
}

function nextDayString(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return format(d, "yyyy-MM-dd");
}

function buildIso(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString();
}

/**
 * Dialog für das Massen-Ändern bestehender Schichten: passt auf den gewählten
 * Tagen bestehende reguläre Schichten an (Assistent / Zeiten / Notiz), optional
 * gefiltert auf einen Assistenten. Nur die aktivierten Felder werden geschrieben
 * — so lässt sich z. B. nur der Assistent tauschen, ohne Zeiten/Notiz zu
 * überschreiben. Abwesenheiten (Urlaub/Krank) sind bewusst ausgenommen (kein
 * Zeit-/Assistentenwechsel über die Massen-Aktion). Konflikt-/Fehlerbehandlung
 * analog zum Massen-Eintragen (Überschneidung → "Trotzdem ändern" mit force).
 */
export function BulkEditDialog({
  open,
  onClose,
  dates,
  shifts,
  assistants,
  month,
  year,
  onSaved,
}: BulkEditDialogProps) {
  const queryClient = useQueryClient();
  const updateShift = useUpdateShift();

  // Filter: welche bestehenden Schichten geändert werden ("all" = alle).
  const [filterUserId, setFilterUserId] = useState<"all" | number>("all");

  // Zu ändernde Felder (jeweils opt-in) + ihre Werte.
  const [changeAssistant, setChangeAssistant] = useState(false);
  const [newUserId, setNewUserId] = useState<number | "">("");
  const [changeTimes, setChangeTimes] = useState(false);
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("16:00");
  const [changeNotes, setChangeNotes] = useState(false);
  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bereits erfolgreich geänderte Schicht-IDs (kein Doppel-Update bei force-Retry)
  // und Schicht-IDs mit Überschneidung (für Warnung + force-Wiederholung).
  const [updatedIds, setUpdatedIds] = useState<Set<number>>(new Set());
  const [conflictIds, setConflictIds] = useState<number[] | null>(null);

  // Beim Öffnen Auswahl/Fehler zurücksetzen.
  useEffect(() => {
    if (open) {
      setFilterUserId("all");
      setChangeAssistant(false);
      setNewUserId("");
      setChangeTimes(false);
      setStartTime("08:00");
      setEndTime("16:00");
      setChangeNotes(false);
      setNotes("");
      setError(null);
      setUpdatedIds(new Set());
      setConflictIds(null);
    }
  }, [open]);

  // Sobald die Eingaben geändert werden, ist eine frühere Kollisionswarnung
  // hinfällig — beim nächsten Speichern wird neu geprüft (ohne force).
  function resetConflicts() {
    setConflictIds(null);
  }

  // Zu ändernde Schichten: Tag in der Auswahl, passender User (oder alle), keine
  // Abwesenheit (Urlaub/Krank werden bewusst nicht massen-geändert).
  const targets = useMemo(() => {
    const dateSet = new Set(dates);
    return shifts.filter(
      (s) =>
        s.type !== "vacation" &&
        s.type !== "sick" &&
        dateSet.has(localDayKey(s.startTime)) &&
        (filterUserId === "all" || s.userId === filterUserId),
    );
  }, [dates, shifts, filterUserId]);

  const hasAnyChange = changeAssistant || changeTimes || changeNotes;

  function validate(): boolean {
    if (!hasAnyChange) {
      setError("Bitte mindestens ein Feld zum Ändern auswählen.");
      return false;
    }
    if (changeAssistant && newUserId === "") {
      setError("Bitte einen neuen Assistenten auswählen.");
      return false;
    }
    if (changeTimes && (!startTime || !endTime)) {
      setError("Bitte Start- und Endzeit angeben.");
      return false;
    }
    return true;
  }

  // Baut den PATCH-Body aus den aktivierten Feldern. Zeiten werden pro Schicht
  // anhand ihres bestehenden Tages berechnet (Endzeit <= Startzeit = Folgetag).
  function buildPatch(shift: Shift): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    if (changeAssistant && newUserId !== "") data["userId"] = newUserId;
    if (changeTimes) {
      const dayKey = localDayKey(shift.startTime);
      const endsNextDay = endTime <= startTime;
      data["startTime"] = buildIso(dayKey, startTime);
      data["endTime"] = endsNextDay
        ? buildIso(nextDayString(dayKey), endTime)
        : buildIso(dayKey, endTime);
    }
    if (changeNotes) data["notes"] = notes || null;
    return data;
  }

  async function handleSave(force = false) {
    if (!validate()) return;
    if (targets.length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = new Set(updatedIds);
      const conflicts: number[] = [];
      let otherError = false;

      for (const shift of targets) {
        if (updated.has(shift.id)) continue;
        const patch = buildPatch(shift);
        try {
          await updateShift.mutateAsync({
            id: shift.id,
            data: { ...patch, ...(force ? { force: true } : {}) } as never,
          });
          updated.add(shift.id);
        } catch (err) {
          if (
            err instanceof ApiError &&
            err.status === 409 &&
            (err.data as { code?: string } | null)?.code === "shift_overlap"
          ) {
            conflicts.push(shift.id);
          } else {
            otherError = true;
          }
        }
      }

      setUpdatedIds(updated);
      await queryClient.invalidateQueries({ queryKey: getListShiftsQueryKey({ month, year }) });

      if (otherError) {
        setError("Einige Schichten konnten nicht geändert werden. Bitte erneut versuchen.");
        return;
      }
      if (conflicts.length > 0) {
        setConflictIds(conflicts);
        return;
      }

      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const sortedDates = [...dates].sort();
  const dateSummary = sortedDates
    .map((d) => format(new Date(`${d}T00:00:00`), "d. MMM", { locale: de }))
    .join(", ");

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md" data-testid="bulk-edit-dialog">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">Einträge ändern</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
            <p className="font-medium">
              {dates.length} {dates.length === 1 ? "Tag" : "Tage"} ausgewählt
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">{dateSummary}</p>
          </div>

          {/* Filter: welche bestehenden Schichten geändert werden. */}
          <div className="space-y-1.5">
            <Label>Betroffene Schichten</Label>
            <Select
              value={filterUserId === "all" ? "all" : String(filterUserId)}
              onValueChange={(v) => {
                setFilterUserId(v === "all" ? "all" : Number(v));
                resetConflicts();
              }}
            >
              <SelectTrigger data-testid="bulk-edit-filter-user">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Assistenten</SelectItem>
                {assistants.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3 rounded-md border border-border/60 p-3">
            <p className="text-sm font-medium">Änderungen</p>

            {/* Assistent tauschen */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={changeAssistant}
                  onCheckedChange={(v) => {
                    setChangeAssistant(v === true);
                    resetConflicts();
                    setError(null);
                  }}
                  data-testid="bulk-edit-toggle-assistant"
                />
                Assistent tauschen
              </label>
              {changeAssistant && (
                <Select
                  value={newUserId === "" ? "" : String(newUserId)}
                  onValueChange={(v) => {
                    setNewUserId(Number(v));
                    resetConflicts();
                    setError(null);
                  }}
                >
                  <SelectTrigger data-testid="bulk-edit-new-user">
                    <SelectValue placeholder="Neuen Assistenten wählen..." />
                  </SelectTrigger>
                  <SelectContent>
                    {assistants.map((a) => (
                      <SelectItem key={a.id} value={String(a.id)}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Zeiten anpassen */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={changeTimes}
                  onCheckedChange={(v) => {
                    setChangeTimes(v === true);
                    resetConflicts();
                    setError(null);
                  }}
                  data-testid="bulk-edit-toggle-times"
                />
                Zeiten anpassen
              </label>
              {changeTimes && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Startzeit</Label>
                    <Input
                      type="time"
                      data-testid="bulk-edit-start"
                      value={startTime}
                      onChange={(e) => {
                        setStartTime(e.target.value);
                        resetConflicts();
                        setError(null);
                      }}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Endzeit</Label>
                    <Input
                      type="time"
                      data-testid="bulk-edit-end"
                      value={endTime}
                      onChange={(e) => {
                        setEndTime(e.target.value);
                        resetConflicts();
                        setError(null);
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Notiz setzen */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={changeNotes}
                  onCheckedChange={(v) => {
                    setChangeNotes(v === true);
                    resetConflicts();
                    setError(null);
                  }}
                  data-testid="bulk-edit-toggle-notes"
                />
                Notiz setzen
              </label>
              {changeNotes && (
                <Input
                  data-testid="bulk-edit-notes"
                  value={notes}
                  onChange={(e) => {
                    setNotes(e.target.value);
                    resetConflicts();
                    setError(null);
                  }}
                  placeholder="Leer lassen, um die Notiz zu entfernen"
                />
              )}
            </div>
          </div>

          <p className="text-sm" data-testid="bulk-edit-count">
            {targets.length === 0 ? (
              <span className="text-muted-foreground">
                An den gewählten Tagen gibt es keine passenden Schichten (Abwesenheiten
                ausgenommen).
              </span>
            ) : (
              <span>
                Es {targets.length === 1 ? "wird" : "werden"}{" "}
                <span className="font-semibold">{targets.length}</span>{" "}
                {targets.length === 1 ? "Schicht" : "Schichten"} geändert.
              </span>
            )}
          </p>

          {/* Kollisionswarnung (Überschneidung), force-Wiederholung wie beim Eintragen. */}
          {conflictIds && conflictIds.length > 0 && (
            <div
              className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2.5 text-sm"
              data-testid="bulk-edit-overlap"
            >
              <p className="font-medium text-destructive">
                Überschneidung bei {conflictIds.length}{" "}
                {conflictIds.length === 1 ? "Schicht" : "Schichten"}
              </p>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Die übrigen Schichten wurden bereits geändert. Du kannst die Schichten mit
                Überschneidung trotzdem ändern, falls das gewollt ist.
              </p>
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive" data-testid="bulk-edit-error">
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Abbrechen
          </Button>
          <Button
            onClick={() => handleSave(conflictIds !== null)}
            disabled={saving || targets.length === 0 || !hasAnyChange}
            variant={conflictIds ? "destructive" : "default"}
            className="gap-1.5"
            data-testid="bulk-edit-confirm"
          >
            <Pencil className="h-3.5 w-3.5" />
            {saving
              ? "Speichern..."
              : conflictIds
                ? "Trotzdem ändern"
                : "Änderungen anwenden"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
