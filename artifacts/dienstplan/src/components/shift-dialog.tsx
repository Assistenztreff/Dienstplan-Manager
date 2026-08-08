import { useState, useEffect } from "react";
import { eachDayOfInterval, format } from "date-fns";
import {
  useCreateShift,
  useBulkCreateAbsence,
  useUpdateShift,
  useDeleteShift,
  useListShifts,
  useListShiftModels,
  useGetAllowanceSettings,
  getListShiftsQueryKey,
  ApiError,
  type BulkAbsenceInput,
  type ShiftInputType,
  type ShiftUpdateType,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { CalendarIcon, Check, ChevronsUpDown, Trash2, X } from "lucide-react";
import { de } from "date-fns/locale";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { readableApiError, planUpgradeMessage } from "@/lib/api-error";
import { warnIfMonthClosed } from "@/lib/month-closing-warning";
import { computeAutoPauseMinutes } from "@/lib/pause";
import { useTeam } from "@/context/team";
import { useAuth } from "@/context/auth";
import { isAdminRole } from "@/lib/roles";

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
  einsatzTeamId?: number | null;
  isVertretung?: boolean | null;
  pauseMinutes?: number | null;
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
    hint: "Der Assistenzkraft angeboten, wartet auf Bestätigung — zählt noch nicht in Auswertungen und Stundennachweis.",
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
  // Aushilfe-Einsatz: ID eines anderen eigenen Teams als String, "" = keiner.
  einsatzTeamId: string;
  // Vertretung: Info-Markierung für Arbeitsdienste (Auswertungs-Zählung).
  isVertretung: boolean;
  // Unbezahlte Pause in Minuten als String ("" = 0; reine Info-Kennzahl).
  pauseMinutes: string;
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

// Liefert das Vortagsdatum ("yyyy-MM-dd") zu einem Datum. Wird für den Hinweis
// auf einen hineinragenden Vortags-Nachtdienst beim Anlegen von Abwesenheiten
// gebraucht.
function prevDayString(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() - 1);
  return format(d, "yyyy-MM-dd");
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

const TIME_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

function weekdaysLabel(weekdays: number[]): string {
  return [...weekdays]
    .sort((a, b) => a - b)
    .map((d) => WEEKDAY_SHORT[d - 1] ?? String(d))
    .join(", ");
}

function initialSelection(editShift: ShiftForEdit | undefined, firstModelId: number | undefined): string {
  if (!editShift) return firstModelId ? `model:${firstModelId}` : "";
  if (
    editShift.type === "vacation" ||
    editShift.type === "sick" ||
    editShift.type === "freizeitausgleich" ||
    editShift.type === "team" ||
    editShift.type === "kind_krank" ||
    editShift.type === "freistellung" ||
    editShift.type === "abgesagt_ag" ||
    editShift.type === "abgesagt_an" ||
    editShift.type === "urlaubsabgeltung"
  )
    return editShift.type;
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
  const bulkCreateAbsence = useBulkCreateAbsence();
  const updateShift = useUpdateShift();
  const deleteShift = useDeleteShift();
  // Dienste STRIKT team-bezogen laden: ohne Filter kämen Schichtmodelle
  // fremder eigener Teams in die Auswahl, deren Speichern der Server korrekt
  // mit 403 ablehnt ("Schichtmodell gehört nicht zu diesem Team").
  const { data: models } = useListShiftModels(teamId != null ? { teamId } : {});
  // Konto-globaler Schalter „Team-Dienst (Teamsitzung)": blendet die
  // Team-Option im Typ-Wähler ein (Server-Gate bleibt maßgeblich).
  const { data: allowanceSettings } = useGetAllowanceSettings(
    teamId != null ? { teamId } : undefined,
  );
  const teamMeetingEnabled = allowanceSettings?.teamMeetingEnabled === true;
  // Schichten des Monats (gleicher Query wie die Kalender-Seite, kommt daher
  // aus dem Cache): Basis für den Hinweis auf einen Vortags-Nachtdienst, der
  // in den gewählten Abwesenheitstag hineinragt.
  const { data: monthShifts } = useListShifts({
    month,
    year,
    ...(teamId != null ? { teamId } : {}),
  });
  // Aushilfe-Einsatz: nur für Dienstleister mit mehreren Teams relevant —
  // wählbar sind alle EIGENEN Teams außer dem aktuell angezeigten (teamId).
  const { teams } = useTeam();
  const { currentUser } = useAuth();
  const isAdminUser = isAdminRole(currentUser?.role);
  const einsatzTeams = teams.filter((t) => t.id !== teamId);

  const allModels = models ?? [];
  const activeModels = allModels.filter((m) => m.isActive);
  const firstModel = activeModels[0];
  const firstModelId = firstModel?.id;

  const [assistantOpen, setAssistantOpen] = useState(false);
  // Eigener Kalender-Picker (zentriertes Overlay statt nativem Date-Input),
  // damit iOS/Safari beim Öffnen des Dialogs keinen eigenen Kalender aufpoppt
  // und die Position vorhersehbar bleibt.
  const [dateOpen, setDateOpen] = useState(false);
  // Optionales Bis-Datum für Abwesenheiten (Task #715): leer = ein einzelner
  // Tag wie bisher; gesetzt = der ganze Zeitraum wird als Sammelauftrag in
  // EINEM Request angelegt (transaktional, Urlaubskonto einmal am Ende).
  const [absenceEndDate, setAbsenceEndDate] = useState("");
  const [endDateOpen, setEndDateOpen] = useState(false);

  function modelFromSelection(sel: string) {
    if (!sel.startsWith("model:")) return undefined;
    const id = Number(sel.slice("model:".length));
    return allModels.find((m) => m.id === id);
  }

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
      startTime: editShift
        ? toTimeString(editShift.startTime)
        : firstModel?.defaultStartTime || "08:00",
      endTime: editShift
        ? toTimeString(editShift.endTime)
        : firstModel?.defaultEndTime || "16:00",
      selection: initialSelection(editShift, firstModelId),
      // Beim Bearbeiten den gespeicherten Status übernehmen; neue Schichten
      // starten bewusst als Entwurf (Beginn des Planungs-Workflows).
      planningStatus: isPlanningStatus(editShift?.planningStatus)
        ? editShift!.planningStatus
        : editShift
          ? "FIX"
          : "VORLAEUFIG",
      notes: editShift?.notes ?? "",
      einsatzTeamId: editShift?.einsatzTeamId != null ? String(editShift.einsatzTeamId) : "",
      isVertretung: editShift?.isVertretung === true,
      pauseMinutes:
        editShift?.pauseMinutes != null && editShift.pauseMinutes > 0
          ? String(editShift.pauseMinutes)
          : "",
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
  // Pausen-Vorbefüllung: sobald der Nutzer das Pausenfeld selbst angefasst hat,
  // wird es von der automatischen Regel nicht mehr überschrieben.
  const [pauseTouched, setPauseTouched] = useState(false);

  // Formular nur beim Öffnen / beim Wechsel des Bearbeitungsziels zurücksetzen,
  // nicht wenn die Schichtmodelle asynchron nachladen (sonst gehen Eingaben verloren).
  useEffect(() => {
    if (open) {
      setErrors({});
      setConfirmDelete(false);
      setOverlapConflicts(null);
      setBulkCreated(new Set());
      setBulkConflicts(null);
      setDateOpen(false);
      setAbsenceEndDate("");
      setEndDateOpen(false);
      setPauseTouched(false);
      setForm(buildInitialForm());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editShift?.id, preselectedUserId, preselectedDate, bulkDates]);

  // Sobald die Modelle geladen sind, im Anlegen-Modus eine Standardauswahl setzen,
  // falls der Nutzer noch nichts gewählt hat.
  useEffect(() => {
    if (open && !isEditing && firstModel) {
      setForm((f) =>
        f.selection === ""
          ? {
              ...f,
              selection: `model:${firstModel.id}`,
              startTime: firstModel.defaultStartTime || f.startTime,
              endTime: firstModel.defaultEndTime || f.endTime,
            }
          : f,
      );
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

  // Wechselt Typ/Modell. Beim Wählen eines Schichtmodells werden dessen
  // Standard-Start-/Endzeit vorbelegt (überschreibbar).
  function handleSelectionChange(value: string) {
    setErrors((e) => ({ ...e, selection: undefined, startTime: undefined, endTime: undefined }));
    setOverlapConflicts(null);
    setBulkConflicts(null);
    const m = modelFromSelection(value);
    setForm((f) => ({
      ...f,
      selection: value,
      ...(m && m.defaultStartTime && m.defaultEndTime
        ? { startTime: m.defaultStartTime, endTime: m.defaultEndTime }
        : {}),
    }));
  }

  const isAbsence =
    form.selection === "vacation" ||
    form.selection === "sick" ||
    form.selection === "freizeitausgleich" ||
    form.selection === "kind_krank" ||
    form.selection === "freistellung" ||
    form.selection === "abgesagt_ag" ||
    form.selection === "abgesagt_an" ||
    form.selection === "urlaubsabgeltung";
  // Team-Eintrag (Teamsitzung): ganztägig, immer FIX (Server erzwingt beides),
  // keine Zeit-/Status-Felder.
  const isTeam = form.selection === "team";
  const is24h = form.selection === "legacy:full_day";

  // Automatische Pausen-Vorbefüllung (Pausenregelung in den Einstellungen):
  // NUR beim Anlegen neuer Dienste und nur, solange der Nutzer das Pausenfeld
  // nicht selbst angefasst hat. Bearbeitete/bestehende Dienste bleiben
  // unverändert (keine rückwirkende Neuberechnung).
  const pauseAutoEnabled = allowanceSettings?.pauseAutoEnabled === true;
  useEffect(() => {
    if (!open || isEditing || pauseTouched || !pauseAutoEnabled) return;
    if (isAbsence || isTeam) return;
    if (!TIME_RE.test(form.startTime) || !TIME_RE.test(form.endTime)) return;
    const [sh, sm] = form.startTime.split(":").map(Number);
    const [eh, em] = form.endTime.split(":").map(Number);
    let duration = eh * 60 + em - (sh * 60 + sm);
    // Endzeit <= Startzeit = Tagesübergang; 24h-Dienst = feste 24 Stunden.
    if (duration <= 0) duration += 24 * 60;
    if (is24h) duration = 24 * 60;
    const minutes = computeAutoPauseMinutes(duration, allowanceSettings ?? {});
    const next = minutes > 0 ? String(minutes) : "";
    setForm((f) => (f.pauseMinutes === next ? f : { ...f, pauseMinutes: next }));
  }, [
    open,
    isEditing,
    pauseTouched,
    pauseAutoEnabled,
    isAbsence,
    isTeam,
    is24h,
    form.startTime,
    form.endTime,
    allowanceSettings,
  ]);

  // Auswahl-Anzeige des Assistenten-Pickers (nur Mitglieder des aktuellen Teams).
  const selectedAssistant = assistants.find((a) => String(a.id) === form.userId);

  const renderAssistantItem = (a: Assistant) => (
    <CommandItem
      key={a.id}
      value={a.name}
      onSelect={() => {
        set("userId", String(a.id));
        setAssistantOpen(false);
      }}
    >
      <Check
        className={cn(
          "mr-2 h-4 w-4",
          String(a.id) === form.userId ? "opacity-100" : "opacity-0",
        )}
      />
      {a.name}
    </CommandItem>
  );

  // Abgleich der Standard-Wochentage des gewählten Modells mit dem gewählten
  // Datum bzw. den ausgewählten Tagen (Mehrfach-Modus). Reine Hinweis-Logik —
  // das Anlegen an einem "unpassenden" Tag bleibt bewusst erlaubt.
  const selectedModel = modelFromSelection(form.selection);
  const relevantDates = isBulk ? bulkDates ?? [] : form.date ? [form.date] : [];
  const modelWeekdays = selectedModel?.defaultWeekdays ?? [];
  const weekdayMismatchDates =
    selectedModel && modelWeekdays.length > 0
      ? relevantDates.filter((d) => !modelWeekdays.includes(isoWeekday(d)))
      : [];

  // Hinweis auf hineinragende Vortags-Dienste beim Anlegen von Abwesenheiten:
  // Die Abwesenheits-Ersetzung matcht bewusst nur Dienste, die AM Abwesenheitstag
  // beginnen. Ein Dienst des Vortags, der über Mitternacht in den gewählten Tag
  // hineinragt (z. B. Nachtdienst 20:00–06:00), bleibt bestehen. Reiner Hinweis —
  // kein Blocker.
  const overhangShifts =
    isAbsence && form.userId
      ? (monthShifts ?? []).filter((s) => {
          if (s.userId !== Number(form.userId)) return false;
          if (editShift && s.id === editShift.id) return false;
          // Nur reguläre Dienste (keine Abwesenheiten/Team-Einträge).
          if (
            s.type === "vacation" ||
            s.type === "sick" ||
            s.type === "freizeitausgleich" ||
            s.type === "team"
          )
            return false;
          const startDay = toDateString(s.startTime);
          return relevantDates.some(
            (d) =>
              startDay === prevDayString(d) &&
              new Date(s.endTime).getTime() > new Date(`${d}T00:00:00`).getTime(),
          );
        })
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
    ? assistants.find((a) => a.id === editShift?.userId)?.name ?? `Assistenzkraft #${editShift?.userId}`
    : undefined;

  function validate(): boolean {
    const errs: Partial<Record<keyof FormState, string>> = {};
    if (!form.userId) errs.userId = "Assistenzkraft auswählen";
    if (!form.date) errs.date = "Datum angeben";
    if (!isAbsence && !isTeam) {
      if (!form.startTime) errs.startTime = "Startzeit angeben";
      if (!form.endTime) errs.endTime = "Endzeit angeben";
      // Identische Start-/Endzeit ist erlaubt und bedeutet ein 24h-Dienst
      // (Ende am Folgetag); eine kleinere Endzeit bedeutet "endet am Folgetag"
      // (Nachtdienst über Mitternacht). Beides wird in handleSave aufgelöst.
    }
    if (form.notes.length > 500) {
      errs.notes = `Notiz darf maximal 500 Zeichen lang sein (aktuell ${form.notes.length}).`;
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
    if (isAbsence || isTeam) {
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
    // Bis-Datum nur für Abwesenheiten im Einzel-Anlege-Modus relevant.
    const absenceRangeEnd =
      !isEditing && !isBulk && isAbsence && absenceEndDate && absenceEndDate !== form.date
        ? absenceEndDate
        : null;
    if (absenceRangeEnd && absenceRangeEnd < form.date) {
      setErrors({ date: "Das Bis-Datum darf nicht vor dem Datum liegen." });
      return;
    }
    setSaving(true);
    try {
      const { startIso, endIso } = buildTimes(form.date);
      const { type, shiftModelId } = deriveTypeAndModel();

      // Zeitraum-Anlage (Task #715): alle Tage von Datum bis Bis-Datum in
      // EINEM Sammelauftrag; Tage mit bestehender Abwesenheit desselben Typs
      // überspringt der Server.
      if (absenceRangeEnd) {
        const rangeDays = eachDayOfInterval({
          start: new Date(`${form.date}T00:00:00`),
          end: new Date(`${absenceRangeEnd}T00:00:00`),
        });
        const result = await bulkCreateAbsence.mutateAsync({
          data: {
            userId: Number(form.userId),
            type: type as BulkAbsenceInput["type"],
            days: rangeDays.map((d) => {
              const key = format(d, "yyyy-MM-dd");
              return {
                startTime: new Date(`${key}T00:00:00`).toISOString(),
                endTime: new Date(`${key}T23:59:59`).toISOString(),
              };
            }),
            shiftModelId,
            notes: form.notes || undefined,
            ...(teamId != null ? { teamId } : {}),
          },
        });
        if (result.createdCount === 0) {
          setErrors({
            notes: "Für den gewählten Zeitraum bestehen bereits Abwesenheiten dieses Typs.",
          });
          return;
        }
        await invalidate();
        // Soft-Close-Hinweis nur für tatsächlich angelegte Tage.
        const skippedKeys = new Set(result.skippedDates);
        for (const d of rangeDays) {
          if (!skippedKeys.has(format(d, "yyyy-MM-dd"))) {
            void warnIfMonthClosed(d, teamId ?? null);
          }
        }
        onClose();
        return;
      }

      if (isEditing && editShift) {
        const data = {
          startTime: startIso,
          endTime: endIso,
          type,
          planningStatus: isAbsence ? "FIX" : form.planningStatus,
          shiftModelId,
          notes: form.notes || null,
          einsatzTeamId:
            !isAbsence && !isTeam && form.einsatzTeamId
              ? Number(form.einsatzTeamId)
              : null,
          isVertretung: !isAbsence && !isTeam ? form.isVertretung : false,
          pauseMinutes:
            !isAbsence && !isTeam ? Math.max(0, Number(form.pauseMinutes) || 0) : 0,
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
          planningStatus: isAbsence ? "FIX" : form.planningStatus,
          shiftModelId,
          notes: form.notes || undefined,
          ...(!isAbsence && !isTeam && form.einsatzTeamId
            ? { einsatzTeamId: Number(form.einsatzTeamId) }
            : {}),
          ...(!isAbsence && !isTeam
            ? {
                isVertretung: form.isVertretung,
                pauseMinutes: Math.max(0, Number(form.pauseMinutes) || 0),
              }
            : {}),
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
      // Soft-Close-Hinweis: Änderung in bereits abgeschlossenem Monat.
      void warnIfMonthClosed(new Date(form.date), teamId ?? null);
      onClose();
    } catch (err) {
      const planMsg = planUpgradeMessage(err);
      if (err instanceof ApiError && err.status === 401) {
        setErrors({ notes: "Sitzung abgelaufen. Bitte Seite neu laden und erneut anmelden." });
      } else if (planMsg) {
        setErrors({ notes: planMsg });
      } else if (err instanceof ApiError && err.status === 403) {
        // Konkrete Server-Meldung durchreichen (z. B. "Schichtmodell gehört
        // nicht zu diesem Team") statt eines generischen Berechtigungs-Texts.
        setErrors({ notes: readableApiError(err, "Keine Berechtigung zum Speichern.") });
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
      let forbiddenMessage: string | null = null;
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
          planningStatus: isAbsence ? "FIX" : form.planningStatus,
          shiftModelId,
          notes: form.notes || undefined,
          ...(!isAbsence && !isTeam && form.einsatzTeamId
            ? { einsatzTeamId: Number(form.einsatzTeamId) }
            : {}),
          ...(!isAbsence && !isTeam
            ? {
                isVertretung: form.isVertretung,
                pauseMinutes: Math.max(0, Number(form.pauseMinutes) || 0),
              }
            : {}),
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
          } else if (err instanceof ApiError && err.status === 403) {
            // Konkrete Server-Meldung (z. B. team-fremdes Schichtmodell)
            // durchreichen — betrifft alle Tage gleichermaßen, daher Abbruch.
            forbiddenMessage = readableApiError(err, "Keine Berechtigung zum Speichern.");
            break;
          } else if (err instanceof ApiError && err.status === 400) {
            // Konkrete Server-Meldung (z. B. Urlaub außerhalb des Vertrags-
            // zeitraums) durchreichen — betrifft alle Tage, daher Abbruch.
            forbiddenMessage = readableApiError(err, "Speichern fehlgeschlagen. Bitte erneut versuchen.");
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
      if (forbiddenMessage) {
        setErrors({ notes: forbiddenMessage });
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

      // Alles angelegt. Soft-Close-Hinweis für den ersten betroffenen Tag
      // (der Toast erscheint pro Monat ohnehin nur einmal).
      for (const dateStr of bulkDates) {
        void warnIfMonthClosed(new Date(dateStr), teamId ?? null);
      }
      onSaved?.();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  // Ein-Klick-Bestätigung: setzt einen Entwurf/Vorschlag direkt auf FIX
  // (verbindlich), ohne die übrigen Formularfelder anzufassen. Sendet bewusst
  // NUR planningStatus (+ force, da sich Zeiten/Zuordnung nicht ändern und eine
  // ggf. bewusst angelegte Überschneidung die Bestätigung nicht blockieren soll).
  const showQuickConfirm =
    isEditing &&
    !isAbsence &&
    (editShift?.planningStatus === "VORLAEUFIG" || editShift?.planningStatus === "ANGEBOTEN");

  async function handleQuickConfirm() {
    if (!editShift) return;
    setSaving(true);
    try {
      await updateShift.mutateAsync({
        id: editShift.id,
        data: { planningStatus: "FIX", force: true } as { planningStatus: "FIX" },
      });
      await invalidate();
      void warnIfMonthClosed(new Date(editShift.startTime), teamId ?? null);
      onClose();
    } catch (err) {
      setErrors({
        notes: readableApiError(err, "Bestätigen fehlgeschlagen. Bitte erneut versuchen."),
      });
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
      void warnIfMonthClosed(new Date(editShift.startTime), teamId ?? null);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="sm:max-w-md"
        data-testid="shift-dialog"
        // Kein Auto-Fokus beim Öffnen: sonst fokussiert iOS/Safari das erste
        // Feld und poppt ggf. sofort einen Picker auf.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
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
          {/* Ein-Klick-Bestätigung für Entwürfe/Vorschläge: prominent oben,
              damit der häufigste Planungs-Schritt (→ verbindlich) keinen
              manuellen Status-Wechsel im Formular braucht. */}
          {showQuickConfirm && (
            <div
              className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2.5"
              data-testid="shift-dialog-quick-confirm"
            >
              <p className="flex-1 min-w-[12rem] text-sm">
                {editShift?.planningStatus === "VORLAEUFIG"
                  ? "Dieser Dienst ist ein Entwurf und zählt noch nicht in Auswertungen."
                  : "Dieser Dienst ist ein Vorschlag und zählt noch nicht in Auswertungen."}
              </p>
              <Button
                size="sm"
                className="gap-1.5"
                onClick={handleQuickConfirm}
                disabled={saving}
                data-testid="shift-dialog-confirm-fix"
              >
                <Check className="h-3.5 w-3.5" />
                Bestätigen
              </Button>
            </div>
          )}

          {/* Assistent */}
          <div className="space-y-1.5">
            <Label>Assistenzkraft *</Label>
            {isEditing ? (
              <Input
                data-testid="shift-dialog-user"
                value={editAssistantName ?? ""}
                disabled
                readOnly
              />
            ) : (
              <Popover open={assistantOpen} onOpenChange={setAssistantOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={assistantOpen}
                    data-testid="shift-dialog-user"
                    className={cn(
                      "w-full justify-between font-normal",
                      !selectedAssistant && "text-muted-foreground",
                      errors.userId && "border-destructive",
                    )}
                  >
                    {selectedAssistant ? selectedAssistant.name : "Assistenzkraft auswählen..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Name suchen..." />
                    <CommandList>
                      <CommandEmpty>Keine Assistenzkräfte gefunden.</CommandEmpty>
                      <CommandGroup>
                        {assistants.map(renderAssistantItem)}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
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
              <Button
                type="button"
                variant="outline"
                data-testid="shift-dialog-date"
                data-value={form.date}
                onClick={() => setDateOpen(true)}
                className={cn(
                  "w-full justify-start font-normal",
                  !form.date && "text-muted-foreground",
                  errors.date && "border-destructive",
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                {form.date
                  ? format(new Date(`${form.date}T00:00:00`), "dd.MM.yyyy")
                  : "Datum wählen..."}
              </Button>
              {/* Zentriertes Kalender-Overlay statt ankerbasiertem Popover:
                  auf iPad/Mobil bleibt die Position damit immer vorhersehbar
                  (mittig über der Dialog-Karte). */}
              <Dialog open={dateOpen} onOpenChange={setDateOpen}>
                <DialogContent
                  className="w-auto max-w-[calc(100vw-2rem)] p-4"
                  data-testid="shift-dialog-date-picker"
                  onOpenAutoFocus={(e) => e.preventDefault()}
                >
                  <DialogHeader>
                    <DialogTitle className="text-base">Datum wählen</DialogTitle>
                  </DialogHeader>
                  <Calendar
                    mode="single"
                    locale={de}
                    showOutsideDays={false}
                    captionLayout="dropdown"
                    startMonth={new Date(new Date().getFullYear() - 3, 0)}
                    endMonth={new Date(new Date().getFullYear() + 3, 11)}
                    selected={form.date ? new Date(`${form.date}T00:00:00`) : undefined}
                    defaultMonth={
                      form.date
                        ? new Date(`${form.date}T00:00:00`)
                        : new Date(year, month - 1, 1)
                    }
                    onSelect={(d) => {
                      if (!d) return;
                      set("date", format(d, "yyyy-MM-dd"));
                      setDateOpen(false);
                    }}
                    className="mx-auto"
                  />
                </DialogContent>
              </Dialog>
              {errors.date && <p className="text-xs text-destructive">{errors.date}</p>}
            </div>
          )}

          {/* Optionales Bis-Datum (nur Abwesenheiten, Einzel-Anlege-Modus):
              leer = ein Tag wie bisher; gesetzt = der ganze Zeitraum wird als
              Sammelauftrag angelegt (Task #715). */}
          {!isEditing && !isBulk && isAbsence && (
            <div className="space-y-1.5">
              <Label>Bis (optional)</Label>
              <div className="flex gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  data-testid="shift-dialog-end-date"
                  data-value={absenceEndDate}
                  onClick={() => setEndDateOpen(true)}
                  className={cn(
                    "w-full justify-start font-normal",
                    !absenceEndDate && "text-muted-foreground",
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                  {absenceEndDate
                    ? format(new Date(`${absenceEndDate}T00:00:00`), "dd.MM.yyyy")
                    : "Nur dieser Tag"}
                </Button>
                {absenceEndDate && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    aria-label="Bis-Datum entfernen"
                    data-testid="shift-dialog-end-date-clear"
                    onClick={() => setAbsenceEndDate("")}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Mit Bis-Datum wird die Abwesenheit für den ganzen Zeitraum in einem
                Schritt eingetragen.
              </p>
              <Dialog open={endDateOpen} onOpenChange={setEndDateOpen}>
                <DialogContent
                  className="w-auto max-w-[calc(100vw-2rem)] p-4"
                  data-testid="shift-dialog-end-date-picker"
                  onOpenAutoFocus={(e) => e.preventDefault()}
                >
                  <DialogHeader>
                    <DialogTitle className="text-base">Bis-Datum wählen</DialogTitle>
                  </DialogHeader>
                  <Calendar
                    mode="single"
                    locale={de}
                    showOutsideDays={false}
                    captionLayout="dropdown"
                    startMonth={new Date(new Date().getFullYear() - 3, 0)}
                    endMonth={new Date(new Date().getFullYear() + 3, 11)}
                    disabled={
                      form.date ? { before: new Date(`${form.date}T00:00:00`) } : undefined
                    }
                    selected={
                      absenceEndDate ? new Date(`${absenceEndDate}T00:00:00`) : undefined
                    }
                    defaultMonth={
                      absenceEndDate
                        ? new Date(`${absenceEndDate}T00:00:00`)
                        : form.date
                          ? new Date(`${form.date}T00:00:00`)
                          : new Date(year, month - 1, 1)
                    }
                    onSelect={(d) => {
                      if (!d) return;
                      setAbsenceEndDate(format(d, "yyyy-MM-dd"));
                      setEndDateOpen(false);
                    }}
                    className="mx-auto"
                  />
                </DialogContent>
              </Dialog>
            </div>
          )}

          {/* Schicht-Typ / Modell */}
          <div className="space-y-1.5">
            <Label>Typ *</Label>
            <Select value={form.selection} onValueChange={handleSelectionChange}>
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
                {(teamMeetingEnabled || isTeam) && (
                  <SelectGroup>
                    <SelectLabel>Team</SelectLabel>
                    <SelectItem value="team">
                      <span className="flex items-center gap-2">
                        <span className="inline-block h-2.5 w-2.5 rounded-full bg-sky-500" />
                        Team (Teamsitzung)
                      </span>
                    </SelectItem>
                  </SelectGroup>
                )}
                {(teamMeetingEnabled || isTeam) && <SelectSeparator />}
                <SelectGroup>
                  <SelectLabel>Abwesenheit</SelectLabel>
                  <SelectItem value="vacation">
                    <span className="flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500" />
                      Urlaub
                    </span>
                  </SelectItem>
                  <SelectItem value="sick">
                    <span className="flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-full bg-slate-500" />
                      Krank
                    </span>
                  </SelectItem>
                  <SelectItem value="freizeitausgleich">
                    <span className="flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-600" />
                      Freizeitausgleich (Ersatzruhetag)
                    </span>
                  </SelectItem>
                  <SelectItem value="kind_krank">
                    <span className="flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-full bg-zinc-500" />
                      Kind krank (unbezahlt)
                    </span>
                  </SelectItem>
                  <SelectItem value="freistellung">
                    <span className="flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-full bg-teal-600" />
                      Freistellung (bezahlt)
                    </span>
                  </SelectItem>
                  <SelectItem value="abgesagt_ag">
                    <span className="flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-full bg-orange-600" />
                      Abgesagt durch Arbeitgeber (bezahlt)
                    </span>
                  </SelectItem>
                  <SelectItem value="abgesagt_an">
                    <span className="flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-full bg-stone-500" />
                      Abgesagt durch Assistenz (unbezahlt)
                    </span>
                  </SelectItem>
                  <SelectItem value="urlaubsabgeltung">
                    <span className="flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-full bg-lime-600" />
                      Urlaubsabgeltung (ausgezahlt)
                    </span>
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            {activeModels.length === 0 && !isAbsence && !legacyEditOption && !is24h && (
              <p className="text-xs text-muted-foreground">
                In diesem Team sind noch keine Dienste angelegt. Lege sie unter
                Einstellungen („+ Neuen Dienst") an.
              </p>
            )}
          </div>

          {/* Planungsstatus (nur für reguläre Dienste; Abwesenheiten und
              Team-Einträge sind kein Planungs-Entwurf, sondern sofort
              verbindlich — der Server erzwingt bei Team-Einträgen FIX). */}
          {!isAbsence && !isTeam && (
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

          {/* Aushilfe-Einsatz: nur für Dienstleister mit mehreren Teams. Die
              Schicht bleibt im aktuellen Team (Stunden zählen hier); das
              gewählte Team sieht sie als schreibgeschützten Aushilfe-Eintrag. */}
          {!isAbsence && !isTeam && teamId != null && einsatzTeams.length > 0 && (
            <div className="space-y-1.5">
              <Label>Aushilfe-Einsatz für Team</Label>
              <Select
                value={form.einsatzTeamId || "none"}
                onValueChange={(v) => set("einsatzTeamId", v === "none" ? "" : v)}
              >
                <SelectTrigger data-testid="shift-dialog-einsatz-team">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Kein Aushilfe-Einsatz</SelectItem>
                  {einsatzTeams.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.einsatzTeamId && (
                <p className="text-xs text-muted-foreground">
                  Die Stunden zählen weiterhin in diesem Team; das gewählte Team
                  sieht den Dienst als Aushilfe-Eintrag im Kalender.
                </p>
              )}
            </div>
          )}

          {/* Vertretung + unbezahlte Pause: reine Info-Kennzahlen der
              Lohnauswertung, nur für Arbeitsdienste (Server setzt sie bei
              Abwesenheiten/Team-Einträgen zurück). */}
          {!isAbsence && !isTeam && (
            <div className="grid grid-cols-2 items-end gap-3">
              <label
                className="flex h-9 cursor-pointer items-center gap-2 text-sm"
                data-testid="shift-dialog-vertretung"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={form.isVertretung}
                  onChange={(e) => set("isVertretung", e.target.checked)}
                />
                Vertretung
              </label>
              <div className="space-y-1.5">
                <Label>Unbezahlte Pause (Min.)</Label>
                <Input
                  type="number"
                  min={0}
                  max={1440}
                  step={5}
                  placeholder="0"
                  data-testid="shift-dialog-pause"
                  value={form.pauseMinutes}
                  onChange={(e) => {
                    setPauseTouched(true);
                    set("pauseMinutes", e.target.value);
                  }}
                />
              </div>
            </div>
          )}

          {/* Hinweis: gewähltes Datum passt nicht zu den Standard-Wochentagen
              des Modells. Reine Warnung — das Anlegen bleibt erlaubt. */}
          {!isAbsence && selectedModel && weekdayMismatchDates.length > 0 && (
            <p
              className="text-xs text-amber-700 dark:text-amber-500"
              data-testid="shift-dialog-weekday-mismatch"
            >
              {isBulk
                ? `„${selectedModel.name}" ist üblich ${weekdaysLabel(
                    modelWeekdays,
                  )} — ${weekdayMismatchDates.length} ${
                    weekdayMismatchDates.length === 1
                      ? "ausgewählter Tag passt"
                      : "der ausgewählten Tage passen"
                  } nicht dazu (${[...weekdayMismatchDates]
                    .sort()
                    .map((d) => format(new Date(`${d}T00:00:00`), "d. MMM"))
                    .join(", ")}).`
                : `„${selectedModel.name}" ist üblich ${weekdaysLabel(
                    modelWeekdays,
                  )} — das gewählte Datum ist ein ${WEEKDAY_SHORT[isoWeekday(form.date) - 1]}.`}
            </p>
          )}

          {/* Zeiten (nur für reguläre Schichten) */}
          {!isAbsence && !isTeam && (
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

          {isTeam && (
            <p className="text-xs text-muted-foreground rounded-md bg-muted/50 px-3 py-2">
              Teamsitzung: ein Eintrag pro Team und Tag. Alle Assistenzkräfte des Teams
              erhalten die in den Einstellungen festgelegte Stunden-Gutschrift als
              Arbeitszeit. Der Eintrag ist sofort verbindlich (FIX).
            </p>
          )}

          {isAbsence && (
            <p className="text-xs text-muted-foreground rounded-md bg-muted/50 px-3 py-2">
              {form.selection === "vacation"
                ? "Urlaubstag wird als ganzer Tag eingetragen und vom Urlaubskontigent abgezogen."
                : form.selection === "freizeitausgleich"
                  ? "Ersatzruhetag für geleistete Feiertagsarbeit. Wird als bezahlter ganzer Tag eingetragen und vom Ersatzruhetag-Konto abgezogen — der Urlaubsanspruch bleibt unberührt."
                  : form.selection === "kind_krank"
                    ? "Kind-krank-Tag wird als ganzer Tag eingetragen. Unbezahlt (Krankengeld über die Krankenkasse) — zählt in der Auswertung nur als Info-Kennzahl."
                    : form.selection === "freistellung"
                      ? "Bezahlte Freistellung wird als ganzer Tag eingetragen. Vertragsstunden werden als Lohnfortzahlung gutgeschrieben."
                      : form.selection === "abgesagt_ag"
                        ? "Vom Arbeitgeber abgesagter Dienst. Die Stunden werden nach dem Lohnausfallprinzip bezahlt und in der Auswertung gutgeschrieben."
                        : form.selection === "abgesagt_an"
                          ? "Von der Assistenzkraft abgesagter Dienst. Unbezahlt — die Stunden erscheinen in der Auswertung nur als Info-Kennzahl."
                          : form.selection === "urlaubsabgeltung"
                            ? "Urlaubsabgeltung: nicht genommener Urlaub wird ausgezahlt. Der Euro-Wert erscheint in der Auswertung als eigene Position (kein Arbeits-Soll)."
                            : "Krankheitstag wird als ganzer Tag eingetragen. Vertragsstunden werden als Lohnfortzahlung gutgeschrieben."}
            </p>
          )}

          {/* Hinweis: Ein Dienst des Vortags ragt in den gewählten Abwesenheits-
              tag hinein (z. B. Nachtdienst 20:00–06:00). Er gehört zum Vortag
              und bleibt bewusst bestehen — reiner Hinweis, kein Blocker. */}
          {isAbsence && overhangShifts.length > 0 && (
            <p
              className="text-xs text-amber-700 dark:text-amber-500"
              data-testid="shift-dialog-overhang-hint"
            >
              {overhangShifts.length === 1
                ? `Hinweis: Der Dienst vom Vortag (${conflictLabel(overhangShifts[0])}) ragt in den gewählten Tag hinein. Er gehört zum Vortag und bleibt bestehen.`
                : `Hinweis: ${overhangShifts.length} Dienste vom jeweiligen Vortag (${overhangShifts
                    .map((s) => conflictLabel(s))
                    .join("; ")}) ragen in die gewählten Tage hinein. Sie gehören zum Vortag und bleiben bestehen.`}
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

          {/* Notiz / Kommentar */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Notiz / Kommentar</Label>
              {isAdminUser && (
                <span className={`text-xs tabular-nums ${form.notes.length > 500 ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                  {form.notes.length}/500
                </span>
              )}
            </div>
            <Textarea
              data-testid="shift-dialog-notes"
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder={isAdminUser ? "Optional – interne Notiz zur Schicht" : ""}
              maxLength={600}
              rows={2}
              disabled={!isAdminUser}
              className={!isAdminUser ? "resize-none opacity-70" : "resize-none"}
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
