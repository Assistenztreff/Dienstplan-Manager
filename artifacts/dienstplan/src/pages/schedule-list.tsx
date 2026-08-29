import { useEffect, useMemo, useRef, useState } from "react";
import { useListShifts } from "@workspace/api-client-react";
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameDay,
  getISOWeek,
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
} from "date-fns";
import { de } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Plus, ChevronsDownUp } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SHIFT_LIST_STALE_TIME_MS, SHIFT_LIST_GC_TIME_MS } from "@/lib/shift-cache";
import type { ShiftDeviationReport } from "@workspace/api-client-react";
import {
  isAbsenceShift,
  type Shift,
  type ShiftModelInfo,
  usePersistentState,
} from "./dienstplan-helpers";
import { AgendaView } from "./agenda-view";
import type { DeviationReportValues } from "./deviation-dialog";

// Drei Prüf-Filter (Kay-Feedback 28.08.2026). Sie beantworten je eine Frage
// mit Handlungsbedarf und blenden über das bestehende hideEmptyDays alle
// unbeteiligten Tage aus — vorher musste man jeden Tag einzeln durchklicken:
//   "korrekturen"  Assistenzkraft: nachträgliche Änderung des Planers offen
//   "vorschlaege"  Assistenzkraft: gewöhnlicher Dienstvorschlag offen
//   "meldungen"    Planer: gemeldete Abweichung wartet auf Annehmen/Widerspruch
type ScheduleListType =
  | "alle"
  | "dienste"
  | "abwesenheiten"
  | "korrekturen"
  | "vorschlaege"
  | "meldungen";

/** Die drei Prüf-Filter — als Menge von Dienst-IDs je Filter. */
type PruefFilter = "korrekturen" | "vorschlaege" | "meldungen";

export type PruefListen = Partial<Record<PruefFilter, ReadonlySet<number>>>;

const PRUEF_FILTER_LABELS: Record<PruefFilter, string> = {
  korrekturen: "Offene Korrekturen",
  vorschlaege: "Offene Vorschläge",
  meldungen: "Gemeldete Abweichungen",
};

const PRUEF_FILTER_EMPTY: Record<PruefFilter, string> = {
  korrekturen: "Keine offenen Korrekturen",
  vorschlaege: "Keine offenen Vorschläge",
  meldungen: "Keine gemeldeten Abweichungen",
};

function istPruefFilter(t: ScheduleListType): t is PruefFilter {
  return t === "korrekturen" || t === "vorschlaege" || t === "meldungen";
}
type ScheduleListRange = "tag" | "woche" | "monat" | "zweiMonate";

/** Vereinheitlichte, KW-gruppierte Wochen-Liste unter Kalender UND Tabelle
 *  (Grilling 26.08.2026): ersetzt sowohl das frühere, ausschließlich im
 *  Kalender eingebettete Tagesdetail-Panel als auch die zwei separaten,
 *  ungefilterten „persistenten" Wochenlisten. Eine einzige Filterleiste
 *  (Anzeigetyp + Zeitraum), eine Liste — für Monats- und Tabellenansicht,
 *  Desktop wie Mobil, in derselben (kompakten) Dichte.
 *
 *  „Diese Woche" kann in einen Nachbarmonat hineinreichen, „Nächste 2
 *  Monate" braucht zwei Folgemonate — /shifts kennt kein from/to (nur
 *  month/year, siehe openapi.yaml), daher werden die fehlenden Monate hier
 *  bei Bedarf separat nachgeladen. Vor-/Folgemonat sind über das ohnehin
 *  laufende Prefetching (Task #758, prefetchAdjacentMonthShifts) meist schon
 *  im Query-Cache — kein zusätzlicher Request. */
export function ScheduleList({
  month,
  year,
  currentMonthShifts,
  effectiveSelectedUserIds,
  modelMap,
  selectedDay,
  teamParam,
  isTeamScopeReady,
  onDayClick,
  onShiftClick,
  onConfirmShift,
  onConfirmOwnShift,
  pruefListen,
  focusFilter,
  canEdit,
  selectionMode,
  selectedDates,
  onToggleDate,
  onPrevMonth,
  onNextMonth,
  deviationReports,
  meldungWiederMoeglichShiftIds,
  onReportDeviation,
  onAcceptDeviation,
  onDisputeDeviation,
  deviationActionPending,
}: {
  month: number;
  year: number;
  /** Bereits auf effectiveSelectedUserIds gefilterte Schichten des geladenen
   *  Monats (= visibleShifts der Seite). */
  currentMonthShifts: Shift[];
  effectiveSelectedUserIds: number[] | "all";
  modelMap: Map<number, ShiftModelInfo>;
  selectedDay: Date;
  teamParam: { teamId?: number };
  isTeamScopeReady: boolean;
  onDayClick: (day: Date) => void;
  onShiftClick: (shift: Shift) => void;
  onConfirmShift?: (shift: Shift) => void;
  onConfirmOwnShift?: (shift: Shift) => void;
  /** Dienst-IDs je Prüf-Filter. Wird von der Seite berechnet (dort liegen
   *  Rolle, Team-Kontext und die Abweichungs-Meldungen) und hier nur zum
   *  Filtern genutzt. */
  pruefListen?: PruefListen;
  /** Setzt die Liste auf einen Prüf-Filter. `nonce` muss sich bei jedem
   *  Auslösen ändern, damit derselbe Filter erneut greift, auch wenn der
   *  Nutzer zwischendurch von Hand umgestellt hat. So kann ein Banner (oder
   *  das Dashboard per URL) die Ansicht setzen, ohne dass der Filterzustand
   *  aus dieser Komponente herauswandern muss. */
  focusFilter?: { type: PruefFilter; nonce: number } | null;
  canEdit: boolean;
  selectionMode?: boolean;
  selectedDates?: string[];
  onToggleDate?: (day: Date) => void;
  onPrevMonth?: () => void;
  onNextMonth?: () => void;
  deviationReports?: Map<number, ShiftDeviationReport>;
  /** Dienste, bei denen trotz vorhandener (erledigter) Meldung erneut
   *  gemeldet werden darf — der Planer hat seither nochmals korrigiert. */
  meldungWiederMoeglichShiftIds?: ReadonlySet<number>;
  onReportDeviation?: (shift: Shift, values: DeviationReportValues) => void;
  onAcceptDeviation?: (shift: Shift) => void;
  onDisputeDeviation?: (shift: Shift, reason: string) => void;
  deviationActionPending?: boolean;
}) {
  const [detailType, setDetailType] = usePersistentState<ScheduleListType>(
    "dienstplan.scheduleListType",
    "alle",
    ["alle", "dienste", "abwesenheiten", "korrekturen", "vorschlaege", "meldungen"],
  );
  // Zeitraum startet bei JEDEM Seitenaufruf auf „Heute" (Nutzer-Entscheidung
  // 27.08.2026, zweite Runde) — bewusst NICHT persistiert, anders als der
  // Anzeigetyp: Der Tagesblick ist der gewollte Einstieg, Monats-/Wochenblick
  // ist eine bewusste Sitzungs-Entscheidung.
  const [detailRange, setDetailRange] = useState<ScheduleListRange>("tag");

  // Sprung aus einem Banner oder vom Dashboard: Filter und Zeitraum so setzen,
  // dass ALLE betroffenen Tage des Monats auf einen Blick dastehen. Danach in
  // den Listenbereich scrollen — sonst landet man weiterhin oben im Kalender
  // und muesste erst hinunterrollen.
  useEffect(() => {
    if (!focusFilter) return;
    setDetailType(focusFilter.type);
    setDetailRange("monat");
    // Doppeltes rAF: Filter- und Einklapp-Effekt müssen erst gelaufen sein,
    // sonst steht die Zielzeile noch gar nicht im DOM. Ziel ist die ERSTE
    // betroffene Tageszeile — nicht die Listen-Kopfzeile und erst recht nicht
    // die aktuelle Woche (Kay-Feedback 28.08.2026).
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const ersteZeile = document.querySelector('[data-testid^="agenda-day-"]');
        (ersteZeile ?? document.querySelector('[data-testid="schedule-list-header"]'))
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusFilter?.type, focusFilter?.nonce]);

  // Ist der letzte Fall erledigt, waere der Filter eine Sackgasse (leere Liste,
  // und der Auswahl-Eintrag verschwindet dann auch aus dem Menue). Deshalb
  // automatisch zurueck auf "Alle".
  useEffect(() => {
    if (istPruefFilter(detailType) && (pruefListen?.[detailType]?.size ?? 0) === 0) {
      setDetailType("alle");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailType, pruefListen]);

  // Eingeklappte Wochenkarten (Abnahme 27.08.2026). Bewusst NICHT
  // persistiert: beim nächsten Seitenaufruf sind alle Wochen wieder offen.
  const [collapsedWeeks, setCollapsedWeeks] = useState<ReadonlySet<string>>(new Set());
  const toggleWeek = (weekKey: string) => {
    setCollapsedWeeks((prev) => {
      const next = new Set(prev);
      if (next.has(weekKey)) next.delete(weekKey);
      else next.add(weekKey);
      return next;
    });
  };

  // „Dieser Monat" füllt die Randwochen auf volle Mo–So-Blöcke auf —
  // dafür braucht es die Nachbarmonate, sobald die Randwoche überlappt.
  const monthStartForFill = startOfMonth(selectedDay);
  const monthEndForFill = endOfMonth(selectedDay);
  const monatNeedsPrev =
    detailRange === "monat" && !isSameDay(startOfWeek(monthStartForFill, { weekStartsOn: 1 }), monthStartForFill);
  const monatNeedsNext =
    detailRange === "monat" && !isSameDay(endOfWeek(monthEndForFill, { weekStartsOn: 1 }), monthEndForFill);

  const needsPrevMonth = detailRange === "woche" || monatNeedsPrev;
  const needsNextMonth = detailRange === "woche" || detailRange === "zweiMonate" || monatNeedsNext;
  const needsAfterNextMonth = detailRange === "zweiMonate";
  const prevMonthDate = new Date(year, month - 2, 1);
  const nextMonthDate = new Date(year, month, 1);
  const afterNextMonthDate = new Date(year, month + 1, 1);

  const { data: prevMonthShiftsRaw } = useListShifts(
    { month: prevMonthDate.getMonth() + 1, year: prevMonthDate.getFullYear(), ...teamParam },
    {
      query: {
        enabled: isTeamScopeReady && needsPrevMonth,
        staleTime: SHIFT_LIST_STALE_TIME_MS,
        gcTime: SHIFT_LIST_GC_TIME_MS,
      },
    } as unknown as Parameters<typeof useListShifts>[1],
  ) as { data?: Shift[] };
  const { data: nextMonthShiftsRaw } = useListShifts(
    { month: nextMonthDate.getMonth() + 1, year: nextMonthDate.getFullYear(), ...teamParam },
    {
      query: {
        enabled: isTeamScopeReady && needsNextMonth,
        staleTime: SHIFT_LIST_STALE_TIME_MS,
        gcTime: SHIFT_LIST_GC_TIME_MS,
      },
    } as unknown as Parameters<typeof useListShifts>[1],
  ) as { data?: Shift[] };
  const { data: afterNextMonthShiftsRaw } = useListShifts(
    { month: afterNextMonthDate.getMonth() + 1, year: afterNextMonthDate.getFullYear(), ...teamParam },
    {
      query: {
        enabled: isTeamScopeReady && needsAfterNextMonth,
        staleTime: SHIFT_LIST_STALE_TIME_MS,
        gcTime: SHIFT_LIST_GC_TIME_MS,
      },
    } as unknown as Parameters<typeof useListShifts>[1],
  ) as { data?: Shift[] };

  const filterByAssistant = (list: Shift[] | undefined): Shift[] => {
    if (!list) return [];
    return effectiveSelectedUserIds === "all"
      ? list
      : list.filter((s) => effectiveSelectedUserIds.includes(s.userId));
  };

  const { rangeShifts, countShifts, rangeStart, rangeEnd, displayStart, displayEnd } = useMemo(() => {
    let from = startOfDay(selectedDay);
    let to = endOfDay(selectedDay);
    let pool = currentMonthShifts;
    if (detailRange === "woche") {
      from = startOfWeek(selectedDay, { weekStartsOn: 1 });
      to = endOfWeek(selectedDay, { weekStartsOn: 1 });
      pool = [
        ...filterByAssistant(prevMonthShiftsRaw),
        ...currentMonthShifts,
        ...filterByAssistant(nextMonthShiftsRaw),
      ];
    } else if (detailRange === "monat") {
      from = startOfMonth(selectedDay);
      to = endOfMonth(selectedDay);
      // Mo–So-Auffüllung (Abnahme 27.08.2026): der Pool umfasst auch die
      // Nachbarmonate, damit deren Dienste auf den grauen Randtagen als
      // Planungshilfe erscheinen können.
      pool = [
        ...filterByAssistant(prevMonthShiftsRaw),
        ...currentMonthShifts,
        ...filterByAssistant(nextMonthShiftsRaw),
      ];
    } else if (detailRange === "zweiMonate") {
      to = endOfMonth(afterNextMonthDate);
      pool = [
        ...currentMonthShifts,
        ...filterByAssistant(nextMonthShiftsRaw),
        ...filterByAssistant(afterNextMonthShiftsRaw),
      ];
    }
    // Anzeige-Intervall: nur bei „Dieser Monat" auf volle Mo–So-Wochen
    // erweitert; Kopfzeilen-Zählung und Beschriftung bleiben beim
    // Anker-Intervall (der graue Rand zählt nirgends mit).
    const dFrom = detailRange === "monat" ? startOfWeek(from, { weekStartsOn: 1 }) : from;
    const dTo = detailRange === "monat" ? endOfWeek(to, { weekStartsOn: 1 }) : to;
    const filtered = pool
      .filter((s) => {
        const d = new Date(s.startTime);
        if (d < dFrom || d > dTo) return false;
        if (detailType === "dienste") return !isAbsenceShift(s);
        if (detailType === "abwesenheiten") return isAbsenceShift(s);
        if (istPruefFilter(detailType)) return pruefListen?.[detailType]?.has(s.id) ?? false;
        return true;
      })
      .sort((a, b) => +new Date(a.startTime) - +new Date(b.startTime));
    const counted = filtered.filter((s) => {
      const d = new Date(s.startTime);
      return d >= from && d <= to;
    });
    return { rangeShifts: filtered, countShifts: counted, rangeStart: from, rangeEnd: to, displayStart: dFrom, displayEnd: dTo };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMonthShifts, prevMonthShiftsRaw, nextMonthShiftsRaw, afterNextMonthShiftsRaw, selectedDay, detailRange, detailType, pruefListen]);

  const rangeDays = useMemo(
    () => eachDayOfInterval({ start: displayStart, end: displayEnd }),
    [displayStart, displayEnd],
  );

  // Wochen-Keys des angezeigten Bereichs — für den „Alle ein-/ausklappen"-
  // Knopf (identische Key-Bildung wie die Karten-Gruppierung in AgendaView).
  const weekKeys = useMemo(() => {
    const keys: string[] = [];
    for (const day of rangeDays) {
      const key = format(startOfWeek(day, { weekStartsOn: 1 }), "yyyy-MM-dd");
      if (keys[keys.length - 1] !== key) keys.push(key);
    }
    return keys;
  }, [rangeDays]);
  // „Alle"-Knopf: Sobald IRGENDEINE Woche zu ist, klappt der Klick alles auf
  // (deterministisch — wichtig, weil der Monatsblick teilweise eingeklappt
  // startet); erst wenn alles offen ist, klappt er alles zu.
  const anyCollapsed = weekKeys.some((k) => collapsedWeeks.has(k));
  const toggleAllWeeks = () => {
    setCollapsedWeeks(anyCollapsed ? new Set() : new Set(weekKeys));
  };

  // Schnellübersicht (Nutzer-Entscheidung 27.08.2026): „Dieser Monat" und
  // „Nächste 2 Monate" starten mit eingeklappten Wochen — nur die AKTUELLE
  // Kalenderwoche ist offen (in Monaten ohne „heute" also alle zu). Läuft
  // auch beim Monatswechsel neu, damit der Einstieg vorhersehbar bleibt;
  // „Heute"/„Diese Woche" öffnen immer alles.
  const todayWeekKey = format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");
  const displayRangeKey = `${detailRange}|${detailType}|${format(displayStart, "yyyy-MM-dd")}|${format(displayEnd, "yyyy-MM-dd")}`;
  useEffect(() => {
    // Prüf-Filter (Korrekturen, Vorschläge, Meldungen, Widersprüche) zeigen
    // ohnehin NUR die betroffenen Tage — da ist Einklappen sinnlos und schädlich:
    // die gesuchte Woche wäre zu und der Fall unsichtbar (Kay-Feedback
    // 28.08.2026, nach dem ersten Test des Dashboard-Sprungs).
    if (istPruefFilter(detailType)) {
      setCollapsedWeeks(new Set());
    } else if (detailRange === "monat" || detailRange === "zweiMonate") {
      setCollapsedWeeks(new Set(weekKeys.filter((k) => k !== todayWeekKey)));
    } else {
      setCollapsedWeeks(new Set());
    }
    // Bewusst NUR der stabile Zeitraum-Schluessel als Abhaengigkeit:
    // weekKeys wechselt seine Array-Identitaet mit jedem Query-Refetch —
    // haenge der Effekt daran, wuerde jedes Speichern/Nachladen die
    // manuellen Auf-/Zuklapp-Entscheidungen des Nutzers zuruecksetzen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayRangeKey]);

  // Auto-Scroll zur aktuellen Woche (Nutzer-Entscheidung 27.08.2026, dritte
  // Runde): schaltet der Nutzer auf „Diese Woche" oder „Dieser Monat" um,
  // liegt die relevante Woche oft weit unten in der (u. U. langen) Liste —
  // die Seite scrollt dann automatisch dorthin. Nur bei einem ECHTEN Wechsel
  // IN einen dieser beiden Zeiträume (Ref-Vergleich), nicht bei jedem
  // Tages-/Monatswechsel INNERHALB desselben Zeitraums.
  const prevDetailRangeRef = useRef(detailRange);
  useEffect(() => {
    const enteringWeekOrMonth =
      prevDetailRangeRef.current !== detailRange &&
      (detailRange === "woche" || detailRange === "monat");
    prevDetailRangeRef.current = detailRange;
    if (!enteringWeekOrMonth) return;
    // Bei einem Prüf-Filter ist die aktuelle Woche das falsche Ziel — dort
    // steht in aller Regel gar kein Fall. Das Scrollen übernimmt der
    // Fokus-Effekt weiter oben, der zur ERSTEN betroffenen Zeile springt.
    if (istPruefFilter(detailType)) return;
    const weekKey =
      detailRange === "woche"
        ? format(startOfWeek(selectedDay, { weekStartsOn: 1 }), "yyyy-MM-dd")
        : todayWeekKey;
    // Doppeltes rAF: der Einklapp-Effekt oben löst bei „Dieser Monat" noch
    // einen State-Update-Zyklus aus (Wochen klappen zu) — erst NACH dessen
    // Layout-Commit ist die Zielposition der Woche stabil.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document
          .querySelector(`[data-testid="agenda-week-${weekKey}"]`)
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }, [detailRange, selectedDay, todayWeekKey]);

  const rangeLabel =
    detailRange === "tag"
      ? format(selectedDay, "EEEE, d. MMMM yyyy", { locale: de })
      : detailRange === "woche"
        ? `KW ${getISOWeek(rangeStart)} · ${format(rangeStart, "d.")}–${format(rangeEnd, "d. MMMM yyyy", { locale: de })}`
        : detailRange === "monat"
          ? format(selectedDay, "MMMM yyyy", { locale: de })
          : `${format(rangeStart, "d. MMMM")} – ${format(rangeEnd, "d. MMMM yyyy", { locale: de })}`;

  // ── Sticky-Filterleiste unterhalb der Dienstplan-Kopfzeile — eigene
  //    Messung (dasselbe Muster wie die Wochentag-Zeile in MonthGrid), weil
  //    diese Komponente ein Geschwister von MonthGrid/DienstplanTableView
  //    ist und keinen gemeinsamen State mit deren headerH teilt. ──
  const [headerH, setHeaderH] = useState(0);
  useEffect(() => {
    const el = document.querySelector("[data-dienstplan-header]") as HTMLElement | null;
    if (!el) return;
    const update = () => setHeaderH(el.getBoundingClientRect().height);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="mt-2 space-y-3" data-testid="schedule-list">
      <div
        className="sticky z-30 flex flex-wrap items-center gap-2.5 rounded-lg border border-border/40 bg-card px-4 py-3"
        style={{ top: headerH || 0 }}
        data-testid="schedule-list-menu"
      >
        <Select value={detailType} onValueChange={(v) => setDetailType(v as ScheduleListType)}>
          <SelectTrigger
            className="h-auto w-auto gap-1.5 rounded-lg border-[#d8d8d4] bg-card px-2.5 py-1.5 text-[12.5px] font-semibold text-[#092948] shadow-none"
            data-testid="schedule-list-type-menu"
            aria-label="Anzeigetyp"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="alle">Alle</SelectItem>
            <SelectItem value="dienste">Dienste</SelectItem>
            <SelectItem value="abwesenheiten">Abwesenheiten</SelectItem>
            {(["korrekturen", "vorschlaege", "meldungen"] as const)
              .filter((k) => (pruefListen?.[k]?.size ?? 0) > 0)
              .map((k) => (
                <SelectItem key={k} value={k}>
                  {PRUEF_FILTER_LABELS[k]}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <Select value={detailRange} onValueChange={(v) => setDetailRange(v as ScheduleListRange)}>
          <SelectTrigger
            className="h-auto w-auto gap-1.5 rounded-lg border-[#d8d8d4] bg-card px-2.5 py-1.5 text-[12.5px] font-semibold text-[#092948] shadow-none"
            data-testid="schedule-list-range-menu"
            aria-label="Zeitraum"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tag">Heute</SelectItem>
            <SelectItem value="woche">Diese Woche</SelectItem>
            <SelectItem value="monat">Dieser Monat</SelectItem>
            <SelectItem value="zweiMonate">Nächste 2 Monate</SelectItem>
          </SelectContent>
        </Select>
        <div className="min-w-0">
          <p className="text-[13px] font-extrabold text-[#092948]" data-testid="schedule-list-header">
            {rangeLabel}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {/* Zählt NUR den Anker-Zeitraum — die grauen Mo–So-Randtage
                aus dem Nachbarmonat verfälschen die Zahl nicht. */}
            {countShifts.length === 0
              ? detailType === "abwesenheiten"
                ? "Keine Abwesenheiten"
                : istPruefFilter(detailType)
                  ? PRUEF_FILTER_EMPTY[detailType]
                  : "Keine Dienste geplant"
              : istPruefFilter(detailType)
                ? `${countShifts.length} ${PRUEF_FILTER_LABELS[detailType].toLowerCase()}`
                : `${countShifts.length} ${
                    detailType === "abwesenheiten"
                      ? countShifts.length === 1 ? "Abwesenheit" : "Abwesenheiten"
                      : countShifts.length === 1 ? "Dienst" : "Dienste"
                  }`}
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {weekKeys.length > 1 && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1 shrink-0"
              data-testid="schedule-list-collapse-all"
              onClick={toggleAllWeeks}
              title={anyCollapsed ? "Alle Wochen ausklappen" : "Alle Wochen einklappen"}
            >
              <ChevronsDownUp className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{anyCollapsed ? "Alle ausklappen" : "Alle einklappen"}</span>
            </Button>
          )}
          {canEdit && !selectionMode && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1 shrink-0"
              data-testid="add-shift"
              onClick={() => onDayClick(selectedDay)}
            >
              <Plus className="h-3.5 w-3.5" />
              Dienst anlegen
            </Button>
          )}
        </div>
      </div>

      <AgendaView
        days={rangeDays}
        shifts={rangeShifts}
        modelMap={modelMap}
        onDayClick={onDayClick}
        onShiftClick={onShiftClick}
        onConfirmShift={onConfirmShift}
        onConfirmOwnShift={onConfirmOwnShift}
        deviationReports={deviationReports}
        meldungWiederMoeglichShiftIds={meldungWiederMoeglichShiftIds}
        onReportDeviation={onReportDeviation}
        onAcceptDeviation={onAcceptDeviation}
        onDisputeDeviation={onDisputeDeviation}
        deviationActionPending={deviationActionPending}
        canEdit={canEdit}
        selectionMode={selectionMode}
        selectedDates={selectedDates}
        onToggleDate={onToggleDate}
        onPrevMonth={onPrevMonth}
        onNextMonth={onNextMonth}
        selectedDay={selectedDay}
        // Leere Tage sind nur fuer Planende nuetzlich — dort ist die leere Zeile
        // die Stelle, an der ein Dienst angelegt wird. Einer Assistenzkraft
        // nuetzen sie nichts: sie kann dort nichts eintragen und muss sich durch
        // lauter leere Zeilen scrollen, um ihre eigenen Dienste zu finden
        // (Kay-Feedback 28.08.2026). Deshalb blendet "Alle" sie fuer sie aus.
        hideEmptyDays={detailType !== "alle" || !canEdit}
        anchorInterval={detailRange === "monat" ? { from: rangeStart, to: rangeEnd } : undefined}
        collapsedWeeks={collapsedWeeks}
        onToggleWeek={toggleWeek}
      />
    </div>
  );
}
