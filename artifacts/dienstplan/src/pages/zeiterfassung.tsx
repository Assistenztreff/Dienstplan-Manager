import { useMemo, useState } from "react";
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
import { Check, X, CalendarClock, ArrowRight } from "lucide-react";
import { useAuth } from "@/context/auth";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

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

export default function Zeiterfassung() {
  const { currentUser } = useAuth();
  const isAdmin = currentUser?.role === "admin";
  const isAssistant = currentUser?.role === "assistant";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: entries, isLoading: entriesLoading } = useListTimeEntries();
  const { data: users, isLoading: usersLoading } = useListUsers();
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

  const [dialogShift, setDialogShift] = useState<Shift | null>(null);
  const [startInput, setStartInput] = useState("");
  const [endInput, setEndInput] = useState("");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
        onError: () => {
          toast({ title: "Fehler beim Aktualisieren", variant: "destructive" });
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
      } else if (err instanceof ApiError && err.status === 409) {
        setFormError("Für diese Schicht wurde bereits eine Zeit erfasst.");
      } else {
        setFormError("Speichern fehlgeschlagen. Bitte erneut versuchen.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-serif font-bold text-foreground">Zeiterfassung</h2>
          <p className="text-muted-foreground mt-1">
            {isAdmin ? "Geleistete Stunden prüfen und genehmigen" : "Meine geleisteten Stunden"}
          </p>
        </div>
      </div>

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
                {entries?.map((entry) => (
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
                              disabled={isConfirming}
                              onClick={() => handleConfirm(entry.id, "confirmed")}
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                              disabled={isConfirming}
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
                {(!entries || entries.length === 0) && (
                  <tr>
                    <td colSpan={isAdmin ? 6 : 4} className="p-8 text-center text-muted-foreground">
                      Keine Zeiteinträge gefunden.
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
    </div>
  );
}
