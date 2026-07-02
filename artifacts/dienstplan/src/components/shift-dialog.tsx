import { useState, useEffect } from "react";
import { format } from "date-fns";
import {
  useCreateShift,
  useUpdateShift,
  useDeleteShift,
  useListShiftModels,
  useListShiftTemplates,
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Trash2 } from "lucide-react";
import { readableApiError, planUpgradeMessage } from "@/lib/api-error";

type Assistant = { id: number; name: string };

type ShiftForEdit = {
  id: number;
  userId: number;
  startTime: string;
  endTime: string;
  type: string;
  planningStatus?: string | null;
  shiftModelId?: number | null;
  notes?: string | null;
};

// Planungsstatus: Entwurf (intern) → Vorschlag (angeboten) → Bestätigt (fix).
type PlanningStatus = "VORLAEUFIG" | "ANGEBOTEN" | "FIX";

const PLANNING_STATUS_OPTIONS: { value: PlanningStatus; label: string; hint: string }[] = [
  {
    value: "VORLAEUFIG",
    label: "Entwurf",
    hint: "Interne Planung, noch nicht verbindlich — zählt nicht in Auswertungen und Stundennachweis.",
  },
  {
    value: "ANGEBOTEN",
    label: "Vorschlag",
    hint: "Dem Assistenten angeboten, wartet auf Bestätigung — zählt noch nicht in Auswertungen und Stundennachweis.",
  },
  {
    value: "FIX",
    label: "Bestätigt",
    hint: "Verbindlich bestätigter Dienst — zählt in Auswertungen und Stundennachweis.",
  },
];

function isPlanningStatus(value: string | null | undefined): value is PlanningStatus {
  return value === "VORLAEUFIG" || value === "ANGEBOTEN" || value === "FIX";
}

type ShiftDialogProps = {
  open: boolean;
  onClose: () => void;
  preselectedDate?: Date;
  preselectedUserId?: number;
  editShift?: ShiftForEdit;
  assistants: Assistant[];
  month: number;
  year: number;
  teamId?: number | null;
  /**
   * Mehrfach-Anlegen (Auswahl-Modus): Liste lokaler Datumsschlüssel
   * (yyyy-MM-dd). Ist sie gesetzt (und es wird nicht bearbeitet), legt der
   * Dialog für jedes Datum dieselbe Schicht an (Schleife) statt einer einzelnen.
   */
  bulkDates?: string[];
  /** Wird nach erfolgreichem Speichern aufgerufen (z. B. Auswahl zurücksetzen). */
  onSaved?: () => void;
};

const LEGACY_TYPE_LABELS: Record<string, string> = {
  active: "Aktivdienst",
  standby: "Bereitschaftsdienst",
  night: "Nachtdienst",
  full_day: "24h-Dienst",
};

type ConflictInfo = {
  id: number;
  startTime: string;
  endTime: string;
  type: string;
};

// Lesbares Label für eine kollidierende Schicht (Datum + Zeit, ggf. Folgetag).
function conflictLabel(c: ConflictInfo): string {
  const start = new Date(c.startTime);
  const end = new Date(c.endTime);
  const startStr = format(start, "dd.MM.yyyy HH:mm");
  const sameDay = format(start, "yyyy-MM-dd") === format(end, "yyyy-MM-dd");
  const endStr = sameDay ? format(end, "HH:mm") : `${format(end, "dd.MM. HH:mm")} (+1)`;
  return `${startStr}–${endStr}`;
}

type FormState = {
  userId: string;
  date: string;
  startTime: string;
  endTime: string;
  selection: string;
  planningStatus: PlanningStatus;
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

// Liefert das Folgedatum ("yyyy-MM-dd") zu einem Datum. Wird genutzt, wenn eine
// Schicht über Mitternacht läuft und die Endzeit am nächsten Tag liegt.
function nextDayString(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return format(d, "yyyy-MM-dd");
}

// Wochentag eines lokalen Datums (yyyy-MM-dd) im ISO-Schema: 1 (Montag) bis
// 7 (Sonntag). JS getDay() liefert 0=Sonntag, daher die Verschiebung.
function isoWeekday(dateStr: string): number {
  return ((new Date(`${dateStr}T00:00:00`).getDay() + 6) % 7) + 1;
}

const WEEKDAY_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

function weekdaysLabel(weekdays: number[]): string {
  return [...weekdays]
    .sort((a, b) => a - b)
    .map((d) => WEEKDAY_SHORT[d - 1] ?? String(d))
    .join(", ");
}

type TemplateWeekdays = { weekdays: number[] };

// Prüft, ob eine Vorlage laut ihren Wochentagen zu einem Datum passt.
// Eine leere Wochentagsliste bedeutet "gilt an allen Tagen".
function templateMatchesDate(tpl: TemplateWeekdays, dateStr: string): boolean {
  if (!tpl.weekdays || tpl.weekdays.length === 0) return true;
  if (!dateStr) return true;
  return tpl.weekdays.includes(isoWeekday(dateStr));
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
  teamId,
  bulkDates,
  onSaved,
}: ShiftDialogProps) {
  const queryClient = useQueryClient();
  const createShift = useCreateShift();
  const updateShift = useUpdateShift();
  const deleteShift = useDeleteShift();
  const { data: models } = useListShiftModels();
  const { data: templates } = useListShiftTemplates(teamId != null ? { teamId } : undefined);

  const allTemplates = templates ?? [];
  const allModels = models ?? [];
  const activeModels = allModels.filter((m) => m.isActive);
  const firstModelId = activeModels[0]?.id;

  const isEditing = !!editShift;
  // Mehrfach-Anlegen ist nur im Anlege-Modus (nicht beim Bearbeiten) aktiv und
  // setzt mindestens einen ausgewählten Tag voraus.
  const isBulk = !isEditing && (bulkDates?.length ?? 0) > 0;

  const defaultDate = preselectedDate
    ? format(preselectedDate, "yyyy-MM-dd")
    : format(new Date(), "yyyy-MM-dd");

  function buildInitialForm(): FormState {
    return {
      userId: editShift ? String(editShift.userId) : preselectedUserId ? String(preselectedUserId) : "",
      // Im Mehrfach-Modus ist das einzelne Datumsfeld bedeutungslos (die Tage
      // stehen über bulkDates fest); wir füllen es nur, damit validate() greift.
      date: editShift ? toDateString(editShift.startTime) : isBulk ? bulkDates![0] : defaultDate,
      startTime: editShift ? toTimeString(editShift.startTime) : "08:00",
      endTime: editShift ? toTimeString(editShift.endTime) : "16:00",
      selection: initialSelection(editShift, firstModelId),
      // Beim Bearbeiten den gespeicherten Status übernehmen; neue Schichten
      // starten bewusst als Entwurf (Beginn des Planungs-Workflows).
      planningStatus: isPlanningStatus(editShift?.planningStatus)
        ? editShift!.planningStatus
        : editShift
          ? "FIX"
          : "VORLAEUFIG",
      notes: editShift?.notes ?? "",
    };
  }

  const [form, setForm] = useState<FormState>(buildInitialForm);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [overlapConflicts, setOverlapConflicts] = useState<ConflictInfo[] | null>(null);
  // Mehrfach-Anlegen: bereits erfolgreich angelegte Tage (damit ein "Trotzdem
  // anlegen"-Wiederholungslauf sie nicht doppelt erzeugt) und die Tage mit
  // Überschneidung (für die Warnung + force-Wiederholung).
  const [bulkCreated, setBulkCreated] = useState<Set<string>>(new Set());
  const [bulkConflicts, setBulkConflicts] = useState<string[] | null>(null);
  // Gewählte Arbeitszeit-Vorlage (nur zur Anzeige im Select); das Anwenden
  // belegt Start-/Endzeit vor.
  const [templateId, setTemplateId] = useState<string>("");

  // Formular nur beim Öffnen / beim Wechsel des Bearbeitungsziels zurücksetzen,
  // nicht wenn die Schichtmodelle asynchron nachladen (sonst gehen Eingaben verloren).
  useEffect(() => {
    if (open) {
      setErrors({});
      setConfirmDelete(false);
      setOverlapConflicts(null);
      setBulkCreated(new Set());
      setBulkConflicts(null);
      setTemplateId("");
      setForm(buildInitialForm());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editShift?.id, preselectedUserId, preselectedDate, bulkDates]);

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
    // Sobald die Eingaben geändert werden, ist eine frühere Kollisionswarnung
    // hinfällig — beim nächsten Speichern wird neu geprüft (ohne force).
    setOverlapConflicts(null);
    setBulkConflicts(null);
  }

  // Wendet eine Arbeitszeit-Vorlage an: belegt Start-/Endzeit vor.
  function applyTemplate(value: string) {
    setTemplateId(value);
    const tpl = allTemplates.find((t) => String(t.id) === value);
    if (!tpl) return;
    setForm((f) => ({ ...f, startTime: tpl.startTime, endTime: tpl.endTime }));
    setErrors((e) => ({ ...e, startTime: undefined, endTime: undefined }));
    setOverlapConflicts(null);
    setBulkConflicts(null);
  }

  const isAbsence = form.selection === "vacation" || form.selection === "sick";
  const is24h = form.selection === "legacy:full_day";

  // Wochentags-Abgleich der Vorlagen mit dem gewählten Datum bzw. den
  // ausgewählten Tagen (Mehrfach-Modus). Reine Hinweis-/Sortierlogik —
  // das Anwenden einer "unpassenden" Vorlage bleibt bewusst erlaubt.
  const relevantDates = isBulk ? bulkDates ?? [] : form.date ? [form.date] : [];
  const templateFitsAllDates = (tpl: TemplateWeekdays) =>
    relevantDates.every((d) => templateMatchesDate(tpl, d));

  // Passende Vorlagen zuerst listen (stabile Reihenfolge innerhalb der Gruppen).
  const matchingTemplates = allTemplates.filter((t) => templateFitsAllDates(t));
  const otherTemplates = allTemplates.filter((t) => !templateFitsAllDates(t));

  // Hinweis, wenn die aktuell angewendete Vorlage nicht zu den Tagen passt.
  // Reagiert auch auf nachträgliche Datumsänderungen, da rein abgeleitet.
  const selectedTemplate = allTemplates.find((t) => String(t.id) === templateId);
  const templateMismatchDates = selectedTemplate
    ? relevantDates.filter((d) => !templateMatchesDate(selectedTemplate, d))
    : [];

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

  // Beim Bearbeiten kann der Assistent nicht gewechselt werden. Statt eines
  // deaktivierten Selects (das je nach Datenlage nur die userId zeigt) den
  // vollen Namen aus der Assistentenliste auflösen und schreibgeschützt anzeigen.
  const editAssistantName = isEditing
    ? assistants.find((a) => a.id === editShift?.userId)?.name ?? `Assistent #${editShift?.userId}`
    : undefined;

  function validate(): boolean {
    const errs: Partial<Record<keyof FormState, string>> = {};
    if (!form.userId) errs.userId = "Assistent auswählen";
    if (!form.date) errs.date = "Datum angeben";
    if (!isAbsence) {
      if (!form.startTime) errs.startTime = "Startzeit angeben";
      if (!form.endTime) errs.endTime = "Endzeit angeben";
      // Identische Start-/Endzeit ist erlaubt und bedeutet ein 24h-Dienst
      // (Ende am Folgetag); eine kleinere Endzeit bedeutet "endet am Folgetag"
      // (Nachtdienst über Mitternacht). Beides wird in handleSave aufgelöst.
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

  // Berechnet Start-/End-Zeitstempel für ein konkretes Datum (yyyy-MM-dd) gemäß
  // dem aktuellen Formular. Zentral genutzt von Einzel- und Mehrfach-Anlegen,
  // damit beide Pfade dieselbe Zeitlogik (Abwesenheit / 24h / Tagesübergang)
  // verwenden.
  function buildTimes(dateStr: string): { startIso: string; endIso: string } {
    if (isAbsence) {
      return {
        startIso: new Date(`${dateStr}T00:00:00`).toISOString(),
        endIso: new Date(`${dateStr}T23:59:59`).toISOString(),
      };
    }
    if (is24h) {
      const startDate = new Date(`${dateStr}T${form.startTime}:00`);
      return {
        startIso: buildIso(dateStr, form.startTime),
        endIso: new Date(startDate.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      };
    }
    // Endzeit <= Startzeit bedeutet Tagesübergang: Endzeitstempel auf den
    // Folgetag legen, damit eine korrekte positive Dauer gespeichert wird.
    const endsNextDay = form.endTime <= form.startTime;
    return {
      startIso: buildIso(dateStr, form.startTime),
      endIso: endsNextDay
        ? buildIso(nextDayString(dateStr), form.endTime)
        : buildIso(dateStr, form.endTime),
    };
  }

  async function handleSave(force = false) {
    if (!validate()) return;
    setSaving(true);
    try {
      const { startIso, endIso } = buildTimes(form.date);
      const { type, shiftModelId } = deriveTypeAndModel();

      if (isEditing && editShift) {
        const data = {
          startTime: startIso,
          endTime: endIso,
          type,
          planningStatus: form.planningStatus,
          shiftModelId,
          notes: form.notes || null,
        };
        await updateShift.mutateAsync({
          id: editShift.id,
          data: { ...data, ...(force ? { force: true } : {}) } as typeof data,
        });
      } else {
        const data = {
          userId: Number(form.userId),
          startTime: startIso,
          endTime: endIso,
          type,
          planningStatus: form.planningStatus,
          shiftModelId,
          notes: form.notes || undefined,
        };
        await createShift.mutateAsync({
          data: {
            ...data,
            ...(force ? { force: true } : {}),
            ...(teamId != null ? { teamId } : {}),
          } as typeof data,
        });
      }
      await invalidate();
      onClose();
    } catch (err) {
      const planMsg = planUpgradeMessage(err);
      if (err instanceof ApiError && err.status === 401) {
        setErrors({ notes: "Sitzung abgelaufen. Bitte Seite neu laden und erneut anmelden." });
      } else if (planMsg) {
        setErrors({ notes: planMsg });
      } else if (err instanceof ApiError && err.status === 403) {
        setErrors({ notes: "Keine Berechtigung zum Speichern." });
      } else if (
        err instanceof ApiError &&
        err.status === 409 &&
        (err.data as { code?: string } | null)?.code === "shift_overlap"
      ) {
        const conflicts = (err.data as { conflicts?: ConflictInfo[] }).conflicts ?? [];
        setOverlapConflicts(conflicts);
      } else {
        setErrors({
          notes: readableApiError(err, "Speichern fehlgeschlagen. Bitte erneut versuchen."),
        });
      }
    } finally {
      setSaving(false);
    }
  }

  // Mehrfach-Anlegen: legt für jeden ausgewählten Tag dieselbe Schicht an.
  // Bereits erfolgreich erstellte Tage werden bei einem "Trotzdem anlegen"-
  // Wiederholungslauf übersprungen (kein Doppel-Anlegen). Überschneidungen
  // werden gesammelt und können per force erneut versucht werden.
  async function handleBulkSave(force = false) {
    if (!bulkDates || bulkDates.length === 0) return;
    if (!validate()) return;
    setSaving(true);
    try {
      const { type, shiftModelId } = deriveTypeAndModel();
      const created = new Set(bulkCreated);
      const conflicts: string[] = [];
      let sessionExpired = false;
      let otherError = false;
      let planLimitError: string | null = null;

      for (const dateStr of bulkDates) {
        // Schon angelegte Tage nicht erneut erstellen.
        if (created.has(dateStr)) continue;
        const { startIso, endIso } = buildTimes(dateStr);
        const data = {
          userId: Number(form.userId),
          startTime: startIso,
          endTime: endIso,
          type,
          planningStatus: form.planningStatus,
          shiftModelId,
          notes: form.notes || undefined,
        };
        try {
          await createShift.mutateAsync({
            data: {
              ...data,
              ...(force ? { force: true } : {}),
              ...(teamId != null ? { teamId } : {}),
            } as typeof data,
          });
          created.add(dateStr);
        } catch (err) {
          const planMsg = planUpgradeMessage(err);
          if (err instanceof ApiError && err.status === 401) {
            sessionExpired = true;
            break;
          } else if (planMsg) {
            planLimitError = planMsg;
            break;
          } else if (
            err instanceof ApiError &&
            err.status === 409 &&
            (err.data as { code?: string } | null)?.code === "shift_overlap"
          ) {
            conflicts.push(dateStr);
          } else {
            otherError = true;
          }
        }
      }

      setBulkCreated(created);
      await invalidate();

      if (sessionExpired) {
        setErrors({ notes: "Sitzung abgelaufen. Bitte Seite neu laden und erneut anmelden." });
        return;
      }
      if (planLimitError) {
        setErrors({ notes: planLimitError });
        return;
      }
      if (otherError) {
        setErrors({
          notes: "Einige Schichten konnten nicht angelegt werden. Bitte erneut versuchen.",
        });
        return;
      }
      if (conflicts.length > 0) {
        // Nur Überschneidungen offen: Warnung anzeigen, force-Wiederholung anbieten.
        setBulkConflicts(conflicts);
        return;
      }

      // Alles angelegt.
      onSaved?.();
      onClose();
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
      <DialogContent className="sm:max-w-md" data-testid="shift-dialog">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">
            {isEditing
              ? "Schicht bearbeiten"
              : isBulk
                ? "Schichten eintragen"
                : "Neue Schicht anlegen"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Assistent */}
          <div className="space-y-1.5">
            <Label>Assistent *</Label>
            {isEditing ? (
              <Input
                data-testid="shift-dialog-user"
                value={editAssistantName ?? ""}
                disabled
                readOnly
              />
            ) : (
              <Select value={form.userId} onValueChange={(v) => set("userId", v)}>
                <SelectTrigger data-testid="shift-dialog-user" className={errors.userId ? "border-destructive" : ""}>
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
            )}
            {errors.userId && <p className="text-xs text-destructive">{errors.userId}</p>}
          </div>

          {/* Datum: im Mehrfach-Modus stehen die Tage fest (Auswahl) und werden
              als Zusammenfassung gezeigt; sonst das einzelne Datumsfeld. */}
          {isBulk ? (
            <div className="space-y-1.5">
              <Label>Tage</Label>
              <div
                className="rounded-md bg-muted/50 px-3 py-2 text-sm"
                data-testid="shift-dialog-bulk-summary"
              >
                <p className="font-medium">
                  {bulkDates!.length} {bulkDates!.length === 1 ? "Tag" : "Tage"} ausgewählt
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {[...bulkDates!]
                    .sort()
                    .map((d) => format(new Date(`${d}T00:00:00`), "d. MMM"))
                    .join(", ")}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>Datum *</Label>
              <Input
                type="date"
                data-testid="shift-dialog-date"
                value={form.date}
                onChange={(e) => set("date", e.target.value)}
                className={errors.date ? "border-destructive" : ""}
              />
              {errors.date && <p className="text-xs text-destructive">{errors.date}</p>}
            </div>
          )}

          {/* Schicht-Typ / Modell */}
          <div className="space-y-1.5">
            <Label>Typ *</Label>
            <Select value={form.selection} onValueChange={(v) => set("selection", v)}>
              <SelectTrigger data-testid="shift-dialog-type">
                <SelectValue placeholder="Typ auswählen..." />
              </SelectTrigger>
              <SelectContent>
                {(activeModels.length > 0 || legacyEditOption || inactiveEditModel) && (
                  <SelectGroup>
                    <SelectLabel>Dienst</SelectLabel>
                    {legacyEditOption && (
                      <SelectItem value={legacyEditOption.value}>{legacyEditOption.label}</SelectItem>
                    )}
                    {activeModels.map((m) => (
                      <SelectItem key={m.id} value={`model:${m.id}`}>
                        {m.name}
                      </SelectItem>
                    ))}
                    {inactiveEditModel && (
                      <SelectItem value={`model:${inactiveEditModel.id}`}>
                        {inactiveEditModel.name} (inaktiv)
                      </SelectItem>
                    )}
                  </SelectGroup>
                )}
                {(activeModels.length > 0 || legacyEditOption || inactiveEditModel) && (
                  <SelectSeparator />
                )}
                <SelectGroup>
                  <SelectLabel>Abwesenheit</SelectLabel>
                  <SelectItem value="vacation">
                    <span className="flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-full bg-yellow-400" />
                      Urlaub
                    </span>
                  </SelectItem>
                  <SelectItem value="sick">
                    <span className="flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-full bg-slate-400" />
                      Krank
                    </span>
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            {activeModels.length === 0 && !isAbsence && !legacyEditOption && !is24h && (
              <p className="text-xs text-muted-foreground">
                Noch keine Schichtmodelle angelegt. Lege sie unter Einstellungen an.
              </p>
            )}
          </div>

          {/* Planungsstatus (nur für reguläre Dienste; Abwesenheiten sind kein
              Planungs-Entwurf, sondern sofort verbindlich). */}
          {!isAbsence && (
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={form.planningStatus}
                onValueChange={(v) => set("planningStatus", v as PlanningStatus)}
              >
                <SelectTrigger data-testid="shift-dialog-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLANNING_STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {PLANNING_STATUS_OPTIONS.find((o) => o.value === form.planningStatus)?.hint}
              </p>
            </div>
          )}

          {/* Arbeitszeit-Vorlage (Schnellauswahl, belegt Zeiten vor) */}
          {!isAbsence && allTemplates.length > 0 && (
            <div className="space-y-1.5">
              <Label>Vorlage</Label>
              <Select value={templateId} onValueChange={applyTemplate}>
                <SelectTrigger data-testid="shift-dialog-template">
                  <SelectValue placeholder="Vorlage wählen (optional)..." />
                </SelectTrigger>
                <SelectContent>
                  {otherTemplates.length === 0 ? (
                    // Alle Vorlagen passen (oder haben keine Wochentags-
                    // Einschränkung): flache Liste ohne Gruppierung.
                    allTemplates.map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>
                        {t.name} ({t.startTime}–{t.endTime})
                      </SelectItem>
                    ))
                  ) : (
                    <>
                      {matchingTemplates.length > 0 && (
                        <SelectGroup>
                          <SelectLabel>
                            {isBulk ? "Passend zu den Tagen" : "Passend zum Datum"}
                          </SelectLabel>
                          {matchingTemplates.map((t) => (
                            <SelectItem key={t.id} value={String(t.id)}>
                              {t.name} ({t.startTime}–{t.endTime})
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      )}
                      {matchingTemplates.length > 0 && <SelectSeparator />}
                      <SelectGroup>
                        <SelectLabel>Andere Wochentage</SelectLabel>
                        {otherTemplates.map((t) => (
                          <SelectItem key={t.id} value={String(t.id)}>
                            {t.name} ({t.startTime}–{t.endTime}) · {weekdaysLabel(t.weekdays)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </>
                  )}
                </SelectContent>
              </Select>
              {selectedTemplate && templateMismatchDates.length > 0 ? (
                <p
                  className="text-xs text-amber-700 dark:text-amber-500"
                  data-testid="shift-dialog-template-mismatch"
                >
                  {isBulk
                    ? `Die Vorlage „${selectedTemplate.name}" gilt nur ${weekdaysLabel(
                        selectedTemplate.weekdays,
                      )} — ${templateMismatchDates.length} ${
                        templateMismatchDates.length === 1
                          ? "ausgewählter Tag passt"
                          : "der ausgewählten Tage passen"
                      } nicht dazu (${[...templateMismatchDates]
                        .sort()
                        .map((d) => format(new Date(`${d}T00:00:00`), "d. MMM"))
                        .join(", ")}). Die Zeiten wurden trotzdem übernommen.`
                    : `Die Vorlage „${selectedTemplate.name}" gilt nur ${weekdaysLabel(
                        selectedTemplate.weekdays,
                      )} — das gewählte Datum ist ein ${
                        WEEKDAY_SHORT[isoWeekday(form.date) - 1]
                      }. Die Zeiten wurden trotzdem übernommen.`}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Belegt Start- und Endzeit automatisch vor. Unter Einstellungen verwaltbar.
                </p>
              )}
            </div>
          )}

          {/* Zeiten (nur für reguläre Schichten) */}
          {!isAbsence && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Startzeit *</Label>
                <Input
                  type="time"
                  data-testid="shift-dialog-start"
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
                  data-testid="shift-dialog-end"
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

          {/* Kollisionswarnung */}
          {overlapConflicts && overlapConflicts.length > 0 && (
            <div
              className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2.5 text-sm"
              data-testid="shift-dialog-overlap"
            >
              <p className="font-medium text-destructive">
                Überschneidung mit bestehender{" "}
                {overlapConflicts.length > 1 ? "Schichten" : "Schicht"}
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-destructive">
                {overlapConflicts.map((c) => (
                  <li key={c.id}>{conflictLabel(c)}</li>
                ))}
              </ul>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Du kannst trotzdem speichern, falls die Überschneidung gewollt ist
                (z. B. Bereitschaft parallel zu einem anderen Dienst).
              </p>
            </div>
          )}

          {/* Kollisionswarnung im Mehrfach-Modus: betrifft ganze Tage, nicht eine
              einzelne Zeitspanne. Bereits angelegte Tage bleiben erhalten. */}
          {bulkConflicts && bulkConflicts.length > 0 && (
            <div
              className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2.5 text-sm"
              data-testid="shift-dialog-bulk-overlap"
            >
              <p className="font-medium text-destructive">
                Überschneidung an {bulkConflicts.length}{" "}
                {bulkConflicts.length === 1 ? "Tag" : "Tagen"}
              </p>
              <p className="mt-1 text-destructive">
                {[...bulkConflicts]
                  .sort()
                  .map((d) => format(new Date(`${d}T00:00:00`), "d. MMM"))
                  .join(", ")}
              </p>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Die übrigen Tage wurden bereits angelegt. Du kannst die Tage mit
                Überschneidung trotzdem anlegen, falls das gewollt ist.
              </p>
            </div>
          )}

          {/* Hinweise */}
          <div className="space-y-1.5">
            <Label>Hinweise</Label>
            <Input
              data-testid="shift-dialog-notes"
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
          {isBulk ? (
            <Button
              onClick={() => handleBulkSave(bulkConflicts !== null)}
              disabled={saving}
              variant={bulkConflicts ? "destructive" : "default"}
              data-testid="shift-dialog-save"
            >
              {saving
                ? "Speichern..."
                : bulkConflicts
                  ? "Trotzdem anlegen"
                  : `Für ${bulkDates!.length} ${bulkDates!.length === 1 ? "Tag" : "Tage"} anlegen`}
            </Button>
          ) : (
            <Button
              onClick={() => handleSave(overlapConflicts !== null)}
              disabled={saving}
              variant={overlapConflicts ? "destructive" : "default"}
              data-testid="shift-dialog-save"
            >
              {saving
                ? "Speichern..."
                : overlapConflicts
                  ? "Trotzdem speichern"
                  : isEditing
                    ? "Aktualisieren"
                    : "Anlegen"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
