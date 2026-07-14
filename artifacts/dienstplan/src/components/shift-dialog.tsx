import { useState, useMemo, useEffect } from "react";
import { format } from "date-fns";
import {
  useCreateShift,
  useUpdateShift,
  useListShiftModels,
  useListUsers,
  getListShiftsQueryKey,
  ApiError,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { AlertTriangle, Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { readableApiError } from "@/lib/api-error";

type Assistant = { id: number; name: string };
type TeamInfo = { id: number; name: string };

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

const PLANNING_STATUS_OPTIONS: { value: PlanningStatus; label: string }[] = [
  { value: "VORLAEUFIG", label: "Entwurf" },
  { value: "ANGEBOTEN", label: "Vorschlag" },
  { value: "FIX", label: "Bestätigt" },
];

function isPlanningStatus(
  value: string | null | undefined,
): value is PlanningStatus {
  return value === "VORLAEUFIG" || value === "ANGEBOTEN" || value === "FIX";
}

type ShiftDialogProps = {
  open: boolean;
  onClose: () => void;
  preselectedDate?: Date;
  preselectedUserId?: number;
  editShift?: ShiftForEdit;
  assistants: Assistant[];
  allTeams?: TeamInfo[];
  currentTeamId?: number | null;
  onTeamChange?: (teamId: number) => void;
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
  const { data: models } = useListShiftModels();

  const allModels = models ?? [];
  const activeModels = allModels.filter((m) => m.isActive);
  const firstModel = activeModels[0];

  const isEditing = !!editShift;
  const isBulk = !isEditing && (bulkDates?.length ?? 0) > 0;

  const defaultDate = preselectedDate
    ? format(preselectedDate, "yyyy-MM-dd")
    : format(new Date(), "yyyy-MM-dd");

  const [selectedTeamId, setSelectedTeamId] = useState<string>(
    currentTeamId != null ? String(currentTeamId) : "",
  );
  const numericTeamId = selectedTeamId ? Number(selectedTeamId) : undefined;

  const { data: teamUsers, isLoading: teamUsersLoading } = useListUsers(
    numericTeamId != null ? { teamId: numericTeamId } : undefined,
    { query: { enabled: open && numericTeamId != null } } as any
  ) as any;

  const teamAssistants: Assistant[] = useMemo(() => {
    if (numericTeamId == null) return assistants;
    const usersList = teamUsers?.data || teamUsers || [];
    return usersList
      .filter((u: any) => u.role !== "admin")
      .map((u: any) => ({ id: u.id, name: u.name }));
  }, [numericTeamId, teamUsers, assistants]);

  const [form, setForm] = useState<any>({
    userId: editShift
      ? String(editShift.userId)
      : preselectedUserId
        ? String(preselectedUserId)
        : "",
    date: editShift
      ? format(new Date(editShift.startTime), "yyyy-MM-dd")
      : isBulk
        ? bulkDates![0]
        : defaultDate,
    startTime: editShift
      ? format(new Date(editShift.startTime), "HH:mm")
      : firstModel?.defaultStartTime || "08:00",
    endTime: editShift
      ? format(new Date(editShift.endTime), "HH:mm")
      : firstModel?.defaultEndTime || "16:00",
    selection: editShift
      ? editShift.shiftModelId
        ? `model:${editShift.shiftModelId}`
        : editShift.type
      : firstModel
        ? `model:${firstModel.id}`
        : "",
    planningStatus:
      editShift && isPlanningStatus(editShift.planningStatus)
        ? editShift.planningStatus
        : "VORLAEUFIG",
    notes: editShift?.notes ?? "",
  });

  useEffect(() => {
    if (open) {
      setForm({
        userId: editShift
          ? String(editShift.userId)
          : preselectedUserId
            ? String(preselectedUserId)
            : "",
        date: editShift
          ? format(new Date(editShift.startTime), "yyyy-MM-dd")
          : isBulk
            ? bulkDates![0]
            : defaultDate,
        startTime: editShift
          ? format(new Date(editShift.startTime), "HH:mm")
          : firstModel?.defaultStartTime || "08:00",
        endTime: editShift
          ? format(new Date(editShift.endTime), "HH:mm")
          : firstModel?.defaultEndTime || "16:00",
        selection: editShift
          ? editShift.shiftModelId
            ? `model:${editShift.shiftModelId}`
            : editShift.type
          : firstModel
            ? `model:${firstModel.id}`
            : "",
        planningStatus:
          editShift && isPlanningStatus(editShift.planningStatus)
            ? editShift.planningStatus
            : "VORLAEUFIG",
        notes: editShift?.notes ?? "",
      });
      setSelectedTeamId(currentTeamId != null ? String(currentTeamId) : "");
    }
  }, [open, editShift, preselectedUserId, preselectedDate, currentTeamId]);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [overlapConflicts, setOverlapConflicts] = useState<unknown[] | null>(
    null,
  );
  const [assistantOpen, setAssistantOpen] = useState(false);

  const handleTeamChange = (value: string) => {
    setSelectedTeamId(value);
    setForm((f: any) => ({ ...f, userId: "" }));
    setErrors((e) => ({ ...e, userId: "" }));
    onTeamChange?.(Number(value));
  };

  const selectedAssistant = teamAssistants.find(
    (a) => String(a.id) === form.userId,
  );
  const isForeignTeam =
    currentTeamId != null &&
    numericTeamId != null &&
    numericTeamId !== currentTeamId;

  const isAbsence = ["vacation", "sick", "freizeitausgleich"].includes(
    form.selection,
  );

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
    setErrors({});
    try {
      const startIso = new Date(
        `${form.date}T${form.startTime}:00`,
      ).toISOString();
      const endsNextDay = form.endTime <= form.startTime;
      const endIso = isAbsence
        ? new Date(`${form.date}T23:59:59`).toISOString()
        : endsNextDay
          ? new Date(
              new Date(`${form.date}T${form.endTime}:00`).getTime() +
                24 * 60 * 60 * 1000,
            ).toISOString()
          : new Date(`${form.date}T${form.endTime}:00`).toISOString();

      const isModel = form.selection.startsWith("model:");
      const shiftModelId = isModel
        ? Number(form.selection.slice("model:".length))
        : null;

      const type = ["vacation", "sick", "freizeitausgleich"].includes(form.selection)
        ? form.selection
        : "work";

      const data: any = {
        userId: Number(form.userId),
        startTime: startIso,
        endTime: endIso,
        type,
        planningStatus: isAbsence ? undefined : form.planningStatus,
        shiftModelId,
        notes: form.notes || undefined,
        // ÄNDERUNG: Wir priorisieren das aktuelle Plan-Team (currentTeamId)
        // damit die Schicht im korrekten Dienstplan landet!
        teamId: currentTeamId ?? teamId ?? undefined, 
      };

      console.log("Sende Schicht-Daten an API:", data);

      if (isEditing && editShift) {
        await updateShift.mutateAsync({
          id: editShift.id,
          data: { ...data, force } as any,
        });
      } else {
        await createShift.mutateAsync({
          data: { ...data, force } as any,
        });
      }

      await queryClient.invalidateQueries({
        queryKey: getListShiftsQueryKey({ month, year }),
      });
      onSaved?.();
      onClose();
    } catch (err: any) {
      console.error("Detaillierter Server-Fehler:", err);
      if (err instanceof ApiError) {
        console.error("API Status Code:", err.status);
        console.error("API Error Payload:", err.data);
      }

      if (err instanceof ApiError && err.status === 409) {
        setOverlapConflicts(
          ((err.data as { conflicts?: unknown[] } | null)?.conflicts ??
            []) as unknown[],
        );
      } else {
        const errorMsg = readableApiError(err, "Speichern fehlgeschlagen.");
        setErrors({
          submit: errorMsg,
        });
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
          {allTeams.length > 1 && !isEditing && (
            <div className="space-y-1.5">
              <Label htmlFor="team-select">Team auswählen</Label>
              <Select value={selectedTeamId} onValueChange={handleTeamChange}>
                <SelectTrigger id="team-select" className="h-11 text-base">
                  <SelectValue placeholder="Team auswählen..." />
                </SelectTrigger>
                <SelectContent>
                  {allTeams.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isForeignTeam && (
                <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    Aushilfe aus einem anderen Team — der Dienst wird im
                    aktuellen Plan angelegt.
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Assistent *</Label>
            <Popover open={assistantOpen} onOpenChange={setAssistantOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={assistantOpen}
                  className={cn(
                    "h-11 w-full justify-between text-base font-normal",
                    !selectedAssistant && "text-muted-foreground",
                    errors.userId && "border-destructive",
                  )}
                >
                  {selectedAssistant
                    ? selectedAssistant.name
                    : teamUsersLoading
                      ? "Lade Assistenten..."
                      : "Assistent auswählen..."}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="w-[--radix-popover-trigger-width] p-0"
                align="start"
              >
                <Command>
                  <CommandInput placeholder="Name suchen..." />
                  <CommandList>
                    <CommandEmpty>
                      {teamUsersLoading
                        ? "Wird geladen..."
                        : "Keine Assistenten gefunden."}
                    </CommandEmpty>
                    <CommandGroup>
                      {teamAssistants.map((a) => (
                        <CommandItem
                          key={a.id}
                          value={a.name}
                          onSelect={() => {
                            setForm((f: any) => ({ ...f, userId: String(a.id) }));
                            setErrors((e) => ({ ...e, userId: "" }));
                            setAssistantOpen(false);
                          }}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              String(a.id) === form.userId
                                ? "opacity-100"
                                : "opacity-0",
                            )}
                          />
                          {a.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            {errors.userId && (
              <p className="text-xs text-destructive">{errors.userId}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="shift-date">Datum *</Label>
            <Input
              id="shift-date"
              type="date"
              className="h-11 text-base"
              value={form.date}
              onChange={(e) => setForm((f: any) => ({ ...f, date: e.target.value }))}
            />
            {errors.date && (
              <p className="text-xs text-destructive">{errors.date}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="type-select">Typ *</Label>
            <Select
              value={form.selection}
              onValueChange={(v) => setForm((f: any) => ({ ...f, selection: v }))}
            >
              <SelectTrigger id="type-select" className="h-11 text-base">
                <SelectValue placeholder="Typ auswählen..." />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Dienste</SelectLabel>
                  {activeModels.map((m) => (
                    <SelectItem key={m.id} value={`model:${m.id}`}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>Abwesenheiten</SelectLabel>
                  <SelectItem value="vacation">Urlaub</SelectItem>
                  <SelectItem value="sick">Krank</SelectItem>
                  <SelectItem value="freizeitausgleich">
                    Freizeitausgleich
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          {!isAbsence && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="start-time">Startzeit *</Label>
                <Input
                  id="start-time"
                  type="time"
                  className="h-11 text-base"
                  value={form.startTime}
                  onChange={(e) =>
                    setForm((f: any) => ({ ...f, startTime: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="end-time">Endzeit *</Label>
                <Input
                  id="end-time"
                  type="time"
                  className="h-11 text-base"
                  value={form.endTime}
                  onChange={(e) =>
                    setForm((f: any) => ({ ...f, endTime: e.target.value }))
                  }
                />
              </div>
            </div>
          )}

          {!isAbsence && (
            <div className="space-y-1.5">
              <Label htmlFor="status-select">Status</Label>
              <Select
                value={form.planningStatus}
                onValueChange={(v) =>
                  setForm((f: any) => ({
                    ...f,
                    planningStatus: v,
                  }))
                }
              >
                <SelectTrigger id="status-select" className="h-11 text-base">
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
              {form.planningStatus === "VORLAEUFIG" && (
                <p className="text-xs text-muted-foreground mt-1">
                  Interne Planung, noch nicht verbindlich — zählt nicht in
                  Auswertungen und Stundennachweis.
                </p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="shift-notes">Hinweise (Optional)</Label>
            <Input
              id="shift-notes"
              type="text"
              placeholder="Optional"
              className="h-11 text-base"
              value={form.notes}
              onChange={(e) => setForm((f: any) => ({ ...f, notes: e.target.value }))}
            />
          </div>

          {overlapConflicts && overlapConflicts.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-semibold">Schichtüberschneidung!</p>
                <p className="text-xs opacity-90">
                  Die Assistenzkraft ist in diesem Zeitraum bereits verplant.
                </p>
              </div>
            </div>
          )}

          {/* NEU: Globale Fehlermeldung der API im Dialog anzeigen */}
          {errors.submit && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive animate-in fade-in duration-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-semibold">Speichern fehlgeschlagen</p>
                <p className="text-xs opacity-90">{errors.submit}</p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button
            variant="outline"
            className="h-11"
            onClick={onClose}
            disabled={saving}
          >
            Abbrechen
          </Button>
          <Button
            className="h-11"
            onClick={() => handleSave(overlapConflicts !== null)}
            disabled={saving}
          >
            {saving
              ? "Speichern..."
              : overlapConflicts
                ? "Trotzdem speichern"
                : "Speichern"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}