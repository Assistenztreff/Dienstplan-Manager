import { useMemo, useState } from "react";
import {
  useListUsers,
  useListContracts,
  useListShifts,
  useListShiftModels,
  useBulkCreateAbsence,
  useBulkDeleteShifts,
  useUpdateContract,
  useListVacationBalances,
  useGetAllowanceSettings,
  useCreateAbsenceRequest,
  useListAbsenceRequests,
  useApproveAbsenceRequest,
  useRejectAbsenceRequest,
  ApiError,
  type BulkAbsenceInput,
  type VacationBalance,
  type Contract,
  type User,
  type Shift,
  type ShiftModel,
  type AllowanceSettings,
  type AbsenceRequest,
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
import { Plus, Trash2, Plane, Stethoscope, Info, ChevronLeft, ChevronRight, Calculator, X, AlertCircle } from "lucide-react";
import { eachDayOfInterval, format, startOfMonth, endOfMonth, addMonths, subMonths } from "date-fns";
import { de } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import { planUpgradeMessage, readableApiError, PLAN_FEATURE_MESSAGES } from "@/lib/api-error";
import {
  chunkIds,
  invalidateShiftDerivedQueries,
  removeShiftsFromCache,
  upsertShiftsInCache,
  REFERENCE_DATA_STALE_TIME_MS,
  SHIFT_LIST_STALE_TIME_MS,
  SHIFT_LIST_GC_TIME_MS,
} from "@/lib/shift-cache";
import { warnIfMonthClosed } from "@/lib/month-closing-warning";
import { useAuth, hasTeamAccessLevel } from "@/context/auth";
import { isAdminRole } from "@/lib/roles";
import { hasAccess } from "@/lib/entitlements";
import { PlanUpgradeLink } from "@/components/plan-limit-banner";
import { MonthYearPicker } from "@/components/month-year-picker";
import { AbwesenheitsKalender } from "@/components/abwesenheits-kalender";
import { ArbeitstageRechnerDialog } from "@/components/arbeitstage-rechner-dialog";
import { KrankmeldungDialog } from "@/components/krankmeldung-dialog";
import { formatDays, formatHours } from "@/lib/utils";
import {
  useVertretungAktivieren,
  type VertretungsVorschlag,
} from "@/lib/vertretung-aktivieren";
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
  wunschfrei: "Wunschfrei",
};

const REQUEST_STATUS_LABEL: Record<AbsenceRequest["status"], string> = {
  PENDING: "Offen",
  APPROVED: "Bestätigt",
  REJECTED: "Abgelehnt",
};

function formatRequestRange(item: AbsenceRequest): string {
  const days = item.days;
  if (days.length === 0) return "";
  const first = new Date(days[0]!.startTime);
  const last = new Date(days[days.length - 1]!.startTime);
  return dayKey(first) === dayKey(last)
    ? format(first, "dd.MM.yyyy", { locale: de })
    : `${format(first, "dd.MM.yyyy", { locale: de })} – ${format(last, "dd.MM.yyyy", { locale: de })}`;
}

// Datenpflege-Hinweis: Zeigt an, wenn ein Urlaubstag aktuell aus VERTRAGSDATEN
// (Wochenstunden ÷ Arbeitstage/Woche) bewertet wird, weil (noch) kein
// 13-Wochen-Schnitt vorliegt UND die Arbeitstage noch nie bewusst festgelegt
// wurden (workdaysConfirmedAt == null → Migrations-Default). Der Rechner-
// Dialog übernimmt die Korrektur; das X bestätigt den Ist-Wert (beides setzt
// serverseitig workdaysConfirmedAt → der Hinweis bleibt dauerhaft weg, ist
// aber über den „Neu berechnen"-Button in der Urlaubszeile jederzeit
// wiedererreichbar).
function WorkdaysHint({
  contract,
  balance,
  onOpenRechner,
}: {
  contract: Contract;
  balance?: VacationBalance;
  onOpenRechner: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateContract = useUpdateContract();
  const [closing, setClosing] = useState(false);

  if (!balance || balance.dailyHoursSource !== "contract") return null;
  if (contract.workdaysConfirmedAt != null) return null;

  const workdays = balance.contractWorkdaysPerWeek ?? 5;
  const weekly = balance.contractWeeklyHours;

  // Paket C (Task #871): die Bilanz kommt jetzt aus dem gebündelten
  // GET /vacation-balances (einmal für ALLE Verträge, statt einer
  // Einzelabfrage je Zeile) — nach Speichern reicht daher die Invalidierung
  // der Batch-Query, die Einzel-Route bleibt nur noch für Direktaufrufe (z. B.
  // den mobilen Kalender) bestehen.
  async function invalidateContractQueries() {
    await queryClient.invalidateQueries({
      predicate: (q) => {
        const k = q.queryKey[0];
        return k === "/api/contracts" || k === "/api/vacation-balances";
      },
    });
  }

  async function handleClose() {
    setClosing(true);
    try {
      // Reine Bestätigung ohne Wert-Update (workdaysConfirm): setzt nur
      // serverseitig workdaysConfirmedAt und tastet keine Vertragswerte an —
      // konfliktfest gegenüber parallelen Änderungen.
      await updateContract.mutateAsync({
        id: contract.id,
        data: { workdaysConfirm: true },
      });
      await invalidateContractQueries();
    } catch {
      if (!navigator.onLine) return; // Banner erklärt den Grund bereits.
      toast({ title: "Schließen fehlgeschlagen", variant: "destructive" });
    } finally {
      setClosing(false);
    }
  }

  return (
    <div
      className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-1.5 text-xs text-amber-900"
      data-testid={`workdays-hint-${contract.id}`}
    >
      <span className="flex items-center gap-1.5 min-w-0">
        <Info className="h-3.5 w-3.5 shrink-0" />
        <span>
          Urlaubstage werden aus den Vertragsdaten bewertet
          {weekly != null && (
            <>
              {" "}
              ({formatHours(weekly)} Wochenstunden ÷ {formatHours(workdays)}{" "}
              {workdays === 1 ? "Arbeitstag" : "Arbeitstage"}/Woche ={" "}
              {balance.dailyHours != null ? formatHours(balance.dailyHours) : balance.dailyHours} h/Tag)
            </>
          )}
          . Bitte prüfe die Arbeitstage pro Woche.
        </span>
      </span>
      <span className="flex items-center gap-1 ml-auto">
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs"
          onClick={onOpenRechner}
          disabled={closing}
          data-testid={`workdays-rechner-open-${contract.id}`}
        >
          Rechner öffnen
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={handleClose}
          disabled={closing}
          aria-label="Hinweis schließen und Wert bestätigen"
          title="Hinweis schließen und Wert bestätigen"
          data-testid={`workdays-hint-close-${contract.id}`}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </span>
    </div>
  );
}

// Garantierter Sockel, tatsächlich erworbene Mehrarbeit und optionale Prognose
// bleiben sichtbar getrennt. Nur Sockel + erworbene Mehrarbeit gehören zum
// heute verfügbaren Reststand; die Prognose ist reine Information.
function VacationForecastLines({
  balance,
  dailyHours,
  userId,
}: {
  balance?: VacationBalance;
  dailyHours: number;
  userId: number;
}) {
  if (!balance) return null;
  const {
    vacationSockelHours,
    vacationAufbauHours,
    vacationForecastHours,
    vacationForecastEnabled,
  } = balance;

  return (
    <>
      <span className="text-xs" data-testid={`vacation-sockel-${userId}`}>
        Garantierter Sockel {formatDays(vacationSockelHours)} h
      </span>
      {vacationAufbauHours != null && vacationAufbauHours > 0 && (
        <span className="text-xs" data-testid={`vacation-aufbau-${userId}`}>
          Durch bestätigte Mehrarbeit erworben + {formatDays(vacationAufbauHours)} h
        </span>
      )}
      {vacationForecastEnabled && vacationForecastHours != null && (
        <span className="text-xs" data-testid={`vacation-forecast-${userId}`}>
          13-Wochen-Prognose zum Jahresende {formatDays(vacationForecastHours)} h
          <br />
          <span className="text-[11px] text-muted-foreground">
            Noch nicht verfügbares Guthaben ·{" "}
            entspricht{" "}
            {formatDays(Math.round((vacationForecastHours / dailyHours) * 10) / 10)} Diensten
          </span>
        </span>
      )}
    </>
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

  // Verwaltungsrechte: Konto-Admins und Teamleiter sehen/verwalten ALLE
  // Abwesenheiten ihres Scopes. Assistenzkräfte sehen die Seite ebenfalls,
  // aber ausschließlich für die EIGENE Person (§3 der Menü-Neustrukturierung);
  // der Server erzwingt dasselbe Scoping zusätzlich autoritativ.
  const canManage =
    isAdminRole(currentUser?.role) ||
    !!currentUser?.isTeamleiter ||
    hasTeamAccessLevel(currentUser, "stufe1");

  // Die Nutzerliste ist ein Admin-/Teamleiter-Endpunkt (403 für Assistenz-
  // kräfte) — für Assistenzkräfte gar nicht erst abfragen.
  // Doppelter Cast (Optionen + Ergebnis): Die generierten Hooks verlieren die
  // Datentyp-Inferenz, sobald Optionen ohne queryKey übergeben werden.
  const { data: users, isLoading: usersLoading } = useListUsers(undefined, {
    query: { enabled: canManage, staleTime: REFERENCE_DATA_STALE_TIME_MS },
  } as unknown as Parameters<typeof useListUsers>[1]) as {
    data?: User[];
    isLoading: boolean;
  };
  const { data: contracts, isLoading: contractsLoading } = useListContracts(undefined, {
    query: { staleTime: REFERENCE_DATA_STALE_TIME_MS },
  } as unknown as Parameters<typeof useListContracts>[1]) as {
    data?: Contract[];
    isLoading: boolean;
  };
  const { data: shiftModels } = useListShiftModels(undefined, {
    query: { staleTime: REFERENCE_DATA_STALE_TIME_MS },
  } as unknown as Parameters<typeof useListShiftModels>[1]) as { data?: ShiftModel[] };
  // all: true (Task #871) — diese Seite zeigt bewusst die GESAMTE
  // Abwesenheits-Historie (Liste "Eingetragene Abwesenheiten", Resturlaub-
  // Vorjahresbezug etc.), nicht nur den serverseitigen Default-Zeitraum
  // (aktueller Kalendermonat).
  const { data: vacationShifts, isLoading: vacationLoading } = useListShifts(
    { type: "vacation", all: true },
    {
      query: { staleTime: SHIFT_LIST_STALE_TIME_MS, gcTime: SHIFT_LIST_GC_TIME_MS },
    } as unknown as Parameters<typeof useListShifts>[1],
  ) as { data?: Shift[]; isLoading: boolean };
  const { data: sickShifts, isLoading: sickLoading } = useListShifts(
    { type: "sick", all: true },
    {
      query: { staleTime: SHIFT_LIST_STALE_TIME_MS, gcTime: SHIFT_LIST_GC_TIME_MS },
    } as unknown as Parameters<typeof useListShifts>[1],
  ) as { data?: Shift[]; isLoading: boolean };

  // Vollzeit-Referenz (AP 2) für den Urlaubstopf — Konto-globale Einstellung,
  // daher ohne teamId abgefragt (wie im Einstellungen-Formular editiert).
  const { data: allowanceSettings } = useGetAllowanceSettings(undefined, {
    query: { enabled: canManage, staleTime: REFERENCE_DATA_STALE_TIME_MS },
  } as unknown as Parameters<typeof useGetAllowanceSettings>[1]) as { data?: AllowanceSettings };
  const fulltimeWorkdaysPerWeek = allowanceSettings?.fulltimeWorkdaysPerWeek ?? 5;

  // Paket C (Task #871): EIN Request für die Resturlaub-Bilanzen ALLER
  // sichtbaren Verträge, statt vorher zwei Einzelabfragen (WorkdaysHint +
  // VacationForecastLines) PRO Assistenzkraft. Nur laden, wenn die Karte
  // überhaupt sichtbar ist (Premium-Feature absenceTracking).
  const {
    data: vacationBalances,
    isFetching: vacationBalancesFetching,
  } = useListVacationBalances(undefined, {
    query: {
      enabled: !trackingLocked,
      staleTime: 0,
      refetchOnMount: "always",
    },
  } as unknown as Parameters<typeof useListVacationBalances>[1]) as {
    data?: VacationBalance[];
    isFetching: boolean;
  };
  const balanceByContractId = useMemo(() => {
    const map = new Map<number, VacationBalance>();
    if (!vacationBalancesFetching) {
      for (const b of vacationBalances ?? []) map.set(b.contractId, b);
    }
    return map;
  }, [vacationBalances, vacationBalancesFetching]);

  const bulkCreateAbsence = useBulkCreateAbsence();
  const bulkDeleteShifts = useBulkDeleteShifts();
  const createAbsenceRequest = useCreateAbsenceRequest();
  const approveAbsenceRequest = useApproveAbsenceRequest();
  const { frageVertretungen } = useVertretungAktivieren();
  const rejectAbsenceRequest = useRejectAbsenceRequest();

  // #887: eigene Anträge (Assistenzkraft) bzw. offene Anträge zur Bestätigung
  // (Planer). Zwei getrennte Abfragen statt einer gemeinsamen mit Rollen-
  // Verzweigung im Query-Key — die Serverseite scoped ohnehin automatisch
  // (eigene Person vs. erlaubte Teams).
  const { data: myAbsenceRequests } = useListAbsenceRequests(undefined, {
    query: { enabled: !canManage, staleTime: 0, refetchOnMount: "always" },
  } as unknown as Parameters<typeof useListAbsenceRequests>[1]) as {
    data?: AbsenceRequest[];
  };
  const { data: pendingAbsenceRequests, isLoading: pendingRequestsLoading } =
    useListAbsenceRequests(
      { status: "PENDING" },
      {
        query: { enabled: canManage, staleTime: 0, refetchOnMount: "always" },
      } as unknown as Parameters<typeof useListAbsenceRequests>[1],
    ) as { data?: AbsenceRequest[]; isLoading: boolean };
  const [resolvingRequestId, setResolvingRequestId] = useState<number | null>(null);

  async function invalidateAbsenceRequests() {
    await queryClient.invalidateQueries({
      predicate: (q) => q.queryKey[0] === "/api/absence-requests",
    });
  }

  async function handleApproveRequest(item: AbsenceRequest) {
    setResolvingRequestId(item.id);
    try {
      const approved = (await approveAbsenceRequest.mutateAsync({ id: item.id })) as {
        vertretungsVorschlaege?: VertretungsVorschlag[];
      };
      await invalidateAbsenceRequests();
      void invalidate();
      // War an einem verdraengten Dienst jemand als Vertretung vorgemerkt,
      // direkt nachfragen — sonst bliebe der Tag nach einer aus der App
      // gemeldeten Krankheit einfach leer (Kay 30.08.2026).
      if (approved?.vertretungsVorschlaege?.length) {
        frageVertretungen(approved.vertretungsVorschlaege);
      }
      toast({
        title: `${TYPE_LABEL[item.type]}santrag bestätigt`,
        description: `${item.userName ?? "Assistenzkraft"} · ${item.days.length} ${
          item.days.length === 1 ? "Tag" : "Tage"
        }`,
      });
    } catch (err) {
      const planMsg = planUpgradeMessage(err);
      if (planMsg) {
        toast({ title: "Bestätigen fehlgeschlagen", description: planMsg, variant: "destructive" });
      } else if (err instanceof ApiError && (err.status === 400 || err.status === 409)) {
        toast({
          title: "Bestätigen fehlgeschlagen",
          description: readableApiError(err, "Bitte erneut versuchen."),
          variant: "destructive",
        });
      } else {
        if (!navigator.onLine) return; // Banner erklärt den Grund bereits.
        toast({ title: "Bestätigen fehlgeschlagen", variant: "destructive" });
      }
      await invalidateAbsenceRequests();
    } finally {
      setResolvingRequestId(null);
    }
  }

  async function handleRejectRequest(item: AbsenceRequest) {
    setResolvingRequestId(item.id);
    try {
      await rejectAbsenceRequest.mutateAsync({ id: item.id });
      await invalidateAbsenceRequests();
      toast({ title: "Antrag abgelehnt" });
    } catch {
      if (!navigator.onLine) return; // Banner erklärt den Grund bereits.
      toast({ title: "Ablehnen fehlgeschlagen", variant: "destructive" });
    } finally {
      setResolvingRequestId(null);
    }
  }

  const [userId, setUserId] = useState<string>("");
  const [type, setType] = useState<AbsenceType>("vacation");
  const [shiftModelId, setShiftModelId] = useState<string>("");
  // #887: ersetzt bei Assistenzkräften das Dienst-Dropdown — gilt pro Tag im
  // gewählten Zeitraum (Ganztägig = 00:00–23:59 je Tag, Von-Bis = dieselbe
  // Uhrzeitspanne an jedem Tag des Zeitraums).
  const [dayMode, setDayMode] = useState<"ganztaegig" | "vonbis">("ganztaegig");
  const [vonZeit, setVonZeit] = useState("08:00");
  const [bisZeit, setBisZeit] = useState("16:00");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  // Schnell-Krankmeldung für Assistenzkräfte (Dialog).
  const [krankmeldungOpen, setKrankmeldungOpen] = useState(false);

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
  // Vertrag, für den der Arbeitstage-Rechner geöffnet ist (null = zu).
  const [rechnerContract, setRechnerContract] = useState<Contract | null>(null);
  // Abwesenheitskalender standardmäßig eingeklappt; Zustand pro Gerät merken.
  const [kalenderOffen, setKalenderOffen] = useState<boolean>(() => {
    try {
      return localStorage.getItem("abwesenheitskalender-offen") === "1";
    } catch {
      return false;
    }
  });

  function toggleKalender() {
    setKalenderOffen((v) => {
      const next = !v;
      try {
        localStorage.setItem("abwesenheitskalender-offen", next ? "1" : "0");
      } catch {
        /* Speicher voll/deaktiviert — Zustand gilt dann nur für die Sitzung. */
      }
      return next;
    });
  }

  const assistants = useMemo(
    () => (users ?? []).filter((u) => u.role === "assistant"),
    [users]
  );

  // Assistenzkräfte ohne Verwaltungsrechte: alles ist auf die eigene Person
  // fixiert — für Resturlaub-Panel und Namensauflösung genügt der eigene
  // Datensatz (die Nutzerliste steht ihnen serverseitig nicht zu).
  const displayUsers = useMemo(
    () =>
      canManage
        ? assistants
        : currentUser
          ? [{ id: currentUser.id, name: currentUser.name }]
          : [],
    [canManage, assistants, currentUser],
  );

  const allAbsences = useMemo<AbsenceShift[]>(
    () => [...(vacationShifts ?? []), ...(sickShifts ?? [])] as AbsenceShift[],
    [vacationShifts, sickShifts]
  );

  const ranges = useMemo(() => buildRanges(allAbsences), [allAbsences]);

  const userName = (id: number) =>
    displayUsers.find((u) => u.id === id)?.name ??
    (users ?? []).find((u) => u.id === id)?.name ??
    "Unbekannt";

  // Resturlaub im laufenden Jahr: Anspruch laut aktivem Vertrag minus der bereits
  // als Urlaub geplanten Tage dieses Jahres.
  const currentYear = new Date().getFullYear();
  // #887: Referenz für den Lösch-Guard vergangener Abwesenheiten (clientseitig,
  // Server ist die eigentliche Durchsetzung).
  const todayKey = dayKey(new Date());
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
    await invalidateShiftDerivedQueries(queryClient);
  }

  async function handleSave() {
    setError(null);
    // Ohne Verwaltungsrechte ist die Zielperson immer die eigene.
    const effectiveUserId = canManage ? userId : String(currentUser?.id ?? "");
    if (!effectiveUserId) {
      setError("Bitte eine Assistenzkraft auswählen.");
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
    if (!canManage && dayMode === "vonbis" && (!vonZeit || !bisZeit || bisZeit <= vonZeit)) {
      setError("Bitte eine gültige Von-Bis-Zeitspanne angeben (Bis nach Von, am selben Tag).");
      return;
    }

    const uid = Number(effectiveUserId);
    const days = eachDayOfInterval({ start, end });

    // #887: Assistenzkräfte legen keine Schichten mehr direkt an — der
    // Zeitraum wird als PENDING-Antrag gestellt (kein Kalender-/Urlaubskonto-
    // Effekt, bis ein Planer bestätigt).
    if (!canManage) {
      setSaving(true);
      try {
        await createAbsenceRequest.mutateAsync({
          data: {
            type: type as "vacation" | "sick",
            days: days.map((day) => {
              const key = dayKey(day);
              if (dayMode === "ganztaegig") {
                return { startTime: `${key}T00:00:00.000Z`, endTime: `${key}T23:59:59.000Z` };
              }
              return {
                startTime: new Date(`${key}T${vonZeit}:00`).toISOString(),
                endTime: new Date(`${key}T${bisZeit}:00`).toISOString(),
              };
            }),
          },
        });
        await invalidateAbsenceRequests();
        toast({
          title: `${TYPE_LABEL[type]}santrag eingereicht`,
          description: "Ein Planer muss den Zeitraum noch bestätigen.",
        });
        setFrom("");
        setTo("");
        setDayMode("ganztaegig");
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          setError("Sitzung abgelaufen. Bitte Seite neu laden und erneut anmelden.");
        } else if (err instanceof ApiError && err.status === 400) {
          setError(readableApiError(err, "Antrag konnte nicht gestellt werden. Bitte erneut versuchen."));
        } else {
          setError("Antrag konnte nicht gestellt werden. Bitte erneut versuchen.");
        }
      } finally {
        setSaving(false);
      }
      return;
    }

    setSaving(true);
    try {
      // Sammelauftrag (Task #715): der ganze Zeitraum in EINEM Request,
      // transaktional (ganz oder gar nicht) — der Urlaubszähler wird server-
      // seitig einmal am Ende fortgeschrieben. Tage mit bestehender Abwesenheit
      // desselben Typs überspringt der Server und meldet sie zurück.
      const result = await bulkCreateAbsence.mutateAsync({
        data: {
          userId: uid,
          type: type as BulkAbsenceInput["type"],
          days: days.map((day) => ({
            startTime: `${dayKey(day)}T00:00:00.000Z`,
            endTime: `${dayKey(day)}T23:59:59.000Z`,
          })),
          shiftModelId: shiftModelId ? Number(shiftModelId) : null,
        },
      });
      if (result.createdCount === 0) {
        setError("Für den gewählten Zeitraum bestehen bereits Abwesenheiten dieses Typs.");
        return;
      }
      // Sofort reagieren: angelegte Einträge direkt in die geladenen Listen
      // einfügen, ersetzte Arbeitsdienste entfernen; der Abgleich abgeleiteter
      // Daten (Urlaubszähler, Salden) läuft im Hintergrund.
      upsertShiftsInCache(queryClient, result.shifts, result.teamId);
      removeShiftsFromCache(queryClient, result.replacedShiftIds);
      void invalidate();
      // Soft-Close-Hinweis: nur für tatsächlich angelegte Tage.
      const skippedKeys = new Set(result.skippedDates);
      for (const day of days) {
        if (!skippedKeys.has(dayKey(day))) void warnIfMonthClosed(day, null);
      }
      toast({
        title: `${TYPE_LABEL[type]} eingetragen`,
        description:
          `${result.createdCount} ${result.createdCount === 1 ? "Tag" : "Tage"} angelegt` +
          (result.skippedCount > 0 ? `, ${result.skippedCount} bereits vorhanden` : ""),
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
    // Sammelauftrag (Task #751): der ganze Zeitraum in EINEM Request, server-
    // seitig transaktional inkl. Zeiterfassungs- und Urlaubs-Rückbuchung —
    // statt N langsamer Einzel-DELETEs. Sehr lange Zeiträume laufen in
    // Blöcken à 200 (API-Limit), jeder Block atomar.
    const deleted: number[] = [];
    try {
      for (const chunk of chunkIds(range.shiftIds)) {
        const result = await bulkDeleteShifts.mutateAsync({ data: { ids: chunk } });
        deleted.push(...result.deletedIds);
      }
      // Sofort reagieren: Einträge aus dem Cache nehmen; der Abgleich (inkl.
      // Urlaubszähler auf den Verträgen) läuft im Hintergrund.
      removeShiftsFromCache(queryClient, deleted);
      void invalidate();
      void warnIfMonthClosed(range.startDate, null);
      void warnIfMonthClosed(range.endDate, null);
      toast({ title: "Abwesenheit entfernt" });
    } catch {
      // Bereits gelöschte Blöcke sofort aus der Ansicht nehmen; die Liste
      // gleicht sich im Hintergrund ab.
      removeShiftsFromCache(queryClient, deleted);
      void invalidate();
      if (!navigator.onLine) return; // Banner erklärt den Grund bereits.
      toast({ title: "Entfernen fehlgeschlagen", variant: "destructive" });
    } finally {
      setDeletingKey(null);
    }
  }

  const isLoading =
    (canManage && usersLoading) || contractsLoading || vacationLoading || sickLoading;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-2xl md:text-3xl font-serif font-bold text-foreground">Abwesenheiten</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Urlaub und Krankheit als Zeitraum erfassen und verwalten
        </p>
      </div>

      {/* Abwesenheitskalender (Jahresansicht mit Direktanlage, HANDOFF 05.08.2026) —
          einklappbar, damit Resturlaub und Listen schneller erreichbar sind. */}
      <section aria-labelledby="abwesenheitskalender-ueberschrift">
        <button
          type="button"
          onClick={toggleKalender}
          aria-expanded={kalenderOffen}
          aria-controls="abwesenheitskalender"
          className="flex w-full items-center gap-2 rounded-md px-2 py-2.5 text-left transition-colors hover:bg-muted/50"
          data-testid="toggle-abwesenheits-kalender"
        >
          <ChevronRight
            className={`h-5 w-5 shrink-0 transition-transform ${kalenderOffen ? "rotate-90" : ""}`}
          />
          <span id="abwesenheitskalender-ueberschrift" className="font-semibold">Abwesenheitskalender</span>
          <span className="text-sm text-muted-foreground">
            Jahresübersicht mit Direktanlage
          </span>
        </button>
        {kalenderOffen && <div id="abwesenheitskalender"><AbwesenheitsKalender /></div>}
      </section>

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
        <MonthYearPicker
          month={currentNavMonth.getMonth() + 1}
          year={currentNavMonth.getFullYear()}
          onChange={(m, y) => {
            const newMonth = new Date(y, m - 1, 1);
            setCurrentNavMonth(newMonth);
            setFrom(format(startOfMonth(newMonth), "yyyy-MM-dd"));
            setTo(format(endOfMonth(newMonth), "yyyy-MM-dd"));
          }}
          testId="absence-month-label"
          triggerClassName="text-base font-semibold tabular-nums"
        />
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

      {/* Schnell-Krankmeldung: nur für Assistenzkräfte sichtbar (kein canManage),
          damit sie sich schnell krank melden können, ohne das Formular auszufüllen. */}
      {!canManage && currentUser && (
        <>
          <button
            type="button"
            onClick={() => setKrankmeldungOpen(true)}
            className="w-full text-left"
            data-testid="abwesenheiten-krank-melden-btn"
          >
            <Card className="border-destructive/30 bg-destructive/5 shadow-sm transition-colors hover:border-destructive/50">
              <CardContent className="flex items-center gap-3 py-4">
                <AlertCircle className="h-5 w-5 text-destructive shrink-0" aria-hidden />
                <div className="flex-1">
                  <p className="text-sm font-medium text-destructive">Krank melden</p>
                  <p className="text-xs text-destructive/70 mt-0.5">
                    Heute oder mehrere Tage krankmelden — Koordinator wird informiert.
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-destructive/60 shrink-0" />
              </CardContent>
            </Card>
          </button>
          <KrankmeldungDialog
            open={krankmeldungOpen}
            onClose={() => setKrankmeldungOpen(false)}
          />
        </>
      )}

      {/* #887: eigene Urlaubs-/Krankheitsanträge samt Status — nur für
          Assistenzkräfte, da Planer sofort wirksame Einträge anlegen. */}
      {!canManage && (myAbsenceRequests?.length ?? 0) > 0 && (
        <Card className="border-border/50 shadow-sm">
          <CardContent className="p-5">
            <h3 className="font-semibold mb-4">Meine Anträge</h3>
            <div className="space-y-2" data-testid="my-absence-requests">
              {myAbsenceRequests!.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 py-2.5 px-3 rounded-lg border border-border/40"
                  data-testid={`absence-request-row-${item.id}`}
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">
                      {TYPE_LABEL[item.type]} · {formatRequestRange(item)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {item.days.length} {item.days.length === 1 ? "Tag" : "Tage"}
                    </div>
                  </div>
                  <Badge
                    variant={
                      item.status === "APPROVED"
                        ? "default"
                        : item.status === "REJECTED"
                          ? "destructive"
                          : "secondary"
                    }
                    className="text-xs shrink-0"
                    data-testid={`absence-request-status-${item.id}`}
                  >
                    {REQUEST_STATUS_LABEL[item.status]}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* #887: Planer-Freigabe offener Urlaubs-/Krankheitsanträge. */}
      {canManage && (
        <Card
          className="border-border/50 shadow-sm"
          data-testid="pending-absence-requests-section"
        >
          <CardContent className="p-5">
            <h3 className="font-semibold mb-4">Offene Anträge</h3>
            {pendingRequestsLoading ? (
              <Skeleton className="h-12 w-full" />
            ) : (pendingAbsenceRequests?.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">
                Keine offenen Anträge.
              </p>
            ) : (
              <div className="space-y-2" data-testid="pending-absence-requests">
                {pendingAbsenceRequests!.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 py-2.5 px-3 rounded-lg border border-border/40"
                    data-testid={`pending-absence-request-${item.id}`}
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        {item.userName ?? "Unbekannt"} · {TYPE_LABEL[item.type]}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatRequestRange(item)} · {item.days.length}{" "}
                        {item.days.length === 1 ? "Tag" : "Tage"}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={resolvingRequestId === item.id}
                        onClick={() => void handleRejectRequest(item)}
                        data-testid={`absence-request-reject-${item.id}`}
                      >
                        Ablehnen
                      </Button>
                      <Button
                        size="sm"
                        disabled={resolvingRequestId === item.id}
                        onClick={() => void handleApproveRequest(item)}
                        data-testid={`absence-request-approve-${item.id}`}
                      >
                        Bestätigen
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Erfassung */}
        <Card className="border-border/50 shadow-sm lg:col-span-1">
          <CardContent className="p-5 space-y-4" aria-labelledby="abwesenheit-eintragen">
            <h2 id="abwesenheit-eintragen" className="font-semibold">Abwesenheit eintragen</h2>

            <div className="space-y-1.5">
              <Label htmlFor="absence-user">Assistenzkraft</Label>
              {canManage ? (
                <Select value={userId} onValueChange={setUserId}>
                  <SelectTrigger id="absence-user" data-testid="absence-user">
                    <SelectValue placeholder="Assistenzkraft auswählen" />
                  </SelectTrigger>
                  <SelectContent>
                    {assistants.map((u) => (
                      <SelectItem key={u.id} value={String(u.id)}>
                        {u.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                // Assistenzkräfte tragen nur für sich selbst ein — kein Auswahlfeld.
                <p
                  className="flex h-9 items-center rounded-md border border-input bg-muted/40 px-3 text-sm"
                  data-testid="absence-user-self"
                >
                  {currentUser?.name}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="absence-type">Art</Label>
              <Select value={type} onValueChange={(v) => setType(v as AbsenceType)}>
                  <SelectTrigger id="absence-type" data-testid="absence-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vacation">Urlaub</SelectItem>
                  <SelectItem value="sick">Krank</SelectItem>
                  <SelectItem value="wunschfrei">Wunschfrei</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {canManage ? (
              <div className="space-y-1.5">
                <Label htmlFor="absence-shift-model">Dienst (optional)</Label>
                <Select
                  value={shiftModelId || "none"}
                  onValueChange={(v) => setShiftModelId(v === "none" ? "" : v)}
                >
                    <SelectTrigger id="absence-shift-model" data-testid="absence-shift-model">
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
            ) : (
              // #887: Assistenzkräfte wählen kein Schichtmodell mehr, sondern
              // legen pro Zeitraum fest, ob der Antrag ganztägig gilt oder eine
              // Uhrzeitspanne hat (an jedem Tag des Zeitraums gleich).
              <div className="space-y-1.5">
                <Label htmlFor="absence-day-mode">Zeitraum</Label>
                <Select
                  value={dayMode}
                  onValueChange={(v) => setDayMode(v as "ganztaegig" | "vonbis")}
                >
                  <SelectTrigger id="absence-day-mode" data-testid="absence-day-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ganztaegig">Ganztägig (Standard)</SelectItem>
                    <SelectItem value="vonbis">Von–Bis</SelectItem>
                  </SelectContent>
                </Select>
                {dayMode === "vonbis" && (
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div className="space-y-1.5">
                      <Label htmlFor="absence-von-zeit">Von (Uhrzeit)</Label>
                      <Input
                        id="absence-von-zeit"
                        type="time"
                        value={vonZeit}
                        onChange={(e) => setVonZeit(e.target.value)}
                        data-testid="absence-von-zeit"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="absence-bis-zeit">Bis (Uhrzeit)</Label>
                      <Input
                        id="absence-bis-zeit"
                        type="time"
                        value={bisZeit}
                        onChange={(e) => setBisZeit(e.target.value)}
                        data-testid="absence-bis-zeit"
                      />
                    </div>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Der Antrag muss von einem Planer bestätigt werden, bevor er im
                  Kalender erscheint.
                </p>
              </div>
            )}

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

            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

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
              ) : displayUsers.length === 0 ? (
                <p className="text-sm text-muted-foreground">Keine Assistenzkräfte vorhanden.</p>
              ) : (
                <div className="space-y-2.5">
                  {displayUsers.map((u) => {
                    const contract = activeContractFor(u.id);
                    const balance = contract
                      ? balanceByContractId.get(contract.id)
                      : undefined;
                    const entitlement = contract?.vacationDays ?? null;
                    // Urlaub wird stundengenau geführt (Point 7): die typische
                    // Dienstlänge (Wochenstunden ÷ Arbeitstage/Woche des
                    // Vertrags) bestimmt die Umrechnung Stunden ↔ Tage — statt
                    // pauschal 8h. Ohne (nutzbaren) Vertrag Fallback auf 8h.
                    const dailyHours =
                      contract != null &&
                      contract.weeklyHours > 0 &&
                      (contract.workdaysPerWeek ?? 0) > 0
                        ? Math.round((contract.weeklyHours / contract.workdaysPerWeek!) * 100) / 100
                        : 8;
                    // Urlaubstopf (AP 2): Urlaubswochen × Wochenstunden statt
                    // Urlaubstage × Stundenzahl/Tag — Teilzeit bekommt so einen
                    // fairen Topf. Ohne nutzbaren Vertrag (weeklyHours) bleibt
                    // der alte tagesbasierte Fallback bestehen.
                    const fallbackHoursTotal =
                      entitlement === null
                        ? null
                        : contract != null && contract.weeklyHours > 0 && fulltimeWorkdaysPerWeek > 0
                          ? Math.round((entitlement / fulltimeWorkdaysPerWeek) * contract.weeklyHours * 100) / 100
                          : entitlement * dailyHours;
                    const hoursTotal = balance?.vacationHoursTotal ?? fallbackHoursTotal;
                    const hoursUsed = balance?.vacationHoursUsed ?? contract?.vacationHoursUsed ?? 0;
                    const hoursLeft =
                      balance?.vacationHoursRemaining ??
                      (hoursTotal !== null ? hoursTotal - hoursUsed : null);
                    // Ohne Vertrag fehlt der Stundenzähler → Fallback: geplante
                    // Tage (Anzahl Urlaubs-Schichten dieses Jahres).
                    const taken =
                      contract != null
                        ? balance?.vacationDaysUsed ??
                          Math.round((hoursUsed / dailyHours) * 10) / 10
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
                        <span className="flex items-center gap-1">
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
                          <span className="flex flex-col items-end text-muted-foreground">
                            <span>
                              <span
                                className={
                                  hoursLeft !== null && hoursLeft < 0
                                    ? "font-semibold text-destructive"
                                    : "font-semibold text-foreground"
                                }
                                data-testid={`vacation-remaining-${u.id}`}
                              >
                                {hoursLeft !== null ? formatDays(hoursLeft) : hoursLeft}
                              </span>{" "}
                              h
                            </span>
                            <span className="text-xs">
                              Verbleibend:{" "}
                              {hoursLeft !== null
                                ? formatDays(Math.round((hoursLeft / dailyHours) * 10) / 10)
                                : "–"}{" "}
                              Dienste à {formatDays(dailyHours)} h · Gesamt{" "}
                              {hoursTotal !== null ? formatDays(hoursTotal) : "–"} h · Verbraucht{" "}
                              {formatDays(hoursUsed)} h · Vertragsurlaub{" "}
                              <span data-testid={`vacation-entitlement-${u.id}`}>
                                {formatDays(entitlement)}
                              </span>{" "}
                              Tage
                              <span className="sr-only">
                                {" "}
                                (<span data-testid={`vacation-taken-${u.id}`}>{formatDays(taken)}</span>{" "}
                                genommen)
                              </span>
                            </span>
                            {contract && (
                              <VacationForecastLines
                                balance={balance}
                                dailyHours={dailyHours}
                                userId={u.id}
                              />
                            )}
                          </span>
                        )}
                        {/* Arbeitstage-Rechner jederzeit wieder erreichbar —
                            auch nachdem der Hinweis bestätigt wurde. */}
                        {canManage && contract && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0"
                            aria-label="Arbeitstage neu berechnen"
                            title="Arbeitstage neu berechnen"
                            onClick={() => setRechnerContract(contract)}
                            data-testid={`workdays-recalc-${u.id}`}
                          >
                            <Calculator className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        </span>
                      </div>
                      {/* Vertrags-Datenpflege (PATCH) bleibt Verwaltungsrechten vorbehalten. */}
                      {canManage && contract && (
                        <WorkdaysHint
                          contract={contract}
                          balance={balanceByContractId.get(contract.id)}
                          onOpenRechner={() => setRechnerContract(contract)}
                        />
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
                    // #887: vergangene Abwesenheiten sind unveränderlich (der
                    // Server lehnt das Löschen ohnehin ab) — der Button wird
                    // hier nur deaktiviert, damit Nutzer den Grund sofort sehen.
                    const isPast = dayKey(range.endDate) < todayKey;
                    const sameDay = dayKey(range.startDate) === dayKey(range.endDate);
                    // Halbtägiger Urlaub (#862): Zeitspanne ergänzen, damit ein
                    // Teil-Tag von einem ganztägigen Eintrag unterscheidbar bleibt.
                    const dateLabel = sameDay
                      ? range.timeSpan
                        ? `${format(range.startDate, "dd.MM.yyyy", { locale: de })}, ${range.timeSpan}`
                        : format(range.startDate, "dd.MM.yyyy", { locale: de })
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
                          {!isPast && (
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
                          )}
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

      <ArbeitstageRechnerDialog
        contract={rechnerContract ?? undefined}
        open={rechnerContract !== null}
        onOpenChange={(open) => {
          if (!open) setRechnerContract(null);
        }}
      />
    </div>
  );
}
