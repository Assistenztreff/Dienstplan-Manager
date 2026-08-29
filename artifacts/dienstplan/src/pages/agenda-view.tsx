import { format, isSameDay, isToday, getDay, getISOWeek, startOfWeek } from "date-fns";
import { de } from "date-fns/locale";
import { Plus, ChevronDown } from "lucide-react";
import { ABSENCE_CATEGORY } from "@/components/abwesenheits-kalender";
import type { ShiftDeviationReport } from "@workspace/api-client-react";
import {
  isAbsenceShift,
  type Shift,
  type ShiftModelInfo,
  usePersonSlotLookup,
} from "./dienstplan-helpers";
import { DayDetailRow } from "./day-detail-row";
import type { DeviationReportValues } from "./deviation-dialog";

export function AgendaView({
  days,
  shifts,
  modelMap,
  onDayClick,
  onShiftClick,
  onConfirmShift,
  onConfirmOwnShift,
  plannerCorrectedShiftIds,
  correctionObjections,
  onObjectCorrection,
  onWithdrawCorrection,
  canEdit,
  selectionMode = false,
  selectedDates,
  onToggleDate,
  onPrevMonth,
  onNextMonth,
  selectedDay,
  hideEmptyDays = false,
  anchorInterval,
  collapsedWeeks,
  onToggleWeek,
  deviationReports,
  onReportDeviation,
  onAcceptDeviation,
  onDisputeDeviation,
  deviationActionPending,
}: {
  days: Date[];
  shifts: Shift[];
  modelMap: Map<number, ShiftModelInfo>;
  onDayClick: (day: Date) => void;
  onShiftClick: (shift: Shift) => void;
  onConfirmShift?: (shift: Shift) => void;
  /** Eigenbestätigung der Assistenzkraft (eigene Route, s. day-detail-row). */
  onConfirmOwnShift?: (shift: Shift) => void;
  /** Dienste, die der Planer zuletzt nachträglich geändert hat. */
  plannerCorrectedShiftIds?: ReadonlySet<number>;
  /** Offene Widersprüche je Dienst-ID. */
  correctionObjections?: Map<number, { id: number; reason: string; status: string }>;
  onObjectCorrection?: (shift: Shift, reason: string) => void;
  onWithdrawCorrection?: (shift: Shift) => void;
  canEdit: boolean;
  /** Abweichungsmodell: shiftId → Meldung, plus die drei Aktionen. Fehlen
   *  sie, bleibt die Zeile unverändert (Ownership-/Rollenprüfung lebt in
   *  DayDetailRow selbst). */
  deviationReports?: Map<number, ShiftDeviationReport>;
  onReportDeviation?: (shift: Shift, values: DeviationReportValues) => void;
  onAcceptDeviation?: (shift: Shift) => void;
  onDisputeDeviation?: (shift: Shift, reason: string) => void;
  deviationActionPending?: boolean;
  selectionMode?: boolean;
  selectedDates?: string[];
  onToggleDate?: (day: Date) => void;
  /** Monatswechsel per Tastatur: ← / PageUp → vorheriger Monat */
  onPrevMonth?: () => void;
  /** Monatswechsel per Tastatur: → / PageDown → nächster Monat */
  onNextMonth?: () => void;
  /** Im Kalender gewählter Tag — seine Zeile wird in der Liste markiert
   *  (Ersatz für das frühere, an selectedDay gekoppelte Tagesdetail-Panel). */
  selectedDay?: Date;
  /** Bei aktivem Typ-Filter (Dienste/Abwesenheiten) Tage ohne passenden
   *  Eintrag ausblenden — sonst dominieren leere Zeilen die Trefferliste.
   *  Bei „Alle" bleiben alle Tage stehen (inkl. „Schicht hinzufügen"). */
  hideEmptyDays?: boolean;
  /** Mockup-Abnahme 27.08.2026: Bei Zeitraum „Dieser Monat" laufen die
   *  Randwochen voll Mo–So durch — Tage AUSSERHALB dieses Intervalls sind
   *  Nachbarmonats-Tage: ruhig grau, Dienste ausgegraut sichtbar (Planungs-
   *  hilfe „wer hatte die letzten Dienste im Vormonat?"), nicht anklickbar,
   *  kein Anlegen, zählen in keiner Zusammenfassung mit. */
  anchorInterval?: { from: Date; to: Date };
  /** Eingeklappte Wochen (Karten-Keys). State lebt im Eltern-Element, damit
   *  der „Alle ein-/ausklappen"-Knopf der Filterleiste ihn mitsteuern kann.
   *  Bewusst NICHT persistiert — beim nächsten Öffnen sind alle Wochen offen. */
  collapsedWeeks?: ReadonlySet<string>;
  onToggleWeek?: (weekKey: string) => void;
}) {
  const selectedDateSet = new Set(selectedDates ?? []);
  const getPersonSlot = usePersonSlotLookup();
  const isOtherDay = (day: Date): boolean =>
    anchorInterval != null && (day < anchorInterval.from || day > anchorInterval.to);

  // ── Wochen-Kapitel (Task #746, Variante A): Tage nach ISO-Woche (Mo–So)
  //    gruppieren; jede Woche wird ein eigener Kartenblock mit Überschrift. ──
  //    `label` haelt die KW-Spanne der VOLLEN Woche fest, bevor hideEmptyDays
  //    Tage entfernt — sonst wuerde die Ueberschrift bei gefilterter Ansicht
  //    eine zu kurze Spanne behaupten. Wochen ohne verbleibenden Tag fallen
  //    ganz weg, statt als leere Karte mit blosser KW-Ueberschrift zu stehen.
  const allWeeks: { key: string; days: Date[] }[] = [];
  for (const day of days) {
    const key = format(startOfWeek(day, { weekStartsOn: 1 }), "yyyy-MM-dd");
    const last = allWeeks[allWeeks.length - 1];
    if (last && last.key === key) last.days.push(day);
    else allWeeks.push({ key, days: [day] });
  }
  const weeks = allWeeks
    .map((week) => {
      const first = week.days[0]!;
      const weekLast = week.days[week.days.length - 1]!;
      // Zusammenfassung für den (einklappbaren) Wochenkopf — zählt NUR Tage
      // des angezeigten Zeitraums, ausgegraute Nachbarmonats-Dienste nicht.
      const ownShifts = shifts.filter((s) => {
        const d = new Date(s.startTime);
        return week.days.some((day) => isSameDay(d, day) && !isOtherDay(day));
      });
      const dienstCount = ownShifts.filter((s) => !isAbsenceShift(s)).length;
      const abwCount = ownShifts.length - dienstCount;
      return {
        key: week.key,
        isoWeek: getISOWeek(first),
        label: isSameDay(first, weekLast)
          ? format(first, "d. MMMM", { locale: de })
          : `${format(first, "d.")}–${format(weekLast, "d. MMMM", { locale: de })}`,
        summary: `${dienstCount} ${dienstCount === 1 ? "Dienst" : "Dienste"}${abwCount > 0 ? ` · ${abwCount} Abw.` : ""}`,
        days: hideEmptyDays
          ? week.days.filter((day) => shifts.some((s) => isSameDay(new Date(s.startTime), day)))
          : week.days,
      };
    })
    .filter((week) => week.days.length > 0);

  return (
    <div
      className="space-y-3"
      tabIndex={onPrevMonth || onNextMonth ? 0 : undefined}
      aria-label="Monatsansicht — ArrowLeft/ArrowRight für Monatswechsel"
      onKeyDown={
        onPrevMonth || onNextMonth
          ? (e) => {
              if (e.key === "ArrowLeft" || e.key === "PageUp") {
                e.preventDefault();
                onPrevMonth?.();
              } else if (e.key === "ArrowRight" || e.key === "PageDown") {
                e.preventDefault();
                onNextMonth?.();
              }
            }
          : undefined
      }
      data-testid="agenda-view"
    >
      {weeks.map((week) => {
        const collapsed = collapsedWeeks?.has(week.key) ?? false;
        return (
          <section
            key={week.key}
            data-testid={`agenda-week-${week.key}`}
            data-collapsed={collapsed ? "true" : "false"}
            className="overflow-hidden rounded-lg border border-border/40 bg-card"
          >
            {/* Ebenen-Stufe 1 (Mockup-Abnahme 27.08.2026): kühle Brand-Tönung
                statt neutralem Grau; der ganze Kopf klappt die Woche ein/aus,
                die Zusammenfassung rechts bleibt auch eingeklappt sichtbar. */}
            <button
              type="button"
              aria-expanded={!collapsed}
              onClick={() => onToggleWeek?.(week.key)}
              className={`flex w-full items-center gap-2 bg-[#e9ecf1] px-4 py-1.5 text-left text-[11px] font-bold uppercase tracking-wide text-assistenz-brand ${collapsed ? "" : "border-b border-border/40"} ${onToggleWeek ? "" : "pointer-events-none"}`}
            >
              {onToggleWeek && (
                <ChevronDown
                  aria-hidden="true"
                  className={`h-3.5 w-3.5 shrink-0 transition-transform motion-reduce:transition-none ${collapsed ? "-rotate-90" : ""}`}
                />
              )}
              <span>KW {week.isoWeek} · {week.label}</span>
              <span className="ml-auto font-semibold normal-case tracking-normal text-muted-foreground tabular-nums">
                {week.summary}
              </span>
            </button>
            {!collapsed && week.days
              .map((day, dayIdx, renderedDays) => {
              const dayShifts = shifts.filter((s) => isSameDay(new Date(s.startTime), day));
              // Task #792: Ausfall-UserIds für diesen Tag — damit DayDetailRow
              // das Warn-Icon auf Dienst-Zeilen zeigen kann (analog MonthGrid).
              const dayAusfallUserIds = new Set(
                dayShifts
                  .filter((s) => isAbsenceShift(s) && ABSENCE_CATEGORY[s.type] === "ausfall")
                  .map((s) => s.userId),
              );
              const isCurrentDay = isToday(day);
              // Wochenende: helle Brand-Tönung + Streifen + dunkelblaue,
              // dickere Beschriftung — Information nie nur über Farbe
              // (Barrierefreiheit, DESIGN-GUIDELINES; Abnahme 27.08.2026).
              const weekend = getDay(day) === 0 || getDay(day) === 6;
              // Nachbarmonats-Tag (nur Zeitraum „Dieser Monat"): ruhig grau,
              // nichts anklickbar, Dienste unten ausgegraut sichtbar.
              const other = isOtherDay(day);
              const bulkSelected = !other && selectionMode && selectedDateSet.has(format(day, "yyyy-MM-dd"));
              // Verschmolzene Auswahl (Abnahme 27.08.2026): direkt benachbarte
              // ausgewählte Zeilen teilen sich EINEN Rahmen — der Folge-Tag
              // kappt seine Oberkante, nur der letzte behält die Unterkante.
              const prevSelected = bulkSelected && dayIdx > 0 &&
                selectedDateSet.has(format(renderedDays[dayIdx - 1]!, "yyyy-MM-dd"));
              const nextSelected = bulkSelected && dayIdx < renderedDays.length - 1 &&
                selectedDateSet.has(format(renderedDays[dayIdx + 1]!, "yyyy-MM-dd"));
              // Ersetzt das frühere day-detail-Panel: die Zeile des im Kalender
              // gewählten Tages wird hier hervorgehoben (Desktop) bzw. ist das
              // Scroll-Ziel (eingeklapptes Smartphone, siehe MonthGrid).
              const isAnchorDay = !other && selectedDay != null && isSameDay(day, selectedDay);
              const dayClickable = canEdit && !other;

              return (
                <div
                  key={day.toISOString()}
                  data-testid={`agenda-day-${format(day, "yyyy-MM-dd")}`}
                  data-selected={bulkSelected ? "true" : "false"}
                  data-anchor={isAnchorDay ? "true" : "false"}
                  data-other-month={other ? "true" : "false"}
                  // Task #846: echter Rand statt Ring (Detailzeilen decken
                  // ring-inset ab). Unselektiert bleibt der 2-px-Rahmen als
                  // Transparent-Platzhalter stehen (kein Layout-Sprung beim
                  // An-/Abwählen einzelner Tage); innerhalb eines Auswahl-
                  // Blocks entfallen die Zwischenkanten komplett.
                  className={
                    bulkSelected
                      ? `border-x-[2px] border-assistenz-brand bg-assistenz-mint ${prevSelected ? "border-t-0" : "border-t-[2px]"} ${nextSelected ? "border-b-0" : "border-b-[2px]"}`
                      : isAnchorDay
                        ? "border-[2px] border-primary/50 border-b-border/30 last:border-b-transparent"
                        : "border-[2px] border-transparent border-b-border/30 last:border-b-transparent"
                  }
                >
                  <button
                    type="button"
                    tabIndex={other ? -1 : undefined}
                    className={`relative flex min-h-[40px] w-full items-center gap-3 px-4 py-1 text-left transition-colors ${
                      other
                        ? "bg-[#f6f6f3] text-muted-foreground"
                        : isCurrentDay
                          ? "bg-primary text-primary-foreground hover:bg-primary/90"
                          : weekend
                            ? "bg-[#eef3f9] text-assistenz-brand shadow-[inset_3px_0_0_#05305B] hover:bg-[#e3ecf5]"
                            : "bg-card text-foreground hover:bg-muted/40"
                    } ${!dayClickable ? "cursor-default pointer-events-none" : "after:absolute after:inset-x-0 after:top-1/2 after:h-[44px] after:-translate-y-1/2 after:content-['']"}`}
                    onClick={() =>
                      dayClickable && (selectionMode ? onToggleDate?.(day) : onDayClick(day))
                    }
                  >
                    <span className={`min-w-[24px] text-sm tabular-nums ${other ? "font-medium" : weekend ? "font-extrabold" : "font-bold"}`}>{format(day, "d")}</span>
                    <span className={`text-sm ${other ? "font-medium" : weekend ? "font-bold" : "font-semibold"}`}>
                      {format(day, "EEEEEE", { locale: de })}
                    </span>
                    {other && (
                      <span className="rounded-[5px] border border-border/60 px-1.5 py-px text-[10.5px] tracking-wide text-muted-foreground">
                        {format(day, "MMM", { locale: de })}
                      </span>
                    )}
                    {isCurrentDay && !other && (
                      <span className="rounded bg-primary-foreground px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                        Heute
                      </span>
                    )}
                    {canEdit && !other && (
                      <span
                        className={`ml-auto flex items-center gap-1.5 text-xs ${
                          isCurrentDay ? "opacity-80" : "text-muted-foreground"
                        }`}
                      >
                        {/* Leere Tage: dezenter Hinweis links neben dem Plus;
                            die Zahlenspalte bleibt reserviert, damit das Plus
                            über alle Zeilen bündig steht. */}
                        {dayShifts.length === 0 && <span>Schicht hinzufügen</span>}
                        <span className="min-w-[1rem] text-right font-medium tabular-nums">
                          {dayShifts.length > 0 ? dayShifts.length : ""}
                        </span>
                        <Plus className="h-3.5 w-3.5 shrink-0" />
                      </span>
                    )}
                    {other && dayShifts.length > 0 && (
                      <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                        {dayShifts.length}
                      </span>
                    )}
                  </button>

                  {/* Nur Tage MIT Einträgen bekommen Detailzeilen — leere Tage
                      bleiben einzeilig. Zeilen im selben Format
                      wie die Tagesleiste unter dem Kalender (DayDetailRow).
                      Nachbarmonats-Dienste: ausgegraut sichtbar, nicht klickbar. */}
                  {dayShifts.length > 0 && (
                    <div className={`border-t border-border/20 bg-card ${other ? "opacity-60 grayscale" : ""}`}>
                      {dayShifts.map((shift) => (
                        <div key={shift.id}>
                          <DayDetailRow
                            shift={shift}
                            testId={`shift-badge-${shift.id}`}
                            // Name IMMER zeigen — auch ohne Bearbeitungsrecht
                            // (Assistenzkraft sieht serverseitig nur eigene
                            // Schichten; festgepinnt in zweiklick-desktop).
                            modelMap={modelMap}
                            hasAusfall={!isAbsenceShift(shift) && dayAusfallUserIds.has(shift.userId)}
                            onClick={dayClickable && !selectionMode ? () => onShiftClick(shift) : undefined}
                            onConfirm={dayClickable && !selectionMode ? onConfirmShift : undefined}
                            // Wie "War anders" bewusst OHNE den canEdit-Anteil
                            // von dayClickable: die Eigenbestätigung ist gerade
                            // für Nicht-Planer gedacht. Ownership und Status
                            // prüft die Zeile selbst (selfConfirmable).
                            onConfirmOwn={!other && !selectionMode ? onConfirmOwnShift : undefined}
                            korrekturVomPlaner={plannerCorrectedShiftIds?.has(shift.id) ?? false}
                            correctionObjection={correctionObjections?.get(shift.id)}
                            // Widersprechen ist Sache der betroffenen Person —
                            // wie "War anders" bewusst ohne canEdit-Anteil.
                            onObjectCorrection={!other && !selectionMode ? onObjectCorrection : undefined}
                            // Zurücknehmen ist Planer-Sache.
                            onWithdrawCorrection={dayClickable && !selectionMode ? onWithdrawCorrection : undefined}
                            deviationReport={deviationReports?.get(shift.id)}
                            // "War anders" ist für die Assistenzkraft selbst
                            // gedacht, NICHT nur für Bearbeitungsberechtigte —
                            // anders als onClick/onConfirm daher bewusst ohne
                            // canEdit-Anteil von dayClickable (Ownership/FIX/
                            // Vergangenheits-Check übernimmt DayDetailRow
                            // selbst). Annehmen/Widersprechen bleiben Planer-
                            // exklusiv, also weiterhin an dayClickable gekoppelt.
                            onReportDeviation={!other && !selectionMode ? onReportDeviation : undefined}
                            onAcceptDeviation={dayClickable && !selectionMode ? onAcceptDeviation : undefined}
                            onDisputeDeviation={dayClickable && !selectionMode ? onDisputeDeviation : undefined}
                            deviationActionPending={deviationActionPending}
                          />
                          {shift.notes && (
                            <p
                              data-testid={`agenda-shift-note-${shift.id}`}
                              className="border-b border-[#f1f1ee] px-4 pb-2 text-[11px] leading-snug text-muted-foreground last:border-b-0"
                            >
                              {shift.notes.length > 80
                                ? shift.notes.slice(0, 80) + "…"
                                : shift.notes}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
