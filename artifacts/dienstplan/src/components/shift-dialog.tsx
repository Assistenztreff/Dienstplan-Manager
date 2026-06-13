import { useState, useEffect } from "react";
import { format } from "date-fns";
import {
  useCreateShift,
  useUpdateShift,
  useDeleteShift,
  useListShiftModels,
  getListShiftsQueryKey,
  ApiError,
  type ShiftInputType,
  type ShiftUpdateType,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2 } from "lucide-react";
import { colorDotClass } from "@/lib/shift-model-colors";

type Assistant = { id: number; name: string };

type ShiftForEdit = {
  id: number;
  userId: number;
  startTime: string;
  endTime: string;
  type: string;
  shiftModelId?: number | null;
  notes?: string | null;
};

type ShiftDialogProps = {
  open: boolean;
  onClose: () => void;
  preselectedDate?: Date;
  preselectedUserId?: number;
  editShift?: ShiftForEdit;
  assistants: Assistant[];
  month: number;
  year: number;
};

const LEGACY_TYPE_LABELS: Record<string, string> = {
  active: "Aktivdienst",
  standby: "Bereitschaftsdienst",
  night: "Nachtdienst",
  full_day: "24h-Dienst",
};

type FormState = {
  userId: string;
  date: string;
  startTime: string;
  endTime: string;
  selection: string;
  notes: string;
};

function toTimeString(isoString: string): string {
  return format(new Date(isoString), "HH:mm");
}

function toDateString(isoString: string): string {
  return format(new Date(isoString), "yyyy-MM-dd");
}

function buildIso(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString();
}

function initialSelection(editShift: ShiftForEdit | undefined, firstModelId: number | undefined): string {
  if (!editShift) return firstModelId ? `model:${firstModelId}` : "";
  if (editShift.type === "vacation" || editShift.type === "sick") return editShift.type;
  if (editShift.type === "work" && editShift.shiftModelId) return `model:${editShift.shiftModelId}`;
  return `legacy:${editShift.type}`;
}

export function ShiftDialog({
  open,
  onClose,
  preselectedDate,
  preselectedUserId,
  editShift,
  assistants,
  month,
  year,
}: ShiftDialogProps) {
  const queryClient = useQueryClient();
  const createShift = useCreateShift();
  const updateShift = useUpdateShift();
  const deleteShift = useDeleteShift();
  const { data: models } = useListShiftModels();

  const allModels = models ?? [];
  const activeModels = allModels.filter((m) => m.isActive);
  const firstModelId = activeModels[0]?.id;

  const isEditing = !!editShift;

  const defaultDate = preselectedDate
    ? format(preselectedDate, "yyyy-MM-dd")
    : format(new Date(), "yyyy-MM-dd");

  function buildInitialForm(): FormState {
    return {
      userId: editShift ? String(editShift.userId) : preselectedUserId ? String(preselectedUserId) : "",
      date: editShift ? toDateString(editShift.startTime) : defaultDate,
      startTime: editShift ? toTimeString(editShift.startTime) : "08:00",
      endTime: editShift ? toTimeString(editShift.endTime) : "16:00",
      selection: initialSelection(editShift, firstModelId),
      notes: editShift?.notes ?? "",
    };
  }

  const [form, setForm] = useState<FormState>(buildInitialForm);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Formular nur beim Öffnen / beim Wechsel des Bearbeitungsziels zurücksetzen,
  // nicht wenn die Schichtmodelle asynchron nachladen (sonst gehen Eingaben verloren).
  useEffect(() => {
    if (open) {
      setErrors({});
      setConfirmDelete(false);
      setForm(buildInitialForm());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editShift?.id, preselectedUserId, preselectedDate]);

  // Sobald die Modelle geladen sind, im Anlegen-Modus eine Standardauswahl setzen,
  // falls der Nutzer noch nichts gewählt hat.
  useEffect(() => {
    if (open && !isEditing && firstModelId) {
      setForm((f) => (f.selection === "" ? { ...f, selection: `model:${firstModelId}` } : f));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, firstModelId, isEditing]);

  function set<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
  }

  const isAbsence = form.selection === "vacation" || form.selection === "sick";
  const is24h = form.selection === "legacy:full_day";

  // Wenn das bearbeitete Modell inaktiv ist, trotzdem als Option anzeigen.
  const editModelId =
    editShift?.type === "work" && editShift.shiftModelId ? editShift.shiftModelId : undefined;
  const inactiveEditModel =
    editModelId && !activeModels.some((m) => m.id === editModelId)
      ? allModels.find((m) => m.id === editModelId)
      : undefined;

  const legacyEditOption =
    editShift && form.selection.startsWith("legacy:")
      ? { value: form.selection, label: LEGACY_TYPE_LABELS[editShift.type] ?? editShift.type }
      : undefined;

  function validate(): boolean {
    const errs: Partial<Record<keyof FormState, string>> = {};
    if (!form.userId) errs.userId = "Assistent auswählen";
    if (!form.date) errs.date = "Datum angeben";
    if (!isAbsence) {
      if (!form.startTime) errs.startTime = "Startzeit angeben";
      if (!form.endTime) errs.endTime = "Endzeit angeben";
      if (form.startTime && form.endTime && form.startTime >= form.endTime && !is24h) {
        errs.endTime = "Endzeit muss nach der Startzeit liegen";
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function invalidate() {
    await queryClient.invalidateQueries({ queryKey: getListShiftsQueryKey({ month, year }) });
  }

  function deriveTypeAndModel(): { type: ShiftInputType & ShiftUpdateType; shiftModelId: number | null } {
    if (form.selection.startsWith("model:")) {
      return {
        type: "work" as ShiftInputType & ShiftUpdateType,
        shiftModelId: Number(form.selection.slice("model:".length)),
      };
    }
    if (form.selection.startsWith("legacy:")) {
      return {
        type: form.selection.slice("legacy:".length) as ShiftInputType & ShiftUpdateType,
        shiftModelId: null,
      };
    }
    return { type: form.selection as ShiftInputType & ShiftUpdateType, shiftModelId: null };
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    try {
      let startIso: string;
      let endIso: string;

      if (isAbsence) {
        startIso = new Date(`${form.date}T00:00:00`).toISOString();
        endIso = new Date(`${form.date}T23:59:59`).toISOString();
      } else if (is24h) {
        startIso = buildIso(form.date, form.startTime);
        const startDate = new Date(`${form.date}T${form.startTime}:00`);
        endIso = new Date(startDate.getTime() + 24 * 60 * 60 * 1000).toISOString();
      } else {
        startIso = buildIso(form.date, form.startTime);
        endIso = buildIso(form.date, form.endTime);
      }

      const { type, shiftModelId } = deriveTypeAndModel();

      if (isEditing && editShift) {
        await updateShift.mutateAsync({
          id: editShift.id,
          data: {
            startTime: startIso,
            endTime: endIso,
            type,
            shiftModelId,
            notes: form.notes || null,
          },
        });
      } else {
        await createShift.mutateAsync({
          data: {
            userId: Number(form.userId),
            startTime: startIso,
            endTime: endIso,
            type,
            shiftModelId,
            notes: form.notes || undefined,
          },
        });
      }
      await invalidate();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setErrors({ notes: "Sitzung abgelaufen. Bitte Seite neu laden und erneut anmelden." });
      } else if (err instanceof ApiError && err.status === 403) {
        setErrors({ notes: "Keine Berechtigung zum Speichern." });
      } else {
        setErrors({ notes: "Speichern fehlgeschlagen. Bitte erneut versuchen." });
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!editShift) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setSaving(true);
    try {
      await deleteShift.mutateAsync({ id: editShift.id });
      await invalidate();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">
            {isEditing ? "Schicht bearbeiten" : "Neue Schicht anlegen"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Assistent */}
          <div className="space-y-1.5">
            <Label>Assistent *</Label>
            <Select
              value={form.userId}
              onValueChange={(v) => set("userId", v)}
              disabled={isEditing}
            >
              <SelectTrigger className={errors.userId ? "border-destructive" : ""}>
                <SelectValue placeholder="Assistent auswählen..." />
              </SelectTrigger>
              <SelectContent>
                {assistants.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.userId && <p className="text-xs text-destructive">{errors.userId}</p>}
          </div>

          {/* Datum */}
          <div className="space-y-1.5">
            <Label>Datum *</Label>
            <Input
              type="date"
              value={form.date}
              onChange={(e) => set("date", e.target.value)}
              className={errors.date ? "border-destructive" : ""}
            />
            {errors.date && <p className="text-xs text-destructive">{errors.date}</p>}
          </div>

          {/* Schicht-Typ / Modell */}
          <div className="space-y-1.5">
            <Label>Typ *</Label>
            <Select value={form.selection} onValueChange={(v) => set("selection", v)}>
              <SelectTrigger>
                <SelectValue placeholder="Typ auswählen..." />
              </SelectTrigger>
              <SelectContent>
                {legacyEditOption && (
                  <SelectItem value={legacyEditOption.value}>{legacyEditOption.label}</SelectItem>
                )}
                {activeModels.map((m) => (
                  <SelectItem key={m.id} value={`model:${m.id}`}>
                    <span className="flex items-center gap-2">
                      <span className={`inline-block h-2.5 w-2.5 rounded-full ${colorDotClass(m.color)}`} />
                      {m.name}
                    </span>
                  </SelectItem>
                ))}
                {inactiveEditModel && (
                  <SelectItem value={`model:${inactiveEditModel.id}`}>
                    <span className="flex items-center gap-2">
                      <span className={`inline-block h-2.5 w-2.5 rounded-full ${colorDotClass(inactiveEditModel.color)}`} />
                      {inactiveEditModel.name} (inaktiv)
                    </span>
                  </SelectItem>
                )}
                <SelectItem value="vacation">Urlaub</SelectItem>
                <SelectItem value="sick">Krank</SelectItem>
              </SelectContent>
            </Select>
            {activeModels.length === 0 && !isAbsence && !legacyEditOption && (
              <p className="text-xs text-muted-foreground">
                Noch keine Schichtmodelle angelegt. Lege sie unter Einstellungen an.
              </p>
            )}
          </div>

          {/* Zeiten (nur für reguläre Schichten) */}
          {!isAbsence && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Startzeit *</Label>
                <Input
                  type="time"
                  value={form.startTime}
                  onChange={(e) => set("startTime", e.target.value)}
                  className={errors.startTime ? "border-destructive" : ""}
                />
                {errors.startTime && <p className="text-xs text-destructive">{errors.startTime}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Endzeit {is24h ? "(auto)" : "*"}</Label>
                <Input
                  type="time"
                  value={is24h ? form.startTime : form.endTime}
                  onChange={(e) => set("endTime", e.target.value)}
                  disabled={is24h}
                  className={errors.endTime ? "border-destructive" : ""}
                />
                {is24h && (
                  <p className="text-xs text-muted-foreground">24h nach Startzeit</p>
                )}
                {errors.endTime && !is24h && (
                  <p className="text-xs text-destructive">{errors.endTime}</p>
                )}
              </div>
            </div>
          )}

          {isAbsence && (
            <p className="text-xs text-muted-foreground rounded-md bg-muted/50 px-3 py-2">
              {form.selection === "vacation"
                ? "Urlaubstag wird als ganzer Tag eingetragen und vom Urlaubskontigent abgezogen."
                : "Krankheitstag wird als ganzer Tag eingetragen. Vertragsstunden werden als Lohnfortzahlung gutgeschrieben."}
            </p>
          )}

          {/* Hinweise */}
          <div className="space-y-1.5">
            <Label>Hinweise</Label>
            <Input
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Optional"
            />
            {errors.notes && <p className="text-xs text-destructive">{errors.notes}</p>}
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2 pt-2">
          {isEditing && (
            <Button
              variant={confirmDelete ? "destructive" : "outline"}
              size="sm"
              onClick={handleDelete}
              disabled={saving}
              className="gap-1.5 mr-auto"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {confirmDelete ? "Wirklich löschen?" : "Löschen"}
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Abbrechen
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Speichern..." : isEditing ? "Aktualisieren" : "Anlegen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
