import { isAdminRole } from "@/lib/roles";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams, useLocation } from "wouter";
import {
  useListShifts,
  useListUsers,
  useListShiftModels,
  useUpdateShift,
  useCreateShift,
  useSendShiftProposals,
  useBulkConfirmOwnShifts,
  useGetHoursBalance,
  useListShiftDeviations,
  useConfirmOwnShift,
  useListShiftCorrectionObjections,
  useObjectShiftCorrection,
  useWithdrawShiftCorrection,
  useReportShiftDeviation,
  useAcceptShiftDeviation,
  useDisputeShiftDeviation,
  useGetHourBudgetBalance,
  type ShiftInputType,
  type User,
  type ShiftModel,
  type HoursBalance,
  type HourBudgetBalance,
  type ShiftDeviationReport,
  type ShiftCorrectionObjection,
} from "@workspace/api-client-react";
import { useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, isValid } from "date-fns";
import { de } from "date-fns/locale";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Check, X, CalendarPlus, Trash2, Pencil, ChevronsLeft } from "lucide-react";
import { ShiftDialog, type VertretungsVorschlag } from "@/components/shift-dialog";
import { BulkDeleteDialog } from "@/components/bulk-delete-dialog";
import { BulkEditDialog } from "@/components/bulk-edit-dialog";
import { useTeam } from "@/context/team";
import { useAuth, hasTeamAccessLevel } from "@/context/auth";
import { buildPersonColorAssignment, userDotClass } from "@/lib/shift-model-colors";
import { hasAccess, getLimit } from "@/lib/entitlements";
import { useIsMobile } from "@/hooks/use-mobile";
import { toast } from "sonner";
import { useSelectedAssistant, type Assistant } from "@/components/assistant-filter";
import {
  StundenkontoPanel,
  StundenkontoReihe,
  useSelectedUserIds,
  useIsWideStundenkontoLayout,
  useStundenkontoSort,
  useStundenkontoEintraege,
} from "@/components/stundenkonto-leiste";
import { PlanLimitBanner } from "@/components/plan-limit-banner";
import { exportSimpleMonthPdf } from "@/lib/pdf-export";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  SHIFT_LIST_STALE_TIME_MS,
  SHIFT_LIST_GC_TIME_MS,
  REFERENCE_DATA_STALE_TIME_MS,
  prefetchAdjacentMonthShifts,
  upsertShiftsInCache,
  invalidateShiftDerivedQueries,
} from "@/lib/shift-cache";
import {
  type DialogState,
  isAbsenceShift,
  isMirrorShift,
  isPastCorrection,
  PersonColorsContext,
  scrollToAgendaDay,
  type Shift,
  type ShiftModelInfo,
  TeamAbsenceOverview,
  usePersistentState,
} from "./dienstplan-helpers";
import { StatusBadge } from "@/components/status-badge";
import { CorrectedShiftsProvider } from "./corrected-shifts";
import { MonthGrid } from "./month-grid";
import type { DeviationReportValues } from "./deviation-dialog";
import { readableApiError } from "@/lib/api-error";
import { ScheduleList } from "./schedule-list";
import { DienstplanHeader } from "./dienstplan-header";
import { DienstplanTableView } from "./dienstplan-table-view";

function monthsAhead(target: Date, now: Date): number {
  return (
    (target.getFullYear() - now.getFullYear()) * 12 +
    (target.getMonth() - now.getMonth())
  );
}

export default function Dienstplan() {
  const { currentUser } = useAuth();
  const isAdmin = isAdminRole(currentUser?.role);
  // Freigeschaltete Mitarbeiter (Task #735/#734): Stufe 1 UND Teamleiter
  // dürfen planen (Dienste anlegen/bearbeiten/bestätigen) — dieselbe
  // Schwelle wie die Team-Verwaltung-Route in App.tsx. Bewusst getrennt von
  // isAdmin, damit Stufe 1 NICHT automatisch Stufe-2-Rechte (Zeiterfassung
  // bestätigen, Team-Verwaltung-Struktur) mit erbt.
  const canPlan =
    isAdmin || Boolean(currentUser?.isTeamleiter) || hasTeamAccessLevel(currentUser, "stufe1");
  const canBulkEdit = hasAccess(currentUser, "bulkEdit");
  // historyMonths ist ein Konto-Limit (Plan des TEAM-EIGENTUEMERS), aber
  // currentUser.plan spiegelt nur den eigenen Plan wider — bei Assistenzkräften
  // (accessLevel-Planungsrecht, Task #735) praktisch immer "free", selbst wenn
  // der Arbeitgeber Premium ist (Memory feature-via-team-owner-plan.md). Der
  // clientseitige Vorab-Check ist nur fuer den Inhaber (isAdmin) aussagekraeftig
  // — bei allen anderen macht der Server (getUserLimit ueber den Team-Owner)
  // die verbindliche Pruefung; ein 403 zeigt ShiftDialog bereits ueber
  // planUpgradeMessage() korrekt an. Ohne diese Einschraenkung wuerde der
  // Knopf fuer Stufe-1/2-Assistenzkräfte eines Premium-Arbeitgebers
  // faelschlich blockieren (stiller No-Op statt Dialog).
  const forwardLimit = isAdmin ? getLimit(currentUser, "historyMonths") : null;

  const [searchParams] = useSearchParams();
  const [, navigate] = useLocation();
  const initialDate = (() => {
    const param = searchParams.get("date");
    if (param) {
      const parsed = parseISO(param);
      if (isValid(parsed)) return parsed;
    }
    return new Date();
  })();

  const [currentDate, setCurrentDate] = useState(initialDate);
  const [dialog, setDialog] = useState<DialogState>({ mode: "closed" });
  const [mobileView, setMobileView] = usePersistentState<"list" | "grid">(
    "dienstplan.mobileView",
    "grid",
    ["list", "grid"],
  );
  // 3.3: Smartphone-Monatsraster startet bei jedem Aufruf eingeklappt
  // (Mini-Balken + Zähler); der Header-Button klappt für die laufende Ansicht
  // auf (kompakte Initialen-Pillen). Bewusst nicht persistiert — die Vorlage
  // sieht den eingeklappten Zustand als festen Startpunkt vor.
  const [desktopView, setDesktopView] = usePersistentState<"table" | "grid">(
    "dienstplan.desktopView",
    "table",
    ["table", "grid"],
  );
  // Punkt 1 (Arbeitsanweisung 17.08.2026): globaler Minimiert-Umschalter für
  // die Desktop/Tablet-Monatsansicht — kollabiert die zweizeilige Pille auf
  // eine Zeile. Persistiert wie desktopView, damit die Wahl über Sitzungen
  // hinweg erhalten bleibt.
  const [pillMinimiertFlag, setPillMinimiertFlag] = usePersistentState<"1" | "0">(
    "dienstplan.pillMinimiert",
    "0",
    ["1", "0"],
  );
  const pillMinimiert = pillMinimiertFlag === "1";
  const [selectedDay, setSelectedDay] = useState<Date>(() => initialDate);

  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedDates, setSelectedDates] = useState<string[]>([]);

  const month = currentDate.getMonth() + 1;
  const year = currentDate.getFullYear();

  const { selectedTeamId, isTeamScopeReady } = useTeam();
  const teamParam = selectedTeamId != null ? { teamId: selectedTeamId } : {};

  // placeholderData: keepPreviousData (Task #758) hält beim Monatswechsel
  // die Daten des vorherigen Monats sichtbar, bis der neue Monat eintrifft —
  // isLoading bleibt dabei false, sodass die Seite NICHT auf den Skeleton-
  // Zweig unten zurückfällt und Grid/Liste montiert bleiben (siehe
  // isTransitioning weiter unten für den dezenten Ladehinweis).
  const { data: shifts, isLoading: shiftsLoading, isFetching: shiftsFetching } = useListShifts(
    { month, year, ...teamParam },
    {
      query: {
        // Erst laden, wenn der Team-Scope settled ist — sonst feuert die
        // Monatsliste doppelt (ohne, dann mit teamId nach der Auto-Auswahl).
        enabled: isTeamScopeReady,
        placeholderData: keepPreviousData,
        staleTime: SHIFT_LIST_STALE_TIME_MS,
        gcTime: SHIFT_LIST_GC_TIME_MS,
      },
    } as unknown as Parameters<typeof useListShifts>[1],
  ) as { data?: Shift[]; isLoading: boolean; isFetching: boolean };
  const queryClient = useQueryClient();

  // Abweichungsmodell: alle Meldungen im Team-Scope, als shiftId → Meldung
  // nachgeschlagen. Kein Monatsfilter — die Route kennt keinen, und das
  // Datenaufkommen bleibt klein (nur tatsächlich gemeldete Abweichungen).
  const { data: deviationReportsData } = useListShiftDeviations(teamParam, {
    query: { enabled: isTeamScopeReady },
  } as unknown as Parameters<typeof useListShiftDeviations>[1]) as {
    data?: ShiftDeviationReport[];
  };
  const deviationReportsByShiftId = useMemo(() => {
    const map = new Map<number, ShiftDeviationReport>();
    for (const report of deviationReportsData ?? []) map.set(report.shiftId, report);
    return map;
  }, [deviationReportsData]);
  // Dienste mit ANGENOMMENER Abweichungsmeldung. Sie bleiben FIX (beide Seiten
  // sind sich einig, eine erneute Bestaetigung waere sinnlos), sollen aber in
  // allen Ansichten als nachtraeglich korrigiert erkennbar sein — per Context
  // statt Prop-Kette, s. corrected-shifts.tsx.
  // Widersprüche gegen Planer-Korrekturen ("Weg A"). Eigene Liste statt eines
  // Feldes am Dienst — dieselbe Bauweise wie beim Abweichungsmodell, damit die
  // Schicht-Abfragen unverändert bleiben.
  const { data: correctionObjectionsData } = useListShiftCorrectionObjections(teamParam, {
    query: { enabled: isTeamScopeReady },
  } as unknown as Parameters<typeof useListShiftCorrectionObjections>[1]) as {
    data?: ShiftCorrectionObjection[];
  };
  const openObjectionsByShiftId = useMemo(() => {
    const map = new Map<number, ShiftCorrectionObjection>();
    for (const o of correctionObjectionsData ?? []) {
      if (o.status === "OPEN") map.set(o.shiftId, o);
    }
    return map;
  }, [correctionObjectionsData]);

  const correctedShiftIds = useMemo(() => {
    const ids = new Set<number>();
    for (const report of deviationReportsData ?? []) {
      if (report.status === "ACCEPTED") ids.add(report.shiftId);
    }
    return ids;
  }, [deviationReportsData]);

  const confirmOwnShiftMutation = useConfirmOwnShift();
  const objectCorrectionMutation = useObjectShiftCorrection();
  const withdrawCorrectionMutation = useWithdrawShiftCorrection();
  const reportDeviationMutation = useReportShiftDeviation();
  const acceptDeviationMutation = useAcceptShiftDeviation();
  const disputeDeviationMutation = useDisputeShiftDeviation();
  const deviationActionPending =
    reportDeviationMutation.isPending ||
    acceptDeviationMutation.isPending ||
    disputeDeviationMutation.isPending;

  // invalidateShiftDerivedQueries invalidiert per Präfix alles unter
  // /api/shifts (Details s. shift-cache.ts) — deckt sowohl die Monatsliste
  // als auch /api/shifts/deviations in einem Rutsch ab, kein separater
  // Invalidierungs-Aufruf für die Meldungsliste nötig.
  async function reportDeviation(shift: Shift, values: DeviationReportValues) {
    try {
      await reportDeviationMutation.mutateAsync({ id: shift.id, data: values });
      void invalidateShiftDerivedQueries(queryClient, { refetchType: "all" });
      toast.success("Abweichung gemeldet — der Planer wird benachrichtigt.");
    } catch (err) {
      if (!navigator.onLine) return;
      toast.error(readableApiError(err, "Melden fehlgeschlagen. Bitte erneut versuchen."));
    }
  }

  async function acceptDeviation(shift: Shift) {
    try {
      const updated = await acceptDeviationMutation.mutateAsync({ id: shift.id });
      // Die Schicht selbst hat sich geändert (Zeiten/Stunden) — Monatsliste
      // und abgeleitete Auswertungen mit aktualisieren, wie bei confirmShift.
      void invalidateShiftDerivedQueries(queryClient, { refetchType: "all" });
      toast.success(
        `Abweichung angenommen — Dienst übernimmt die gemeldete Zeit${
          updated?.reportedAusgefallen ? " (ausgefallen)" : ""
        }.`,
      );
    } catch (err) {
      if (!navigator.onLine) return;
      toast.error(readableApiError(err, "Annehmen fehlgeschlagen. Bitte erneut versuchen."));
    }
  }

  async function disputeDeviation(shift: Shift, reason: string) {
    try {
      await disputeDeviationMutation.mutateAsync({ id: shift.id, data: { reason } });
      void invalidateShiftDerivedQueries(queryClient, { refetchType: "all" });
      toast.success("Widerspruch gesendet — der Planwert bleibt maßgeblich.");
    } catch (err) {
      if (!navigator.onLine) return;
      toast.error(readableApiError(err, "Widersprechen fehlgeschlagen. Bitte erneut versuchen."));
    }
  }

  // Vor-/Folgemonat im Hintergrund vorladen (Task #758): ein Klick auf
  // "Vorheriger/Nächster Monat" findet die Daten dann meist schon im Cache.
  // Abhängigkeiten bewusst nur Primitives (nicht das teamParam-Objekt, das
  // bei jedem Render neu erzeugt wird und den Effekt sonst dauerhaft
  // auslösen würde).
  useEffect(() => {
    // Auch das Vorladen wartet auf den settled Team-Scope — sonst würden die
    // Nachbarmonate zuerst unscoped (und damit doppelt) geladen.
    if (!isTeamScopeReady) return;
    prefetchAdjacentMonthShifts(queryClient, month, year, teamParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient, month, year, selectedTeamId, isTeamScopeReady]);

  const updateShift = useUpdateShift();
  const createShift = useCreateShift();
  const sendProposalsMutation = useSendShiftProposals();
  const bulkConfirmOwnMutation = useBulkConfirmOwnShifts();
  const [confirmingShiftId, setConfirmingShiftId] = useState<number | null>(null);
  const [isBulkConfirming, setIsBulkConfirming] = useState(false);
  const { data: users, isLoading: usersLoading } = useListUsers(
    selectedTeamId != null ? { teamId: selectedTeamId } : undefined,
    {
      query: { enabled: isTeamScopeReady, staleTime: REFERENCE_DATA_STALE_TIME_MS },
    } as unknown as Parameters<typeof useListUsers>[1],
  ) as { data?: User[]; isLoading: boolean };

  const goToMonth = (newDate: Date) => {
    setCurrentDate(newDate);
    setSelectedDay(startOfMonth(newDate));
    clearSelection();
  };
  // Tastatur-Wechsel über die Monatsgrenze (MonthGrid): Zieltag, der nach dem
  // Monatswechsel fokussiert werden soll. Lebt hier, weil MonthGrid während
  // des Ladens des neuen Monats kurz unmountet (Skeleton-Zweig).
  const [monthGridFocusDate, setMonthGridFocusDate] = useState<Date | null>(null);
  const navigateMonthWithFocus = (targetDate: Date) => {
    setMonthGridFocusDate(targetDate);
    goToMonth(targetDate);
  };
  const prevMonth = () => goToMonth(new Date(year, month - 2, 1));
  const nextMonth = () => goToMonth(new Date(year, month, 1));

  useEffect(() => {
    setSelectedDates([]);
    setIsSelectionMode(false);
  }, [selectedTeamId]);

  const start = startOfMonth(currentDate);
  const end = endOfMonth(currentDate);
  const days = eachDayOfInterval({ start, end });

  const assistants: Assistant[] = canPlan
    ? (users ?? []).filter((u) => u.role === "assistant").map((u) => ({ id: u.id, name: u.name }))
    : currentUser
    ? [{ id: currentUser.id, name: currentUser.name }]
    : [];

  const [selectedAssistant, setSelectedAssistant] = useSelectedAssistant(
    assistants,
    // Erst "ready", wenn Team-Scope UND Nutzerliste stehen — sonst würde eine
    // gespeicherte Auswahl gegen die noch leere Liste geprüft und verworfen.
    isTeamScopeReady && !(canPlan && usersLoading),
  );

  // Task #857: Für berechtigte Admins (Premium-Feature wie in Auswertungen)
  // ersetzt das Stundenkonto den einfachen Dropdown-Filter durch eine
  // Mehrfachauswahl. Alle anderen Nutzer sehen weiterhin exakt den
  // bisherigen Einzel-Filter (selectedAssistant oben) — "unverändert" ist
  // hier Teil der Anforderung, kein Zufall.
  const canSeeStundenkonto = isAdmin && hasAccess(currentUser, "advancedAnalytics");
  const {
    selectedUserIds: multiSelectedUserIds,
    toggleUser: toggleStundenkontoUser,
    selectAll: selectAllStundenkonto,
  } = useSelectedUserIds(
    assistants,
    isTeamScopeReady && !(canPlan && usersLoading),
  );
  // Unterhalb von md (<768px, siehe useIsMobile) zeigen wir für
  // canSeeStundenkonto-Admins NUR das klassische Einzel-Dropdown (kein
  // Stundenkonto-Panel/-Reihe, s. contents/md:hidden-Header weiter unten).
  // Der effektive Scope MUSS deshalb dort ebenfalls selectedAssistant folgen
  // — sonst kann eine auf Desktop persistierte Mehrfachauswahl (z. B. "all"
  // oder eine Teilmenge) mobil unsichtbar bleiben, während sie weiterhin
  // Sichtbarkeit UND Versand-Scope bestimmt (Review-Fund: Mobil zeigt eine
  // Person, Request geht trotzdem teamweit raus, oder umgekehrt).
  const isMobileViewport = useIsMobile();
  const effectiveSelectedUserIds: number[] | "all" = canSeeStundenkonto && !isMobileViewport
    ? multiSelectedUserIds
    : selectedAssistant === "all"
    ? "all"
    : [selectedAssistant];
  // Ziel-Scope für "Vorschlag senden": undefined = ganzes Team (kein Filter
  // aktiv). Bei 1+ ausgewählten Personen NIE stillschweigend auf "alle"
  // erweitern — sonst würden auch abgewählte Assistenzkräfte einen
  // Vorschlag erhalten. Der Endpunkt kennt nur "eine Person" oder "alle"
  // (kein Batch-userId-Array); bei Mehrfachauswahl sendet sendProposals()
  // deshalb einen Request pro ausgewählter Person (siehe dort).
  const sendScopeUserIds: number[] | undefined =
    effectiveSelectedUserIds === "all" ? undefined : effectiveSelectedUserIds;

  const [stundenkontoOpenFlag, setStundenkontoOpenFlag] = usePersistentState<"1" | "0">(
    "dienstplan.stundenkontoOpen",
    "1",
    ["1", "0"],
  );
  const stundenkontoOpen = stundenkontoOpenFlag === "1";
  const isWideStundenkontoLayout = useIsWideStundenkontoLayout();

  const { data: hoursBalances, isLoading: hoursBalancesLoading } = useGetHoursBalance(
    { month, year, ...teamParam },
    {
      query: {
        enabled: canSeeStundenkonto && isTeamScopeReady,
        placeholderData: keepPreviousData,
        staleTime: SHIFT_LIST_STALE_TIME_MS,
        gcTime: SHIFT_LIST_GC_TIME_MS,
      },
    } as unknown as Parameters<typeof useGetHoursBalance>[1],
  ) as { data?: HoursBalance[]; isLoading: boolean };

  const { sortMode: stundenkontoSort, toggleSort: toggleStundenkontoSort } =
    useStundenkontoSort();

  // Kostenträger-Budget (Zielvereinbarung) des angezeigten Monats als
  // Kopfzeile des Stundenkontos: zeigt beim Planen, wie viele der mit dem
  // Kostenträger vereinbarten Stunden noch übrig sind. retry:false, weil der
  // Endpunkt im Free-Tarif mit 403 antwortet — die Kopfzeile blendet sich
  // dann einfach aus (gleiche Logik wie die Dashboard-Kachel).
  const { data: hourBudget } = useGetHourBudgetBalance(
    { month, year, ...teamParam },
    {
      query: {
        enabled: canSeeStundenkonto && isTeamScopeReady,
        retry: false,
        placeholderData: keepPreviousData,
        staleTime: SHIFT_LIST_STALE_TIME_MS,
        gcTime: SHIFT_LIST_GC_TIME_MS,
      },
    } as unknown as Parameters<typeof useGetHourBudgetBalance>[1],
  ) as { data?: HourBudgetBalance };

  // Kollisionsarme Farbzuordnung fürs ganze Team: die ersten 8 Personen
  // bekommen garantiert 8 verschiedene Farben (statt reinem ID-Hash).
  // Memo über die ID-Liste, damit der Provider-Wert referenzstabil bleibt.
  const assistantIdsKey = assistants.map((a) => a.id).join(",");
  const personColors = useMemo(
    () =>
      buildPersonColorAssignment(
        assistantIdsKey === "" ? [] : assistantIdsKey.split(",").map(Number),
      ),
    [assistantIdsKey],
  );

  const { data: shiftModels } = useListShiftModels(
    teamParam,
    {
      query: { enabled: isTeamScopeReady, staleTime: REFERENCE_DATA_STALE_TIME_MS },
    } as unknown as Parameters<typeof useListShiftModels>[1],
  ) as { data?: ShiftModel[] };
  const modelMap = new Map<number, ShiftModelInfo>(
    (shiftModels ?? []).map((m) => [m.id, { name: m.name }])
  );

  const allShifts: Shift[] = shifts ?? [];

  // Kapazitäts-Ampel für die Vertretungs-Auswahl im ShiftDialog (Kay-Feedback
  // 28.08.2026): wiederverwendet exakt dieselbe Stundenkonto-Bilanz statt
  // eigener Berechnung — "frei" > 0 heißt noch freie Vertragsstunden diesen
  // Monat. Ohne sichtbares Stundenkonto (canSeeStundenkonto=false) bleiben
  // hoursBalances leer → ShiftDialog zeigt dann einfach keine Punkte an.
  const stundenkontoEintraege = useStundenkontoEintraege(
    assistants,
    allShifts,
    hoursBalances ?? [],
    "name",
  );
  const capacityByUserId = useMemo(
    () =>
      new Map(
        stundenkontoEintraege.map((e) => [e.id, { frei: e.frei, hasContract: e.hasContract }]),
      ),
    [stundenkontoEintraege],
  );

  // Map userId → Set<dayKey "yyyy-MM-dd"> aller Abwesenheitstage im geladenen Monat.
  // Wird ausschließlich in der Tabellenansicht (Zell-Styling + Klick-Sperre) genutzt.
  // Der ShiftDialog führt seinen eigenen monatsgenauen Query aus, damit auch
  // Datumsänderungen auf andere Monate korrekt abgesichert sind.
  const absenceByUser = useMemo(() => {
    const map = new Map<number, Set<string>>();
    for (const s of allShifts) {
      if (!isAbsenceShift(s)) continue;
      const dk = format(new Date(s.startTime), "yyyy-MM-dd");
      let set = map.get(s.userId);
      if (!set) { set = new Set<string>(); map.set(s.userId, set); }
      set.add(dk);
    }
    return map;
  }, [allShifts]);

  const visibleShifts: Shift[] =
    effectiveSelectedUserIds === "all"
      ? allShifts
      : allShifts.filter((s) => effectiveSelectedUserIds.includes(s.userId));
  const tableAssistants: Assistant[] =
    effectiveSelectedUserIds === "all"
      ? assistants
      : assistants.filter((a) => effectiveSelectedUserIds.includes(a.id));
  const isLoading = !isTeamScopeReady || shiftsLoading || (canPlan && usersLoading);
  // Dezenter Hinweis auf einen Hintergrund-Reload (Platzhalterdaten aus
  // keepPreviousData sind sichtbar, z. B. kurz nach einem Monatswechsel) —
  // KEIN Ersatz für isLoading: Grid/Liste bleiben voll bedienbar, nur
  // optisch leicht abgedunkelt (siehe Content-Wrapper weiter unten).
  const isTransitioning = shiftsFetching && !isLoading;

  function openCreate(date: Date, userId?: number) {
    if (!canPlan) return;
    if (forwardLimit !== null && monthsAhead(date, new Date()) > forwardLimit) {
      toast.error(
        "Im Free-Tarif nur bis nächsten Monat planbar. Für eine längere Vorausplanung auf Premium upgraden.",
        {
          action: { label: "Zu Premium", onClick: () => navigate("/preise") },
        },
      );
      return;
    }
    // Kein neuer Dienst für eine abwesende Assistenzkraft.
    if (userId != null) {
      const dk = format(date, "yyyy-MM-dd");
      if (absenceByUser.get(userId)?.has(dk)) {
        const found = assistants.find((a) => a.id === userId);
        const first = found?.name.trim().split(/\s+/)[0];
        toast.info(
          first
            ? `${first} ist an diesem Tag abwesend.`
            : "Diese Assistenzkraft ist an diesem Tag abwesend.",
        );
        return;
      }
    }
    setDialog({ mode: "create", date, userId });
  }

  function openEdit(shift: Shift) {
    if (!canPlan) return;
    // Aushilfe-Spiegel ist im Ziel-Team schreibgeschützt.
    if (isMirrorShift(shift, selectedTeamId)) {
      toast.info(
        `Aushilfe-Einsatz aus ${shift.homeTeamName ?? "einem anderen Team"} — bearbeiten im Stammteam.`,
      );
      return;
    }
    setDialog({ mode: "edit", shift });
  }

  async function confirmShift(shift: Shift) {
    if (!canPlan || confirmingShiftId !== null) return;
    setConfirmingShiftId(shift.id);
    try {
      const updated = await updateShift.mutateAsync({
        id: shift.id,
        data: { planningStatus: "FIX", force: true } as { planningStatus: "FIX" },
      });
      // Sofort reagieren: den bestätigten Dienst direkt in die geladenen
      // Listen schreiben statt auf den kompletten Monats-Reload zu warten;
      // der Abgleich abgeleiteter Daten (Salden, Dashboard) läuft im
      // Hintergrund. Macht das Bestätigen vieler Dienste nacheinander
      // spürbar schneller (ein Roundtrip statt zwei je Dienst).
      upsertShiftsInCache(queryClient, [{ ...shift, ...updated }], selectedTeamId);
      void invalidateShiftDerivedQueries(queryClient);
      toast.success("Dienst bestätigt — zählt jetzt in Auswertungen und Stundennachweis.");
    } catch {
      if (!navigator.onLine) return; // Banner erklärt den Grund bereits.
      toast.error("Bestätigen fehlgeschlagen. Bitte erneut versuchen.");
    } finally {
      setConfirmingShiftId(null);
    }
  }

  // Vertretung aktivieren: legt mit den Original-Zeiten/-Dienstart des gerade
  // ersetzten Arbeitsdienstes einen neuen Dienst für die vorgemerkte
  // Vertretung an (ein Klick aus dem Toast in handleVertretungsVorschlag).
  async function activateVertretung(vorschlag: VertretungsVorschlag) {
    try {
      const created = await createShift.mutateAsync({
        data: {
          userId: vorschlag.userId,
          teamId: vorschlag.teamId,
          startTime: vorschlag.startTime,
          endTime: vorschlag.endTime,
          type: vorschlag.type as ShiftInputType,
          shiftModelId: vorschlag.shiftModelId ?? undefined,
          isVertretung: true,
          planningStatus: "FIX",
        },
      });
      upsertShiftsInCache(queryClient, [created], selectedTeamId);
      void invalidateShiftDerivedQueries(queryClient);
      toast.success(`Vertretung für ${vorschlag.userName} eingetragen.`);
    } catch {
      toast.error("Vertretung konnte nicht eingetragen werden. Bitte im Dienstplan manuell anlegen.");
    }
  }

  // Vorschlag anzeigen: ein Klick im Toast übernimmt Zeiten + Dienstart 1:1.
  function handleVertretungsVorschlag(vorschlag: VertretungsVorschlag) {
    toast(`Vertretung: ${vorschlag.userName} für diesen Dienst eintragen?`, {
      action: {
        label: "Eintragen",
        onClick: () => void activateVertretung(vorschlag),
      },
      duration: 15000,
    });
  }

  // Sendbare Entwürfe (VORLAEUFIG) — Basis für "Vorschlag senden".
  // Aushilfe-Spiegel werden im Ziel-Team NICHT mitversendet.
  const sendableShifts = allShifts.filter(
    (s) =>
      s.planningStatus === "VORLAEUFIG" &&
      s.type !== "vacation" &&
      s.type !== "sick" &&
      !isMirrorShift(s, selectedTeamId),
  );
  // Auf den aktiven Scope eingeschränkt — treibt Button-Zähler, Dialogtext
  // UND den tatsächlichen Versand (siehe sendProposals()), damit nie mehr
  // Personen benachrichtigt werden als in der Auswahl sichtbar sind.
  const scopedSendableShifts =
    sendScopeUserIds === undefined
      ? sendableShifts
      : sendableShifts.filter((s) => sendScopeUserIds.includes(s.userId));

  // Für die Assistenzkraft: eigene ANGEBOTEN-Dienste des aktuellen Monats.
  const myAngebotenShifts = !isAdmin
    ? allShifts.filter(
        (s) =>
          s.planningStatus === "ANGEBOTEN" &&
          s.userId === currentUser?.id &&
          !isMirrorShift(s, selectedTeamId),
      )
    : [];

  // Kay-Feedback 28.08.2026: Vorschlag und Korrektur sind zwei verschiedene
  // Vorgänge und gehören getrennt. Ein VORSCHLAG betrifft einen noch nicht
  // gearbeiteten Dienst — Zustimmung zur Planung. Eine KORREKTUR betrifft
  // einen bereits vergangenen Dienst, den der Planer nachträglich geändert
  // hat (er fällt dabei auf ANGEBOTEN zurück, s. faelltZurueck in
  // shifts-crud.ts) — Zustimmung zu einer geänderten Arbeitszeit, also eine
  // arbeitszeitrechtlich ganz andere Aussage. Deshalb zwei Banner statt einem
  // Sammel-Hinweis, und beide mit Einzelbestätigung.
  const myKorrekturShifts = myAngebotenShifts.filter((s) => isPastCorrection(s));
  const myVorschlagShifts = myAngebotenShifts.filter((s) => !isPastCorrection(s));
  // Die drei Pruef-Listen der Tagesleiste. Sie werden HIER berechnet, weil nur
  // die Seite Rolle, Team-Kontext und die Abweichungs-Meldungen kennt; die
  // Liste filtert damit nur noch.
  const meldungShiftIds = useMemo(() => {
    const ids = new Set<number>();
    for (const report of deviationReportsData ?? []) {
      if (report.status === "PENDING") ids.add(report.shiftId);
    }
    return ids;
  }, [deviationReportsData]);
  const korrekturIdKey = myKorrekturShifts.map((s) => s.id).join(",");
  const vorschlagIdKey = myVorschlagShifts.map((s) => s.id).join(",");
  const pruefListen = useMemo(
    () => ({
      korrekturen: new Set(myKorrekturShifts.map((s) => s.id)),
      vorschlaege: new Set(myVorschlagShifts.map((s) => s.id)),
      // Nur der Planer handelt auf Meldungen und Widersprüchen — bei der
      // Assistenzkraft bliebe der Filter sonst als leerer Eintrag im Menü.
      meldungen: canPlan ? meldungShiftIds : new Set<number>(),
      widersprueche: canPlan ? new Set(openObjectionsByShiftId.keys()) : new Set<number>(),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [korrekturIdKey, vorschlagIdKey, meldungShiftIds, openObjectionsByShiftId, canPlan],
  );

  // Sprungziel der Tagesleiste. nonce statt boolean, damit derselbe Filter
  // erneut greift, wenn der Nutzer zwischendurch von Hand umgestellt hat.
  const [focusFilter, setFocusFilter] = useState<
    { type: "korrekturen" | "vorschlaege" | "meldungen" | "widersprueche"; nonce: number } | null
  >(null);
  const focusPruefliste = (
    type: "korrekturen" | "vorschlaege" | "meldungen" | "widersprueche",
  ) =>
    setFocusFilter((prev) => ({ type, nonce: (prev?.nonce ?? 0) + 1 }));

  // Dashboard verlinkt mit ?fokus=... direkt in die gefilterte Tagesleiste,
  // damit "Korrektur pruefen" nicht nur den Monat oeffnet, sondern sofort die
  // betroffenen Tageszeilen zeigt (Kay-Feedback 28.08.2026).
  const fokusParam = searchParams.get("fokus");
  useEffect(() => {
    if (
      fokusParam === "korrekturen" ||
      fokusParam === "vorschlaege" ||
      fokusParam === "meldungen" ||
      fokusParam === "widersprueche"
    ) {
      focusPruefliste(fokusParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fokusParam]);

  async function sendProposals() {
    if (!isAdmin || isBulkConfirming) return;
    if (scopedSendableShifts.length === 0) {
      closeDialog();
      return;
    }
    setIsBulkConfirming(true);
    try {
      let totalUpdated = 0;
      let totalEmailsSent = 0;
      let anyFailed = false;
      const succeededUserIds = new Set<number>();
      // Bei Mehrfachauswahl EIN Request mit allen ausgewählten Personen
      // (userIds) statt einem Request pro Person — niemals mit
      // userId/userIds=undefined ("alle") senden, sonst erhielten auch
      // abgewählte Assistenzkräfte einen Vorschlag.
      try {
        const result = await sendProposalsMutation.mutateAsync({
          data: {
            month,
            year,
            teamId: selectedTeamId ?? undefined,
            userIds: sendScopeUserIds === undefined ? undefined : [...sendScopeUserIds],
          },
        });
        totalUpdated += result.updated;
        totalEmailsSent += result.emailsSent;
        for (const s of scopedSendableShifts) succeededUserIds.add(s.userId);
      } catch {
        anyFailed = true;
      }
      // Sofort reagieren: nur die tatsächlich erfolgreich versendeten
      // Entwürfe im Cache auf "Vorschlag" stellen; der vollständige
      // Abgleich läuft im Hintergrund, statt den Dialog bis zum
      // Monats-Reload blockiert zu halten.
      upsertShiftsInCache(
        queryClient,
        scopedSendableShifts
          .filter((s) => succeededUserIds.has(s.userId))
          .map((s) => ({ ...s, planningStatus: "ANGEBOTEN" })),
        selectedTeamId,
      );
      void invalidateShiftDerivedQueries(queryClient);
      closeDialog();
      if (!navigator.onLine) return;
      if (anyFailed) {
        toast.error(
          totalUpdated > 0
            ? `${totalUpdated} ${totalUpdated === 1 ? "Dienst" : "Dienste"} versendet, ein Teil ist fehlgeschlagen. Bitte erneut versuchen.`
            : "Versenden fehlgeschlagen. Bitte erneut versuchen.",
        );
      } else if (totalUpdated === 0) {
        toast.info("Keine Entwürfe zum Versenden gefunden.");
      } else if (totalEmailsSent === 0) {
        toast.success(
          `${totalUpdated} ${totalUpdated === 1 ? "Dienst" : "Dienste"} auf „Vorschlag" gesetzt. E-Mail-Versand nicht konfiguriert.`,
        );
      } else {
        toast.success(
          `Vorschlag versendet — ${totalEmailsSent} ${totalEmailsSent === 1 ? "Assistenzkraft" : "Assistenzkräfte"} per E-Mail benachrichtigt.`,
        );
      }
    } catch {
      if (!navigator.onLine) return;
      toast.error("Versenden fehlgeschlagen. Bitte erneut versuchen.");
    } finally {
      setIsBulkConfirming(false);
    }
  }

  /**
   * Assistenzkraft bestätigt EINEN eigenen Dienst (Vorschlag oder Korrektur).
   * Eigene Route statt PATCH /shifts/:id — die ist planerpflichtig, weshalb
   * die Einzelbestätigung für Assistenzkräfte bisher gar nicht möglich war
   * (nur "Alle bestätigen"). Kay-Feedback 28.08.2026.
   */
  async function confirmOwnShift(shift: Shift) {
    if (confirmingShiftId !== null) return;
    setConfirmingShiftId(shift.id);
    try {
      await confirmOwnShiftMutation.mutateAsync({ id: shift.id });
      const bestaetigt = { ...shift, planningStatus: "FIX" as const };
      upsertShiftsInCache(queryClient, [bestaetigt], selectedTeamId);
      void invalidateShiftDerivedQueries(queryClient);
      toast.success(
        isPastCorrection(shift)
          ? "Korrektur bestätigt — die geänderte Zeit zählt jetzt in Auswertungen und Stundennachweis."
          : "Dienst bestätigt — zählt jetzt in Auswertungen und Stundennachweis.",
      );
    } catch (err) {
      if (!navigator.onLine) return;
      toast.error(readableApiError(err, "Bestätigen fehlgeschlagen. Bitte erneut versuchen."));
    } finally {
      setConfirmingShiftId(null);
    }
  }

  /** Assistenzkraft widerspricht einer nachträglichen Änderung des Planers. */
  async function objectCorrection(shift: Shift, reason: string) {
    try {
      await objectCorrectionMutation.mutateAsync({ id: shift.id, data: { reason } });
      await invalidateShiftDerivedQueries(queryClient, { refetchType: "all" });
      toast.success("Widerspruch gesendet — der Arbeitgeber wurde informiert.");
    } catch (err) {
      if (!navigator.onLine) return;
      toast.error(readableApiError(err, "Widerspruch fehlgeschlagen. Bitte erneut versuchen."));
    }
  }

  /** Planer nimmt eine bestrittene Korrektur zurück (alter Wert gilt wieder). */
  async function withdrawCorrection(shift: Shift) {
    try {
      await withdrawCorrectionMutation.mutateAsync({ id: shift.id });
      await invalidateShiftDerivedQueries(queryClient, { refetchType: "all" });
      toast.success("Korrektur zurückgenommen — der Stand vor der Änderung gilt wieder.");
    } catch (err) {
      if (!navigator.onLine) return;
      toast.error(readableApiError(err, "Zurücknehmen fehlgeschlagen. Bitte erneut versuchen."));
    }
  }

  async function confirmOwnProposals() {
    if (myAngebotenShifts.length === 0) return;
    try {
      const result = await bulkConfirmOwnMutation.mutateAsync({
        data: { month, year, teamId: selectedTeamId ?? undefined },
      });
      // Sofort reagieren: die eigenen Vorschläge im Cache auf "FIX" stellen;
      // der vollständige Abgleich (Salden, Dashboard) läuft im Hintergrund.
      upsertShiftsInCache(
        queryClient,
        myAngebotenShifts.map((s) => ({ ...s, planningStatus: "FIX" })),
        selectedTeamId,
      );
      void invalidateShiftDerivedQueries(queryClient);
      const { confirmed } = result;
      toast.success(
        confirmed === 1
          ? "1 Dienst bestätigt — zählt jetzt in Auswertungen und Stundennachweis."
          : `${confirmed} Dienste bestätigt — zählen jetzt in Auswertungen und Stundennachweis.`,
      );
    } catch {
      if (!navigator.onLine) return;
      toast.error("Bestätigen fehlgeschlagen. Bitte erneut versuchen.");
    }
  }

  function closeDialog() {
    setDialog({ mode: "closed" });
  }

  function toggleSelectionMode() {
    setIsSelectionMode((prev) => {
      if (prev) setSelectedDates([]);
      return !prev;
    });
  }

  function toggleDate(day: Date) {
    const key = format(day, "yyyy-MM-dd");
    setSelectedDates((prev) =>
      prev.includes(key) ? prev.filter((d) => d !== key) : [...prev, key],
    );
  }

  function clearSelection() {
    setSelectedDates([]);
    setIsSelectionMode(false);
  }

  const canBasicExport = hasAccess(currentUser, "basicExport");
  const [isExporting, setIsExporting] = useState(false);

  async function handleSimpleExport() {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const exportUsers =
        effectiveSelectedUserIds === "all"
          ? assistants
          : assistants.filter((a) => effectiveSelectedUserIds.includes(a.id));
      const namePart =
        exportUsers.length === 1
          ? exportUsers[0].name.replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "")
          : "Alle";
      const exported = await exportSimpleMonthPdf({
        // Aushilfe-Spiegel nicht mitexportieren: die Stunden gehören ins
        // Monats-PDF des Stammteams (sonst doppelt).
        shifts: visibleShifts.filter((s) => !isMirrorShift(s, selectedTeamId)),
        users: exportUsers,
        month,
        year,
        monthLabel: format(currentDate, "MMMM yyyy", { locale: de }),
        teamId: selectedTeamId,
        filename: `Monatsuebersicht_${namePart}_${year}_${String(month).padStart(2, "0")}.pdf`,
      });
      if (!exported) {
        toast.error("Keine bestätigten Dienste oder Abwesenheiten in diesem Monat.");
      }
    } catch (err) {
      if (!navigator.onLine) return; // Banner erklärt den Grund bereits.
      toast.error("PDF-Export fehlgeschlagen.");
      console.error(err);
    } finally {
      setIsExporting(false);
    }
  }

  const header = (
    <DienstplanHeader
      isAdmin={isAdmin}
      canPlan={canPlan}
      assistants={assistants}
      selectedAssistant={selectedAssistant}
      onSelectAssistant={setSelectedAssistant}
      mobileView={mobileView}
      onMobileView={setMobileView}
      desktopView={desktopView}
      onDesktopView={setDesktopView}
      confirmableCount={scopedSendableShifts.length}
      isBulkConfirming={isBulkConfirming}
      onConfirmAll={() => setDialog({ mode: "send-proposals" })}
      canBasicExport={canBasicExport}
      isExporting={isExporting}
      onExport={handleSimpleExport}
      canBulkEdit={canBulkEdit}
      isSelectionMode={isSelectionMode}
      onToggleSelection={toggleSelectionMode}
      month={month}
      year={year}
      onMonthSelect={(m, y) => goToMonth(new Date(y, m - 1, 1))}
      onPrevMonth={prevMonth}
      onNextMonth={nextMonth}
      pillMinimiert={pillMinimiert}
      onTogglePillMinimiert={() => setPillMinimiertFlag(pillMinimiert ? "0" : "1")}
      canSeeStundenkonto={canSeeStundenkonto}
      stundenkontoOpen={stundenkontoOpen}
      onToggleStundenkonto={() => setStundenkontoOpenFlag(stundenkontoOpen ? "0" : "1")}
    />
  );

  if (isLoading) {
    return (
      <PersonColorsContext.Provider value={personColors}>
        <div className="flex flex-col gap-3 animate-in fade-in duration-300">
          {header}
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        </div>
      </PersonColorsContext.Provider>
    );
  }

  const forwardPlanningBlocked =
    canPlan && forwardLimit !== null && monthsAhead(currentDate, new Date()) > forwardLimit;

  return (
    <PersonColorsContext.Provider value={personColors}>
    <CorrectedShiftsProvider shiftIds={correctedShiftIds}>
    <div className="flex flex-col gap-3 animate-in fade-in duration-300">
      {header}

      {forwardPlanningBlocked && (
        <PlanLimitBanner>
          Im Free-Tarif nur bis nächsten Monat planbar. Für eine längere Vorausplanung ist ein
          Upgrade auf Premium nötig.
        </PlanLimitBanner>
      )}

      {/* Assistenz-Banner 1: KORREKTUREN. Bewusst zuerst und farblich getrennt
          von den Vorschlägen — hier geht es um bereits gearbeitete Dienste,
          deren Zeit der Planer nachträglich geändert hat. Das ist die
          arbeitszeitrechtlich bedeutsamere Zustimmung und darf nicht mit
          gewöhnlicher Planung in einem Topf landen (Kay-Feedback 28.08.2026).
          Kein Sammel-Knopf: jede Korrektur wird einzeln in der Tagesleiste
          bestätigt, damit niemand geänderte Zeiten unbesehen abnickt. */}
      {!isAdmin && myKorrekturShifts.length > 0 && (
        <div className="flex flex-col gap-3 rounded-lg border border-[#e2c88a] bg-[#fdf7e8] px-4 py-3 text-[#7a5406] sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2">
            <StatusBadge kind="correction" compact className="mt-0.5" />
            <span className="text-sm font-medium">
              {myKorrekturShifts.length === 1
                ? "1 Korrektur wartet auf deine Bestätigung."
                : `${myKorrekturShifts.length} Korrekturen warten auf deine Bestätigung.`}
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 self-start border-[#e2c88a] bg-white text-[#7a5406] hover:bg-[#fdf3dc] sm:self-auto"
            data-testid="korrekturen-anzeigen"
            onClick={() => focusPruefliste("korrekturen")}
          >
            {myKorrekturShifts.length === 1 ? "Korrektur anzeigen" : "Korrekturen anzeigen"}
          </Button>
        </div>
      )}

      {/* Assistenz-Banner 2: echte Dienstvorschläge (noch nicht gearbeitet).
          Sammelbestätigung bleibt hier erhalten — bei reiner Vorausplanung ist
          sie eine Erleichterung, keine Gefahr. Einzeln geht jetzt zusätzlich
          über die Tagesleiste. */}
      {!isAdmin && myVorschlagShifts.length > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3">
          <div className="flex items-center gap-2 text-sky-900">
            <Check className="h-4 w-4 shrink-0 text-sky-600" />
            <span className="text-sm font-medium">
              {myVorschlagShifts.length === 1
                ? "1 Dienstvorschlag wartet auf Ihre Bestätigung."
                : `${myVorschlagShifts.length} Dienstvorschläge warten auf Ihre Bestätigung.`}
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 border-sky-300 bg-white text-sky-900 hover:bg-sky-100"
            disabled={bulkConfirmOwnMutation.isPending}
            onClick={() => void confirmOwnProposals()}
          >
            {bulkConfirmOwnMutation.isPending ? "Wird bestätigt …" : "Alle bestätigen"}
          </Button>
        </div>
      )}

      <div className="flex flex-col md:hidden" data-testid="dienstplan-mobile">
        {canSeeStundenkonto && (
          <div className="mb-3 rounded-lg border bg-card" data-testid="stundenkonto-reihe-wrapper-mobile">
            <StundenkontoReihe
              balances={hoursBalances}
              assistants={assistants}
              shifts={allShifts}
              selectedUserIds={multiSelectedUserIds}
              onToggleUser={toggleStundenkontoUser}
              onSelectAll={selectAllStundenkonto}
              isLoading={hoursBalancesLoading}
              budget={hourBudget}
              sortMode={stundenkontoSort}
              onToggleSort={toggleStundenkontoSort}
              minimal
            />
          </div>
        )}
        <div className={`w-full transition-opacity duration-150 ${isTransitioning ? "opacity-60" : ""}`}>
        {/* Grilling 26.08.2026, Punkt 6: „Liste" blendet das Monatsraster
            komplett aus — übrig bleibt die vereinheitlichte Wochen-Liste
            (siehe unten), die dadurch die einzige Ansicht ist. Kein
            separates AgendaView mehr an dieser Stelle (Dopplung entfernt). */}
        {mobileView === "grid" && (
          <MonthGrid
            days={days}
            monthStart={start}
            shifts={visibleShifts}
            modelMap={modelMap}
            selectedDay={selectedDay}
            onSelectDay={setSelectedDay}
            onAddShift={(day) => openCreate(day)}
            onShiftClick={openEdit}
            onConfirmShift={confirmShift}
            canEdit={canPlan}
            selectionMode={isSelectionMode}
            selectedDates={selectedDates}
            onToggleDate={toggleDate}
            onNavigateMonth={navigateMonthWithFocus}
            focusDate={monthGridFocusDate}
            onFocusDateHandled={() => setMonthGridFocusDate(null)}
            variant="collapsed"
            onCollapsedDayActivate={scrollToAgendaDay}
          />
        )}
        </div>
      </div>

      <div className="hidden flex-col md:flex" data-testid="dienstplan-desktop">
        {/* Task #857: unterhalb der Panel-Breite (< 1100px) steht das
            Stundenkonto als horizontale Reihe über dem Kalender, statt
            seitlich daneben — auf Tablet-Breite wäre neben dem Kalender
            kein Platz mehr fürs Panel. */}
        {canSeeStundenkonto && !isWideStundenkontoLayout && (
          <div className="mb-3 rounded-lg border bg-card" data-testid="stundenkonto-reihe-wrapper">
            <StundenkontoReihe
              balances={hoursBalances}
              assistants={assistants}
              shifts={allShifts}
              selectedUserIds={multiSelectedUserIds}
              onToggleUser={toggleStundenkontoUser}
              onSelectAll={selectAllStundenkonto}
              isLoading={hoursBalancesLoading}
              budget={hourBudget}
              sortMode={stundenkontoSort}
              onToggleSort={toggleStundenkontoSort}
            />
          </div>
        )}
        <div className={`flex w-full items-start gap-4 transition-opacity duration-150 ${isTransitioning ? "opacity-60" : ""}`}>
        <div className="min-w-0 flex-1">
        {desktopView === "grid" ? (
          <MonthGrid
            days={days}
            monthStart={start}
            shifts={visibleShifts}
            modelMap={modelMap}
            selectedDay={selectedDay}
            onSelectDay={setSelectedDay}
            onAddShift={(day) => openCreate(day)}
            onShiftClick={openEdit}
            onConfirmShift={confirmShift}
            canEdit={canPlan}
            selectionMode={isSelectionMode}
            selectedDates={selectedDates}
            onToggleDate={toggleDate}
            onNavigateMonth={navigateMonthWithFocus}
            focusDate={monthGridFocusDate}
            onFocusDateHandled={() => setMonthGridFocusDate(null)}
            pillMinimiert={pillMinimiert}
          />
        ) : (
          <DienstplanTableView
            days={days}
            year={year}
            month={month}
            tableAssistants={tableAssistants}
            allShifts={allShifts}
            isAdmin={canPlan}
            isSelectionMode={isSelectionMode}
            selectedDates={selectedDates}
            toggleDate={toggleDate}
            openCreate={openCreate}
            openEdit={openEdit}
            onConfirmShift={confirmShift}
            modelMap={modelMap}
            personColors={personColors}
            onPrevMonth={prevMonth}
            onNextMonth={nextMonth}
            absenceByUser={absenceByUser}
            selectedDay={selectedDay}
            onSelectDay={setSelectedDay}
          />
        )}
        </div>
        {/* ≥1100px: Panel oder eingeklappte Registerkarte neben dem
            Kalender/der Tabelle (sibling, nicht in MonthGrid verschachtelt —
            siehe monthgrid-content-based-rows.md: Kalenderzeilen bleiben
            content-basiert, keine gekoppelte Höhe zu einer Nachbarspalte). */}
        {canSeeStundenkonto && isWideStundenkontoLayout && (
          stundenkontoOpen ? (
            <div className="shrink-0" data-testid="stundenkonto-panel-wrapper">
              <StundenkontoPanel
                balances={hoursBalances}
                assistants={assistants}
                shifts={allShifts}
                selectedUserIds={multiSelectedUserIds}
                onToggleUser={toggleStundenkontoUser}
                onSelectAll={selectAllStundenkonto}
                isLoading={hoursBalancesLoading}
                budget={hourBudget}
                sortMode={stundenkontoSort}
                onToggleSort={toggleStundenkontoSort}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setStundenkontoOpenFlag("1")}
              title="Stundenkonto einblenden"
              aria-label="Stundenkonto einblenden"
              data-testid="stundenkonto-collapsed-tab"
              className="flex min-h-[220px] w-7 shrink-0 flex-col items-center justify-between rounded-lg border bg-card py-2 text-muted-foreground transition-colors hover:bg-muted"
            >
              <ChevronsLeft className="h-3.5 w-3.5" aria-hidden="true" />
              <span
                className="text-[11px] font-medium tracking-wide"
                style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
              >
                Stundenkonto
              </span>
              <div className="flex flex-col items-center gap-1" aria-hidden="true">
                {assistants.slice(0, 6).map((a) => (
                  <span key={a.id} className={`h-1.5 w-1.5 rounded-full ${userDotClass(a.id, personColors)}`} />
                ))}
              </div>
            </button>
          )
        )}
        </div>
      </div>

      {/* ── Vereinheitlichte Wochen-Liste (Grilling 26.08.2026) ─────────────
           EINE Instanz für Monats-, Tabellen- UND Listenansicht, Desktop wie
           Mobil — ersetzt sowohl das frühere, nur im Kalender eingebettete
           Tagesdetail-Panel als auch die zwei separaten, ungefilterten
           „persistenten" Wochenlisten. Sitzt bewusst außerhalb von
           dienstplan-mobile/-desktop (volle Breite, wie zuvor die
           persistenten Listen) — dadurch existiert `agenda-day-<Datum>` nur
           noch EIN einziges Mal im DOM statt bisher dreifach. ── */}
      <ScheduleList
        month={month}
        year={year}
        currentMonthShifts={visibleShifts}
        effectiveSelectedUserIds={effectiveSelectedUserIds}
        modelMap={modelMap}
        selectedDay={selectedDay}
        teamParam={teamParam}
        isTeamScopeReady={isTeamScopeReady}
        onDayClick={(day) => openCreate(day)}
        onShiftClick={openEdit}
        onConfirmShift={confirmShift}
            onConfirmOwnShift={confirmOwnShift}
            correctionObjections={openObjectionsByShiftId}
            onObjectCorrection={objectCorrection}
            onWithdrawCorrection={canPlan ? withdrawCorrection : undefined}
            pruefListen={pruefListen}
            focusFilter={focusFilter}
        deviationReports={deviationReportsByShiftId}
        onReportDeviation={reportDeviation}
        onAcceptDeviation={canPlan ? acceptDeviation : undefined}
        onDisputeDeviation={canPlan ? disputeDeviation : undefined}
        deviationActionPending={deviationActionPending}
        canEdit={canPlan}
        selectionMode={isSelectionMode}
        selectedDates={selectedDates}
        onToggleDate={toggleDate}
        onPrevMonth={prevMonth}
        onNextMonth={nextMonth}
      />

      {canPlan && assistants.length > 0 && (
        <TeamAbsenceOverview
          shifts={allShifts}
          assistants={assistants}
          onShiftClick={openEdit}
          canEdit={canPlan}
        />
      )}

      {canPlan && isSelectionMode && selectedDates.length > 0 && createPortal(
        <div
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex w-max max-w-[calc(100vw-1rem)] flex-wrap items-center justify-center gap-2 rounded-2xl border border-border bg-card px-4 py-2.5 shadow-lg md:rounded-full"
          data-testid="bulk-action-bar"
        >
          <span
            className="w-full text-center text-sm font-medium sm:w-auto sm:text-left"
            data-testid="bulk-selected-count"
          >
            {selectedDates.length} {selectedDates.length === 1 ? "Tag" : "Tage"} ausgewählt
          </span>
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => setDialog({ mode: "bulk-create", dates: selectedDates })}
            data-testid="bulk-create-open"
          >
            <CalendarPlus className="h-4 w-4" />
            Schichten eintragen
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="gap-1.5"
            onClick={() => setDialog({ mode: "bulk-edit", dates: selectedDates })}
            data-testid="bulk-edit-open"
          >
            <Pencil className="h-4 w-4" />
            Einträge ändern
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="gap-1.5"
            onClick={() => setDialog({ mode: "bulk-delete", dates: selectedDates })}
            data-testid="bulk-delete-open"
          >
            <Trash2 className="h-4 w-4" />
            Einträge löschen
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5"
            onClick={clearSelection}
            data-testid="bulk-cancel"
          >
            <X className="h-4 w-4" />
            Abbrechen
          </Button>
        </div>,
        document.body,
      )}

      {canPlan && (
        <ShiftDialog
          open={dialog.mode === "create" || dialog.mode === "edit" || dialog.mode === "bulk-create"}
          onClose={closeDialog}
          preselectedDate={dialog.mode === "create" ? dialog.date : undefined}
          preselectedUserId={dialog.mode === "create" ? dialog.userId : undefined}
          editShift={dialog.mode === "edit" ? dialog.shift : undefined}
          bulkDates={dialog.mode === "bulk-create" ? dialog.dates : undefined}
          onSaved={() => {
            clearSelection();
            closeDialog();
          }}
          onVertretungsVorschlag={handleVertretungsVorschlag}
          assistants={assistants}
          capacityByUserId={capacityByUserId}
          month={month}
          year={year}
          teamId={selectedTeamId}
        />
      )}

      {canPlan && (
        <BulkEditDialog
          open={dialog.mode === "bulk-edit"}
          onClose={closeDialog}
          dates={dialog.mode === "bulk-edit" ? dialog.dates : []}
          shifts={allShifts.filter((s) => !isMirrorShift(s, selectedTeamId))}
          assistants={assistants}
          shiftModels={shiftModels ?? []}
          month={month}
          year={year}
          onSaved={() => {
            clearSelection();
            closeDialog();
          }}
        />
      )}

      {isAdmin && (
        <AlertDialog
          open={dialog.mode === "send-proposals"}
          onOpenChange={(open) => {
            if (!open && !isBulkConfirming) closeDialog();
          }}
        >
          <AlertDialogContent data-testid="confirm-all-dialog">
            <AlertDialogHeader>
              <AlertDialogTitle>Vorschlag versenden?</AlertDialogTitle>
              <AlertDialogDescription data-testid="confirm-all-description">
                {sendScopeUserIds !== undefined
                  ? scopedSendableShifts.length === 1
                    ? `1 Entwurf der ausgewählten Assistenzkraft in ${format(currentDate, "MMMM yyyy", { locale: de })} wird auf „Vorschlag" gesetzt und per E-Mail versandt.`
                    : `${scopedSendableShifts.length} Entwürfe der ausgewählten Assistenzkräfte in ${format(currentDate, "MMMM yyyy", { locale: de })} werden auf „Vorschlag" gesetzt — jede erhält eine E-Mail mit ihren Diensten.`
                  : scopedSendableShifts.length === 1
                  ? `1 Entwurf in ${format(currentDate, "MMMM yyyy", { locale: de })} wird auf „Vorschlag" gesetzt — die Assistenzkraft erhält eine E-Mail.`
                  : `${scopedSendableShifts.length} Entwürfe in ${format(currentDate, "MMMM yyyy", { locale: de })} werden auf „Vorschlag" gesetzt — jede Assistenzkraft erhält eine E-Mail mit ihren Diensten.`}{" "}
                Die Assistenzkräfte können danach in ihrem Konto bestätigen.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isBulkConfirming} data-testid="confirm-all-cancel">
                Abbrechen
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={isBulkConfirming}
                onClick={(e) => {
                  e.preventDefault();
                  void sendProposals();
                }}
                data-testid="confirm-all-submit"
              >
                {isBulkConfirming ? "Wird versendet …" : "Jetzt versenden"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {canPlan && (
        <BulkDeleteDialog
          open={dialog.mode === "bulk-delete"}
          onClose={closeDialog}
          dates={dialog.mode === "bulk-delete" ? dialog.dates : []}
          shifts={allShifts.filter((s) => !isMirrorShift(s, selectedTeamId))}
          assistants={assistants}
          onDeleted={() => {
            clearSelection();
            closeDialog();
          }}
        />
      )}
    </div>
    </CorrectedShiftsProvider>
    </PersonColorsContext.Provider>
  );
}
