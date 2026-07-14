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
import { Check, Trash2, AlertTriangle } from "lucide-react";
import { readableApiError, planUpgradeMessage } from "@/lib/api-error";

type Assistant = { id: number; name: string };
type TeamInfo = { id: number; name: string }; // Neu für die Teamauswahl

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

type PlanningStatus = "VORLAEUFIG" | "ANGEBOTEN" | "FIX";

const PLANNING_STATUS_OPTIONS: { value: PlanningStatus; label: string; hint: string }[] = [
  { value: "VORLAEUFIG", label: "Entwurf", hint: "Interne Planung, noch nicht verbindlich." },
  { value: "ANGEBOTEN", label: "Vorschlag", hint: "Dem Assistenten angeboten, wartet auf Bestätigung." },
  { value: "FIX", label: "Bestätigt", hint: "Verbindlich bestätigter Dienst — zählt in Auswertungen." },
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
  allTeams?: TeamInfo[]; // Neu: Alle eigenen Teams des Dienstleisters
  currentTeamId?: number | null; // Neu: Aktuell im Plan ausgewähltes Team
  onTeamChange?: (teamId: number) => void; // Neu: Callback wenn ein Aushilfen-Team gewählt wird
  month: number;
  year: number;
  teamId?: number | null;
  bulkDates?: string[];
  onSaved?: () => void;
};

export function ShiftDialog({
  open,
  onClose,
  preselectedDate,
  preselectedUserId,
  editShift,
  assistants,
  allTeams = [],
  currentTeamId,
  onTeamChange,
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

  const allModels = models ?? [];
  const activeModels = allModels.filter((m) => m.isActive);
  const firstModel = activeModels[0];

  const isEditing = !!editShift;
  const isBulk = !isEditing && (bulkDates?.length ?? 0) > 0;

  const defaultDate = preselectedDate ? format(preselectedDate, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

  // Lokaler State für das ausgewählte Team (für teamübergreifende Aushilfen)
  const [selectedTeamId, setSelectedTeamId] = useState<string>(String(currentTeamId || ""));

  const [form, setForm] = useState({
    userId: editShift ? String(editShift.userId) : preselectedUserId ? String(preselectedUserId) : "",
    date: editShift ? format(new Date(editShift.startTime), "yyyy-MM-dd") : isBulk ? bulkDates![0] : defaultDate,
    startTime: editShift ? format(new Date(editShift.startTime), "HH:mm") : firstModel?.defaultStartTime || "08:00",
    endTime: editShift ? format(new Date(editShift.endTime), "HH:mm") : firstModel?.defaultEndTime || "16:00",
    selection: editShift ? (editShift.shiftModelId ? `model:${editShift.shiftModelId}` : editShift.type) : firstModel ? `model:${firstModel.id}` : "",
    planningStatus: editShift && isPlanningStatus(editShift.planningStatus) ? editShift.planningStatus : "VORLAEUFIG" as PlanningStatus,
    notes: editShift?.notes ?? "",
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [overlapConflicts, setOverlapConflicts] = useState<any[] | null>(null);

  // Trigger, wenn der Dienstleister das Team für eine Aushilfe wechselt
  const handleTeamChange = (value: string) => {
    setSelectedTeamId(value);
    setForm(f => ({ ...f, userId: "" })); // Assistenten-Auswahl zurücksetzen
    if (onTeamChange) {
      onTeamChange(Number(value));
    }
  };

  const isAbsence = ["vacation", "sick", "freizeitausgleich"].includes(form.selection);

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!form.userId) errs.userId = "Assistent auswählen";
    if (!form.date) errs.date = "Datum angeben";
    if (!isAbsence) {
      if (!form.startTime) errs.startTime = "Startzeit angeben";
      if (!form.endTime) errs.endTime = "Endzeit angeben";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSave(force = false) {
    if (!validate()) return;
    setSaving(true);
    try {
      const startIso = new Date(`${form.date}T${form.startTime}:00`).toISOString();
      const endsNextDay = form.endTime <= form.startTime;
      const endIso = isAbsence 
        ? new Date(`${form.date}T23:59:59`).toISOString()
        : endsNextDay 
          ? new Date(new Date(`${form.date}T${form.endTime}:00`).getTime() + 24 * 60 * 60 * 1000).toISOString()
          : new Date(`${form.date}T${form.endTime}:00`).toISOString();

      const shiftModelId = form.selection.startsWith("model:") ? Number(form.selection.slice("model:".length)) : null;
      const type = shiftModelId ? "work" : form.selection;

      const data = {
        userId: Number(form.userId),
        startTime: startIso,
        endTime: endIso,
        type,
        planningStatus: form.planningStatus,
        shiftModelId,
        notes: form.notes || null,
        teamId: Number(selectedTeamId) || teamId, // Nutzt das ausgewählte Aushilfen-Team
      };

      if (isEditing && editShift) {
        await updateShift.mutateAsync({ id: editShift.id, data: { ...data, force } as any });
      } else {
        await createShift.mutateAsync({ data: { ...data, force } as any });
      }

      await queryClient.invalidateQueries({ queryKey: getListShiftsQueryKey({ month, year }) });
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setOverlapConflicts((err.data as any)?.conflicts || []);
      } else {
        setErrors({ notes: readableApiError(err, "Speichern fehlgeschlagen.") });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">
            {isEditing ? "Schicht bearbeiten" : "Neue Schicht anlegen"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          
          {/* NEU: Team-Auswahl für teamübergreifende Aushilfen (Nur sichtbar wenn mehrere Teams existieren) */}
          {allTeams.length > 1 && !isEditing && (
            <div className="space-y-1.5">
              <Label htmlFor="team-select" className="font-medium text-slate-700">Team für diesen Dienst</Label>
              <Select value={selectedTeamId} onValueChange={handleTeamChange}>
                <SelectTrigger id="team-select" className="h-11 text-base">
                  <SelectValue placeholder="Team auswählen..." />
                </SelectTrigger>
                <SelectContent>
                  {allTeams.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Wähle ein anderes Team, um eine dortige Assistenzkraft als Aushilfe einzusetzen.
              </p>
            </div>
          )}

          {/* Assistenten Dropdown */}
          <div className="space-y-1.5">
            <Label htmlFor="assistant-select" className="font-medium text-slate-700">Assistent *</Label>
            <Select value={form.userId} onValueChange={(v) => setForm(f => ({ ...f, userId: v }))}>
              <SelectTrigger id="assistant-select" className={`h-11 text-base ${errors.userId ? "border-destructive" : ""}`}>
                <SelectValue placeholder="Assistent auswählen..." />
              </SelectTrigger>
              <SelectContent>
                {assistants.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.userId && <p className="text-xs text-destructive">{errors.userId}</p>}
          </div>

          {/* Schicht-Typ */}
          <div className="space-y-1.5">
            <Label htmlFor="type-select" className="font-medium text-slate-700">Typ *</Label>
            <Select value={form.selection} onValueChange={(v) => setForm(f => ({ ...f, selection: v }))}>
              <SelectTrigger id="type-select" className="h-11 text-base">
                <SelectValue placeholder="Typ auswählen..." />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Dienste</SelectLabel>
                  {activeModels.map((m) => (
                    <SelectItem key={m.id} value={`model:${m.id}`}>{m.name}</SelectItem>
                  ))}
                </SelectGroup>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>Abwesenheiten</SelectLabel>
                  <SelectItem value="vacation">Urlaub</SelectItem>
                  <SelectItem value="sick">Krank</SelectItem>
                  <SelectItem value="freizeitausgleich">Freizeitausgleich</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          {/* Zeiten */}
          {!isAbsence && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="start-time">Startzeit *</Label>
                <Input id="start-time" type="time" className="h-11 text-base" value={form.startTime} onChange={(e) => setForm(f => ({ ...f, startTime: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="end-time">Endzeit *</Label>
                <Input id="end-time" type="time" className="h-11 text-base" value={form.endTime} onChange={(e) => setForm(f => ({ ...f, endTime: e.target.value }))} />
              </div>
            </div>
          )}

          {/* Status-Auswahl */}
          {!isAbsence && (
            <div className="space-y-1.5">
              <Label htmlFor="status-select">Status</Label>
              <Select value={form.planningStatus} onValueChange={(v) => setForm(f => ({ ...f, planningStatus: v as PlanningStatus }))}>
                <SelectTrigger id="status-select" className="h-11 text-base">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLANNING_STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Kollisionswarnung */}
          {overlapConflicts && overlapConflicts.length > 0 && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive flex gap-2 items-start">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Schichtüberschneidung!</p>
                <p className="text-xs opacity-90">Die Assistenzkraft ist in diesem Zeitraum bereits verplant.</p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button variant="outline" className="h-11" onClick={onClose}>Abbrechen</Button>
          <Button className="h-11" onClick={() => handleSave(overlapConflicts !== null)}>
            {saving ? "Speichern..." : overlapConflicts ? "Trotzdem speichern" : "Speichern"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
