import { useMemo, useState } from "react";
import {
  useListUsers,
  useListContracts,
  useListShifts,
  useCreateShift,
  useDeleteShift,
  ApiError,
  type ShiftInputType,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Plane, Stethoscope } from "lucide-react";
import { eachDayOfInterval, format } from "date-fns";
import { de } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import { planUpgradeMessage } from "@/lib/api-error";
import {
  buildRanges,
  dayKey,
  type AbsenceType,
  type AbsenceShift,
  type AbsenceRange,
} from "./abwesenheiten-ranges";

const TYPE_LABEL: Record<AbsenceType, string> = {
  vacation: "Urlaub",
  sick: "Krank",
};

export default function Abwesenheiten() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: users, isLoading: usersLoading } = useListUsers();
  const { data: contracts, isLoading: contractsLoading } = useListContracts();
  const { data: vacationShifts, isLoading: vacationLoading } = useListShifts({ type: "vacation" });
  const { data: sickShifts, isLoading: sickLoading } = useListShifts({ type: "sick" });

  const createShift = useCreateShift();
  const deleteShift = useDeleteShift();

  const [userId, setUserId] = useState<string>("");
  const [type, setType] = useState<AbsenceType>("vacation");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  const assistants = useMemo(
    () => (users ?? []).filter((u) => u.role === "assistant"),
    [users]
  );

  const allAbsences = useMemo<AbsenceShift[]>(
    () => [...(vacationShifts ?? []), ...(sickShifts ?? [])] as AbsenceShift[],
    [vacationShifts, sickShifts]
  );

  const ranges = useMemo(() => buildRanges(allAbsences), [allAbsences]);

  const userName = (id: number) =>
    assistants.find((u) => u.id === id)?.name ??
    (users ?? []).find((u) => u.id === id)?.name ??
    "Unbekannt";

  // Resturlaub im laufenden Jahr: Anspruch laut aktivem Vertrag minus der bereits
  // als Urlaub geplanten Tage dieses Jahres.
  const currentYear = new Date().getFullYear();
  const vacationByUser = useMemo(() => {
    const map = new Map<number, number>();
    for (const s of vacationShifts ?? []) {
      const d = new Date(s.startTime);
      if (d.getFullYear() !== currentYear) continue;
      map.set(s.userId, (map.get(s.userId) ?? 0) + 1);
    }
    return map;
  }, [vacationShifts, currentYear]);

  const activeContractFor = (uid: number) =>
    (contracts ?? [])
      .filter((c) => c.userId === uid)
      .find((c) => !c.endDate || new Date(c.endDate) > new Date());

  async function invalidate() {
    await queryClient.invalidateQueries({
      predicate: (q) => {
        const k = q.queryKey[0];
        return k === "/api/shifts" || k === "/api/contracts";
      },
    });
  }

  async function handleSave() {
    setError(null);
    if (!userId) {
      setError("Bitte einen Assistenten auswählen.");
      return;
    }
    if (!from || !to) {
      setError("Bitte Von- und Bis-Datum angeben.");
      return;
    }
    const start = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T00:00:00`);
    if (end < start) {
      setError("Das Bis-Datum darf nicht vor dem Von-Datum liegen.");
      return;
    }

    const uid = Number(userId);
    const days = eachDayOfInterval({ start, end });

    // Tage überspringen, an denen für diesen Assistenten bereits eine Abwesenheit
    // desselben Typs existiert (verhindert doppelte Urlaubsabzüge).
    const existingForUser = new Set(
      allAbsences
        .filter((a) => a.userId === uid && a.type === type)
        .map((a) => dayKey(new Date(a.startTime)))
    );

    const toCreate = days.filter((d) => !existingForUser.has(dayKey(d)));
    if (toCreate.length === 0) {
      setError("Für den gewählten Zeitraum bestehen bereits Abwesenheiten dieses Typs.");
      return;
    }

    setSaving(true);
    try {
      // Sequentiell anlegen: bei Urlaub aktualisiert der Server den genommenen
      // Urlaub pro Vertrag (Read-Modify-Write); parallele Aufrufe könnten Zähler
      // verlieren.
      for (const day of toCreate) {
        const startIso = new Date(`${dayKey(day)}T00:00:00`).toISOString();
        const endIso = new Date(`${dayKey(day)}T23:59:59`).toISOString();
        await createShift.mutateAsync({
          data: {
            userId: uid,
            startTime: startIso,
            endTime: endIso,
            type: type as ShiftInputType,
            shiftModelId: null,
          },
        });
      }
      await invalidate();
      const skipped = days.length - toCreate.length;
      toast({
        title: `${TYPE_LABEL[type]} eingetragen`,
        description:
          `${toCreate.length} ${toCreate.length === 1 ? "Tag" : "Tage"} angelegt` +
          (skipped > 0 ? `, ${skipped} bereits vorhanden` : ""),
      });
      setFrom("");
      setTo("");
    } catch (err) {
      const planMsg = planUpgradeMessage(err);
      if (err instanceof ApiError && err.status === 401) {
        setError("Sitzung abgelaufen. Bitte Seite neu laden und erneut anmelden.");
      } else if (planMsg) {
        // Free-Limit (z. B. Vorausplanung nur bis nächsten Monat): klare
        // Upgrade-Meldung statt "Keine Berechtigung".
        setError(planMsg);
      } else if (err instanceof ApiError && err.status === 403) {
        setError("Keine Berechtigung zum Eintragen von Abwesenheiten.");
      } else {
        setError("Eintragen fehlgeschlagen. Bitte erneut versuchen.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(range: AbsenceRange) {
    setDeletingKey(range.key);
    try {
      for (const id of range.shiftIds) {
        await deleteShift.mutateAsync({ id });
      }
      await invalidate();
      toast({ title: "Abwesenheit entfernt" });
    } catch {
      toast({ title: "Entfernen fehlgeschlagen", variant: "destructive" });
    } finally {
      setDeletingKey(null);
    }
  }

  const isLoading = usersLoading || contractsLoading || vacationLoading || sickLoading;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h2 className="text-2xl md:text-3xl font-serif font-bold text-foreground">Abwesenheiten</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Urlaub und Krankheit als Zeitraum erfassen und verwalten
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Erfassung */}
        <Card className="border-border/50 shadow-sm lg:col-span-1">
          <CardContent className="p-5 space-y-4">
            <h3 className="font-semibold">Abwesenheit eintragen</h3>

            <div className="space-y-1.5">
              <Label>Assistent</Label>
              <Select value={userId} onValueChange={setUserId}>
                <SelectTrigger data-testid="absence-user">
                  <SelectValue placeholder="Assistent auswählen" />
                </SelectTrigger>
                <SelectContent>
                  {assistants.map((u) => (
                    <SelectItem key={u.id} value={String(u.id)}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Art</Label>
              <Select value={type} onValueChange={(v) => setType(v as AbsenceType)}>
                <SelectTrigger data-testid="absence-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vacation">Urlaub</SelectItem>
                  <SelectItem value="sick">Krank</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Von</Label>
                <Input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  data-testid="absence-from"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Bis</Label>
                <Input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  data-testid="absence-to"
                />
              </div>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button
              onClick={handleSave}
              disabled={saving}
              className="w-full gap-2"
              data-testid="absence-save"
            >
              <Plus className="h-4 w-4" />
              {saving ? "Eintragen..." : "Eintragen"}
            </Button>
          </CardContent>
        </Card>

        {/* Resturlaub + Liste */}
        <div className="lg:col-span-2 space-y-6">
          {/* Resturlaub */}
          <Card className="border-border/50 shadow-sm">
            <CardContent className="p-5">
              <h3 className="font-semibold mb-4">Resturlaub {currentYear}</h3>
              {isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : assistants.length === 0 ? (
                <p className="text-sm text-muted-foreground">Keine Assistenten vorhanden.</p>
              ) : (
                <div className="space-y-2.5">
                  {assistants.map((u) => {
                    const contract = activeContractFor(u.id);
                    const entitlement = contract?.vacationDays ?? null;
                    const taken = vacationByUser.get(u.id) ?? 0;
                    const remaining = entitlement !== null ? entitlement - taken : null;
                    return (
                      <div
                        key={u.id}
                        className="flex items-center justify-between text-sm py-2 px-3 rounded-lg bg-muted/30 border border-border/40"
                        data-testid={`vacation-balance-row-${u.id}`}
                      >
                        <span className="font-medium">{u.name}</span>
                        {entitlement === null ? (
                          <span className="text-muted-foreground text-xs">
                            Kein Vertrag
                            {taken > 0 && (
                              <>
                                {" · "}
                                <span data-testid={`vacation-taken-${u.id}`}>{taken}</span>{" "}
                                {taken === 1 ? "Tag" : "Tage"} geplant
                              </>
                            )}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">
                            <span
                              className={
                                remaining !== null && remaining < 0
                                  ? "font-semibold text-destructive"
                                  : "font-semibold text-foreground"
                              }
                              data-testid={`vacation-remaining-${u.id}`}
                            >
                              {remaining}
                            </span>{" "}
                            von{" "}
                            <span data-testid={`vacation-entitlement-${u.id}`}>{entitlement}</span>{" "}
                            Tagen (<span data-testid={`vacation-taken-${u.id}`}>{taken}</span>{" "}
                            genommen)
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Liste */}
          <Card className="border-border/50 shadow-sm">
            <CardContent className="p-5">
              <h3 className="font-semibold mb-4">Eingetragene Abwesenheiten</h3>
              {isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : ranges.length === 0 ? (
                <p className="text-sm text-muted-foreground">Noch keine Abwesenheiten eingetragen.</p>
              ) : (
                <div className="space-y-2" data-testid="absence-list">
                  {ranges.map((range) => {
                    const sameDay = dayKey(range.startDate) === dayKey(range.endDate);
                    const dateLabel = sameDay
                      ? format(range.startDate, "dd.MM.yyyy", { locale: de })
                      : `${format(range.startDate, "dd.MM.yyyy", { locale: de })} – ${format(
                          range.endDate,
                          "dd.MM.yyyy",
                          { locale: de }
                        )}`;
                    return (
                      <div
                        key={range.key}
                        className="flex items-center justify-between gap-3 py-2.5 px-3 rounded-lg border border-border/40 hover:bg-muted/20 transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
                              range.type === "vacation"
                                ? "bg-yellow-100 text-yellow-700"
                                : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {range.type === "vacation" ? (
                              <Plane className="h-4 w-4" />
                            ) : (
                              <Stethoscope className="h-4 w-4" />
                            )}
                          </span>
                          <div className="min-w-0">
                            <div className="font-medium truncate">{userName(range.userId)}</div>
                            <div className="text-xs text-muted-foreground">{dateLabel}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge variant="secondary" className="text-xs">
                            {TYPE_LABEL[range.type]} · {range.days}{" "}
                            {range.days === 1 ? "Tag" : "Tage"}
                          </Badge>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                            disabled={deletingKey === range.key}
                            onClick={() => handleDelete(range)}
                            data-testid="absence-delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
