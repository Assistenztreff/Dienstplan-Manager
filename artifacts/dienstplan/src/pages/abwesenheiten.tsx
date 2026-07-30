import { useMemo, useState } from "react";
import {
  useListUsers,
  useListContracts,
  useListShifts,
  useListShiftModels,
  useCreateShift,
  useDeleteShift,
  useUpdateContract,
  useGetVacationBalance,
  ApiError,
  type ShiftInputType,
  type VacationBalance,
  type Contract,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { DatePickerField } from "@/components/date-picker-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Plane, Stethoscope, Info, ChevronLeft, ChevronRight } from "lucide-react";
import { eachDayOfInterval, format, startOfMonth, endOfMonth, addMonths, subMonths } from "date-fns";
import { de } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import { planUpgradeMessage, readableApiError, PLAN_FEATURE_MESSAGES } from "@/lib/api-error";
import { warnIfMonthClosed } from "@/lib/month-closing-warning";
import { useAuth } from "@/context/auth";
import { hasAccess } from "@/lib/entitlements";
import { PlanUpgradeLink } from "@/components/plan-limit-banner";
import { formatDays, formatHours } from "@/lib/utils";
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

// Datenpflege-Hinweis: Zeigt an, wenn ein Urlaubstag aktuell aus VERTRAGSDATEN
// (Wochenstunden ÷ Arbeitstage/Woche) bewertet wird, weil (noch) kein
// 13-Wochen-Schnitt vorliegt. Bestandsverträge stehen nach der Migration oft
// pauschal auf 5 Arbeitstage/Woche — in der persönlichen Assistenz sind aber
// 7-Tage-Modelle häufig. Der Wert lässt sich direkt aus dem Hinweis heraus
// korrigieren (PATCH auf den Vertrag).
function WorkdaysHint({ contract }: { contract: Contract }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateContract = useUpdateContract();
  const [value, setValue] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const { data: balance } = useGetVacationBalance(contract.id, {
    query: { retry: false },
  } as Parameters<typeof useGetVacationBalance>[1]) as {
    data?: VacationBalance;
  };

  if (!balance || balance.dailyHoursSource !== "contract") return null;

  const workdays = balance.contractWorkdaysPerWeek ?? 5;
  const weekly = balance.contractWeeklyHours;
  const selected = value || String(workdays);

  async function handleSave() {
    setSaving(true);
    try {
      await updateContract.mutateAsync({
        id: contract.id,
        data: { workdaysPerWeek: Number(selected) },
      });
      await queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey[0];
          return (
            k === "/api/contracts" ||
            k === `/api/contracts/${contract.id}/vacation-balance`
          );
        },
      });
      toast({
        title: "Arbeitstage aktualisiert",
        description: `Der Vertrag rechnet jetzt mit ${selected} Arbeitstagen pro Woche.`,
      });
      setValue("");
    } catch {
      if (!navigator.onLine) return; // Banner erklärt den Grund bereits.
      toast({ title: "Speichern fehlgeschlagen", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900"
      data-testid={`workdays-hint-${contract.id}`}
    >
      <span className="flex items-start gap-1.5">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Urlaubstage werden derzeit aus den Vertragsdaten bewertet
          {weekly != null && (
            <>
              {" "}
              ({formatHours(weekly)} Wochenstunden ÷ {workdays}{" "}
              {workdays === 1 ? "Arbeitstag" : "Arbeitstage"}/Woche ={" "}
              {balance.dailyHours != null ? formatHours(balance.dailyHours) : balance.dailyHours} h/Tag)
            </>
          )}
          , da noch kein 13-Wochen-Schnitt vorliegt. Bitte prüfen, ob die
          Arbeitstage pro Woche stimmen (Migrations-Standard: 5).
        </span>
      </span>
      <span className="flex items-center gap-2">
        <Select value={selected} onValueChange={setValue}>
          <SelectTrigger
            className="h-7 w-[72px] text-xs"
            data-testid={`workdays-select-${contract.id}`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs"
          disabled={saving || Number(selected) === workdays}
          onClick={handleSave}
          data-testid={`workdays-save-${contract.id}`}
        >
          {saving ? "Speichern..." : "Übernehmen"}
        </Button>
      </span>
    </div>
  );
}

export default function Abwesenheiten() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();

  // Premium-Gate: Das EINTRAGEN von Urlaub/Krankheit bleibt fuer alle Plaene
  // frei. Premium ist nur das TRACKING — die automatische Zaehlung im
  // Resturlaub-Konto (Anspruch/genommen/verbleibend).
  const trackingLocked = !hasAccess(currentUser, "absenceTracking");

  const { data: users, isLoading: usersLoading } = useListUsers();
  const { data: contracts, isLoading: contractsLoading } = useListContracts();
  const { data: shiftModels } = useListShiftModels();
  const { data: vacationShifts, isLoading: vacationLoading } = useListShifts({ type: "vacation" });
  const { data: sickShifts, isLoading: sickLoading } = useListShifts({ type: "sick" });

  const createShift = useCreateShift();
  const deleteShift = useDeleteShift();

  const [userId, setUserId] = useState<string>("");
  const [type, setType] = useState<AbsenceType>("vacation");
  const [shiftModelId, setShiftModelId] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  // Schneller Monatssprung: Navigiert Von/Bis-Datum auf den gesamten Monat.
  const [currentNavMonth, setCurrentNavMonth] = useState<Date>(() => startOfMonth(new Date()));

  function goToPrevMonth() {
    const newMonth = subMonths(currentNavMonth, 1);
    setCurrentNavMonth(newMonth);
    setFrom(format(startOfMonth(newMonth), "yyyy-MM-dd"));
    setTo(format(endOfMonth(newMonth), "yyyy-MM-dd"));
  }

  function goToNextMonth() {
    const newMonth = addMonths(currentNavMonth, 1);
    setCurrentNavMonth(newMonth);
    setFrom(format(startOfMonth(newMonth), "yyyy-MM-dd"));
    setTo(format(endOfMonth(newMonth), "yyyy-MM-dd"));
  }
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
            shiftModelId: shiftModelId ? Number(shiftModelId) : null,
          },
        });
      }
      await invalidate();
      // Soft-Close-Hinweis: Abwesenheit in bereits abgeschlossenem Monat.
      for (const day of toCreate) {
        void warnIfMonthClosed(day, null);
      }
      const skipped = days.length - toCreate.length;
      toast({
        title: `${TYPE_LABEL[type]} eingetragen`,
        description:
          `${toCreate.length} ${toCreate.length === 1 ? "Tag" : "Tage"} angelegt` +
          (skipped > 0 ? `, ${skipped} bereits vorhanden` : ""),
      });
      setFrom("");
      setTo("");
      setShiftModelId("");
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
      } else if (err instanceof ApiError && err.status === 400) {
        // Konkrete Server-Meldung durchreichen (z. B. "Urlaub liegt außerhalb
        // des Vertragszeitraums (Vertrag ab 15.07.2026).").
        setError(readableApiError(err, "Eintragen fehlgeschlagen. Bitte erneut versuchen."));
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
      void warnIfMonthClosed(range.startDate, null);
      void warnIfMonthClosed(range.endDate, null);
      toast({ title: "Abwesenheit entfernt" });
    } catch {
      if (!navigator.onLine) return; // Banner erklärt den Grund bereits.
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

      {/* Schneller Monatssprung: Setzt Von/Bis auf den gesamten gewählten Monat. */}
      <div
        className="flex items-center justify-between gap-2"
        data-testid="absence-month-nav"
      >
        <Button
          variant="outline"
          size="sm"
          onClick={goToPrevMonth}
          className="gap-1.5"
          data-testid="absence-prev-month"
          aria-label="Vorheriger Monat"
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Vorheriger Monat</span>
        </Button>
        <span
          className="text-base font-semibold tabular-nums"
          data-testid="absence-month-label"
        >
          {format(currentNavMonth, "MMMM yyyy", { locale: de })}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={goToNextMonth}
          className="gap-1.5"
          data-testid="absence-next-month"
          aria-label="Nächster Monat"
        >
          <span className="hidden sm:inline">Nächster Monat</span>
          <ChevronRight className="h-4 w-4" />
        </Button>
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

            <div className="space-y-1.5">
              <Label>Dienst (optional)</Label>
              <Select
                value={shiftModelId || "none"}
                onValueChange={(v) => setShiftModelId(v === "none" ? "" : v)}
              >
                <SelectTrigger data-testid="absence-shift-model">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Ganztägig (Standard)</SelectItem>
                  {(shiftModels ?? [])
                    .filter((m) => m.isActive)
                    .map((m) => (
                      <SelectItem key={m.id} value={String(m.id)}>
                        {m.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Ersetzt die Abwesenheit einen geplanten Dienst, werden dessen Zeiten
                automatisch übernommen. Ohne geplanten Dienst legt ein gewähltes
                Modell die Stunden fest (sonst ganztägig).
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Von</Label>
                <DatePickerField
                  value={from}
                  onChange={setFrom}
                  data-testid="absence-from"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Bis</Label>
                <DatePickerField
                  value={to}
                  onChange={setTo}
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
              {trackingLocked ? (
                <div className="space-y-2" data-testid="absence-tracking-premium-hint">
                  <p className="text-sm text-muted-foreground">
                    {PLAN_FEATURE_MESSAGES["absenceTracking"]}
                  </p>
                  <PlanUpgradeLink className="text-sm" />
                </div>
              ) : isLoading ? (
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
                    // Urlaub wird stundengenau geführt (Point 7): 1 Tag = 8 h,
                    // ein 24h-Dienst zählt als 3,0 Tage. Für die Anzeige rechnen
                    // wir die verbrauchten Stunden in Tage um (Stunden / 8). Ohne
                    // Vertrag fehlt der Stundenzähler → Fallback: geplante Tage
                    // (Anzahl Urlaubs-Schichten dieses Jahres).
                    const HOURS_PER_DAY = 8;
                    const taken =
                      contract != null
                        ? Math.round(((contract.vacationHoursUsed ?? 0) / HOURS_PER_DAY) * 10) / 10
                        : vacationByUser.get(u.id) ?? 0;
                    const remaining =
                      entitlement !== null ? Math.round((entitlement - taken) * 10) / 10 : null;
                    return (
                      <div key={u.id}>
                      <div
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
                                <span data-testid={`vacation-taken-${u.id}`}>{formatDays(taken)}</span>{" "}
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
                              {remaining !== null ? formatDays(remaining) : remaining}
                            </span>{" "}
                            von{" "}
                            <span data-testid={`vacation-entitlement-${u.id}`}>{formatDays(entitlement)}</span>{" "}
                            Tagen (<span data-testid={`vacation-taken-${u.id}`}>{formatDays(taken)}</span>{" "}
                            genommen)
                          </span>
                        )}
                      </div>
                      {contract && <WorkdaysHint contract={contract} />}
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
                                ? "bg-amber-200 text-amber-950"
                                : "bg-slate-200 text-slate-800"
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
