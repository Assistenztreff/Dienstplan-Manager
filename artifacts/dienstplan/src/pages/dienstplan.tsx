import { isAdminRole } from "@/lib/roles";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams, useLocation } from "wouter";
import {
  useListShifts,
  useListUsers,
  useListShiftModels,
  useUpdateShift,
  getListShiftsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isToday, getDay, isValid, startOfDay, startOfWeek, addDays, differenceInCalendarDays, isWithinInterval } from "date-fns";
import { de } from "date-fns/locale";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Plus, List, CalendarDays, Table2, Check, CheckSquare, X, CalendarPlus, Trash2, Pencil, ChevronDown, Users, Lock, Download } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ShiftDialog } from "@/components/shift-dialog";
import { BulkDeleteDialog } from "@/components/bulk-delete-dialog";
import { BulkEditDialog } from "@/components/bulk-edit-dialog";
import { TeamSwitcher } from "@/components/team-switcher";
import { useTeam } from "@/context/team";
import { useAuth } from "@/context/auth";
import {
  buildPersonColorAssignment,
  userBadgeClass,
  userDotClass,
  userInitialsClass,
  nameInitials,
  type PersonColorAssignment,
} from "@/lib/shift-model-colors";
import { hasAccess, getLimit } from "@/lib/entitlements";
import { type HeaderTier, useIsMobileViewport, useHeaderTier } from "@/lib/header-tier";
import { toast } from "sonner";
import { useSelectedAssistant, type Assistant } from "@/components/assistant-filter";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { MonthYearPicker } from "@/components/month-year-picker";

type Shift = {
  id: number;
  userId: number;
  startTime: string;
  endTime: string;
  type: string;
  planningStatus?: string | null;
  shiftModelId?: number | null;
  notes?: string | null;
  user?: { name: string } | null;
  einsatzTeamId?: number | null;
  einsatzTeamName?: string | null;
  homeTeamName?: string | null;
};

const PLANNING_STATUS_LABELS: Record<string, string> = {
  VORLAEUFIG: "Entwurf",
  ANGEBOTEN: "Vorschlag",
};

const PLANNING_STATUS_BADGE_CLASSES: Record<string, string> = {
  VORLAEUFIG: "bg-foreground/10 text-foreground/70",
  ANGEBOTEN: "bg-sky-200 text-sky-900",
};

function isConfirmableShift(shift: Shift): boolean {
  if (shift.type === "vacation" || shift.type === "sick") return false;
  return shift.planningStatus === "VORLAEUFIG" || shift.planningStatus === "ANGEBOTEN";
}

function planningStatusBadgeOutline(shift: Shift): string {
  if (shift.planningStatus === "VORLAEUFIG") return "border-dashed opacity-70";
  if (shift.planningStatus === "ANGEBOTEN") return "border-dashed";
  return "";
}

type ShiftModelInfo = { name: string };

const SHIFT_TYPE_LABELS: Record<string, string> = {
  active: "Aktivdienst",
  standby: "Bereitschaft",
  night: "Nachtdienst",
  full_day: "24h-Dienst",
  vacation: "Urlaub",
  sick: "Krankheit",
  freizeitausgleich: "Freizeitausgleich",
  team: "Teamsitzung",
  kind_krank: "Kind krank",
  freistellung: "Freistellung (bezahlt)",
  abgesagt_ag: "Abgesagt (Arbeitgeber)",
  abgesagt_an: "Abgesagt (Assistenz)",
  urlaubsabgeltung: "Urlaubsabgeltung",
};

const SHIFT_TYPE_CLASSES: Record<string, string> = {
  active: "bg-primary/20 text-assistenz-brand border-assistenz-brand/20 hover:bg-primary/30",
  standby: "bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100",
  night: "bg-blue-50 text-blue-800 border-blue-200 hover:bg-blue-100",
  full_day: "bg-purple-50 text-purple-800 border-purple-200 hover:bg-purple-100",
  // Abwesenheiten: eigene semantische Farben, bewusst KEINE der 8 hellen
  // Personenfarben (sattere Flaechen + kraeftige Rahmen, WCAG AA).
  vacation: "bg-amber-200 text-amber-950 border-amber-600 hover:bg-amber-300",
  sick: "bg-slate-200 text-slate-800 border-slate-500 hover:bg-slate-300",
  freizeitausgleich: "bg-emerald-200 text-emerald-950 border-emerald-600 hover:bg-emerald-300",
  // Team-Eintrag (Teamsitzung): semantische Farbe (Himmelblau), bewusst KEINE
  // Personenfarbe — der Eintrag gilt dem ganzen Team.
  team: "bg-sky-200 text-sky-950 border-sky-600 hover:bg-sky-300",
  // Neue Abrechnungskategorien: ebenfalls semantische Farben.
  kind_krank: "bg-zinc-200 text-zinc-800 border-zinc-500 hover:bg-zinc-300",
  freistellung: "bg-teal-200 text-teal-950 border-teal-600 hover:bg-teal-300",
  abgesagt_ag: "bg-orange-200 text-orange-950 border-orange-600 hover:bg-orange-300",
  abgesagt_an: "bg-stone-200 text-stone-800 border-stone-500 hover:bg-stone-300",
  urlaubsabgeltung: "bg-lime-200 text-lime-950 border-lime-600 hover:bg-lime-300",
};

function shiftLabel(shift: Shift, modelMap: Map<number, ShiftModelInfo>): string {
  if (shift.type === "work") {
    return (shift.shiftModelId ? modelMap.get(shift.shiftModelId)?.name : undefined) ?? "Dienst";
  }
  return SHIFT_TYPE_LABELS[shift.type] ?? shift.type;
}

// Kollisionsarme Team-Farbzuordnung (userId → Palettenfarbe), von der Seite
// aus der Team-Mitgliederliste berechnet. Ohne Provider (oder für IDs
// außerhalb des Teams, z. B. Aushilfe-Spiegel) greift der Hash-Fallback.
const PersonColorsContext = createContext<PersonColorAssignment | undefined>(undefined);

function usePersonColors(): PersonColorAssignment | undefined {
  return useContext(PersonColorsContext);
}

function shiftBadgeClasses(shift: Shift, personColors?: PersonColorAssignment): string {
  if (isAbsenceShift(shift) || shift.type === "team") {
    return (
      SHIFT_TYPE_CLASSES[shift.type] ?? "bg-primary/20 text-assistenz-brand border-assistenz-brand/20 hover:bg-primary/30"
    );
  }
  return userBadgeClass(shift.userId, personColors);
}

function usePersistentState<T extends string>(key: string, fallback: T, allowed: readonly T[]): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored != null && (allowed as readonly string[]).includes(stored)) return stored as T;
    } catch {
    }
    return fallback;
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, value);
    } catch {
    }
  }, [key, value]);

  return [value, setValue];
}

const WEEKDAY_LABELS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

const SHIFT_TYPE_DOTS: Record<string, string> = {
  active: "bg-primary",
  standby: "bg-amber-500",
  night: "bg-blue-500",
  full_day: "bg-purple-500",
  vacation: "bg-amber-500",
  sick: "bg-slate-500",
  freizeitausgleich: "bg-emerald-600",
  team: "bg-sky-500",
  kind_krank: "bg-zinc-500",
  freistellung: "bg-teal-600",
  abgesagt_ag: "bg-orange-600",
  abgesagt_an: "bg-stone-500",
  urlaubsabgeltung: "bg-lime-600",
};

// Planungsstatus in den Tageszellen: VORLAEUFIG = gestrichelter Rand + reduzierte
// Deckkraft (nicht nur Transparenz), ANGEBOTEN = durchgezogener Rand (erkennbar
// unterscheidbar), FIX = ohne Zusatz.
function shiftDotStatusClass(shift: Shift): string {
  if (isAbsenceShift(shift)) return "";
  const status = shift.planningStatus ?? "FIX";
  if (status === "VORLAEUFIG") return "opacity-60 border-2 border-dashed border-foreground";
  if (status === "ANGEBOTEN") return "border-2 border-foreground/70";
  return "";
}

const ABSENCE_TYPES = new Set([
  "vacation",
  "sick",
  "freizeitausgleich",
  "kind_krank",
  "freistellung",
  "abgesagt_ag",
  "abgesagt_an",
  "urlaubsabgeltung",
]);
function isAbsenceShift(shift: Shift): boolean {
  return ABSENCE_TYPES.has(shift.type);
}

function dayKey(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function absenceMapFor(shifts: Shift[]): Map<string, Shift> {
  const m = new Map<string, Shift>();
  for (const s of shifts) {
    if (isAbsenceShift(s)) m.set(dayKey(new Date(s.startTime)), s);
  }
  return m;
}

type AbsenceRange = {
  userId: number;
  userName: string;
  type: string;
  start: Date;
  end: Date;
  days: number;
  shift: Shift;
};

function buildAbsenceRanges(shifts: Shift[], nameById: Map<number, string>): AbsenceRange[] {
  const byKey = new Map<string, Shift[]>();
  for (const s of shifts) {
    if (!isAbsenceShift(s)) continue;
    const k = `${s.userId}|${s.type}`;
    const arr = byKey.get(k);
    if (arr) arr.push(s);
    else byKey.set(k, [s]);
  }

  const ranges: AbsenceRange[] = [];
  for (const group of byKey.values()) {
    const sorted = group
      .map((s) => ({ s, d: startOfDay(new Date(s.startTime)) }))
      .sort((a, b) => a.d.getTime() - b.d.getTime());

    let runStartIdx = 0;
    for (let i = 1; i <= sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = i < sorted.length ? sorted[i] : undefined;
      const consecutive = cur != null && differenceInCalendarDays(cur.d, prev.d) <= 1;
      if (!consecutive) {
        const first = sorted[runStartIdx];
        ranges.push({
          userId: first.s.userId,
          userName: first.s.user?.name ?? nameById.get(first.s.userId) ?? "Unbekannt",
          type: first.s.type,
          start: first.d,
          end: prev.d,
          days: differenceInCalendarDays(prev.d, first.d) + 1,
          shift: first.s,
        });
        runStartIdx = i;
      }
    }
  }

  return ranges.sort(
    (a, b) =>
      a.start.getTime() - b.start.getTime() ||
      a.userName.localeCompare(b.userName, "de", { sensitivity: "base" }),
  );
}

function absenceRangeLabel(r: AbsenceRange): string {
  if (isSameDay(r.start, r.end)) return format(r.start, "EEEE, d. MMMM", { locale: de });
  if (r.start.getMonth() === r.end.getMonth()) {
    return `${format(r.start, "d.")} – ${format(r.end, "d. MMMM", { locale: de })}`;
  }
  return `${format(r.start, "d. MMM", { locale: de })} – ${format(r.end, "d. MMM", { locale: de })}`;
}

function TeamAbsenceOverview({
  shifts,
  assistants,
  onShiftClick,
  canEdit,
}: {
  shifts: Shift[];
  assistants: Assistant[];
  onShiftClick: (shift: Shift) => void;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const today = startOfDay(new Date());
  const nameById = new Map(assistants.map((a) => [a.id, a.name]));
  const ranges = buildAbsenceRanges(shifts, nameById).filter(
    (r) => r.end.getTime() >= today.getTime(),
  );

  const thisWeekStart = startOfWeek(today, { weekStartsOn: 1 });
  const weeks = new Map<string, { weekStart: Date; ranges: AbsenceRange[] }>();
  for (const r of ranges) {
    const ws = startOfWeek(r.start, { weekStartsOn: 1 });
    const key = dayKey(ws);
    const bucket = weeks.get(key);
    if (bucket) bucket.ranges.push(r);
    else weeks.set(key, { weekStart: ws, ranges: [r] });
  }
  const sortedWeeks = [...weeks.values()].sort(
    (a, b) => a.weekStart.getTime() - b.weekStart.getTime(),
  );

  function weekLabel(ws: Date): string {
    const diff = differenceInCalendarDays(ws, thisWeekStart);
    if (diff <= 0 && differenceInCalendarDays(addDays(ws, 6), today) >= 0) return "Diese Woche";
    if (diff === 7) return "Nächste Woche";
    const we = addDays(ws, 6);
    if (ws.getMonth() === we.getMonth()) {
      return `Woche ${format(ws, "d.")} – ${format(we, "d. MMM", { locale: de })}`;
    }
    return `Woche ${format(ws, "d. MMM", { locale: de })} – ${format(we, "d. MMM", { locale: de })}`;
  }

  return (
    <Card className="border-border/50 shadow-sm" data-testid="team-absence-overview">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-4 py-3 text-left"
        onClick={() => setOpen((v) => !v)}
        data-testid="team-absence-toggle"
      >
        <Users className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="font-semibold text-sm">Team-Abwesenheiten</span>
        <span className="text-xs text-muted-foreground" data-testid="team-absence-count">
          {ranges.length === 0
            ? "keine aktuell"
            : `${ranges.length} ${ranges.length === 1 ? "Zeitraum" : "Zeiträume"}`}
        </span>
        <ChevronDown
          className={`ml-auto h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="max-h-56 overflow-y-auto border-t border-border/50 px-4 py-3">
          {ranges.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="team-absence-empty">
              Keine laufenden oder anstehenden Abwesenheiten in diesem Monat.
            </p>
          ) : (
            <div className="space-y-4">
              {sortedWeeks.map((week) => (
                <div key={dayKey(week.weekStart)} className="space-y-1.5">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {weekLabel(week.weekStart)}
                  </div>
                  <div className="space-y-1">
                    {week.ranges.map((r) => {
                      const ongoing = isWithinInterval(today, { start: r.start, end: r.end });
                      return (
                        <div
                          key={`${r.userId}-${r.type}-${dayKey(r.start)}`}
                          data-testid="team-absence-row"
                          className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border/40 bg-muted/20 px-3 py-2 text-sm ${
                            canEdit ? "cursor-pointer hover:bg-muted/40 transition-colors" : ""
                          }`}
                          onClick={canEdit ? () => onShiftClick(r.shift) : undefined}
                        >
                          <span
                            className={`inline-block h-2.5 w-2.5 rounded-full shrink-0 ${SHIFT_TYPE_DOTS[r.type] ?? "bg-primary"}`}
                          />
                          <span className="font-medium">{r.userName}</span>
                          <span className="text-muted-foreground">
                            {SHIFT_TYPE_LABELS[r.type] ?? r.type}
                          </span>
                          <span className="ml-auto text-muted-foreground">
                            {absenceRangeLabel(r)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            ({r.days} {r.days === 1 ? "Tag" : "Tage"})
                          </span>
                          {ongoing && (
                            <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-assistenz-brand">
                              läuft
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

type DialogState =
  | { mode: "closed" }
  | { mode: "create"; date: Date; userId?: number }
  | { mode: "edit"; shift: Shift }
  | { mode: "bulk-create"; dates: string[] }
  | { mode: "bulk-edit"; dates: string[] }
  | { mode: "bulk-delete"; dates: string[] }
  | { mode: "confirm-all" };


// Aushilfe-Spiegel: Die Schicht gehört einem ANDEREN eigenen Team und ist nur
// als "Einsatz für" das aktuell angezeigte Team markiert — dort ist sie
// schreibgeschützt (bearbeitet wird im Stammteam).
function isMirrorShift(shift: Shift, selectedTeamId: number | null): boolean {
  return shift.einsatzTeamId != null && shift.einsatzTeamId === selectedTeamId;
}

function ShiftBadge({
  shift,
  showName,
  modelMap,
  onClick,
  onConfirm,
}: {
  shift: Shift;
  showName?: boolean;
  modelMap: Map<number, ShiftModelInfo>;
  onClick?: (e: React.MouseEvent) => void;
  onConfirm?: (shift: Shift) => void;
}) {
  const { selectedTeamId } = useTeam();
  const personColors = usePersonColors();
  const mirror = isMirrorShift(shift, selectedTeamId);
  const einsatzLabel =
    shift.einsatzTeamId != null
      ? mirror
        ? `Aushilfe aus ${shift.homeTeamName ?? "anderem Team"}`
        : `Aushilfe für ${shift.einsatzTeamName ?? "anderes Team"}`
      : null;
  const classes = shiftBadgeClasses(shift, personColors);
  const isAbsence = shift.type === "vacation" || shift.type === "sick";
  const isTeamEntry = shift.type === "team";
  const start = new Date(shift.startTime);
  const end = new Date(shift.endTime);
  const startLabel = format(start, "HH:mm");
  const endLabel = format(end, "HH:mm");
  const label = shiftLabel(shift, modelMap);
  const statusLabel = !isAbsence ? PLANNING_STATUS_LABELS[shift.planningStatus ?? ""] : undefined;
  return (
    <div
      data-testid={`shift-badge-${shift.id}`}
      data-planning-status={shift.planningStatus ?? "FIX"}
      className={`w-full text-xs rounded border px-2 py-1 leading-snug ${mirror ? "cursor-default opacity-90" : "cursor-pointer"} transition-colors ${classes} ${planningStatusBadgeOutline(shift)}`}
      onClick={mirror ? undefined : onClick}
      title={
        mirror && einsatzLabel
          ? `${label} · ${einsatzLabel} (wird im Stammteam bearbeitet)`
          : statusLabel
            ? `${label} · ${statusLabel}`
            : label
      }
    >
      {showName && shift.user && (
        <div className="font-medium truncate">{shift.user.name}</div>
      )}
      {einsatzLabel && (
        <div
          data-testid={`shift-einsatz-badge-${shift.id}`}
          className="mb-0.5 inline-flex items-center rounded bg-foreground/15 px-1 py-px text-[10px] font-semibold uppercase tracking-wide"
        >
          {einsatzLabel}
        </div>
      )}
      {statusLabel && (
        <div
          className={`mb-0.5 inline-flex items-center rounded px-1 py-px text-[10px] font-semibold uppercase tracking-wide ${PLANNING_STATUS_BADGE_CLASSES[shift.planningStatus ?? ""] ?? ""}`}
        >
          {statusLabel}
        </div>
      )}
      {isAbsence || isTeamEntry ? (
        <div className="font-medium truncate">{label}</div>
      ) : (
        <>
          <div className="truncate">
            {startLabel}–{endLabel}
          </div>
          <div className="text-[11px] opacity-70 truncate">{label}</div>
        </>
      )}
      {onConfirm && !mirror && isConfirmableShift(shift) && (
        <button
          type="button"
          data-testid={`shift-confirm-${shift.id}`}
          title="Als verbindlich bestätigen"
          onClick={(e) => {
            e.stopPropagation();
            onConfirm(shift);
          }}
          className="mt-1 inline-flex w-full items-center justify-center gap-1 rounded border border-current/30 bg-card/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide hover:bg-card transition-colors"
        >
          <Check className="h-3 w-3" />
          Bestätigen
        </button>
      )}
    </div>
  );
}

function AbsenceTableBar({
  shift,
  isStart,
  isEnd,
  modelMap,
  onClick,
}: {
  shift: Shift;
  isStart: boolean;
  isEnd: boolean;
  modelMap: Map<number, ShiftModelInfo>;
  onClick?: (e: React.MouseEvent) => void;
}) {
  const personColors = usePersonColors();
  const classes = shiftBadgeClasses(shift, personColors);
  const cap = `${isStart ? "rounded-l" : "border-l-0 -ml-[5px]"} ${
    isEnd ? "rounded-r" : "border-r-0 -mr-1"
  }`;
  return (
    <div
      data-testid={`shift-badge-${shift.id}`}
      className={`w-full h-6 flex items-center text-xs leading-none px-2 border cursor-pointer transition-colors overflow-hidden ${classes} ${cap}`}
      onClick={onClick}
      title={shiftLabel(shift, modelMap)}
    >
      {isStart && <span className="font-medium truncate">{shiftLabel(shift, modelMap)}</span>}
    </div>
  );
}

function AgendaView({
  days,
  shifts,
  modelMap,
  onDayClick,
  onShiftClick,
  onConfirmShift,
  canEdit,
  selectionMode = false,
  selectedDates,
  onToggleDate,
  onPrevMonth,
  onNextMonth,
}: {
  days: Date[];
  shifts: Shift[];
  modelMap: Map<number, ShiftModelInfo>;
  onDayClick: (day: Date) => void;
  onShiftClick: (shift: Shift) => void;
  onConfirmShift?: (shift: Shift) => void;
  canEdit: boolean;
  selectionMode?: boolean;
  selectedDates?: string[];
  onToggleDate?: (day: Date) => void;
  /** Monatswechsel per Tastatur: ← / PageUp → vorheriger Monat */
  onPrevMonth?: () => void;
  /** Monatswechsel per Tastatur: → / PageDown → nächster Monat */
  onNextMonth?: () => void;
}) {
  const selectedDateSet = new Set(selectedDates ?? []);
  return (
    <div
      className="space-y-1"
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
      {days.map((day) => {
        const dayShifts = shifts.filter((s) => isSameDay(new Date(s.startTime), day));
        const isCurrentDay = isToday(day);
        const bulkSelected = selectionMode && selectedDateSet.has(format(day, "yyyy-MM-dd"));

        return (
          <div
            key={day.toISOString()}
            data-testid={`agenda-day-${format(day, "yyyy-MM-dd")}`}
            data-selected={bulkSelected ? "true" : "false"}
            className={`rounded-lg border overflow-hidden ${
              bulkSelected ? "border-primary ring-2 ring-primary bg-primary/5" : "border-border/40"
            }`}
          >
            <button
              type="button"
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                isCurrentDay
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-muted/40 text-foreground hover:bg-muted/70"
              } ${!canEdit ? "cursor-default pointer-events-none" : ""}`}
              onClick={() =>
                canEdit && (selectionMode ? onToggleDate?.(day) : onDayClick(day))
              }
            >
              <span className="text-sm font-semibold min-w-[24px]">{format(day, "d")}</span>
              <span className="text-sm">{format(day, "EEEE", { locale: de })}</span>
              {canEdit && (
                <span
                  className={`ml-auto flex items-center gap-1 text-xs ${
                    isCurrentDay ? "opacity-80" : "text-muted-foreground"
                  }`}
                >
                  {dayShifts.length > 0 && (
                    <span className="font-medium">{dayShifts.length}</span>
                  )}
                  <Plus className="h-3.5 w-3.5" />
                </span>
              )}
            </button>

            <div className="bg-card px-3 py-2 space-y-1.5">
              {dayShifts.length > 0 ? (
                dayShifts.map((shift) => (
                  <ShiftBadge
                    key={shift.id}
                    shift={shift}
                    showName={canEdit}
                    modelMap={modelMap}
                    onClick={canEdit && !selectionMode ? (e) => { e.stopPropagation(); onShiftClick(shift); } : undefined}
                    onConfirm={canEdit && !selectionMode ? onConfirmShift : undefined}
                  />
                ))
              ) : (
                <p className="text-xs text-muted-foreground">
                  {canEdit ? "Keine Schichten — tippen zum Hinzufügen" : "Keine Schichten"}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MonthGrid({
  days,
  monthStart,
  shifts,
  modelMap,
  selectedDay,
  onSelectDay,
  onAddShift,
  onShiftClick,
  onConfirmShift,
  canEdit,
  selectionMode = false,
  selectedDates,
  onToggleDate,
  onNavigateMonth,
  focusDate,
  onFocusDateHandled,
}: {
  days: Date[];
  monthStart: Date;
  shifts: Shift[];
  modelMap: Map<number, ShiftModelInfo>;
  selectedDay: Date;
  onSelectDay: (day: Date) => void;
  onAddShift: (day: Date) => void;
  onShiftClick: (shift: Shift) => void;
  onConfirmShift?: (shift: Shift) => void;
  canEdit: boolean;
  selectionMode?: boolean;
  selectedDates?: string[];
  onToggleDate?: (day: Date) => void;
  onNavigateMonth?: (targetDate: Date) => void;
  focusDate?: Date | null;
  onFocusDateHandled?: () => void;
}) {
  const personColors = usePersonColors();
  const selectedDateSet = new Set(selectedDates ?? []);
  const offset = (getDay(monthStart) + 6) % 7;
  const blanks = Array.from({ length: offset });
  const selectedShifts = shifts.filter((s) => isSameDay(new Date(s.startTime), selectedDay));

  // Roving Tabindex (WAI-ARIA-Grid-Pattern): genau EINE Tageszelle ist in der
  // Tab-Reihenfolge; Pfeiltasten bewegen den Fokus, Home/End springen zum
  // Wochenanfang/-ende. Enter/Space feuern den nativen Button-Klick.
  const cellRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);
  useEffect(() => {
    setFocusedIdx(null);
  }, [monthStart.getTime()]);
  // Zieltag nach Tastatur-Wechsel über die Monatsgrenze fokussieren. Der
  // Merker lebt im Eltern-State (focusDate), weil MonthGrid während des
  // Ladens des neuen Monats kurz unmountet. Nur die sichtbare Instanz
  // (mobil ODER Desktop) übernimmt den Fokus und räumt den Merker ab.
  useEffect(() => {
    if (!focusDate) return;
    const idx = days.findIndex((d) => isSameDay(d, focusDate));
    if (idx < 0) return;
    const el = cellRefs.current[idx];
    if (!el || el.offsetParent === null) return;
    setFocusedIdx(idx);
    el.focus();
    onFocusDateHandled?.();
  }, [focusDate, days]);
  const selectedIdx = days.findIndex((d) => isSameDay(d, selectedDay));
  const tabbableIdx = focusedIdx ?? (selectedIdx >= 0 ? selectedIdx : 0);
  const moveFocus = (idx: number) => {
    const clamped = Math.max(0, Math.min(days.length - 1, idx));
    setFocusedIdx(clamped);
    cellRefs.current[clamped]?.focus();
  };
  const handleCellKeyDown = (e: React.KeyboardEvent, idx: number) => {
    const col = (offset + idx) % 7;
    let target: number | null = null;
    // Pfeiltasten dürfen über die Monatsgrenze in den Vor-/Folgemonat
    // wechseln (WAI-ARIA-Grid-Pattern); Home/End bleiben in der Woche.
    let crossesBoundary = false;
    switch (e.key) {
      case "ArrowRight":
        target = idx + 1;
        crossesBoundary = true;
        break;
      case "ArrowLeft":
        target = idx - 1;
        crossesBoundary = true;
        break;
      case "ArrowDown":
        target = idx + 7;
        crossesBoundary = true;
        break;
      case "ArrowUp":
        target = idx - 7;
        crossesBoundary = true;
        break;
      case "Home":
        target = idx - col;
        break;
      case "End":
        target = idx + (6 - col);
        break;
      default:
        return;
    }
    e.preventDefault();
    if (crossesBoundary && (target < 0 || target > days.length - 1) && onNavigateMonth) {
      onNavigateMonth(addDays(days[idx], target - idx));
      return;
    }
    moveFocus(target);
  };

  const absenceTypesByDay = new Map<string, Set<string>>();
  for (const s of shifts) {
    if (!isAbsenceShift(s)) continue;
    const k = dayKey(new Date(s.startTime));
    if (!absenceTypesByDay.has(k)) absenceTypesByDay.set(k, new Set());
    absenceTypesByDay.get(k)!.add(s.type);
  }
  const hasAbsence = (day: Date | undefined, type: string): boolean =>
    day != null && (absenceTypesByDay.get(dayKey(day))?.has(type) ?? false);

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-sky-50 border border-sky-100 p-2">
        <div className="grid grid-cols-7 gap-1 mb-1">
          {WEEKDAY_LABELS.map((d) => (
            <div key={d} className="text-center text-[11px] font-medium text-muted-foreground py-1">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1" data-testid="month-grid">
          {blanks.map((_, i) => (
            <div key={`blank-${i}`} data-testid="month-grid-blank" />
          ))}
          {days.map((day, dayIdx) => {
            const dayShifts = shifts.filter((s) => isSameDay(new Date(s.startTime), day));
            const selected = isSameDay(day, selectedDay);
            const today = isToday(day);
            const nonAbsence = dayShifts.filter((s) => !isAbsenceShift(s));
            const dots = nonAbsence.slice(0, 3);
            const hiddenCount = nonAbsence.length - dots.length;
            const prevDay = dayIdx > 0 ? days[dayIdx - 1] : undefined;
            const nextDay = dayIdx < days.length - 1 ? days[dayIdx + 1] : undefined;
            const absenceBars = (["vacation", "sick"] as const)
              .filter((type) => hasAbsence(day, type))
              .map((type) => {
                const isStart = !hasAbsence(prevDay, type);
                const isEnd = !hasAbsence(nextDay, type);
                return (
                  <span
                    key={type}
                    data-testid={`absence-bar-${type}-${format(day, "yyyy-MM-dd")}`}
                    className={`block h-1.5 w-full ${SHIFT_TYPE_DOTS[type]} ${
                      isStart ? "rounded-l-full" : "-ml-0.5"
                    } ${isEnd ? "rounded-r-full" : "-mr-0.5"}`}
                  />
                );
              });
            const bulkSelected = selectionMode && selectedDateSet.has(format(day, "yyyy-MM-dd"));
            return (
              <button
                key={day.toISOString()}
                type="button"
                ref={(el) => {
                  cellRefs.current[dayIdx] = el;
                }}
                tabIndex={dayIdx === tabbableIdx ? 0 : -1}
                onKeyDown={(e) => handleCellKeyDown(e, dayIdx)}
                onFocus={() => setFocusedIdx(dayIdx)}
                data-testid={`day-cell-${format(day, "yyyy-MM-dd")}`}
                data-selected={(selectionMode ? bulkSelected : selected) ? "true" : "false"}
                aria-selected={selectionMode ? bulkSelected : selected}
                aria-label={format(day, "EEEE, d. MMMM yyyy", { locale: de })}
                onClick={() => {
                  if (selectionMode) {
                    onToggleDate?.(day);
                    return;
                  }
                  // Zwei-Stufen-Klick: 1. Klick markiert den Tag (Tagesdetail
                  // erscheint), erst der 2. Klick auf den bereits markierten
                  // Tag öffnet den Schicht-Dialog (nur Admin) — identisch für
                  // alle Tage, auch leere.
                  if (selected) {
                    if (canEdit) onAddShift(day);
                    return;
                  }
                  onSelectDay(day);
                }}
                className={`aspect-square rounded-lg flex flex-col items-center justify-start pt-1.5 gap-1 border transition-colors ${
                  bulkSelected
                    ? "border-primary ring-2 ring-primary bg-primary/5"
                    : selected && !selectionMode
                      ? "border-primary ring-2 ring-primary bg-primary/15"
                      : "bg-card border-transparent hover:bg-muted/40"
                }`}
              >
                <span
                  className={`text-xs leading-none flex items-center justify-center h-6 w-6 ${
                    today
                      ? "bg-primary text-primary-foreground rounded-full font-semibold"
                      : "font-medium"
                  }`}
                >
                  {format(day, "d")}
                </span>
                <span className="flex flex-col items-stretch gap-0.5 w-full min-w-0">
                  {absenceBars}
                  {dots.length > 0 && (
                    <span className="flex md:hidden flex-wrap items-center justify-center gap-0.5">
                      {dots.map((s) => (
                        <span
                          key={s.id}
                          title={s.user?.name}
                          className={`flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-bold leading-none text-white ${s.type === "team" ? "bg-sky-500" : userInitialsClass(s.userId, personColors)} ${shiftDotStatusClass(s)}`}
                        >
                          {s.user?.name ? nameInitials(s.user.name) : ""}
                        </span>
                      ))}
                    </span>
                  )}
                  {dots.length > 0 && (
                    <span className="hidden md:flex flex-col items-stretch gap-0.5 px-0.5">
                      {dots.map((s) => {
                        const chipClickable = canEdit && !selectionMode;
                        return (
                        <span
                          key={s.id}
                          data-testid={`day-chip-${s.id}`}
                          title={`${s.user?.name ?? ""} · ${format(new Date(s.startTime), "HH:mm")}`.trim()}
                          role={chipClickable ? "button" : undefined}
                          tabIndex={chipClickable ? 0 : undefined}
                          aria-label={
                            chipClickable
                              ? `Schicht bearbeiten: ${s.user?.name ?? ""} ${format(new Date(s.startTime), "HH:mm")}`.trim()
                              : undefined
                          }
                          onClick={
                            chipClickable
                              ? (e) => {
                                  e.stopPropagation();
                                  onShiftClick(s);
                                }
                              : undefined
                          }
                          onKeyDown={
                            chipClickable
                              ? (e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    onShiftClick(s);
                                  }
                                }
                              : undefined
                          }
                          className={`flex items-center justify-center gap-1 rounded border px-1 py-px text-[9px] leading-tight truncate ${s.type === "team" ? "bg-sky-200 text-sky-950 border-sky-600" : userBadgeClass(s.userId, personColors)} ${planningStatusBadgeOutline(s)} ${chipClickable ? "cursor-pointer hover:ring-1 hover:ring-primary/60" : ""}`}
                        >
                          <span className="font-bold">
                            {s.user?.name ? nameInitials(s.user.name) : ""}
                          </span>
                          <span className="font-medium">
                            {s.type === "team" ? "Team" : format(new Date(s.startTime), "HH:mm")}
                          </span>
                        </span>
                        );
                      })}
                    </span>
                  )}
                  {hiddenCount > 0 && (
                    <span
                      data-testid={`day-more-${format(day, "yyyy-MM-dd")}`}
                      className="text-[9px] font-semibold leading-none text-foreground/70 text-center"
                    >
                      +{hiddenCount}
                      <span className="sr-only md:hidden"> weitere</span>
                      <span className="hidden md:inline"> weitere</span>
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div
        className="rounded-lg border border-border/40 overflow-hidden"
        role="region"
        aria-live="polite"
        aria-label={`Tagesdetails ${format(selectedDay, "EEEE, d. MMMM", { locale: de })}`}
        data-testid="day-detail-panel"
      >
        <div className="flex items-center justify-between gap-2 px-4 py-2.5 bg-muted/40">
          <div className="min-w-0">
            <p className="text-sm font-semibold" data-testid="day-detail-header">
              {format(selectedDay, "EEEE, d. MMMM", { locale: de })}
            </p>
            <p className="text-xs text-muted-foreground">
              {selectedShifts.length === 0
                ? "Keine Dienste geplant"
                : `${selectedShifts.length} ${selectedShifts.length === 1 ? "Schicht" : "Schichten"}`}
            </p>
          </div>
          {canEdit && !selectionMode && (
            <Button size="sm" variant="outline" className="gap-1 shrink-0" data-testid="add-shift" onClick={() => onAddShift(selectedDay)}>
              <Plus className="h-3.5 w-3.5" />
              Schicht erstellen
            </Button>
          )}
        </div>
        <div className="bg-card px-3 py-2 space-y-1.5 max-h-48 overflow-y-auto overscroll-contain">
          {selectedShifts.length > 0 ? (
            selectedShifts.map((shift) => (
              <ShiftBadge
                key={shift.id}
                shift={shift}
                showName={canEdit}
                modelMap={modelMap}
                onClick={canEdit && !selectionMode ? (e) => { e.stopPropagation(); onShiftClick(shift); } : undefined}
                onConfirm={canEdit && !selectionMode ? onConfirmShift : undefined}
              />
            ))
          ) : (
            <p className="text-xs text-muted-foreground">Keine Dienste geplant</p>
          )}
        </div>
      </div>
    </div>
  );
}

function ViewToggle({
  value,
  onChange,
  options,
  showLabels,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; icon: LucideIcon }[];
  showLabels: boolean;
}) {
  return (
    <div className="inline-flex shrink-0 rounded-lg border border-border bg-muted/40 p-0.5">
      {options.map((opt) => {
        const Icon = opt.icon;
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            data-testid={`view-toggle-${opt.value}`}
            data-active={active ? "true" : "false"}
            onClick={() => onChange(opt.value)}
            title={opt.label}
            aria-label={opt.label}
            className={`flex items-center gap-1.5 rounded-md ${showLabels ? "px-3" : "px-1.5"} py-1.5 text-sm font-medium transition-colors ${
              active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
            }`}
          >
            <Icon className="h-4 w-4" />
            {showLabels && <span>{opt.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

function DienstplanHeader({
  isAdmin,
  assistants,
  selectedAssistant,
  onSelectAssistant,
  mobileView,
  onMobileView,
  desktopView,
  onDesktopView,
  confirmableCount,
  isBulkConfirming,
  onConfirmAll,
  canBasicExport,
  isExporting,
  onExport,
  canBulkEdit,
  isSelectionMode,
  onToggleSelection,
  month,
  year,
  onMonthSelect,
  onPrevMonth,
  onNextMonth,
}: {
  isAdmin: boolean;
  assistants: Assistant[];
  selectedAssistant: number | "all";
  onSelectAssistant: (v: number | "all") => void;
  mobileView: "list" | "grid";
  onMobileView: (v: "list" | "grid") => void;
  desktopView: "table" | "grid";
  onDesktopView: (v: "table" | "grid") => void;
  confirmableCount: number;
  isBulkConfirming: boolean;
  onConfirmAll: () => void;
  canBasicExport: boolean;
  isExporting: boolean;
  onExport: () => void;
  canBulkEdit: boolean;
  isSelectionMode: boolean;
  onToggleSelection: () => void;
  month: number;
  year: number;
  onMonthSelect: (month: number, year: number) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
}) {
  const { selectedTeamId } = useTeam();
  const personColors = usePersonColors();
  // Fuer den gesperrten Mehrfachauswahl-Button (Free): Klick fuehrt zur
  // Preise-/Premium-Seite statt eines toten disabled-Buttons.
  const [, navigateHeader] = useLocation();
  const contentKey = [
    isAdmin,
    assistants.length,
    String(selectedAssistant),
    selectedTeamId ?? "none",
    confirmableCount,
    canBasicExport,
    canBulkEdit,
    `${month}/${year}`,
  ].join("|");
  const { measureRef, tier } = useHeaderTier(
    contentKey,
    [isSelectionMode, isExporting].join("|"),
  );
  const showLabels = tier === "labels";
  const stacked = tier === "stack";

  const title = (
    <h2 className={`text-lg md:text-xl font-serif font-bold text-foreground ${stacked ? "min-w-0 shrink truncate" : "shrink-0"}`}>
      Dienstplan
    </h2>
  );

  const assistantFilter = isAdmin && assistants.length > 0 && (
    <Select
      value={String(selectedAssistant)}
      onValueChange={(v) => onSelectAssistant(v === "all" ? "all" : Number(v))}
    >
      <SelectTrigger
        className={
          stacked
            ? "h-9 w-full min-w-0 gap-1.5 truncate"
            : "h-9 w-auto min-w-[7.5rem] max-w-[190px] shrink gap-2 truncate"
        }
        data-testid="assistant-select"
        aria-label="Assistent filtern"
      >
        <SelectValue placeholder="Alle Assistenten" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all" data-testid="assistant-option-all">
          Alle Assistenten
        </SelectItem>
        {assistants.map((a) => (
          <SelectItem key={a.id} value={String(a.id)} data-testid={`assistant-option-${a.id}`}>
            <span className="inline-flex items-center gap-2">
              <span
                aria-hidden="true"
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold leading-none ${userInitialsClass(a.id, personColors)}`}
              >
                {nameInitials(a.name)}
              </span>
              {a.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const viewToggles = (
    <>
      <div className="md:hidden" data-testid="view-toggles-mobile">
        <ViewToggle
          value={mobileView}
          onChange={(v) => onMobileView(v as "list" | "grid")}
          showLabels={showLabels}
          options={[
            { value: "list", label: "Liste", icon: List },
            { value: "grid", label: "Monat", icon: CalendarDays },
          ]}
        />
      </div>
      <div className="hidden md:block" data-testid="view-toggles-desktop">
        <ViewToggle
          value={desktopView}
          onChange={(v) => onDesktopView(v as "table" | "grid")}
          showLabels={showLabels}
          options={[
            { value: "table", label: "Tabelle", icon: Table2 },
            { value: "grid", label: "Monat", icon: CalendarDays },
          ]}
        />
      </div>
    </>
  );

  const confirmAllButton = isAdmin && confirmableCount > 0 && (
    <Button
      variant="outline"
      size="sm"
      className={showLabels ? "gap-1.5" : `relative h-9 shrink-0 px-0 ${stacked ? "w-8" : "w-9"}`}
      onClick={onConfirmAll}
      disabled={isBulkConfirming}
      title="Alle Entwürfe bestätigen"
      aria-label="Alle Entwürfe bestätigen"
      data-testid="confirm-all-drafts"
    >
      <Check className="h-4 w-4" />
      {showLabels ? (
        <>
          <span>Alle bestätigen</span>
          <span className="rounded-full bg-primary/20 px-1.5 text-xs font-semibold text-assistenz-brand">
            {confirmableCount}
          </span>
        </>
      ) : (
        <span className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary/20 px-1 text-[10px] font-semibold text-assistenz-brand ring-1 ring-assistenz-brand/20 backdrop-blur-sm">
          {confirmableCount}
        </span>
      )}
    </Button>
  );

  const exportButton = canBasicExport && (
    <Button
      variant="outline"
      size="sm"
      className={showLabels ? "gap-1.5" : `h-9 shrink-0 px-0 ${stacked ? "w-8" : "w-9"}`}
      onClick={onExport}
      disabled={isExporting}
      title="Monatsübersicht als PDF: bestätigte Dienste und Abwesenheiten, ohne Zeiterfassung."
      aria-label="Monatsübersicht als PDF exportieren"
      data-testid="simple-month-export"
    >
      <Download className="h-4 w-4" />
      {showLabels && <span>{isExporting ? "Exportiere..." : "Monats-PDF"}</span>}
    </Button>
  );

  const selectionButton =
    isAdmin &&
    (canBulkEdit ? (
      isSelectionMode ? (
        <Button
          variant="default"
          size="icon"
          className={`h-9 shrink-0 ${stacked ? "w-8" : "w-9"}`}
          onClick={onToggleSelection}
          title="Auswahl beenden"
          aria-label="Auswahl beenden"
          data-testid="toggle-selection-mode"
        >
          <X className="h-4 w-4" />
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className={showLabels ? "gap-1.5" : `h-9 shrink-0 px-0 ${stacked ? "w-8" : "w-9"}`}
          onClick={onToggleSelection}
          title="Mehrfachauswahl"
          aria-label="Mehrfachauswahl"
          data-testid="toggle-selection-mode"
        >
          <CheckSquare className="h-4 w-4" />
          {showLabels && <span>Mehrfachauswahl</span>}
        </Button>
      )
    ) : (
      // Bewusst klickbar statt `disabled`: auf Touch-Geräten gibt es keinen
      // Tooltip — der Klick führt direkt zur Preise-/Premium-Seite.
      <Button
        variant="outline"
        size="sm"
        className={showLabels ? "gap-1.5" : `h-9 shrink-0 px-0 ${stacked ? "w-8" : "w-9"}`}
        onClick={() => navigateHeader("/preise")}
        title="Massenbearbeitung ist in Premium enthalten. Preise & Premium ansehen."
        aria-label="Mehrfachauswahl (Premium) — Preise & Premium ansehen"
        data-testid="toggle-selection-mode-locked"
      >
        <Lock className="h-4 w-4" />
        {showLabels && <span>Mehrfachauswahl</span>}
      </Button>
    ));

  const monthSwitcher = (
    <div className={`flex items-center gap-0.5 ${stacked ? "min-w-0" : "shrink-0"}`}>
      <Button
        variant="ghost"
        size="icon"
        className={stacked ? "h-8 w-6 shrink-0" : "h-8 w-8"}
        onClick={onPrevMonth}
        aria-label="Vorheriger Monat"
        data-testid="prev-month"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <MonthYearPicker
        month={month}
        year={year}
        onChange={onMonthSelect}
        triggerClassName={
          stacked
            ? "min-w-0 truncate whitespace-nowrap text-center text-lg font-normal tracking-tight text-foreground"
            : "whitespace-nowrap text-center text-sm font-medium md:text-base"
        }
      />
      <Button
        variant="ghost"
        size="icon"
        className={stacked ? "h-8 w-6 shrink-0" : "h-8 w-8"}
        onClick={onNextMonth}
        aria-label="Nächster Monat"
        data-testid="next-month"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );

  return (
    <div className="sticky top-0 z-40 -mx-4 -mt-4 mb-1 border-b border-border/40 bg-white/95 px-4 py-3 backdrop-blur md:-mx-6 md:-mt-6 md:px-6">
      {stacked ? (
        <div ref={measureRef} className="flex w-full flex-col gap-2.5">
          <div className="flex w-full flex-nowrap items-center gap-2">
            {title}
            <div className="shrink">
              <TeamSwitcher />
            </div>
            {assistantFilter && (
              <div className="ml-auto w-full min-w-0 max-w-[190px] shrink">{assistantFilter}</div>
            )}
          </div>
          <div className="flex w-full flex-nowrap items-center gap-1">
            {viewToggles}
            {confirmAllButton}
            {exportButton}
            {selectionButton}
            <div className="ml-auto flex min-w-0 items-center">{monthSwitcher}</div>
          </div>
        </div>
      ) : (
        <div ref={measureRef} className="flex w-full flex-nowrap items-center gap-2">
          {title}
          <TeamSwitcher />
          {assistantFilter}
          <div className="ml-auto flex flex-nowrap items-center gap-1.5">
            {viewToggles}
            {confirmAllButton}
            {exportButton}
            {selectionButton}
            {monthSwitcher}
          </div>
        </div>
      )}
    </div>
  );
}

function monthsAhead(target: Date, now: Date): number {
  return (
    (target.getFullYear() - now.getFullYear()) * 12 +
    (target.getMonth() - now.getMonth())
  );
}

export default function Dienstplan() {
  const { currentUser } = useAuth();
  const isAdmin = isAdminRole(currentUser?.role);
  const canBulkEdit = hasAccess(currentUser, "bulkEdit");
  const forwardLimit = getLimit(currentUser, "historyMonths");

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
  const [desktopView, setDesktopView] = usePersistentState<"table" | "grid">(
    "dienstplan.desktopView",
    "table",
    ["table", "grid"],
  );
  const [selectedDay, setSelectedDay] = useState<Date>(() => initialDate);

  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedDates, setSelectedDates] = useState<string[]>([]);

  const month = currentDate.getMonth() + 1;
  const year = currentDate.getFullYear();

  const { selectedTeamId } = useTeam();
  const teamParam = selectedTeamId != null ? { teamId: selectedTeamId } : {};

  const { data: shifts, isLoading: shiftsLoading } = useListShifts({ month, year, ...teamParam });
  const queryClient = useQueryClient();
  const updateShift = useUpdateShift();
  const [confirmingShiftId, setConfirmingShiftId] = useState<number | null>(null);
  const [isBulkConfirming, setIsBulkConfirming] = useState(false);
  const { data: users, isLoading: usersLoading } = useListUsers(
    selectedTeamId != null ? { teamId: selectedTeamId } : undefined
  );

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

  const assistants: Assistant[] = isAdmin
    ? (users ?? []).filter((u) => u.role === "assistant").map((u) => ({ id: u.id, name: u.name }))
    : currentUser
    ? [{ id: currentUser.id, name: currentUser.name }]
    : [];

  const [selectedAssistant, setSelectedAssistant] = useSelectedAssistant(
    assistants,
    !(isAdmin && usersLoading),
  );

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

  const { data: shiftModels } = useListShiftModels(teamParam);
  const modelMap = new Map<number, ShiftModelInfo>(
    (shiftModels ?? []).map((m) => [m.id, { name: m.name }])
  );

  const allShifts: Shift[] = shifts ?? [];
  const visibleShifts: Shift[] =
    selectedAssistant === "all"
      ? allShifts
      : allShifts.filter((s) => s.userId === selectedAssistant);
  const tableAssistants: Assistant[] =
    selectedAssistant === "all"
      ? assistants
      : assistants.filter((a) => a.id === selectedAssistant);
  const isLoading = shiftsLoading || (isAdmin && usersLoading);

  function openCreate(date: Date, userId?: number) {
    if (!isAdmin) return;
    if (forwardLimit !== null && monthsAhead(date, new Date()) > forwardLimit) {
      toast.error(
        "Im Free-Tarif nur bis nächsten Monat planbar. Für eine längere Vorausplanung auf Premium upgraden.",
        {
          action: { label: "Zu Premium", onClick: () => navigate("/preise") },
        },
      );
      return;
    }
    setDialog({ mode: "create", date, userId });
  }

  function openEdit(shift: Shift) {
    if (!isAdmin) return;
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
    if (!isAdmin || confirmingShiftId !== null) return;
    setConfirmingShiftId(shift.id);
    try {
      await updateShift.mutateAsync({
        id: shift.id,
        data: { planningStatus: "FIX", force: true } as { planningStatus: "FIX" },
      });
      await queryClient.invalidateQueries({ queryKey: getListShiftsQueryKey({ month, year }) });
      toast.success("Dienst bestätigt — zählt jetzt in Auswertungen und Stundennachweis.");
    } catch {
      if (!navigator.onLine) return; // Banner erklärt den Grund bereits.
      toast.error("Bestätigen fehlgeschlagen. Bitte erneut versuchen.");
    } finally {
      setConfirmingShiftId(null);
    }
  }

  // Aushilfe-Spiegel werden im Ziel-Team NICHT mitbestätigt — das macht das
  // Stammteam (dort liegt die Schicht).
  const confirmableShifts = allShifts.filter(
    (s) => isConfirmableShift(s) && !isMirrorShift(s, selectedTeamId),
  );

  async function confirmAllDrafts() {
    if (!isAdmin || isBulkConfirming) return;
    const targets = confirmableShifts;
    if (targets.length === 0) {
      closeDialog();
      return;
    }
    setIsBulkConfirming(true);
    let confirmed = 0;
    let failed = 0;
    try {
      for (const shift of targets) {
        try {
          await updateShift.mutateAsync({
            id: shift.id,
            data: { planningStatus: "FIX", force: true } as { planningStatus: "FIX" },
          });
          confirmed++;
        } catch {
          failed++;
        }
      }
    } finally {
      await queryClient.invalidateQueries({ queryKey: getListShiftsQueryKey({ month, year }) });
      setIsBulkConfirming(false);
      closeDialog();
    }
    if (failed > 0 && !navigator.onLine) return; // Banner erklärt den Grund bereits.
    if (failed === 0) {
      toast.success(
        confirmed === 1
          ? "1 Dienst bestätigt — zählt jetzt in Auswertungen und Stundennachweis."
          : `${confirmed} Dienste bestätigt — zählen jetzt in Auswertungen und Stundennachweis.`,
      );
    } else if (confirmed === 0) {
      toast.error("Bestätigen fehlgeschlagen. Bitte erneut versuchen.");
    } else {
      toast.error(
        `${confirmed} ${confirmed === 1 ? "Dienst" : "Dienste"} bestätigt, ${failed} fehlgeschlagen. Bitte erneut versuchen.`,
      );
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
        selectedAssistant === "all"
          ? assistants
          : assistants.filter((a) => a.id === selectedAssistant);
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
      assistants={assistants}
      selectedAssistant={selectedAssistant}
      onSelectAssistant={setSelectedAssistant}
      mobileView={mobileView}
      onMobileView={setMobileView}
      desktopView={desktopView}
      onDesktopView={setDesktopView}
      confirmableCount={confirmableShifts.length}
      isBulkConfirming={isBulkConfirming}
      onConfirmAll={() => setDialog({ mode: "confirm-all" })}
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
    isAdmin && forwardLimit !== null && monthsAhead(currentDate, new Date()) > forwardLimit;

  return (
    <PersonColorsContext.Provider value={personColors}>
    <div className="flex flex-col gap-3 animate-in fade-in duration-300">
      {header}

      {forwardPlanningBlocked && (
        <PlanLimitBanner>
          Im Free-Tarif nur bis nächsten Monat planbar. Für eine längere Vorausplanung ist ein
          Upgrade auf Premium nötig.
        </PlanLimitBanner>
      )}

      <div className="flex flex-col md:hidden" data-testid="dienstplan-mobile">
        <div className="w-full">
        {mobileView === "list" ? (
          <AgendaView
            days={days}
            shifts={visibleShifts}
            modelMap={modelMap}
            onDayClick={(day) => openCreate(day)}
            onShiftClick={openEdit}
            onConfirmShift={confirmShift}
            canEdit={isAdmin}
            selectionMode={isSelectionMode}
            selectedDates={selectedDates}
            onToggleDate={toggleDate}
            onPrevMonth={prevMonth}
            onNextMonth={nextMonth}
          />
        ) : (
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
            canEdit={isAdmin}
            selectionMode={isSelectionMode}
            selectedDates={selectedDates}
            onToggleDate={toggleDate}
            onNavigateMonth={navigateMonthWithFocus}
            focusDate={monthGridFocusDate}
            onFocusDateHandled={() => setMonthGridFocusDate(null)}
          />
        )}
        </div>
      </div>

      <div className="hidden flex-col md:flex" data-testid="dienstplan-desktop">
        <div className="w-full">
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
            canEdit={isAdmin}
            selectionMode={isSelectionMode}
            selectedDates={selectedDates}
            onToggleDate={toggleDate}
            onNavigateMonth={navigateMonthWithFocus}
            focusDate={monthGridFocusDate}
            onFocusDateHandled={() => setMonthGridFocusDate(null)}
          />
        ) : (
          <Card
            className="w-full overflow-x-auto border-border/50 shadow-sm"
            tabIndex={0}
            aria-label="Tabellenansicht — ArrowLeft/ArrowRight für Monatswechsel"
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft" || e.key === "PageUp") {
                e.preventDefault();
                prevMonth();
              } else if (e.key === "ArrowRight" || e.key === "PageDown") {
                e.preventDefault();
                nextMonth();
              }
            }}
          >
            <table className="min-w-full table-fixed text-sm">
              <thead>
                <tr className="h-px border-b bg-muted/50">
                  <th className="p-3 text-left font-medium sticky left-0 bg-muted/50 backdrop-blur-sm z-10 w-48">
                    {isAdmin ? "Assistent" : "Schicht"}
                  </th>
                  {days.map((day) => {
                    const colSelected =
                      isSelectionMode && selectedDates.includes(format(day, "yyyy-MM-dd"));
                    return (
                    <th
                      key={day.toISOString()}
                      data-testid={isSelectionMode ? `col-header-${format(day, "yyyy-MM-dd")}` : undefined}
                      data-selected={colSelected ? "true" : "false"}
                      onClick={isSelectionMode && isAdmin ? () => toggleDate(day) : undefined}
                      className={`p-2 font-medium text-center w-[88px] min-w-[88px] ${
                        colSelected
                          ? "bg-primary/10 ring-1 ring-inset ring-primary"
                          : isToday(day)
                            ? "bg-primary/10"
                            : ""
                      } ${isSelectionMode && isAdmin ? "cursor-pointer hover:bg-primary/5" : ""}`}
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
                    const absMap = absenceMapFor(assistantShifts);
                    return (
                    <tr
                      key={assistant.id}
                      className="border-b last:border-0 hover:bg-muted/20 transition-colors"
                    >
                      <td className="px-3 py-1.5 font-medium sticky left-0 bg-card hover:bg-muted/20 transition-colors z-10 shadow-[1px_0_0_0_hsl(var(--border))]">
                        {isAdmin ? (
                          <span className="inline-flex items-center gap-2">
                            <span className={`inline-block h-2.5 w-2.5 rounded-full shrink-0 ${userDotClass(assistant.id, personColors)}`} />
                            {assistant.name}
                          </span>
                        ) : (
                          "Meine Schichten"
                        )}
                      </td>
                      {days.map((day, dayIdx) => {
                        const dayShifts = assistantShifts.filter(
                          (s) => isSameDay(new Date(s.startTime), day)
                        );
                        const regular = dayShifts.filter((s) => !isAbsenceShift(s));
                        const absence = absMap.get(dayKey(day));
                        let isStart = true;
                        let isEnd = true;
                        if (absence) {
                          const prev = dayIdx > 0 ? absMap.get(dayKey(days[dayIdx - 1])) : undefined;
                          const next =
                            dayIdx < days.length - 1 ? absMap.get(dayKey(days[dayIdx + 1])) : undefined;
                          isStart = !prev || prev.type !== absence.type;
                          isEnd = !next || next.type !== absence.type;
                        }
                        const colSelected =
                          isSelectionMode && selectedDates.includes(format(day, "yyyy-MM-dd"));
                        const cellClickable = isAdmin;
                        return (
                          <td
                            key={day.toISOString()}
                            className={`p-1 border-l border-border/30 align-top ${
                              cellClickable ? "cursor-pointer group" : ""
                            } ${
                              colSelected
                                ? "bg-primary/5"
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
                                  : () => openCreate(day, assistant.id)
                                : undefined
                            }
                            title={
                              isAdmin && !isSelectionMode
                                ? "Klicken zum Anlegen einer Schicht"
                                : undefined
                            }
                          >
                            <div className="space-y-1 min-h-[26px]">
                              {absence && (
                                <AbsenceTableBar
                                  shift={absence}
                                  isStart={isStart}
                                  isEnd={isEnd}
                                  modelMap={modelMap}
                                  onClick={
                                    isAdmin && !isSelectionMode
                                      ? (e) => { e.stopPropagation(); openEdit(absence); }
                                      : undefined
                                  }
                                />
                              )}
                              {regular.map((s) => (
                                <ShiftBadge
                                  key={s.id}
                                  shift={s}
                                  modelMap={modelMap}
                                  onClick={isAdmin && !isSelectionMode ? (e) => { e.stopPropagation(); openEdit(s); } : undefined}
                                  onConfirm={isAdmin && !isSelectionMode ? confirmShift : undefined}
                                />
                              ))}
                              {dayShifts.length === 0 && isAdmin && (
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
        )}
        </div>
      </div>

      {isAdmin && assistants.length > 0 && (
        <TeamAbsenceOverview
          shifts={allShifts}
          assistants={assistants}
          onShiftClick={openEdit}
          canEdit={isAdmin}
        />
      )}

      {isAdmin && isSelectionMode && selectedDates.length > 0 && createPortal(
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

      {isAdmin && (
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
          assistants={assistants}
          month={month}
          year={year}
          teamId={selectedTeamId}
        />
      )}

      {isAdmin && (
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
          open={dialog.mode === "confirm-all"}
          onOpenChange={(open) => {
            if (!open && !isBulkConfirming) closeDialog();
          }}
        >
          <AlertDialogContent data-testid="confirm-all-dialog">
            <AlertDialogHeader>
              <AlertDialogTitle>Alle Entwürfe dieses Monats bestätigen?</AlertDialogTitle>
              <AlertDialogDescription data-testid="confirm-all-description">
                {confirmableShifts.length === 1
                  ? `1 Entwurf bzw. Vorschlag in ${format(currentDate, "MMMM yyyy", { locale: de })} wird verbindlich (FIX) und zählt danach in Auswertungen und Stundennachweis.`
                  : `${confirmableShifts.length} Entwürfe bzw. Vorschläge in ${format(currentDate, "MMMM yyyy", { locale: de })} werden verbindlich (FIX) und zählen danach in Auswertungen und Stundennachweis.`}{" "}
                Abwesenheiten sind nicht betroffen.
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
                  void confirmAllDrafts();
                }}
                data-testid="confirm-all-submit"
              >
                {isBulkConfirming ? "Wird bestätigt …" : "Jetzt bestätigen"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {isAdmin && (
        <BulkDeleteDialog
          open={dialog.mode === "bulk-delete"}
          onClose={closeDialog}
          dates={dialog.mode === "bulk-delete" ? dialog.dates : []}
          shifts={allShifts.filter((s) => !isMirrorShift(s, selectedTeamId))}
          assistants={assistants}
          month={month}
          year={year}
          onDeleted={() => {
            clearSelection();
            closeDialog();
          }}
        />
      )}
    </div>
    </PersonColorsContext.Provider>
  );
}
