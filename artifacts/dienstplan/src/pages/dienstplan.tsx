import { isAdminRole } from "@/lib/roles";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams, useLocation } from "wouter";
import {
  useListShifts,
  useListUsers,
  useListShiftModels,
  useCreateShift,
  useDeleteShift,
  useUpdateShift,
  useSendShiftProposals,
  useBulkConfirmOwnShifts,
  useGetHoursBalance,
  useListShiftDeviations,
  useListShiftSwapRequests,
  useRequestShiftSwap,
  useResolveShiftSwapRequest,
  useConfirmOwnShift,
  useListShiftChanges,
  useReportShiftDeviation,
  useAcceptShiftDeviation,
  useDisputeShiftDeviation,
  useGetHourBudgetBalance,
  type ShiftInputType,
  type ShiftInput,
  type User,
  type ShiftModel,
  type HoursBalance,
  type HourBudgetBalance,
  type ShiftDeviationReport,
  type ShiftSwapRequest,
} from "@workspace/api-client-react";
import { useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, isValid } from "date-fns";
import { de } from "date-fns/locale";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Check, X, CalendarPlus, Trash2, Pencil, ChevronsLeft } from "lucide-react";
import { ShiftDialog } from "@/components/shift-dialog";
import { useVertretungAktivieren } from "@/lib/vertretung-aktivieren";
import { BulkDeleteDialog } from "@/components/bulk-delete-dialog";
import { AutoplanungDialog } from "@/components/autoplanung-dialog";
import {
  PlanungsmodusLeiste,
  RUHEZEIT_REGELFALL,
  type PlanungsGrenzen,
} from "@/components/planungsmodus-leiste";
import {
  planeMonat,
  offenErklaerung,
  naechsteBesetzung,
  dienstZeiten,
  type PlanDienst,
} from "@/lib/planungslauf";
import { offenePlaetzeFuerTag, schichtenNachTag } from "@/lib/dienstgeruest";
import {
  useGetAllowanceSettings,
  useUpdateAllowanceSettings,
  useBulkCreateShifts,
  useBulkDeleteShifts,
} from "@workspace/api-client-react";
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
  removeShiftsFromCache,
  invalidateShiftDerivedQueries,
  invalidateArbeitsdienstSalden,
  naechsteTempId,
  type CachedShiftRow,
} from "@/lib/shift-cache";
import {
  istSeitherKorrigiert,
  type LetzteAenderung,
} from "@workspace/shift-defaults/deviation-rules";
import {
  type DialogState,
  isAbsenceShift,
  isMirrorShift,
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
import type { GeruestDienst } from "@/lib/dienstgeruest";
import {
  DienstplanDnd,
  type DragEndEvent as DndDragEndEvent,
  type DragStartEvent as DndDragStartEvent,
  type PersonZug,
  type ZugZiel,
} from "@/components/dienstplan-dnd";
import type { DeviationReportValues } from "./deviation-dialog";
import { readableApiError } from "@/lib/api-error";
import { ApiError } from "@workspace/api-client-react";
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
  // JÜNGSTE Meldung je Dienst. Seit dem 28.08.2026 kann ein Dienst mehrere
  // Meldungen haben — nach jeder erneuten Planer-Korrektur öffnet sich der
  // Kanal wieder. Ohne die id-Prüfung gewönne hier eine zufällige alte Zeile.
  const deviationReportsByShiftId = useMemo(() => {
    const map = new Map<number, ShiftDeviationReport>();
    for (const report of deviationReportsData ?? []) {
      const vorhanden = map.get(report.shiftId);
      if (!vorhanden || report.id > vorhanden.id) map.set(report.shiftId, report);
    }
    return map;
  }, [deviationReportsData]);

  // Tauschwuensche (Kay 30.08.2026), gleiche Bauart wie die Abweichungen:
  // team-gescopte Liste, im Frontend als shiftId → Anfrage nachgeschlagen.
  // Die Route liefert einer Assistenzkraft nur ihre EIGENEN Anfragen — der
  // Grund ist oft privat.
  const { data: swapRequestsData } = useListShiftSwapRequests(teamParam, {
    query: { enabled: isTeamScopeReady },
  } as unknown as Parameters<typeof useListShiftSwapRequests>[1]) as {
    data?: ShiftSwapRequest[];
  };
  // JUENGSTE Anfrage je Dienst: Ein abgelehnter Wunsch schliesst einen
  // spaeteren neuen nicht aus (zweiter Termin), also kann es mehrere geben.
  const swapRequestsByShiftId = useMemo(() => {
    const map = new Map<number, ShiftSwapRequest>();
    for (const request of swapRequestsData ?? []) {
      const vorhanden = map.get(request.shiftId);
      if (!vorhanden || request.id > vorhanden.id) map.set(request.shiftId, request);
    }
    return map;
  }, [swapRequestsData]);
  // Dienste mit ANGENOMMENER Abweichungsmeldung. Sie bleiben FIX (beide Seiten
  // sind sich einig, eine erneute Bestaetigung waere sinnlos), sollen aber in
  // allen Ansichten als nachtraeglich korrigiert erkennbar sein — per Context
  // statt Prop-Kette, s. corrected-shifts.tsx.
  // Letzte Aenderung je Dienst. Seit Korrekturen sofort gelten (28.08.2026),
  // taugt der Planungsstatus nicht mehr als Erkennungsmerkmal — der Dienst
  // bleibt bestaetigt. Diese Liste ist die neue Quelle.
  const { data: shiftChangesData } = useListShiftChanges(teamParam, {
    query: { enabled: isTeamScopeReady },
  } as unknown as Parameters<typeof useListShiftChanges>[1]) as {
    data?: { shiftId: number; changeSource: string; createdAt: string }[];
  };

  /** Alle nachtraeglich geaenderten Dienste — bekommen das Korrektur-Symbol. */
  const correctedShiftIds = useMemo(() => {
    // NUR vergangene Dienste tragen das Korrektur-Kennzeichen. Ein künftiger,
    // vom Planer geänderter Dienst fällt auf "Vorschlag" zurück und wird dort
    // bestätigt — er ist eine Planänderung, keine Korrektur einer geleisteten
    // Zeit. Ohne diesen Filter stand an ihm "bestätigt · korrigiert" samt
    // Uhr-Symbol, aber ohne Melde-Knopf (Kay-Test 28.08.2026, 31. August).
    const vergangeneIds = new Set(
      (shifts ?? [])
        .filter((sh) => new Date(sh.endTime).getTime() < Date.now())
        .map((sh) => sh.id),
    );
    const ids = new Set<number>();
    for (const c of shiftChangesData ?? []) {
      if (vergangeneIds.has(c.shiftId)) ids.add(c.shiftId);
    }
    // Bestandsdaten aus der Zeit vor /shifts/changes: eine angenommene
    // Abweichung ist ebenfalls eine Korrektur.
    for (const report of deviationReportsData ?? []) {
      if (report.status === "ACCEPTED" && vergangeneIds.has(report.shiftId)) {
        ids.add(report.shiftId);
      }
    }
    return ids;
  }, [shifts, shiftChangesData, deviationReportsData]);

  /**
   * Dienste, bei denen die Assistenzkraft ERNEUT melden darf: Die letzte
   * Meldung ist abgeschlossen (angenommen oder abgelehnt), und der Planer hat
   * den Dienst DANACH nochmals geändert — ein neuer Sachverhalt. Spiegelt
   * exakt die Serverregel in shifts-deviations.ts; ohne diese Menge bliebe der
   * Knopf verschwunden, weil noch eine (alte) Meldung am Dienst hängt.
   */
  const meldungWiederMoeglichShiftIds = useMemo(() => {
    // Entscheidung faellt in der GEMEINSAMEN Regel
    // (@workspace/shift-defaults/deviation-rules) — dieselbe Funktion, die der
    // Server beim POST anwendet. Vorher stand die Regel hier ein zweites Mal
    // und lief auseinander (Kay-Test 28.08.2026, Punkt 4).
    // /api/shifts/changes liefert bereits genau eine Zeile je Dienst (die
    // juengste), deshalb ist die Map hier schon "die letzte Aenderung".
    const letzteAenderung = new Map<number, LetzteAenderung>();
    for (const c of shiftChangesData ?? []) {
      letzteAenderung.set(c.shiftId, {
        changeSource: c.changeSource,
        createdAt: c.createdAt,
      });
    }
    const ids = new Set<number>();
    for (const [shiftId, report] of deviationReportsByShiftId) {
      if (report.status === "PENDING") continue;
      if (istSeitherKorrigiert(report, letzteAenderung.get(shiftId))) ids.add(shiftId);
    }
    return ids;
  }, [shiftChangesData, deviationReportsByShiftId]);

  /** Vom PLANER zuletzt geaenderte Dienste — nur hier ist Widerspruch moeglich. */
  const plannerCorrectedShiftIds = useMemo(() => {
    const ids = new Set<number>();
    for (const c of shiftChangesData ?? []) {
      if (c.changeSource === "planner_edit" && correctedShiftIds.has(c.shiftId)) {
        ids.add(c.shiftId);
      }
    }
    return ids;
  }, [shiftChangesData, correctedShiftIds]);

  const confirmOwnShiftMutation = useConfirmOwnShift();
  const reportDeviationMutation = useReportShiftDeviation();
  const acceptDeviationMutation = useAcceptShiftDeviation();
  const disputeDeviationMutation = useDisputeShiftDeviation();
  const deviationActionPending =
    reportDeviationMutation.isPending ||
    acceptDeviationMutation.isPending ||
    disputeDeviationMutation.isPending;

  const requestSwapMutation = useRequestShiftSwap();
  const resolveSwapMutation = useResolveShiftSwapRequest();
  const swapActionPending = requestSwapMutation.isPending || resolveSwapMutation.isPending;

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

  // Tauschwunsch stellen (Assistenzkraft). invalidateShiftDerivedQueries
  // deckt per Praefix auch /api/shifts/swap-requests ab — kein zweiter
  // Invalidierungs-Aufruf noetig (s. shift-cache.ts).
  async function requestSwap(shift: Shift, reason: string) {
    try {
      await requestSwapMutation.mutateAsync({ id: shift.id, data: { reason } });
      void invalidateShiftDerivedQueries(queryClient, { refetchType: "all" });
      toast.success("Tausch angefragt — die Planung meldet sich.");
    } catch (err) {
      if (!navigator.onLine) return;
      toast.error(readableApiError(err, "Anfrage fehlgeschlagen. Bitte erneut versuchen."));
    }
  }

  // Tauschwunsch erledigen (Planer). Der Dienst selbst wird hier NICHT
  // angefasst — umbesetzt wird wie immer ueber den Dienst-Dialog; dieser
  // Klick hakt nur die Anfrage ab.
  async function resolveSwap(
    shift: Shift,
    resolution: "REASSIGNED" | "DECLINED",
    note?: string,
  ) {
    try {
      await resolveSwapMutation.mutateAsync({ id: shift.id, data: { resolution, note } });
      void invalidateShiftDerivedQueries(queryClient, { refetchType: "all" });
      toast.success(
        resolution === "REASSIGNED"
          ? "Tauschwunsch als erledigt abgehakt."
          : "Tauschwunsch abgelehnt — die Assistenzkraft sieht deine Antwort.",
      );
    } catch (err) {
      if (!navigator.onLine) return;
      toast.error(readableApiError(err, "Aktion fehlgeschlagen. Bitte erneut versuchen."));
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
  // Drag-and-Drop (Baustein 2): Anlegen auf offenem Platz, Ersetzen auf
  // besetzter Pille — beides mit Rueckgaengig direkt im Hinweis.
  const createShiftPerDnd = useCreateShift();
  const deleteShiftPerDnd = useDeleteShift();
  // Automatische Planung: anlegen je Person, abraeumen beim Neu-Wuerfeln.
  const bulkCreateShifts = useBulkCreateShifts();
  const bulkDeleteShifts = useBulkDeleteShifts();
  const { frageVertretung: handleVertretungsVorschlag } = useVertretungAktivieren();
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
  // Automatische Planung (Baustein 3): reines UI-Gate — der Assistent nutzt
  // nur Endpunkte, die ein Planer ohnehin aufrufen darf (POST /shifts/bulk).
  const canAutoPlan = canPlan && hasAccess(currentUser, "autoScheduling");
  const [autoplanungOpen, setAutoplanungOpen] = useState(false);

  // ── Planungsmodus (Etappe 2, Kay 02.09.2026) ─────────────────────────────
  // Der Modus muss sichtbar sein: In ihm dreht ein Klick auf die Pille die
  // Person weiter, statt den Bearbeiten-Dialog zu oeffnen. Ohne sichtbaren
  // Zustand waere jeder Fehlklick eine stille Umbesetzung.
  const [planungsmodus, setPlanungsmodus] = useState(false);
  const [automatikLaeuft, setAutomatikLaeuft] = useState(false);
  // Was der letzte Automatiklauf angelegt hat — Grundlage fuer „Neu wuerfeln"
  // und „Rueckgaengig" im Hinweis. Nur diese Entwuerfe fasst das Wuerfeln an;
  // was der Planer danach von Hand geaendert oder bestaetigt hat, bleibt.
  const letzterLaufIds = useRef<number[]>([]);
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

  // ── Dienstgeruest (Kay-Entscheidung 01.09.2026) ───────────────────────────
  // Die Dienste, die am Regelplan teilnehmen — daraus berechnet das
  // Monatsraster je Tag die noch offenen Plaetze. Reine Anzeige: es entstehen
  // dabei keine Schichten, PDF-Export, Stundenliste und Auswertung sehen davon
  // nichts. Sortierreihenfolge zaehlt: Frueh/Spaet/Nacht sollen an jedem Tag
  // in derselben Ordnung untereinander stehen.
  const geruestDienste = useMemo<GeruestDienst[]>(
    () =>
      (shiftModels ?? [])
        .filter((m) => m.isActive && m.imRegelplan)
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((m) => ({
          id: m.id,
          name: m.name,
          defaultStartTime: m.defaultStartTime,
          defaultEndTime: m.defaultEndTime,
          defaultWeekdays: m.defaultWeekdays ?? [],
          isActive: m.isActive,
          imRegelplan: m.imRegelplan,
          validFrom: m.validFrom ?? null,
          standbySlot: m.standbySlot,
        })),
    [shiftModels],
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
  // Noch freie Vertragsstunden je Person — die Zahl, die im Stundenkonto
  // rechts neben dem Raster steht. Kay-Fehlermeldung 03.09.2026: Die
  // automatische Planung soll nach BEDARF verteilen, nicht stur reihum, und
  // niemanden mehr einteilen, dessen Monat schon erfuellt ist. Personen ohne
  // hinterlegte Vertragsstunden stehen bewusst NICHT in der Map — ihr Bedarf
  // ist unbekannt (der Lauf behandelt sie dann gesondert).
  const freieStundenByUserId = useMemo(() => {
    const map = new Map<number, number>();
    for (const e of stundenkontoEintraege) {
      if (e.hasContract) map.set(e.id, e.frei);
    }
    return map;
  }, [stundenkontoEintraege]);

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

  // Abwesenheiten als ZEITFENSTER (Kays Punkt 3, 03.09.2026). Die Tages-Map
  // oben sperrt den Kalendertag; sie sieht aber nicht, dass ein
  // 24-Stunden-Dienst vom Vortag bis in den Urlaubstag hineinreicht. Der
  // Planungslauf prueft deshalb zusaetzlich gegen diese Fenster.
  const sperrzeitenByUser = useMemo(() => {
    const map = new Map<number, { start: Date; ende: Date }[]>();
    for (const s of allShifts) {
      if (!isAbsenceShift(s)) continue;
      const liste = map.get(s.userId) ?? [];
      liste.push({ start: new Date(s.startTime), ende: new Date(s.endTime) });
      map.set(s.userId, liste);
    }
    return map;
  }, [allShifts]);

  // ── Grenzen der automatischen Planung (am Team gespeichert) ─────────────
  const { data: planungsSettings } = useGetAllowanceSettings(
    selectedTeamId != null ? { teamId: selectedTeamId } : undefined,
    { query: { staleTime: REFERENCE_DATA_STALE_TIME_MS, enabled: canAutoPlan } } as unknown as
      Parameters<typeof useGetAllowanceSettings>[1],
  ) as { data?: { planungBlockLaenge?: number; planungRuhezeitStunden?: number } };
  const updateAllowanceSettings = useUpdateAllowanceSettings();
  // Lokaler Entwurf der Grenzen: Das Zahnrad tippt hier hinein, gespeichert
  // wird erst beim Zuklappen — sonst ginge je Tastendruck ein Request raus.
  const [grenzenEntwurf, setGrenzenEntwurf] = useState<PlanungsGrenzen | null>(null);
  const grenzen: PlanungsGrenzen = grenzenEntwurf ?? {
    blockLaenge: planungsSettings?.planungBlockLaenge ?? 1,
    ruhezeitStunden: planungsSettings?.planungRuhezeitStunden ?? RUHEZEIT_REGELFALL,
  };

  async function speichereGrenzen() {
    if (!grenzenEntwurf) return;
    const aktuell = planungsSettings as Record<string, unknown> | undefined;
    if (!aktuell) return;
    try {
      // PUT ist ein Voll-Ersetzen: die fuenf Zuschlagsfelder sind Pflicht und
      // muessen unveraendert mitgehen, sonst 400.
      await updateAllowanceSettings.mutateAsync({
        data: {
          nightPercent: aktuell.nightPercent as number,
          nightStart: aktuell.nightStart as string,
          nightEnd: aktuell.nightEnd as string,
          sundayPercent: aktuell.sundayPercent as number,
          holidayPercent: aktuell.holidayPercent as number,
          planungBlockLaenge: grenzenEntwurf.blockLaenge,
          planungRuhezeitStunden: grenzenEntwurf.ruhezeitStunden,
        },
        params: selectedTeamId != null ? { teamId: selectedTeamId } : undefined,
      } as unknown as Parameters<typeof updateAllowanceSettings.mutateAsync>[0]);
      setGrenzenEntwurf(null);
      void queryClient.invalidateQueries({
        predicate: (q) => q.queryKey[0] === "/api/allowance-settings",
      });
    } catch (err) {
      toast.error(readableApiError(err, "Grenzen konnten nicht gespeichert werden."));
    }
  }

  /** Die Regelplan-Dienste in der Form, die der Planungslauf braucht. */
  const planDienste: PlanDienst[] = useMemo(
    () =>
      geruestDienste.map((d) => ({
        id: d.id,
        name: d.name,
        startTime: d.defaultStartTime,
        endTime: d.defaultEndTime,
        standbySlot: d.standbySlot,
      })),
    [geruestDienste],
  );

  /**
   * Fuehrt einen Planungslauf aus und legt das Ergebnis als Entwuerfe an.
   *
   * `nurLuecken=false` (Neu wuerfeln) raeumt vorher die Entwuerfe des letzten
   * Laufs ab — und NUR die. Was der Planer danach von Hand geaendert oder
   * bestaetigt hat, bleibt stehen; ein Wuerfeln, das eigene Arbeit wegwirft,
   * waere keine Hilfe.
   */
  async function starteAutomatik(nurLuecken = true): Promise<void> {
    if (automatikLaeuft || !canAutoPlan) return;
    if (planDienste.length === 0) {
      toast.info(
        "Kein Dienst nimmt am Regelplan teil. Unter Einstellungen bei einem Dienst „Im Regelplan\u201c einschalten.",
      );
      return;
    }
    setAutomatikLaeuft(true);
    try {
      let basis = allShifts;
      if (!nurLuecken && letzterLaufIds.current.length > 0) {
        const wegIds = new Set(letzterLaufIds.current);
        // Sofort aus dem Raster nehmen, dann loeschen (Echtzeit-Regel).
        removeShiftsFromCache(queryClient, wegIds);
        basis = allShifts.filter((sh) => !wegIds.has(sh.id));
        try {
          await bulkDeleteShifts.mutateAsync({ data: { ids: [...wegIds] } });
        } catch {
          toast.error("Die alten Entwürfe ließen sich nicht abräumen.");
          void invalidateShiftDerivedQueries(queryClient);
          setAutomatikLaeuft(false);
          return;
        }
        letzterLaufIds.current = [];
      }

      // Offene Tage je Dienst — dieselbe Ableitung wie die Platzhalter im
      // Raster, damit Vorschau und Anzeige nie auseinanderlaufen. Ab heute,
      // nicht rueckwirkend: vergangene Luecken nachtraeglich mit Entwuerfen
      // zu fuellen erzeugt nur Aufraeumarbeit.
      const heute = format(new Date(), "yyyy-MM-dd");
      const echteSchichten = basis.filter((sh) => !isAbsenceShift(sh));
      const proTag = schichtenNachTag(
        echteSchichten as { shiftModelId?: number | null; startTime: string }[],
      );
      const offeneTageJeDienst = new Map<number, string[]>();
      for (const dienst of geruestDienste) {
        const tage: string[] = [];
        for (const tag of days) {
          const key = format(tag, "yyyy-MM-dd");
          if (key < heute) continue;
          if (offenePlaetzeFuerTag([dienst], tag, proTag.get(key) ?? []).length > 0) {
            tage.push(key);
          }
        }
        offeneTageJeDienst.set(dienst.id, tage);
      }
      const offeneGesamt = [...offeneTageJeDienst.values()].reduce((n, l) => n + l.length, 0);
      if (offeneGesamt === 0) {
        // Kay-Variante 1: Auch wenn nichts zu fuellen ist, steht das Wuerfeln
        // hier — sonst gaebe es keinen Weg dorthin, wenn der Monat voll ist.
        toast.info("Alles besetzt — es sind keine Plätze offen.", {
          action:
            letzterLaufIds.current.length > 0
              ? { label: "Neu würfeln", onClick: () => void starteAutomatik(false) }
              : undefined,
        });
        return;
      }

      const { besetzungen, offen } = planeMonat({
        dienste: planDienste,
        offeneTageJeDienst,
        personen: assistants.map((a) => ({ id: a.id, name: a.name })),
        grenzen: { blockLaenge: grenzen.blockLaenge, ruhezeitStunden: grenzen.ruhezeitStunden },
        bestehende: echteSchichten,
        abwesend: absenceByUser,
        sperrzeiten: sperrzeitenByUser,
        freieStunden: freieStundenByUserId,
      });
      if (besetzungen.length === 0) {
        toast.info(
          `Niemand konnte eingeteilt werden — ${offen.length} Plätze bleiben offen (${offenErklaerung(offen) ?? "kein Grund ermittelbar"}).`,
        );
        return;
      }

      // Sofort anzeigen, dann anlegen (Echtzeit-Regel, s. shift-cache.ts).
      const proPerson = new Map<number, typeof besetzungen>();
      for (const b of besetzungen) {
        const liste = proPerson.get(b.userId) ?? [];
        liste.push(b);
        proPerson.set(b.userId, liste);
      }
      const tempIds = new Map<number, number[]>();
      const vorlaeufig = besetzungen.map((b) => {
        const tempId = naechsteTempId();
        tempIds.set(b.userId, [...(tempIds.get(b.userId) ?? []), tempId]);
        return {
          id: tempId,
          userId: b.userId,
          type: "work",
          startTime: b.start.toISOString(),
          endTime: b.ende.toISOString(),
          planningStatus: "VORLAEUFIG",
          shiftModelId: b.dienstId,
          user: { name: b.userName },
          standbyUserId: b.standbyUserId,
          standbyUserName: b.standbyUserName,
          istVorlaeufig: true,
        } as unknown as CachedShiftRow;
      });
      upsertShiftsInCache(queryClient, vorlaeufig, selectedTeamId);

      // Ein Auftrag je Person. Meldet der Server eine Ueberschneidung, legt er
      // GAR NICHTS an — die Person waere dann im ganzen Monat leer, und genau
      // so entstanden Kays unbesetzte Tage (Fehlermeldung 03.09.2026, Punkt 1).
      // Deshalb einmal nachfassen: die vom Server benannten Tage weglassen und
      // den Rest anlegen. Nur EIN Nachfassversuch — ein zweiter Konflikt haette
      // eine andere Ursache und gehoert gemeldet, nicht wegprobiert.
      async function legeAn(userId: number, liste: typeof besetzungen) {
        const auftrag = (teile: typeof besetzungen) => ({
          data: {
            userId,
            type: "work" as const,
            days: teile.map((b) => ({
              startTime: b.start.toISOString(),
              endTime: b.ende.toISOString(),
              standbyUserId: b.standbyUserId,
            })),
            planningStatus: "VORLAEUFIG" as const,
            shiftModelId: teile[0]!.dienstId,
            ...(selectedTeamId != null ? { teamId: selectedTeamId } : {}),
          },
        });
        try {
          return await bulkCreateShifts.mutateAsync(
            auftrag(liste) as unknown as Parameters<typeof bulkCreateShifts.mutateAsync>[0],
          );
        } catch (err) {
          const konflikte =
            err instanceof ApiError &&
            err.status === 409 &&
            (err.data as { code?: string } | null)?.code === "shift_overlap"
              ? ((err.data as { conflictDates?: string[] }).conflictDates ?? [])
              : [];
          if (konflikte.length === 0) throw err;
          // Der Server schluesselt die Tage nach UTC-Startdatum.
          const weg = new Set(konflikte);
          const rest = liste.filter((b) => !weg.has(b.start.toISOString().slice(0, 10)));
          if (rest.length === 0) throw err;
          uebersprungen += liste.length - rest.length;
          return await bulkCreateShifts.mutateAsync(
            auftrag(rest) as unknown as Parameters<typeof bulkCreateShifts.mutateAsync>[0],
          );
        }
      }

      const auftraege = [...proPerson.entries()];
      let uebersprungen = 0;
      const ergebnisse = await Promise.allSettled(
        auftraege.map(([userId, liste]) => legeAn(userId, liste)),
      );

      const neueIds: number[] = [];
      const fehler: string[] = [];
      let angelegt = 0;
      for (const [i, ergebnis] of ergebnisse.entries()) {
        const [userId, liste] = auftraege[i]!;
        removeShiftsFromCache(queryClient, tempIds.get(userId) ?? []);
        if (ergebnis.status === "fulfilled") {
          const { shifts: neu, teamId: zielTeam } = ergebnis.value;
          upsertShiftsInCache(queryClient, neu as CachedShiftRow[], zielTeam);
          for (const sh of neu) neueIds.push(sh.id);
          angelegt += neu.length;
        } else {
          const vorname = liste[0]!.userName.trim().split(/\s+/)[0];
          fehler.push(`${vorname}: ${readableApiError(ergebnis.reason, "fehlgeschlagen")}`);
        }
      }
      void invalidateArbeitsdienstSalden(queryClient);
      letzterLaufIds.current = neueIds;

      if (fehler.length > 0) {
        toast.error(`${angelegt} Dienste angelegt, ${fehler.length} fehlgeschlagen: ${fehler.join(" · ")}`);
        return;
      }
      // Variante 1 (Kays Wahl): Der Hinweis traegt beide Folge-Aktionen —
      // dann steht das Wuerfeln genau im Moment der Entscheidung, ohne ein
      // zweites Symbol in der Leiste.
      toast.success(
        `${angelegt} Dienste als Entwurf eingeplant${offen.length > 0 ? `, ${offen.length} Plätze bleiben offen (${offenErklaerung(offen) ?? "kein Grund ermittelbar"})` : ""}${uebersprungen > 0 ? `, ${uebersprungen} Tage übersprungen (Überschneidung)` : ""}.`,
        {
          duration: 8000,
          action: { label: "Neu würfeln", onClick: () => void starteAutomatik(false) },
          cancel: {
            label: "Rückgängig",
            onClick: () => {
              removeShiftsFromCache(queryClient, neueIds);
              letzterLaufIds.current = [];
              void bulkDeleteShifts
                .mutateAsync({ data: { ids: neueIds } })
                .then(() => void invalidateArbeitsdienstSalden(queryClient))
                .catch(() => {
                  toast.error("Rückgängig fehlgeschlagen.");
                  void invalidateShiftDerivedQueries(queryClient);
                });
            },
          },
        },
      );
    } finally {
      setAutomatikLaeuft(false);
    }
  }

  /**
   * Klick auf eine Pille im Planungsmodus: naechste Person im Rundlauf.
   * Uebersprungen wird, wer an dem Tag nicht kann (Kays Wahl) — so klickt man
   * sich nie in eine Besetzung, die der Server danach abweist.
   */
  async function rotierePille(shift: Shift): Promise<void> {
    if (!canPlan || isMirrorShift(shift, selectedTeamId)) return;
    const datum = format(new Date(shift.startTime), "yyyy-MM-dd");
    const start = new Date(shift.startTime);
    const ende = new Date(shift.endTime);

    const einsatzfaehig = (userId: number): boolean => {
      if (absenceByUser.get(userId)?.has(datum)) return false;
      for (const s of allShifts) {
        if (s.id === shift.id || s.userId !== userId || isAbsenceShift(s)) continue;
        const sStart = new Date(s.startTime);
        const sEnde = new Date(s.endTime);
        if (format(sStart, "yyyy-MM-dd") === datum) return false;
        if (sStart < ende && start < sEnde) return false;
        const abstand =
          sEnde <= start ? start.getTime() - sEnde.getTime() : sStart.getTime() - ende.getTime();
        if (abstand < grenzen.ruhezeitStunden * 60 * 60 * 1000) return false;
      }
      return true;
    };

    const naechste = naechsteBesetzung({
      aktuelleUserId: shift.userId,
      kandidaten: assistants.map((a) => ({ id: a.id, name: a.name })),
      istEinsatzfaehig: einsatzfaehig,
    });

    if (naechste === null) {
      // Rundlauf zu Ende: Platz leeren. Im Regelplan taucht dort danach
      // wieder die ausgegraute Platzhalter-Pille auf.
      removeShiftsFromCache(queryClient, [shift.id]);
      try {
        await deleteShiftPerDnd.mutateAsync({ id: shift.id });
        void invalidateArbeitsdienstSalden(queryClient);
      } catch (err) {
        upsertShiftsInCache(queryClient, [shift as unknown as CachedShiftRow], selectedTeamId);
        toast.error(readableApiError(err, "Platz leeren fehlgeschlagen."));
      }
      return;
    }

    upsertShiftsInCache(
      queryClient,
      [{ ...shift, userId: naechste.id, user: { name: naechste.name } } as unknown as CachedShiftRow],
      selectedTeamId,
    );
    try {
      const aktualisiert = await updateShift.mutateAsync({
        id: shift.id,
        data: { userId: naechste.id } as { userId: number },
      });
      upsertShiftsInCache(queryClient, [aktualisiert], selectedTeamId);
      void invalidateArbeitsdienstSalden(queryClient);
    } catch (err) {
      upsertShiftsInCache(queryClient, [shift as unknown as CachedShiftRow], selectedTeamId);
      toast.error(readableApiError(err, "Wechsel fehlgeschlagen."));
    }
  }

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

  function openCreate(date: Date, userId?: number, shiftModelId?: number) {
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
    setDialog({ mode: "create", date, userId, shiftModelId });
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

  // ── Drag-and-Drop (Baustein 2, Kay-Entscheidung 01.09.2026) ──────────────
  // Eine Zeitkonto-Pille wird auf das Raster gezogen. Zwei Zielarten:
  //   offener Platz  -> Dienst als ENTWURF anlegen (Zeiten des Platzes),
  //   besetzte Pille -> die gezogene Person uebernimmt den Dienst.
  // Beide Wege haben ein Rueckgaengig direkt im Hinweis — Ersetzen ist damit
  // gefahrlos, obwohl keine Nachfrage dazwischen liegt (Kay: lieber fluessig
  // arbeiten und im Zweifel zurueknoepfen als jedes Mal bestaetigen).
  const [gezogenePerson, setGezogenePerson] = useState<PersonZug | null>(null);

  function dndAbwesendGemeldet(userId: number, datum: string, name: string): boolean {
    if (!absenceByUser.get(userId)?.has(datum)) return false;
    const vorname = name.trim().split(/\s+/)[0];
    toast.info(`${vorname} ist an diesem Tag abwesend.`);
    return true;
  }

  async function handleDndDrop(event: DndDragEndEvent) {
    const person = gezogenePerson;
    setGezogenePerson(null);
    const ziel = event.over?.data.current as ZugZiel | undefined;
    if (!person || !ziel || !canPlan) return;

    if (ziel.art === "platz") {
      // Dieselben Wachposten wie openCreate: Vorausplanungs-Limit + Abwesenheit.
      const zielTag = new Date(`${ziel.datum}T00:00:00`);
      if (forwardLimit !== null && monthsAhead(zielTag, new Date()) > forwardLimit) {
        toast.error(
          "Im Free-Tarif nur bis nächsten Monat planbar. Für eine längere Vorausplanung auf Premium upgraden.",
          { action: { label: "Zu Premium", onClick: () => navigate("/preise") } },
        );
        return;
      }
      if (dndAbwesendGemeldet(person.userId, ziel.datum, person.name)) return;

      // Zeiten des Platzes: Ende gleich Start = 24h-Dienst, Ende vor Start =
      // Tagesuebergang — identisch zur Logik des Dienst-Dialogs (buildTimes).
      const start = new Date(`${ziel.datum}T${ziel.startTime}:00`);
      const ende = new Date(`${ziel.datum}T${ziel.endTime}:00`);
      if (ziel.endTime <= ziel.startTime) ende.setDate(ende.getDate() + 1);
      // Sofort anzeigen (Kay-Vorgabe 01.09.2026): Die Pille steht im Raster,
      // BEVOR der Server gefragt wird — bei ~1 s Latenz war das vorher eine
      // volle Sekunde Warten auf ein Ergebnis, das schon feststand.
      const tempId = naechsteTempId();
      upsertShiftsInCache(
        queryClient,
        [
          {
            id: tempId,
            userId: person.userId,
            type: "work",
            startTime: start.toISOString(),
            endTime: ende.toISOString(),
            planningStatus: "VORLAEUFIG",
            shiftModelId: ziel.dienstId,
            user: { name: person.name },
            istVorlaeufig: true,
          } as unknown as CachedShiftRow,
        ],
        selectedTeamId,
      );
      try {
        const created = await createShiftPerDnd.mutateAsync({
          data: {
            userId: person.userId,
            startTime: start.toISOString(),
            endTime: ende.toISOString(),
            type: "work",
            planningStatus: "VORLAEUFIG",
            shiftModelId: ziel.dienstId,
            ...(selectedTeamId != null ? { teamId: selectedTeamId } : {}),
          } as ShiftInput,
        });
        // Vorlaeufige Zeile gegen die echte tauschen.
        removeShiftsFromCache(queryClient, [tempId]);
        upsertShiftsInCache(queryClient, [created], selectedTeamId);
        void invalidateArbeitsdienstSalden(queryClient);
        const vorname = person.name.trim().split(/\s+/)[0];
        toast.success(`${vorname} eingeplant — als Entwurf.`, {
          action: {
            label: "Rückgängig",
            onClick: () => {
              // Auch hier sofort: erst aus dem Raster nehmen, dann loeschen.
              removeShiftsFromCache(queryClient, [created.id]);
              void deleteShiftPerDnd
                .mutateAsync({ id: created.id })
                .then(() => void invalidateArbeitsdienstSalden(queryClient))
                .catch(() => {
                  // Fehlgeschlagen: die Zeile gehoert zurueck ins Raster.
                  upsertShiftsInCache(queryClient, [created], selectedTeamId);
                  toast.error("Rückgängig fehlgeschlagen. Bitte erneut versuchen.");
                });
            },
          },
        });
      } catch (err) {
        // Zuruecknehmen, was wir vorgegriffen haben.
        removeShiftsFromCache(queryClient, [tempId]);
        if (!navigator.onLine) return;
        toast.error(
          readableApiError(err, "Einplanen fehlgeschlagen. Bitte erneut versuchen."),
        );
      }
      return;
    }

    const shift = allShifts.find((sh) => sh.id === ziel.shiftId);
    if (!shift) return;
    if (isMirrorShift(shift, selectedTeamId)) {
      toast.info(
        `Aushilfe-Einsatz aus ${shift.homeTeamName ?? "einem anderen Team"} — bearbeiten im Stammteam.`,
      );
      return;
    }
    const datum = format(new Date(shift.startTime), "yyyy-MM-dd");

    // ── Vertretung VORMERKEN (Ziel: die Vertretungszeile) ─────────────────
    // Fachlich etwas ganz anderes als das Ersetzen: Der Dienst bleibt bei
    // seiner Person, die gezogene Kraft wird nur fuer den Ausfall-Fall
    // vorgemerkt. Deshalb greift hier auch KEINE Abwesenheitspruefung fuer
    // den Tag — eine Vormerkung ist eine Planungshilfe, kein Einsatz.
    if (ziel.art === "vertretung") {
      if (shift.userId === person.userId) {
        toast.info("Diese Person hat den Dienst bereits — als eigene Vertretung ergibt das nichts.");
        return;
      }
      if (shift.standbyUserId === person.userId) return; // schon vorgemerkt
      const vorherStandbyId = shift.standbyUserId ?? null;
      const vorherStandbyName = shift.standbyUserName ?? null;
      upsertShiftsInCache(
        queryClient,
        [
          {
            ...shift,
            standbyUserId: person.userId,
            standbyUserName: person.name,
          } as unknown as CachedShiftRow,
        ],
        selectedTeamId,
      );
      try {
        const updated = await updateShift.mutateAsync({
          id: shift.id,
          data: { standbyUserId: person.userId } as { standbyUserId: number },
        });
        upsertShiftsInCache(queryClient, [updated], selectedTeamId);
        const vorname = person.name.trim().split(/\s+/)[0];
        toast.success(`${vorname} als Vertretung vorgemerkt.`, {
          action: {
            label: "Rückgängig",
            onClick: () => {
              upsertShiftsInCache(
                queryClient,
                [
                  {
                    ...shift,
                    standbyUserId: vorherStandbyId,
                    standbyUserName: vorherStandbyName,
                  } as unknown as CachedShiftRow,
                ],
                selectedTeamId,
              );
              void updateShift
                .mutateAsync({
                  id: shift.id,
                  data: { standbyUserId: vorherStandbyId } as { standbyUserId: number | null },
                })
                .then((zurueck) => upsertShiftsInCache(queryClient, [zurueck], selectedTeamId))
                .catch(() => {
                  upsertShiftsInCache(queryClient, [updated], selectedTeamId);
                  toast.error("Rückgängig fehlgeschlagen. Bitte erneut versuchen.");
                });
            },
          },
        });
      } catch (err) {
        upsertShiftsInCache(queryClient, [shift as unknown as CachedShiftRow], selectedTeamId);
        if (!navigator.onLine) return;
        toast.error(readableApiError(err, "Vormerken fehlgeschlagen. Bitte erneut versuchen."));
      }
      return;
    }

    // ── Ersetzen: gezogene Person uebernimmt den Dienst ───────────────────
    if (shift.userId === person.userId) return; // nichts zu tun
    if (dndAbwesendGemeldet(person.userId, datum, person.name)) return;

    const vorherigeUserId = shift.userId;
    const vorherigerName = shift.user?.name ?? "";
    // Sofort umbesetzen, dann bestaetigen lassen (s. Kommentar oben).
    upsertShiftsInCache(
      queryClient,
      [{ ...shift, userId: person.userId, user: { name: person.name } } as unknown as CachedShiftRow],
      selectedTeamId,
    );
    try {
      const updated = await updateShift.mutateAsync({
        id: shift.id,
        data: { userId: person.userId } as { userId: number },
      });
      upsertShiftsInCache(queryClient, [updated], selectedTeamId);
      void invalidateArbeitsdienstSalden(queryClient);
      const vorname = person.name.trim().split(/\s+/)[0];
      const vorherVorname = vorherigerName.trim().split(/\s+/)[0] || "die bisherige Person";
      toast.success(`${vorname} übernimmt den Dienst von ${vorherVorname}.`, {
        action: {
          label: "Rückgängig",
          onClick: () => {
            upsertShiftsInCache(queryClient, [shift as unknown as CachedShiftRow], selectedTeamId);
            void updateShift
              .mutateAsync({ id: shift.id, data: { userId: vorherigeUserId } as { userId: number } })
              .then((zurueck) => {
                upsertShiftsInCache(queryClient, [zurueck], selectedTeamId);
                void invalidateArbeitsdienstSalden(queryClient);
              })
              .catch(() => {
                upsertShiftsInCache(queryClient, [updated], selectedTeamId);
                toast.error("Rückgängig fehlgeschlagen. Bitte erneut versuchen.");
              });
          },
        },
      });
    } catch (err) {
      // Umbesetzung zuruecknehmen: die urspruengliche Zeile wieder herstellen.
      upsertShiftsInCache(queryClient, [shift as unknown as CachedShiftRow], selectedTeamId);
      if (!navigator.onLine) return;
      toast.error(readableApiError(err, "Ersetzen fehlgeschlagen. Bitte erneut versuchen."));
    }
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
  // Eine BESTRITTENE Korrektur zählt hier NICHT mehr mit: Die Assistenzkraft
  // hat ihren Teil getan, der Ball liegt beim Planer. Ohne diesen Ausschluss
  // bliebe der Dienst im Banner und im Prüf-Filter stehen, die Liste leerte
  // sich nie und die Ansicht sprang nach dem Ablehnen nicht zurück — anders
  // als nach dem Bestätigen (Kay-Feedback 28.08.2026).
  // Korrekturen sind seit dem 28.08.2026 KEINE Aufgabe mehr, sondern eine
  // Information: der Dienst gilt bereits. Die Liste treibt deshalb nur noch
  // den Hinweis und den Pruef-Filter — bestaetigt wird nichts. Bereits
  // bestrittene fallen raus (der Ball liegt beim Planer), ebenso die vom
  // Planer schon zurueckgenommenen (dort ist changeSource nicht planner_edit).
  const myKorrekturShifts = !isAdmin
    ? allShifts.filter(
        (s) =>
          s.userId === currentUser?.id &&
          !isMirrorShift(s, selectedTeamId) &&
          plannerCorrectedShiftIds.has(s.id) &&
          // Nur VERGANGENE Dienste: ein künftiger, vom Planer geänderter Dienst
          // fällt auf "Vorschlag" zurück und wird dort bestätigt — er gehört
          // nicht in den Korrektur-Hinweis (Kay-Test 28.08.2026, 31. August).
          new Date(s.endTime).getTime() < Date.now(),
      )
    : [];
  // Vorschlaege sind unveraendert echte Aufgaben: alles ANGEBOTEN, das keine
  // Alt-Korrektur aus der Zeit vor der Umstellung ist.
  // Alle offenen Vorschlaege — ein vergangener, noch unbestaetigter Vorschlag
  // ist kein Sonderfall mehr, sondern schlicht ueberfaellig.
  const myVorschlagShifts = myAngebotenShifts;
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
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [korrekturIdKey, vorschlagIdKey, meldungShiftIds, canPlan],
  );

  // Sprungziel der Tagesleiste. nonce statt boolean, damit derselbe Filter
  // erneut greift, wenn der Nutzer zwischendurch von Hand umgestellt hat.
  const [focusFilter, setFocusFilter] = useState<
    { type: "korrekturen" | "vorschlaege" | "meldungen"; nonce: number } | null
  >(null);
  const focusPruefliste = (
    type: "korrekturen" | "vorschlaege" | "meldungen",
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
      fokusParam === "meldungen"
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
      toast.success("Dienst bestätigt — zählt jetzt in Auswertungen und Stundennachweis.");
    } catch (err) {
      if (!navigator.onLine) return;
      toast.error(readableApiError(err, "Bestätigen fehlgeschlagen. Bitte erneut versuchen."));
    } finally {
      setConfirmingShiftId(null);
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
      canAutoPlan={canAutoPlan}
      onAutoPlanung={() => setAutoplanungOpen(true)}
      planungsmodus={planungsmodus}
      onTogglePlanungsmodus={() => {
        setPlanungsmodus((an) => {
          // Beim Verlassen die Mehrtagesauswahl mit aufraeumen — sie gehoert
          // zum Modus und waere sonst unsichtbar weiter aktiv.
          if (an) {
            setIsSelectionMode(false);
            setSelectedDates([]);
          }
          return !an;
        });
      }}
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
    <DienstplanDnd
      aktiv={canPlan && canSeeStundenkonto}
      gezogen={gezogenePerson}
      onDragStart={(e: DndDragStartEvent) =>
        setGezogenePerson((e.active.data.current as PersonZug | undefined) ?? null)
      }
      onDragEnd={(e) => void handleDndDrop(e)}
    >
    <div className="flex flex-col gap-3 animate-in fade-in duration-300">
      {header}

      {forwardPlanningBlocked && (
        <PlanLimitBanner>
          Im Free-Tarif nur bis nächsten Monat planbar. Für eine längere Vorausplanung ist ein
          Upgrade auf Premium nötig.
        </PlanLimitBanner>
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

      {canAutoPlan && planungsmodus && (
        <div className="mb-3" data-testid="planungsmodus-wrapper">
          <PlanungsmodusLeiste
            grenzen={grenzen}
            onGrenzenAendern={setGrenzenEntwurf}
            grenzenSpeichern={() => void speichereGrenzen()}
            laeuft={automatikLaeuft}
            onAutomatik={() => void starteAutomatik(true)}
            auswahlAktiv={isSelectionMode}
            onAuswahlUmschalten={toggleSelectionMode}
            anzahlAusgewaehlt={selectedDates.length}
            onAuswahlLoeschen={() => setDialog({ mode: "bulk-delete", dates: selectedDates })}
            onBeenden={() => {
              setPlanungsmodus(false);
              setIsSelectionMode(false);
              setSelectedDates([]);
            }}
          />
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
              dndBereich="mobil"
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
            onAddShift={(day, shiftModelId) => openCreate(day, undefined, shiftModelId)}
            onShiftClick={planungsmodus ? (sh) => void rotierePille(sh) : openEdit}
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
            geruestDienste={geruestDienste}
            dndBereich="mobil"
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
              dndBereich="reihe"
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
            onAddShift={(day, shiftModelId) => openCreate(day, undefined, shiftModelId)}
            onShiftClick={planungsmodus ? (sh) => void rotierePille(sh) : openEdit}
            onConfirmShift={confirmShift}
            canEdit={canPlan}
            selectionMode={isSelectionMode}
            selectedDates={selectedDates}
            onToggleDate={toggleDate}
            onNavigateMonth={navigateMonthWithFocus}
            focusDate={monthGridFocusDate}
            onFocusDateHandled={() => setMonthGridFocusDate(null)}
            pillMinimiert={pillMinimiert}
            geruestDienste={geruestDienste}
            dndBereich="desktop"
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
                dndBereich="panel"
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
            pruefListen={pruefListen}
            focusFilter={focusFilter}
        deviationReports={deviationReportsByShiftId}
        meldungWiederMoeglichShiftIds={meldungWiederMoeglichShiftIds}
        onReportDeviation={reportDeviation}
        onAcceptDeviation={canPlan ? acceptDeviation : undefined}
        onDisputeDeviation={canPlan ? disputeDeviation : undefined}
        deviationActionPending={deviationActionPending}
        swapRequests={swapRequestsByShiftId}
        onRequestSwap={requestSwap}
        onResolveSwap={canPlan ? resolveSwap : undefined}
        swapActionPending={swapActionPending}
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
          preselectedShiftModelId={dialog.mode === "create" ? dialog.shiftModelId : undefined}
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

      {canPlan && canAutoPlan && (
        <AutoplanungDialog
          open={autoplanungOpen}
          onClose={() => setAutoplanungOpen(false)}
          geruestDienste={geruestDienste}
          days={days}
          monatsLabel={format(currentDate, "MMMM yyyy", { locale: de })}
          shifts={allShifts.filter((s) => !isMirrorShift(s, selectedTeamId))}
          assistants={assistants}
          absenceByUser={absenceByUser}
          eintraege={stundenkontoEintraege}
          teamId={selectedTeamId}
        />
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
    </DienstplanDnd>
    </CorrectedShiftsProvider>
    </PersonColorsContext.Provider>
  );
}
