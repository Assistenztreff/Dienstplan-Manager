import { useState, useEffect } from "react";
import { format } from "date-fns";
import {
  useCreateShift,
  useUpdateShift,
  useDeleteShift,
  getListShiftsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2 } from "lucide-react";

type Assistant = { id: number; name: string };

type ShiftForEdit = {
  id: number;
  userId: number;
  startTime: string;
  endTime: string;
  type: string;
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

const SHIFT_TYPES = [
  { value: "active", label: "Aktivdienst" },
  { value: "standby", label: "Bereitschaftsdienst" },
  { value: "night", label: "Nachtdienst" },
  { value: "full_day", label: "24h-Dienst" },
  { value: "vacation", label: "Urlaub" },
  { value: "sick", label: "Krank" },
] as const;

type ShiftTypeValue = (typeof SHIFT_TYPES)[number]["value"];

const ABSENCE_TYPES: ShiftTypeValue[] = ["vacation", "sick"];

type FormState = {
  userId: string;
  date: string;
  startTime: string;
  endTime: string;
  type: ShiftTypeValue;
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

  const isEditing = !!editShift;

  const defaultDate = preselectedDate
    ? format(preselectedDate, "yyyy-MM-dd")
    : format(new Date(), "yyyy-MM-dd");

  const [form, setForm] = useState<FormState>(() => ({
    userId: editShift ? String(editShift.userId) : preselectedUserId ? String(preselectedUserId) : "",
    date: editShift ? toDateString(editShift.startTime) : defaultDate,
    startTime: editShift ? toTimeString(editShift.startTime) : "08:00",
    endTime: editShift ? toTimeString(editShift.endTime) : "16:00",
    type: editShift && SHIFT_TYPES.find(t => t.value === editShift.type) ? editShift.type as ShiftTypeValue : "active",
    notes: editShift?.notes ?? "",
  }));

  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (open) {
      setErrors({});
      setConfirmDelete(false);
      setForm({
        userId: editShift ? String(editShift.userId) : preselectedUserId ? String(preselectedUserId) : "",
        date: editShift ? toDateString(editShift.startTime) : defaultDate,
        startTime: editShift ? toTimeString(editShift.startTime) : "08:00",
        endTime: editShift ? toTimeString(editShift.endTime) : "16:00",
        type: editShift && SHIFT_TYPES.find(t => t.value === editShift.type) ? editShift.type as ShiftTypeValue : "active",
        notes: editShift?.notes ?? "",
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function set<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm(f => ({ ...f, [field]: value }));
    setErrors(e => ({ ...e, [field]: undefined }));
  }

  const isAbsence = ABSENCE_TYPES.includes(form.type);
  const is24h = form.type === "full_day";

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

      if (isEditing && editShift) {
        await updateShift.mutateAsync({
          params: { id: editShift.id },
          data: {
            startTime: startIso,
            endTime: endIso,
            type: form.type,
            notes: form.notes || null,
          },
        });
      } else {
        await createShift.mutateAsync({
          data: {
            userId: Number(form.userId),
            startTime: startIso,
            endTime: endIso,
            type: form.type,
            notes: form.notes || undefined,
          },
        });
      }
      await invalidate();
      onClose();
    } catch {
      setErrors({ notes: "Speichern fehlgeschlagen. Bitte erneut versuchen." });
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
      await deleteShift.mutateAsync({ params: { id: editShift.id } });
      await invalidate();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
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
              onValueChange={v => set("userId", v)}
              disabled={isEditing}
            >
              <SelectTrigger className={errors.userId ? "border-destructive" : ""}>
                <SelectValue placeholder="Assistent auswählen..." />
              </SelectTrigger>
              <SelectContent>
                {assistants.map(a => (
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
              onChange={e => set("date", e.target.value)}
              className={errors.date ? "border-destructive" : ""}
            />
            {errors.date && <p className="text-xs text-destructive">{errors.date}</p>}
          </div>

          {/* Schicht-Typ */}
          <div className="space-y-1.5">
            <Label>Typ *</Label>
            <Select value={form.type} onValueChange={v => set("type", v as ShiftTypeValue)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SHIFT_TYPES.map(t => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Zeiten (nur für reguläre Schichten) */}
          {!isAbsence && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Startzeit *</Label>
                <Input
                  type="time"
                  value={form.startTime}
                  onChange={e => set("startTime", e.target.value)}
                  className={errors.startTime ? "border-destructive" : ""}
                />
                {errors.startTime && <p className="text-xs text-destructive">{errors.startTime}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Endzeit {is24h ? "(auto)" : "*"}</Label>
                <Input
                  type="time"
                  value={is24h ? form.startTime : form.endTime}
                  onChange={e => set("endTime", e.target.value)}
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
              {form.type === "vacation"
                ? "Urlaubstag wird als ganzer Tag eingetragen und vom Urlaubskontigent abgezogen."
                : "Krankheitstag wird als ganzer Tag eingetragen. Vertragsstunden werden als Lohnfortzahlung gutgeschrieben."}
            </p>
          )}

          {/* Hinweise */}
          <div className="space-y-1.5">
            <Label>Hinweise</Label>
            <Input
              value={form.notes}
              onChange={e => set("notes", e.target.value)}
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
