import { useMemo, useState } from "react";
import { useSearchParams } from "wouter";
import {
  useListTimeEntries,
  useListUsers,
  useListShifts,
  useConfirmTimeEntry,
  useCreateTimeEntry,
  ApiError,
  type Shift,
} from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { Check, X, CalendarClock, ArrowRight, Plus } from "lucide-react";
import { useAuth } from "@/context/auth";
import { useTeam } from "@/context/team";
import { TeamSwitcher } from "@/components/team-switcher";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { readableApiError, planFeatureMessage, PLAN_FEATURE_MESSAGES } from "@/lib/api-error";
import { hasAccess } from "@/lib/entitlements";
import { AssistantFilter, useSelectedAssistant, type Assistant } from "@/components/assistant-filter";

const SHIFT_TYPE_LABEL: Record<string, string> = {
  active: "Aktivdienst",
  standby: "Bereitschaftsdienst",
  night: "Nachtdienst",
  full_day: "24h-Dienst",
  work: "Arbeitszeit",
};

function shiftTypeLabel(type: string): string {
  return SHIFT_TYPE_LABEL[type] ?? "Dienst";
}

function isAbsenceType(type: string): boolean {
  return type === "vacation" || type === "sick";
}

// datetime-local-Wert (yyyy-MM-ddTHH:mm) aus ISO-Zeitstempel, lokale Zeitzone.
function toLocalInput(iso: string): string {
  return format(new Date(iso), "yyyy-MM-dd'T'HH:mm");
}

// Heutiges Datum als yyyy-MM-dd (lokale Zeitzone) für den manuellen Eintrag.
function todayDateStr(): string {
  return format(new Date(), "yyyy-MM-dd");
}

// Aktuelle Uhrzeit als HH:mm (lokale Zeitzone).
function nowTimeStr(): string {
  return format(new Date(), "HH:mm");
}

// Lokaler Zeitstempel aus Datum (yyyy-MM-dd) und Uhrzeit (HH:mm).
function buildLocal(date: string, time: string): Date {
  return new Date(`${date}T${time}:00`);
}

// Datum (yyyy-MM-dd) um einen Tag erhöhen, lokale Zeitzone.
function addOneDay(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return format(d, "yyyy-MM-dd");
}

export default function Zeiterfassung() {
  const { currentUser } = useAuth();
  const isAdmin = currentUser?.role === "admin";
  const isAssistant = currentUser?.role === "assistant";
  // Premium-Feature strictTimeTracking: Bestätigen/Ablehnen von Ist-Zeiten.
  // UX-Gate — die autoritative Durchsetzung liegt beim Server (403).
  // Bestandsschutz: bereits bestätigte/abgelehnte Einträge bleiben sichtbar.
  const canConfirm = hasAccess(currentUser, "strictTimeTracking");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { selectedTeamId } = useTeam();

  const [searchParams, setSearchParams] = useSearchParams();
  const statusFilter = searchParams.get("status");

  const { data: entries, isLoading: entriesLoading } = useListTimeEntries(
    selectedTeamId != null ? { teamId: selectedTeamId } : undefined,
  );
  const { data: users, isLoading: usersLoading } = useListUsers(
    selectedTeamId != null ? { teamId: selectedTeamId } : undefined,
  );
  // Eigene geplante Schichten des Assistenten (Server erzwingt die eigene userId).
  const { data: shifts, isLoading: shiftsLoading } = useListShifts(undefined, {
    query: { enabled: isAssistant },
  } as Parameters<typeof useListShifts>[1]);

  const { mutate: confirmEntry, isPending: isConfirming } = useConfirmTimeEntry();
  const createEntry = useCreateTimeEntry();

  const isLoading =
    entriesLoading || (isAdmin && usersLoading) || (isAssistant && shiftsLoading);

  // Schichten, für die bereits eine Ist-Zeit erfasst wurde (verhindert Doppelbuchung).
  const bookedShiftIds = useMemo(() => {
    const set = new Set<number>();
    for (const e of entries ?? []) {
      if (e.shiftId != null) set.add(e.shiftId);
    }
    return set;
  }, [entries]);

  // Offene geplante Schichten: reguläre Dienste ohne erfasste Ist-Zeit, neueste zuerst.
  const openShifts = useMemo(() => {
    return ((shifts ?? []) as Shift[])
      .filter((s) => !isAbsenceType(s.type) && !bookedShiftIds.has(s.id))
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
  }, [shifts, bookedShiftIds]);

  // Assistenten-Liste (nur Admin) für den seitenübergreifend gemerkten Filter.
  const assistants: Assistant[] = isAdmin
    ? (users ?? []).filter((u) => u.role === "assistant").map((u) => ({ id: u.id, name: u.name }))
    : [];
  const [selectedAssistant, setSelectedAssistant] = useSelectedAssistant(
    assistants,
    !(isAdmin && usersLoading),
  );

  // Status-Filter (z.B. vom Dashboard-Hinweis "Offene Zeiterfassungen" gesetzt)
  // plus gemerkter Assistenten-Filter (nur Admin).
  const filteredEntries = useMemo(() => {
    let list = entries ?? [];
    if (statusFilter) list = list.filter((e) => e.status === statusFilter);
    if (isAdmin && selectedAssistant !== "all") {
      list = list.filter((e) => e.userId === selectedAssistant);
    }
    return list;
  }, [entries, statusFilter, isAdmin, selectedAssistant]);

  function setStatus(status: string | null) {
    const next = new URLSearchParams(searchParams);
    if (status) next.set("status", status);
    else next.delete("status");
    setSearchParams(next, { replace: true });
  }

  const STATUS_FILTERS: { value: string | null; label: string }[] = [
    { value: null, label: "Alle" },
    { value: "pending", label: "Offen" },
    { value: "confirmed", label: "Bestätigt" },
    { value: "rejected", label: "Abgelehnt" },
  ];

  const [dialogShift, setDialogShift] = useState<Shift | null>(null);
  const [startInput, setStartInput] = useState("");
  const [endInput, setEndInput] = useState("");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Manueller Zeiteintrag ohne Schichtbezug (z.B. Nacht-Eintrag über Mitternacht).
  const [manualOpen, setManualOpen] = useState(false);
  const [manualDate, setManualDate] = useState("");
  const [manualStart, setManualStart] = useState("");
  const [manualEnd, setManualEnd] = useState("");
  const [manualEndsNextDay, setManualEndsNextDay] = useState(false);
  const [manualNotes, setManualNotes] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualSaving, setManualSaving] = useState(false);

  const getUserName = (entry: { userId: number; user?: { name: string } | null }) => {
    if (entry.user?.name) return entry.user.name;
    return users?.find((u) => u.id === entry.userId)?.name ?? "Unbekannt";
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">Offen</Badge>;
      case "confirmed":
        return <Badge className="bg-green-100 text-green-800 hover:bg-green-100 text-green-800 border-0">Bestätigt</Badge>;
      case "rejected":
        return <Badge variant="destructive">Abgelehnt</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const handleConfirm = (id: number, status: "confirmed" | "rejected") => {
    confirmEntry(
      { id, data: { status, confirmedBy: currentUser?.id ?? 0 } },
      {
        onSuccess: () => {
          toast({ title: status === "confirmed" ? "Eintrag bestätigt" : "Eintrag abgelehnt" });
          void queryClient.invalidateQueries({ queryKey: ["/api/time-tracking"] });
        },
        onError: (err) => {
          toast({
            title: "Fehler beim Aktualisieren",
            description:
              planFeatureMessage(err) ?? readableApiError(err, "Bitte erneut versuchen."),
            variant: "destructive",
          });
        },
      }
    );
  };

  // Übernehmen: Soll-Zeiten der Schicht ins Formular vorbefüllen, Assistent kann anpassen.
  function openAdopt(shift: Shift) {
    setDialogShift(shift);
    setStartInput(toLocalInput(shift.startTime));
    setEndInput(toLocalInput(shift.endTime));
    setNotes("");
    setFormError(null);
  }

  function closeDialog() {
    setDialogShift(null);
  }

  function openManual() {
    setManualDate(todayDateStr());
    setManualStart(nowTimeStr());
    setManualEnd(nowTimeStr());
    setManualEndsNextDay(false);
    setManualNotes("");
    setManualError(null);
    setManualOpen(true);
  }

  async function handleManualSave() {
    if (!currentUser) return;
    setManualError(null);
    if (!manualDate || !manualStart || !manualEnd) {
      setManualError("Bitte Datum, Start- und Endzeit angeben.");
      return;
    }
    const start = buildLocal(manualDate, manualStart);
    if (Number.isNaN(start.getTime())) {
      setManualError("Ungültige Zeitangabe.");
      return;
    }
    // Ohne Schicht gilt eine Endzeit <= Startzeit nur dann als am Folgetag,
    // wenn der Nutzer den "Endet am Folgetag"-Schalter aktiviert hat (bewusster
    // Nacht-Eintrag über Mitternacht). Sonst bleibt die strenge Validierung und
    // weist die Fehleingabe ab, statt still einen falschen Eintrag zu erzeugen.
    const endDate =
      manualEndsNextDay && manualEnd <= manualStart ? addOneDay(manualDate) : manualDate;
    const end = buildLocal(endDate, manualEnd);
    if (Number.isNaN(end.getTime())) {
      setManualError("Ungültige Zeitangabe.");
      return;
    }
    if (end <= start) {
      setManualError("Die Endzeit muss nach der Startzeit liegen.");
      return;
    }
    setManualSaving(true);
    try {
      await createEntry.mutateAsync({
        data: {
          userId: currentUser.id,
          actualStart: start.toISOString(),
          actualEnd: end.toISOString(),
          ...(manualNotes.trim() ? { notes: manualNotes.trim() } : {}),
        },
      });
      await queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey[0];
          return k === "/api/time-tracking" || k === "/api/shifts";
        },
      });
      toast({ title: "Zeit erfasst", description: "Der Eintrag wartet auf Bestätigung." });
      setManualOpen(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setManualError("Sitzung abgelaufen. Bitte Seite neu laden und erneut anmelden.");
      } else {
        setManualError(readableApiError(err, "Speichern fehlgeschlagen. Bitte erneut versuchen."));
      }
    } finally {
      setManualSaving(false);
    }
  }

  async function handleSave() {
    if (!dialogShift || !currentUser) return;
    setFormError(null);
    if (!startInput || !endInput) {
      setFormError("Bitte Start- und Endzeit angeben.");
      return;
    }
    const start = new Date(startInput);
    const end = new Date(endInput);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      setFormError("Ungültige Zeitangabe.");
      return;
    }
    if (end <= start) {
      setFormError("Die Endzeit muss nach der Startzeit liegen.");
      return;
    }
    setSaving(true);
    try {
      await createEntry.mutateAsync({
        data: {
          userId: currentUser.id,
          shiftId: dialogShift.id,
          actualStart: start.toISOString(),
          actualEnd: end.toISOString(),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        },
      });
      await queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey[0];
          return k === "/api/time-tracking" || k === "/api/shifts";
        },
      });
      toast({ title: "Zeit übernommen", description: "Der Eintrag wartet auf Bestätigung." });
      closeDialog();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setFormError("Sitzung abgelaufen. Bitte Seite neu laden und erneut anmelden.");
      } else {
        setFormError(readableApiError(err, "Speichern fehlgeschlagen. Bitte erneut versuchen."));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-3xl font-serif font-bold text-foreground">Zeiterfassung</h2>
          <p className="text-muted-foreground mt-1">
            {isAdmin ? "Geleistete Stunden prüfen und genehmigen" : "Meine geleisteten Stunden"}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isAssistant && (
            <Button className="gap-1.5 shrink-0" onClick={openManual} data-testid="manual-entry">
              <Plus className="h-4 w-4" />
              Zeit erfassen
            </Button>
          )}
          <TeamSwitcher />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5" data-testid="status-filter">
        {STATUS_FILTERS.map((f) => {
          const active = (statusFilter ?? null) === f.value;
          return (
            <button
              key={f.label}
              type="button"
              data-testid={`status-filter-${f.value ?? "all"}`}
              data-active={active ? "true" : "false"}
              onClick={() => setStatus(f.value)}
              className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                active
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-muted-foreground border-border hover:bg-muted/40"
              }`}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {isAdmin && assistants.length > 0 && (
        <AssistantFilter
          assistants={assistants}
          selected={selectedAssistant}
          onSelect={setSelectedAssistant}
        />
      )}

      {/* Offene geplante Schichten (nur Assistent) */}
      {isAssistant && (
        <Card className="border-border/50 shadow-sm">
          <div className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <CalendarClock className="h-5 w-5 text-muted-foreground" />
              <h3 className="font-semibold">Geplante Schichten übernehmen</h3>
            </div>
            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : openShifts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Keine offenen Schichten. Alle geplanten Dienste sind bereits erfasst.
              </p>
            ) : (
              <div className="space-y-2" data-testid="open-shifts">
                {openShifts.map((shift) => (
                  <div
                    key={shift.id}
                    className="flex items-center justify-between gap-3 py-2.5 px-3 rounded-lg border border-border/40 hover:bg-muted/20 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="font-medium">
                        {format(new Date(shift.startTime), "EEEE, dd.MM.yyyy", { locale: de })}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {shiftTypeLabel(shift.type)} · {format(new Date(shift.startTime), "HH:mm")} –{" "}
                        {format(new Date(shift.endTime), "HH:mm")}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 shrink-0"
                      onClick={() => openAdopt(shift)}
                      data-testid="adopt-shift"
                    >
                      Übernehmen
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      )}

      <Card className="border-border/50 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-8 space-y-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="p-4 text-left font-medium text-muted-foreground">Datum</th>
                  {isAdmin && (
                    <th className="p-4 text-left font-medium text-muted-foreground">Assistent</th>
                  )}
                  <th className="p-4 text-left font-medium text-muted-foreground">Von - Bis</th>
                  <th className="p-4 text-left font-medium text-muted-foreground">Stunden</th>
                  <th className="p-4 text-left font-medium text-muted-foreground">Status</th>
                  {isAdmin && (
                    <th className="p-4 text-right font-medium text-muted-foreground">Aktion</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map((entry) => (
                  <tr key={entry.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="p-4">
                      <div className="font-medium">
                        {format(new Date(entry.actualStart), "dd.MM.yyyy", { locale: de })}
                      </div>
                    </td>
                    {isAdmin && (
                      <td className="p-4">{getUserName(entry)}</td>
                    )}
                    <td className="p-4">
                      {format(new Date(entry.actualStart), "HH:mm")} -{" "}
                      {format(new Date(entry.actualEnd), "HH:mm")}
                    </td>
                    <td className="p-4 font-medium">{entry.actualHours} h</td>
                    <td className="p-4">{getStatusBadge(entry.status)}</td>
                    {isAdmin && (
                      <td className="p-4 text-right">
                        {entry.status === "pending" && (
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 w-8 p-0 text-green-600 hover:text-green-700 hover:bg-green-50 border-green-200"
                              disabled={isConfirming || !canConfirm}
                              title={canConfirm ? "Bestätigen" : PLAN_FEATURE_MESSAGES.strictTimeTracking}
                              onClick={() => handleConfirm(entry.id, "confirmed")}
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                              disabled={isConfirming || !canConfirm}
                              title={canConfirm ? "Ablehnen" : PLAN_FEATURE_MESSAGES.strictTimeTracking}
                              onClick={() => handleConfirm(entry.id, "rejected")}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
                {filteredEntries.length === 0 && (
                  <tr>
                    <td colSpan={isAdmin ? 6 : 4} className="p-8 text-center text-muted-foreground">
                      {statusFilter
                        ? "Keine Zeiteinträge mit diesem Status."
                        : "Keine Zeiteinträge gefunden."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Dialog open={dialogShift !== null} onOpenChange={(v) => !v && closeDialog()}>
        <DialogContent className="sm:max-w-md" data-testid="adopt-dialog">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl">Geplante Zeit übernehmen</DialogTitle>
            <DialogDescription>
              Soll-Zeiten der geplanten Schicht als Ist-Zeit erfassen.
            </DialogDescription>
          </DialogHeader>
          {dialogShift && (
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                {shiftTypeLabel(dialogShift.type)} am{" "}
                {format(new Date(dialogShift.startTime), "EEEE, dd.MM.yyyy", { locale: de })}.
                Zeiten bei Bedarf anpassen.
              </p>
              <div className="space-y-1.5">
                <Label>Von</Label>
                <Input
                  type="datetime-local"
                  value={startInput}
                  onChange={(e) => setStartInput(e.target.value)}
                  data-testid="adopt-start"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Bis</Label>
                <Input
                  type="datetime-local"
                  value={endInput}
                  onChange={(e) => setEndInput(e.target.value)}
                  data-testid="adopt-end"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Notiz (optional)</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Kurze Anmerkung..."
                  rows={3}
                />
              </div>
              {formError && <p className="text-sm text-destructive">{formError}</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={saving}>
              Abbrechen
            </Button>
            <Button onClick={handleSave} disabled={saving} data-testid="adopt-save">
              {saving ? "Speichern..." : "Ist-Zeit speichern"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={manualOpen} onOpenChange={(v) => !v && setManualOpen(false)}>
        <DialogContent className="sm:max-w-md" data-testid="manual-dialog">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl">Zeit manuell erfassen</DialogTitle>
            <DialogDescription>
              Ist-Zeit ohne geplante Schicht eintragen.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Datum</Label>
              <Input
                type="date"
                value={manualDate}
                onChange={(e) => setManualDate(e.target.value)}
                data-testid="manual-date"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Von</Label>
                <Input
                  type="time"
                  value={manualStart}
                  onChange={(e) => setManualStart(e.target.value)}
                  data-testid="manual-start"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Bis</Label>
                <Input
                  type="time"
                  value={manualEnd}
                  onChange={(e) => setManualEnd(e.target.value)}
                  data-testid="manual-end"
                />
              </div>
            </div>
            <div className="flex items-start justify-between gap-3 rounded-lg border border-border/60 p-3">
              <div className="space-y-0.5">
                <Label htmlFor="manual-ends-next-day" className="cursor-pointer">
                  Endet am Folgetag
                </Label>
                <p className="text-xs text-muted-foreground">
                  Für Nacht-Einträge über Mitternacht (z. B. 22:00–06:00)
                </p>
              </div>
              <Switch
                id="manual-ends-next-day"
                checked={manualEndsNextDay}
                onCheckedChange={setManualEndsNextDay}
                data-testid="manual-ends-next-day"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Notiz (optional)</Label>
              <Textarea
                value={manualNotes}
                onChange={(e) => setManualNotes(e.target.value)}
                placeholder="Kurze Anmerkung..."
                rows={3}
              />
            </div>
            {manualError && (
              <p className="text-sm text-destructive" data-testid="manual-error">
                {manualError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManualOpen(false)} disabled={manualSaving}>
              Abbrechen
            </Button>
            <Button onClick={handleManualSave} disabled={manualSaving} data-testid="manual-save">
              {manualSaving ? "Speichern..." : "Ist-Zeit speichern"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
