import { format, isSameDay, isToday } from "date-fns";
import { de } from "date-fns/locale";
import { Card } from "@/components/ui/card";
import { Plus, Check, MessageSquare } from "lucide-react";
import { StatusBadge, type StatusBadgeKind } from "@/components/status-badge";
import { useTeam } from "@/context/team";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { userDotClass, type PersonColorAssignment } from "@/lib/shift-model-colors";
import { type Assistant } from "@/components/assistant-filter";
import {
  isAbsenceShift,
  isConfirmableShift,
  isMirrorShift,
  nameLines,
  PLANNING_STATUS_LABELS,
  type Shift,
  shiftLabel,
  type ShiftModelInfo,
} from "./dienstplan-helpers";

/** Zweizeiliges Zellen-Feld der Tabellenansicht (Task #855): flacheres
 *  Gegenstück zur Kalender-Pille mit denselben Icon-Quellen.
 *  Zeile 1: Status-Icon-Stack (StatusBadge — dieselbe Darstellung wie in der
 *  Dienstpille) + Zustandstext (Bestätigt/Entwurf/Vorschlag, Task #863: ersetzt
 *  den früheren Personen-Farbbalken; kürzt bei schmalen Spalten statt die
 *  Zeit-Zeile darunter zu verdrängen).
 *  Zeile 2: Uhr-Icon (StatusBadge kind="clock", identisch zur Pille) +
 *  Uhrzeit „HH:mm – HH:mm". Hintergrund weiß, Klick öffnet wie bisher den
 *  Bearbeiten-Dialog. Testids/Attribute bleiben unverändert
 *  (shift-badge-<id>, data-planning-status, shift-confirm-<id>,
 *  shift-note-icon-<id>), damit die bestehenden E2E-Specs weiter greifen. */
function TableShiftCell({
  shift,
  modelMap,
  onClick,
  onConfirm,
}: {
  shift: Shift;
  modelMap: Map<number, ShiftModelInfo>;
  onClick?: (e: React.MouseEvent) => void;
  onConfirm?: (shift: Shift) => void;
}) {
  const { selectedTeamId } = useTeam();
  const mirror = isMirrorShift(shift, selectedTeamId);
  const isTeam = shift.type === "team";
  const status = shift.planningStatus ?? "FIX";
  const label = shiftLabel(shift, modelMap);
  const einsatzLabel =
    shift.einsatzTeamId != null
      ? mirror
        ? `Aushilfe aus ${shift.homeTeamName ?? "anderem Team"}`
        : `Aushilfe für ${shift.einsatzTeamName ?? "anderes Team"}`
      : null;
  // Titel wie bisher: Label + Statuswort (FIX → „Bestätigt", sonst Entwurf/Vorschlag).
  const statusWord = status === "FIX" ? "Bestätigt" : (PLANNING_STATUS_LABELS[status] ?? status);
  const timeRange = `${format(new Date(shift.startTime), "HH:mm")} – ${format(new Date(shift.endTime), "HH:mm")}`;
  const baseIconKind: StatusBadgeKind =
    status === "FIX" ? "confirmed" : status === "ANGEBOTEN" ? "sent" : "draft";
  return (
    <div
      data-testid={`shift-badge-${shift.id}`}
      data-planning-status={status}
      className={`w-full overflow-hidden rounded-[4px] border border-[#c7ced8] bg-white px-[3px] py-[2px] leading-none ${mirror ? "cursor-default opacity-90" : "cursor-pointer"} transition-colors`}
      onClick={mirror ? undefined : onClick}
      title={
        mirror && einsatzLabel
          ? `${label} · ${einsatzLabel} (wird im Stammteam bearbeitet)`
          : `${label}${einsatzLabel ? ` · ${einsatzLabel}` : ""} · ${statusWord}`
      }
    >
      {/* Zeile 1: Status-Icon(s) + Zustandstext (Task #863: ersetzt den früheren Personen-Farbbalken). */}
      <div className="flex min-h-[20px] items-center gap-[4px]">
        <span className="flex shrink-0 items-center gap-[3px]">
          <StatusBadge kind={baseIconKind} label={statusWord} />
          {shift.isVertretung && <StatusBadge kind="vertretung" label="Vertretung" />}
        </span>
        <span className="min-w-0 flex-1 truncate text-[9px] font-semibold uppercase tracking-wide text-[#444444]">
          {statusWord}
        </span>
        {shift.notes && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  data-testid={`shift-note-icon-${shift.id}`}
                  className="inline-flex shrink-0 items-center text-[#555555] cursor-default"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MessageSquare className="h-2.5 w-2.5 shrink-0" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[240px] break-words text-xs">
                {shift.notes}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      {/* Zeile 2: Uhr-Icon + Uhrzeit (Teamdienste ohne Uhrzeit, wie in der Pille). */}
      <div className="flex min-h-[20px] items-center gap-[2px]">
        <StatusBadge kind="clock" />
        <span className="min-w-0 flex-1 truncate whitespace-nowrap text-[10px] font-semibold tracking-[-0.2px] tabular-nums text-[#444444]">
          {isTeam ? "Teamdienst" : timeRange}
        </span>
      </div>
      {onConfirm && !mirror && isConfirmableShift(shift) && (
        <button
          type="button"
          data-testid={`shift-confirm-${shift.id}`}
          title="Als verbindlich bestätigen"
          onClick={(e) => {
            e.stopPropagation();
            onConfirm(shift);
          }}
          className="mb-[1px] mt-[2px] inline-flex w-full items-center justify-center gap-1 rounded border border-[#c7ced8] bg-card/60 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#444444] hover:bg-muted transition-colors"
        >
          <Check className="h-3 w-3" />
          Bestätigen
        </button>
      )}
    </div>
  );
}

/** Tabellenansicht (Zeile pro Assistenzkraft, Spalte pro Tag). Wird sowohl am
 * Desktop als auch — mit der vorhandenen Assistenzkraft-Filterung, die die
 * Zeilenzahl reduziert — am Smartphone verwendet (per Horizontal-Scroll). */
export function DienstplanTableView({
  days,
  year,
  month,
  tableAssistants,
  allShifts,
  isAdmin,
  isSelectionMode,
  selectedDates,
  toggleDate,
  openCreate,
  openEdit,
  onConfirmShift,
  modelMap,
  personColors,
  onPrevMonth,
  onNextMonth,
  absenceByUser,
  selectedDay,
  onSelectDay,
}: {
  days: Date[];
  year: number;
  month: number;
  tableAssistants: Assistant[];
  allShifts: Shift[];
  isAdmin: boolean;
  isSelectionMode: boolean;
  selectedDates: string[];
  toggleDate: (day: Date) => void;
  openCreate: (date: Date, userId?: number) => void;
  openEdit: (shift: Shift) => void;
  onConfirmShift?: (shift: Shift) => void;
  modelMap: Map<number, ShiftModelInfo>;
  personColors: PersonColorAssignment | undefined;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  absenceByUser: Map<number, Set<string>>;
  selectedDay: Date;
  onSelectDay: (day: Date) => void;
}) {
  return (
    <Card
      className="w-full overflow-x-auto border-border/50 shadow-sm"
      tabIndex={0}
      aria-label="Tabellenansicht — ArrowLeft/ArrowRight für Monatswechsel"
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "PageUp") {
          e.preventDefault();
          onPrevMonth();
        } else if (e.key === "ArrowRight" || e.key === "PageDown") {
          e.preventDefault();
          onNextMonth();
        }
      }}
    >
      <table className="min-w-full table-fixed text-sm">
        <caption className="sr-only">
          Dienstplan für {format(new Date(year, month - 1, 1), "MMMM yyyy", { locale: de })}
        </caption>
        <thead>
          <tr className="h-px border-b bg-muted/50">
            <th scope="col" className="p-3 text-left font-medium sticky left-0 bg-muted/50 backdrop-blur-sm z-10 w-48">
              {isAdmin ? "Assistenzkraft" : "Schicht"}
            </th>
            {days.map((day) => {
              const colSelected =
                isSelectionMode && selectedDates.includes(format(day, "yyyy-MM-dd"));
              const isDayActive = !isSelectionMode && isSameDay(day, selectedDay);
              return (
              <th
                key={day.toISOString()}
                scope="col"
                data-testid={isSelectionMode ? `col-header-${format(day, "yyyy-MM-dd")}` : "table-day-header"}
                data-selected={colSelected ? "true" : "false"}
                data-active={isDayActive ? "true" : "false"}
                onClick={
                  isSelectionMode && isAdmin
                    ? () => toggleDate(day)
                    : () => onSelectDay(day)
                }
                className={`p-2 font-medium text-center w-[88px] min-w-[88px] cursor-pointer hover:bg-primary/5 ${
                  colSelected
                    ? "bg-assistenz-mint ring-1 ring-inset ring-assistenz-brand"
                    : isDayActive
                      ? "bg-assistenz-mint/60 ring-2 ring-inset ring-assistenz-brand"
                      : isToday(day)
                        ? "bg-primary/10"
                        : ""
                }`}
              >
                <div className="text-xs text-muted-foreground">{format(day, "E", { locale: de })}</div>
                <div
                  className={`text-sm ${
                    isToday(day)
                      ? "bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center mx-auto"
                      : ""
                  }`}
                >
                  {format(day, "d")}
                </div>
              </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {tableAssistants.length === 0 ? (
            <tr>
              <td colSpan={days.length + 1} className="p-8 text-center text-muted-foreground">
                Keine Einträge gefunden.
              </td>
            </tr>
          ) : (
            tableAssistants.map((assistant) => {
              const assistantShifts = allShifts.filter((s) => s.userId === assistant.id);
              return (
              <tr
                key={assistant.id}
                className="border-b last:border-0 hover:bg-muted/20 transition-colors"
              >
                <th scope="row" className="px-3 py-1.5 font-medium sticky left-0 bg-card hover:bg-muted/20 transition-colors z-10 shadow-[1px_0_0_0_hsl(var(--border))]">
                  {isAdmin ? (
                    <span className="inline-flex items-center gap-2">
                      <span className={`inline-block h-2.5 w-2.5 rounded-full shrink-0 ${userDotClass(assistant.id, personColors)}`} />
                      <span className="min-w-0 text-center leading-snug">
                        <span className="block">{nameLines(assistant.name).firstName}</span>
                        <span className="block">{nameLines(assistant.name).lastName || "\u00a0"}</span>
                      </span>
                    </span>
                  ) : (
                    "Meine Schichten"
                  )}
                </th>
                {days.map((day, dayIdx) => {
                  const dayShifts = assistantShifts.filter(
                    (s) => isSameDay(new Date(s.startTime), day)
                  );
                  const regular = dayShifts.filter((s) => !isAbsenceShift(s));
                  const dk = format(day, "yyyy-MM-dd");
                  const colSelected = isSelectionMode && selectedDates.includes(dk);
                  // Zelle ausgegraut, wenn die Assistenzkraft an diesem Tag abwesend ist
                  // (nur in der normalen Tabellenansicht, nicht im Auswahl-Modus).
                  const isAbsent =
                    isAdmin && !isSelectionMode && (absenceByUser.get(assistant.id)?.has(dk) ?? false);
                  const cellClickable = isAdmin;
                  const isDayActive = !isSelectionMode && isSameDay(day, selectedDay);
                  return (
                    <td
                      key={day.toISOString()}
                      className={`p-1 border-l border-border/30 align-top ${
                        cellClickable ? "cursor-pointer group" : ""
                      } ${
                        colSelected
                          ? "bg-assistenz-mint/60"
                          : isDayActive
                            ? "bg-assistenz-mint/30 ring-2 ring-inset ring-assistenz-brand"
                            : isAbsent
                              ? "bg-muted/40"
                              : isToday(day)
                                ? "bg-primary/5"
                                : isAdmin && !isSelectionMode
                                  ? "hover:bg-muted/30"
                                  : ""
                      }`}
                      onClick={
                        isAdmin
                          ? isSelectionMode
                            ? () => toggleDate(day)
                            : () => {
                                onSelectDay(day);
                                openCreate(day, assistant.id);
                              }
                          : undefined
                      }
                      aria-disabled={isAbsent || undefined}
                      title={
                        isAdmin && !isSelectionMode
                          ? isAbsent
                            ? "An diesem Tag abwesend"
                            : "Klicken zum Anlegen einer Schicht"
                          : undefined
                      }
                    >
                      <div className="space-y-1 min-h-[26px]">
                        {regular.map((s) => (
                          <TableShiftCell
                            key={s.id}
                            shift={s}
                            modelMap={modelMap}
                            onClick={isAdmin && !isSelectionMode ? (e) => { e.stopPropagation(); openEdit(s); } : undefined}
                            onConfirm={isAdmin && !isSelectionMode ? onConfirmShift : undefined}
                          />
                        ))}
                        {regular.length === 0 && isAdmin && !isAbsent && (
                          <div className="hidden group-hover:flex items-center justify-center h-8 text-muted-foreground/40">
                            <Plus className="h-3.5 w-3.5" />
                          </div>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
              );
            })
          )}
        </tbody>
      </table>
    </Card>
  );
}
