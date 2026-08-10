import { isAdminRole } from "@/lib/roles";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
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
import { format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isToday, getDay, getISOWeek, isValid, startOfDay, endOfDay, startOfWeek, endOfWeek, addDays, addMonths, differenceInCalendarDays, isWithinInterval } from "date-fns";
import { de } from "date-fns/locale";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Plus, List, CalendarDays, Table2, Check, CheckSquare, X, CalendarPlus, Trash2, Pencil, ChevronDown, ChevronUp, Users, Lock, Download, MessageSquare } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import type { LucideIcon } from "lucide-react";
import { ShiftDialog } from "@/components/shift-dialog";
import { BulkDeleteDialog } from "@/components/bulk-delete-dialog";
import { BulkEditDialog } from "@/components/bulk-edit-dialog";
import { TeamSwitcher } from "@/components/team-switcher";
import { useTeam } from "@/context/team";
import { useAuth } from "@/context/auth";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  buildPersonColorAssignment,
  userBadgeClass,
  userDotClass,
  userInitialsClass,
  nameInitials,
  type PersonColorAssignment,
} from "@/lib/shift-model-colors";
import { type PersonSlot, getPersonSlots } from "@/lib/barrierefreie-farben";
import { useAssistantPalette } from "@/lib/use-assistant-palette";
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
import { PageStickyHeader } from "@/components/page-sticky-header";
import { AbwesenheitsKalender, ABSENCE_CATEGORY, type AbsenceCategory } from "@/components/abwesenheits-kalender";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  isVertretung?: boolean | null;
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

/** Kategoriale Personen-Slot-Farben (userId → Slot) — gemeinsame Quelle für
 *  die Tagesleiste unter dem Kalender UND die mobile Listenansicht, damit der
 *  3-px-Farbbalken überall dieselbe Farbe pro Assistenzkraft trägt.
 *  Zuweisung: Assistenzkraft sortiert nach ID (= Anlagereihenfolge) → Slot 1, 2, ...
 *  Bei >12 Assistenzkräften: wrap-around ab Slot 1 (zweite Runde). */
function usePersonSlotLookup(): (userId: number) => PersonSlot {
  const personColors = usePersonColors();
  const [assistantPalette] = useAssistantPalette();
  const activeSlots = useMemo(() => getPersonSlots(assistantPalette), [assistantPalette]);
  const personSlots = useMemo<Map<number, PersonSlot>>(() => {
    if (!personColors) return new Map();
    const sortedIds = [...personColors.keys()].sort((a, b) => a - b);
    return new Map(sortedIds.map((id, idx) => [id, activeSlots[idx % activeSlots.length]!]));
  }, [personColors, activeSlots]);
  return useCallback(
    (userId: number) => {
      const slot = personSlots.get(userId);
      if (slot) return slot;
      if (!Number.isFinite(userId)) return activeSlots[0]!;
      const hash = Math.abs(Math.trunc(userId) * 2654435761);
      return activeSlots[hash % activeSlots.length]!;
    },
    [personSlots, activeSlots],
  );
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

/** Nachname für die Kalender-Pille (Spec §2.1: Zeile 1 zeigt nur den Nachnamen). */
function lastName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1]! : name.trim();
}

/** Kategoriefarben der Abwesenheits-Streifen in eingeklappten Smartphone-Zellen
 *  (Arbeitsanweisung 3.3, Vorlage: geplant gelb / ausfall rot / absage grau). */
const ABSENCE_CATEGORY_HEX: Record<AbsenceCategory, string> = {
  geplant: "#e5b73b",
  ausfall: "#c23b34",
  absage: "#8a8a86",
};

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
          className={`mb-0.5 inline-flex items-center gap-1 rounded px-1 py-px text-[10px] font-semibold uppercase tracking-wide ${PLANNING_STATUS_BADGE_CLASSES[shift.planningStatus ?? ""] ?? ""}`}
        >
          <StatusBadge
            kind={shift.planningStatus === "FIX" ? "confirmed" : "draft"}
          />
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
      {shift.notes && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                data-testid={`shift-note-icon-${shift.id}`}
                className="mt-0.5 inline-flex items-center gap-0.5 text-[10px] opacity-70 cursor-default"
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
  const getPersonSlot = usePersonSlotLookup();

  // ── Wochen-Kapitel (Task #746, Variante A): Tage nach ISO-Woche (Mo–So)
  //    gruppieren; jede Woche wird ein eigener Kartenblock mit Überschrift. ──
  const weeks: { key: string; days: Date[] }[] = [];
  for (const day of days) {
    const key = format(startOfWeek(day, { weekStartsOn: 1 }), "yyyy-MM-dd");
    const last = weeks[weeks.length - 1];
    if (last && last.key === key) last.days.push(day);
    else weeks.push({ key, days: [day] });
  }

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
        const first = week.days[0]!;
        const weekLast = week.days[week.days.length - 1]!;
        const rangeLabel = isSameDay(first, weekLast)
          ? format(first, "d. MMMM", { locale: de })
          : `${format(first, "d.")}–${format(weekLast, "d. MMMM", { locale: de })}`;
        return (
          <section
            key={week.key}
            data-testid={`agenda-week-${week.key}`}
            className="overflow-hidden rounded-lg border border-border/40 bg-card"
          >
            <h3 className="border-b border-border/40 bg-muted/40 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              KW {getISOWeek(first)} · {rangeLabel}
            </h3>
            {week.days.map((day) => {
              const dayShifts = shifts.filter((s) => isSameDay(new Date(s.startTime), day));
              const isCurrentDay = isToday(day);
              // Wochenende: Tönung UND fetter Wochentag — Information nie nur
              // über Farbe (Barrierefreiheit, DESIGN-GUIDELINES).
              const weekend = getDay(day) === 0 || getDay(day) === 6;
              const bulkSelected = selectionMode && selectedDateSet.has(format(day, "yyyy-MM-dd"));

              return (
                <div
                  key={day.toISOString()}
                  data-testid={`agenda-day-${format(day, "yyyy-MM-dd")}`}
                  data-selected={bulkSelected ? "true" : "false"}
                  className={`border-b border-border/30 last:border-b-0 ${
                    bulkSelected
                      ? "bg-assistenz-mint ring-2 ring-inset ring-assistenz-brand"
                      : ""
                  }`}
                >
                  <button
                    type="button"
                    className={`flex min-h-[44px] w-full items-center gap-3 px-4 py-2 text-left transition-colors ${
                      isCurrentDay
                        ? "bg-primary text-primary-foreground hover:bg-primary/90"
                        : weekend
                          ? "bg-muted/60 text-foreground hover:bg-muted"
                          : "bg-card text-foreground hover:bg-muted/40"
                    } ${!canEdit ? "cursor-default pointer-events-none" : ""}`}
                    onClick={() =>
                      canEdit && (selectionMode ? onToggleDate?.(day) : onDayClick(day))
                    }
                  >
                    <span className="min-w-[24px] text-sm font-semibold tabular-nums">{format(day, "d")}</span>
                    <span className={`text-sm ${weekend ? "font-bold" : ""}`}>
                      {format(day, "EEEEEE", { locale: de })}
                    </span>
                    {isCurrentDay && (
                      <span className="rounded bg-primary-foreground px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                        Heute
                      </span>
                    )}
                    {canEdit && (
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
                  </button>

                  {/* Nur Tage MIT Einträgen bekommen Detailzeilen — leere Tage
                      bleiben einzeilig (Task #746). Zeilen im selben Format
                      wie die Tagesleiste unter dem Kalender (DayDetailRow). */}
                  {dayShifts.length > 0 && (
                    <div className="border-t border-border/20 bg-card">
                      {dayShifts.map((shift) => (
                        <div key={shift.id}>
                          <DayDetailRow
                            shift={shift}
                            testId={`shift-badge-${shift.id}`}
                            showName={canEdit}
                            barColor={shift.type === "team" ? "#0284c7" : getPersonSlot(shift.userId).bg}
                            modelMap={modelMap}
                            onClick={canEdit && !selectionMode ? () => onShiftClick(shift) : undefined}
                            onConfirm={canEdit && !selectionMode ? onConfirmShift : undefined}
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

/** Einzeilige Tagesleisten-Zeile (Arbeitspaket 07.08.2026, Punkt 5):
 *  3-px-Farbbalken links in der Assistenzfarbe (gemeinsamer Nenner mit der
 *  Kalender-Pille), dann Name, Eintragsart („Dienst · bestätigt" /
 *  „Abwesenheit · Urlaub"), bei Entwurf ein kompakter „Bestätigen"-Button
 *  direkt daneben, rechtsbündig die Uhrzeit bzw. „ganztägig".
 *  Keine flächenhafte Einfärbung mehr. */
function DayDetailRow({
  shift,
  barColor,
  modelMap,
  onClick,
  onConfirm,
  testId,
  showName = true,
}: {
  shift: Shift;
  barColor: string;
  modelMap: Map<number, ShiftModelInfo>;
  onClick?: () => void;
  onConfirm?: (shift: Shift) => void;
  /** Überschreibt die data-testid (mobile Listenansicht nutzt `shift-badge-<id>`,
   *  damit bestehende E2E-Selektoren weiter greifen). */
  testId?: string;
  /** Namensspalte ausblenden (Lesemodus der mobilen Listenansicht). */
  showName?: boolean;
}) {
  const { selectedTeamId } = useTeam();
  const mirror = isMirrorShift(shift, selectedTeamId);
  const isAbsence = isAbsenceShift(shift);
  const isTeam = shift.type === "team";
  const status = shift.planningStatus ?? "FIX";
  const label = shiftLabel(shift, modelMap);
  const einsatzLabel =
    shift.einsatzTeamId != null
      ? mirror
        ? `Aushilfe aus ${shift.homeTeamName ?? "anderem Team"}`
        : `Aushilfe für ${shift.einsatzTeamName ?? "anderes Team"}`
      : null;
  const statusText = status === "FIX" ? "bestätigt" : (PLANNING_STATUS_LABELS[status] ?? status);
  const timeLabel = isAbsence
    ? "ganztägig"
    : isTeam
      ? ""
      : `${format(new Date(shift.startTime), "HH:mm")}–${format(new Date(shift.endTime), "HH:mm")}`;
  const clickable = !!onClick && !mirror;
  return (
    <div
      data-testid={testId ?? `day-detail-shift-${shift.id}`}
      data-planning-status={status}
      title={
        mirror && einsatzLabel
          ? `${label} · ${einsatzLabel} (wird im Stammteam bearbeitet)`
          : `${shift.user?.name ? `${shift.user.name} · ` : ""}${label}`
      }
      // Wie die Kalenderzellen (3.4): div mit role=button + Enter/Space; die
      // verschachtelten Bestätigen-/Notiz-Buttons stoppen das Bubbling.
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? onClick : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onClick?.();
              }
            }
          : undefined
      }
      className={`relative flex items-center gap-2.5 border-b border-[#f1f1ee] py-[9px] pl-4 pr-3 text-[12.5px] last:border-b-0 ${planningStatusBadgeOutline(shift)} ${
        clickable
          ? "cursor-pointer transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
          : ""
      }`}
    >
      {/* 3-px-Farbbalken links — identisch zur Kalender-Pille */}
      <span aria-hidden="true" className="absolute bottom-0 left-0 top-0 w-[3px]" style={{ backgroundColor: barColor }} />
      {/* Name gehört zum Zeilen-Layout (Punkt 5) — für alle sichtbar, die die
          Zeile sehen dürfen; Autorisierung gilt nur für Aktionen. */}
      {showName && shift.user && (
        <span className="min-w-[110px] shrink truncate font-semibold text-[#151515]">{shift.user.name}</span>
      )}
      <span className="flex min-w-0 items-center gap-1 text-[#555555]">
        {isAbsence ? (
          <span className="truncate">Abwesenheit · {label}</span>
        ) : (
          <span className="truncate">
            {isTeam ? "Teamdienst" : "Dienst"} ·{" "}
            {status !== "FIX" && <StatusBadge kind="draft" compact className="mr-0.5 align-[-2px]" />}
            {statusText}
            {shift.isVertretung ? " · Vertretung" : ""}
            {einsatzLabel ? ` · ${einsatzLabel}` : ""}
          </span>
        )}
      </span>
      {onConfirm && !mirror && isConfirmableShift(shift) && (
        <button
          type="button"
          data-testid={`shift-confirm-${shift.id}`}
          title="Als verbindlich bestätigen"
          onClick={(e) => {
            e.stopPropagation();
            onConfirm(shift);
          }}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[#d8d8d4] bg-white px-2 py-0.5 text-[11px] font-semibold text-[#092948] transition-colors hover:border-[#092948]"
        >
          <Check className="h-3 w-3" />
          Bestätigen
        </button>
      )}
      {shift.notes && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                data-testid={`shift-note-icon-${shift.id}`}
                className="inline-flex shrink-0 cursor-default items-center text-[#555555]/70"
                onClick={(e) => e.stopPropagation()}
              >
                <MessageSquare className="h-3 w-3 shrink-0" />
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[240px] break-words text-xs">
              {shift.notes}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      {timeLabel && (
        <span className="ml-auto shrink-0 whitespace-nowrap tabular-nums text-[11.5px] text-[#555555]">
          {timeLabel}
        </span>
      )}
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
  variant = "full",
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
  /** Darstellungsdichte (Arbeitsanweisung 3.2/3.3): full = Desktop/Tablet,
   *  compact = aufgeklapptes Smartphone (kompakte Initialen-Pillen),
   *  collapsed = eingeklapptes Smartphone (Mini-Balken + Zähler). */
  variant?: "full" | "compact" | "collapsed";
}) {
  const personColors = usePersonColors();
  const selectedDateSet = new Set(selectedDates ?? []);
  const offset = (getDay(monthStart) + 6) % 7;
  const blanks = Array.from({ length: offset });
  const selectedShifts = shifts.filter((s) => isSameDay(new Date(s.startTime), selectedDay));

  // ── Tagesleisten-Filter (HANDOFF 05.08.2026) ─────────────────────────────
  // Zwei Dropdowns: Anzeigetyp (Alle/Dienste/Abwesenheiten, Standard „Alle")
  // und Zeitraum (Heute/Diese Woche/Dieser Monat/Nächste 2 Monate, Standard
  // „Heute" = der aktuell ausgewählte Tag).
  const [detailType, setDetailType] = useState<"alle" | "dienste" | "abwesenheiten">("alle");
  const [detailRange, setDetailRange] = useState<"tag" | "woche" | "monat" | "zweiMonate">("tag");

  const detailShifts = useMemo(() => {
    let from = startOfDay(selectedDay);
    let to = endOfDay(selectedDay);
    if (detailRange === "woche") {
      from = startOfWeek(selectedDay, { weekStartsOn: 1 });
      to = endOfWeek(selectedDay, { weekStartsOn: 1 });
    } else if (detailRange === "monat") {
      from = startOfMonth(selectedDay);
      to = endOfMonth(selectedDay);
    } else if (detailRange === "zweiMonate") {
      to = endOfMonth(addMonths(selectedDay, 2));
    }
    return shifts
      .filter((s) => {
        const d = new Date(s.startTime);
        if (d < from || d > to) return false;
        if (detailType === "dienste") return !isAbsenceShift(s);
        if (detailType === "abwesenheiten") return isAbsenceShift(s);
        return true;
      })
      .sort((a, b) => +new Date(a.startTime) - +new Date(b.startTime));
  }, [shifts, selectedDay, detailRange, detailType]);

  // Gruppierung nach Tag für Zeiträume > 1 Tag (Tagesüberschriften).
  // detailShifts ist bereits nach startTime sortiert → Gruppen sind fortlaufend.
  const detailGroups = useMemo(() => {
    const groups: { key: string; day: Date; shifts: Shift[] }[] = [];
    for (const s of detailShifts) {
      const d = new Date(s.startTime);
      const key = dayKey(d);
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.shifts.push(s);
      else groups.push({ key, day: d, shifts: [s] });
    }
    return groups;
  }, [detailShifts]);
  const numWeeks = Math.ceil((blanks.length + days.length) / 7);

  // ── Kategoriale Personen-Slot-Farben (gemeinsamer Hook mit der mobilen
  //    Listenansicht, damit die Farbzuordnung überall identisch ist) ────────
  const getPersonSlot = usePersonSlotLookup();

  // ── Dynamische Zeilenhöhe abhängig von max. Einträgen pro Tag ─────────────
  // Spec §3: 1–2 Einträge → scrollfrei; erst ab 3 Einträgen darf die Ansicht
  // nach unten wachsen. "Einträge" = Dienste (Abwesenheiten erscheinen nicht
  // mehr in den Zellen, sondern im Abwesenheitskalender, HANDOFF 05.08.2026).
  const maxDayEntries = useMemo(() => {
    let max = 0;
    for (const day of days) {
      const count = shifts.filter(
        (s) => isSameDay(new Date(s.startTime), day) && !isAbsenceShift(s),
      ).length;
      max = Math.max(max, count);
    }
    return max;
  }, [shifts, days]);

  // Bei ≤2 Einträgen: feste Viewport-Höhe (alle Wochen passen ohne Scrollen).
  // Bei ≥3 Einträgen: Zellen wachsen mit Inhalt → Seite kann scrollen.
  const useDynamicRows = maxDayEntries >= 3;

  // ── Sticky-Header-Höhe messen (ResizeObserver) ────────────────────────────
  // Der Dienstplan-Header klebt bei top:0; die Wochenzeile klebt direkt darunter.
  // Das Grid-Container-Height = 100svh − headerH − weekdayRowH füllt den Rest.
  const [headerH, setHeaderH] = useState(0);
  const weekdayRowRef = useRef<HTMLDivElement>(null);
  const [weekdayRowH, setWeekdayRowH] = useState(0);
  // 3.3: Im eingeklappten Smartphone-Modus scrollt der Tages-Tap zur Tagesleiste.
  const detailPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = document.querySelector("[data-dienstplan-header]") as HTMLElement | null;
    if (!el) return;
    const update = () => setHeaderH(el.getBoundingClientRect().height);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = weekdayRowRef.current;
    if (!el) return;
    const update = () => setWeekdayRowH(el.getBoundingClientRect().height);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Sobald beide Höhen bekannt sind, füllt das Grid den sichtbaren Bereich
  // unterhalb der sticky Header (kleines gap-px-Puffer für den Rahmen).
  const gridHeight =
    headerH > 0 && weekdayRowH > 0
      ? `calc(100svh - ${headerH + weekdayRowH}px - 0.5rem)`
      : undefined;

  // ── Roving Tabindex (WAI-ARIA-Grid-Pattern) ───────────────────────────────
  const cellRefs = useRef<(HTMLElement | null)[]>([]);
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);
  useEffect(() => {
    setFocusedIdx(null);
  }, [monthStart.getTime()]);
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
    let crossesBoundary = false;
    switch (e.key) {
      case "ArrowRight": target = idx + 1; crossesBoundary = true; break;
      case "ArrowLeft":  target = idx - 1; crossesBoundary = true; break;
      case "ArrowDown":  target = idx + 7; crossesBoundary = true; break;
      case "ArrowUp":    target = idx - 7; crossesBoundary = true; break;
      case "Home":       target = idx - col; break;
      case "End":        target = idx + (6 - col); break;
      case "Enter":
      case " ": {
        // Enter/Space auf der Zelle = wie Klick: Tag wählen (3.4 — Anlegen nur
        // über das Plus). Nötig, weil die Zelle ein div role="button" ist;
        // ein nativer Button würde Enter/Space selbst als Klick auslösen.
        e.preventDefault();
        const d = days[idx];
        if (selectionMode) { onToggleDate?.(d); return; }
        onSelectDay(d);
        if (variant === "collapsed") {
          detailPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        return;
      }
      default: return;
    }
    e.preventDefault();
    if (crossesBoundary && (target < 0 || target > days.length - 1) && onNavigateMonth) {
      onNavigateMonth(addDays(days[idx], target - idx));
      return;
    }
    moveFocus(target);
  };

  return (
    <div>
      {/* ── Sticky Wochentag-Zeile (klebt direkt unter dem Dienstplan-Header) ─ */}
      <div
        ref={weekdayRowRef}
        className="sticky z-20 grid grid-cols-7 border-b border-border/30 bg-[#f1f1ee]"
        style={{ top: headerH || 0 }}
      >
        {WEEKDAY_LABELS.map((d) => (
          // Arbeitspaket 07.08.2026, Punkt 1: graues Band, Kürzel größer +
          // schwarz, auf dem Smartphone in derselben Größe wie am Desktop.
          <div key={d} className="py-1 text-center text-[11px] font-semibold uppercase tracking-wider text-[#151515]">
            {d}
          </div>
        ))}
      </div>

      {/* ── Kalender-Grid ─────────────────────────────────────────────────── */}
      {/* Spec §3: Bei ≤2 Einträgen/Tag → feste Viewport-Höhe (scrollfrei);
          Bei ≥3 Einträgen → auto-Zeilen, Seite darf wachsen/scrollen. */}
      <div
        className="grid grid-cols-7 gap-px rounded-b-lg border border-t-0 border-border/30 bg-border/20"
        style={
          variant !== "full"
            ? // Smartphone (Punkt 4): keine feste Grid-Höhe — die Zellen sind
              // quadratisch (1:1) als Mindestmaß und Zeilen wachsen mit Inhalt.
              { gridTemplateColumns: "repeat(7, 1fr)" }
            : useDynamicRows
              ? { gridTemplateColumns: "repeat(7, 1fr)", overflow: "visible" }
              : {
                  ...(gridHeight ? { height: gridHeight, overflow: "hidden" } : {}),
                  gridTemplateRows: `repeat(${numWeeks}, 1fr)`,
                }
        }
        data-testid="month-grid"
      >
        {blanks.map((_, i) => (
          <div key={`blank-${i}`} className="rounded-[5px] bg-muted/10" data-testid="month-grid-blank" />
        ))}
        {days.map((day, dayIdx) => {
          const dayShifts = shifts.filter((s) => isSameDay(new Date(s.startTime), day));
          const selected = isSameDay(day, selectedDay);
          const today = isToday(day);
          // Chronologisch sortieren: das Pillen-Limit (2 bzw. 4) soll immer die
          // FRÜHESTEN Dienste zeigen, unabhängig von der API-Reihenfolge.
          const nonAbsence = dayShifts
            .filter((s) => !isAbsenceShift(s))
            .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
          const absences = dayShifts.filter((s) => isAbsenceShift(s));
           // Desktop/Tablet zeigen bis zu vier Pillen; aufgeklappte Smartphone-
           // Zellen bleiben mit höchstens zwei einzeiligen Pillen gleich hoch.
           const pillLimit = variant === "compact" ? 2 : 4;
           const visiblePills = nonAbsence.slice(0, pillLimit);
          const hiddenCount = nonAbsence.length - visiblePills.length;
          // Eingeklappte Smartphone-Zelle (3.3): ein Streifen je Abwesenheits-
          // Kategorie in Dominanzreihenfolge ausfall > geplant > absage.
          const absenceCategories = (["ausfall", "geplant", "absage"] as const).filter(
            (cat) => absences.some((s) => ABSENCE_CATEGORY[s.type] === cat),
          );
          // Task #726: Personen mit einer Ausfall-Abwesenheit (Krank/Kind krank)
          // am selben Tag — deren Dienst-Pillen erhalten das rote Warn-Icon.
          const ausfallUserIds = new Set(
            absences
              .filter((s) => ABSENCE_CATEGORY[s.type] === "ausfall")
              .map((s) => s.userId),
          );
          const countLabel = [
            nonAbsence.length > 0
              ? `${nonAbsence.length} ${nonAbsence.length === 1 ? "Dienst" : "Dienste"}`
              : "",
            absences.length > 0 ? `${absences.length} Abw.` : "",
          ]
            .filter(Boolean)
            .join(" · ");
          const prevDay = dayIdx > 0 ? days[dayIdx - 1] : undefined;
          const nextDay = dayIdx < days.length - 1 ? days[dayIdx + 1] : undefined;
          const bulkSelected = selectionMode && selectedDateSet.has(format(day, "yyyy-MM-dd"));
          const dow = day.getDay();
          const isWeekend = dow === 0 || dow === 6;

          return (
            <div
              key={day.toISOString()}
              role="button"
              ref={(el) => { cellRefs.current[dayIdx] = el; }}
              tabIndex={dayIdx === tabbableIdx ? 0 : -1}
              onKeyDown={(e) => handleCellKeyDown(e, dayIdx)}
              onFocus={() => setFocusedIdx(dayIdx)}
              data-testid={`day-cell-${format(day, "yyyy-MM-dd")}`}
              data-selected={(selectionMode ? bulkSelected : selected) ? "true" : "false"}
              aria-selected={selectionMode ? bulkSelected : selected}
              aria-label={format(day, "EEEE, d. MMMM yyyy", { locale: de })}
              onClick={() => {
                if (selectionMode) { onToggleDate?.(day); return; }
                // 3.4: Klick auf Zelle/Datum wählt den Tag nur aus — das Anlegen
                // erfolgt ausschließlich über das Plus in der Zellen-Kopfzeile.
                onSelectDay(day);
                // 3.3: Eingeklappt scrollt der Tap zur Tagesansicht (Tagesleiste).
                if (variant === "collapsed") {
                  detailPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                }
              }}
              // Punkt 4 (Smartphone): quadratische Zellen (1:1) als Mindestmaß —
              // die Wochenzeile wächst erst, wenn Pillen nicht mehr passen.
              // min-w-0 ist dabei Pflicht: Bei aspect-ratio auf einem Grid-Item mit
              // align-self:stretch überträgt CSS die Inhalts-HÖHE über das Verhältnis
              // als automatische Mindest-BREITE zurück auf die Spalte (Rückkopplung)
              // und bläht das Grid auf. min-w-0 deaktiviert dieses Automatic Minimum;
              // overflow-x: clip clippt Reste horizontal, ohne die Block-Achse zu
              // unterdrücken (overflow:hidden würde das Zeilenwachstum killen).
              style={variant !== "full" ? { aspectRatio: "1 / 1", overflowX: "clip" } : undefined}
              className={[
                "relative flex w-full flex-col items-stretch rounded-[5px] p-0.5 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
                variant === "full" ? "min-h-0 overflow-hidden" : "min-w-0",
                // Punkt 1: Zelle innen weiß, leicht abgerundete Ecken.
                "bg-white",
                bulkSelected
                  ? "ring-2 ring-inset ring-assistenz-brand bg-assistenz-mint"
                  : selected && !selectionMode
                    ? "ring-2 ring-inset ring-assistenz-brand bg-assistenz-mint/60"
                    : "hover:bg-accent/20",
                today ? "ring-1 ring-inset ring-amber-400/60" : "",
              ].filter(Boolean).join(" ")}
            >
              {/* Kopfzeile (3.4): Datum LINKS, Plus RECHTS in derselben Zeile.
                  Nur das Plus legt einen neuen Dienst an; der Zellenklick wählt. */}
              <span className="flex items-center justify-between gap-1">
                <span
                  className={[
                    "leading-none font-semibold rounded-md",
                    // Punkt 2: Datum 1–2 px größer; Smartphone = Desktop-Größe.
                    "text-[12px] px-1.5 py-0.5",
                    today
                      ? "bg-[#092948] text-white"
                      : isWeekend
                        ? "bg-slate-200/70 text-slate-500"
                        : "bg-muted/50 text-foreground/70",
                  ].join(" ")}
                >
                  {format(day, "d")}
                </span>
                {canEdit && !selectionMode && (
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={`Neuen Dienst anlegen am ${format(day, "d. MMMM", { locale: de })}`}
                    title="Dienst anlegen"
                    data-testid={`day-add-${format(day, "yyyy-MM-dd")}`}
                    onClick={(e) => { e.stopPropagation(); onAddShift(day); }}
                    // Enter/Space lösen bei nativen Buttons den Klick selbst aus —
                    // hier nur das Bubbling zur Zelle stoppen, damit deren
                    // Enter-Handler (Tag wählen) nicht zusätzlich feuert.
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") e.stopPropagation();
                    }}
                    // Punkt 2: Plus 1–2 px größer; Smartphone = Desktop-Größe.
                    className="flex h-3.5 w-3.5 shrink-0 cursor-pointer select-none items-center justify-center rounded-[3px] border border-[#d8d8d4] bg-white p-0 text-[10px] font-bold leading-none text-[#092948] hover:border-[#092948]"
                  >
                    +
                  </button>
                )}
              </span>

              {/* 3.3 eingeklappt: Mini-Balken je Dienst (Personenfarbe),
                  Abwesenheitsstreifen je Kategorie + Zähler — keine Pillen. */}
              {variant === "collapsed" ? (
                <>
                  {nonAbsence.length > 0 && (
                    <span
                      aria-hidden="true"
                      className="mt-[3px] flex flex-col gap-[2px] px-[1px]"
                      data-testid={`day-bars-${format(day, "yyyy-MM-dd")}`}
                    >
                      {nonAbsence.slice(0, 4).map((s) => (
                        <span
                          key={s.id}
                          className="h-[5px] rounded-[2px]"
                          style={{ backgroundColor: s.type === "team" ? "#0284c7" : getPersonSlot(s.userId).bg }}
                        />
                      ))}
                    </span>
                  )}
                  {absenceCategories.map((cat) => (
                    <span
                      key={cat}
                      aria-hidden="true"
                      className="mx-[1px] mt-[2px] h-[3px] rounded-[2px]"
                      style={{ backgroundColor: ABSENCE_CATEGORY_HEX[cat] }}
                      data-testid={`day-strip-${format(day, "yyyy-MM-dd")}`}
                    />
                  ))}
                  {countLabel && (
                    <span
                      className="mt-[2px] px-[1px] text-[9px] leading-tight text-[#666666]"
                      data-testid={`day-count-${format(day, "yyyy-MM-dd")}`}
                    >
                      {countLabel}
                    </span>
                  )}
                </>
              ) : visiblePills.length > 0 && (
                /* Desktop/Tablet: zweizeilige Pille mit Uhrzeit. Aufgeklapptes
                   Smartphone: einzeilige Pille mit Kürzel und Abweichungs-Icon. */
                <div className={`flex flex-col min-w-0 ${variant === "compact" ? "gap-[2px] px-[1px]" : "gap-[3px] px-0.5"}`}>
                  {visiblePills.map((s) => {
                    const isTeam = s.type === "team";
                    const slot = getPersonSlot(s.userId);
                    const status = s.planningStatus ?? "FIX";
                    // Task #726: eingeplante Assistenzkraft ist am selben Tag
                    // krank/Kind krank → roter Ausfall-Hinweis an der Pille.
                    const hasAusfall = !isTeam && ausfallUserIds.has(s.userId);
                    const chipClickable = canEdit && !selectionMode;
                    const compact = variant === "compact";
                    const timeRange = `${format(new Date(s.startTime), "HH:mm")}–${format(new Date(s.endTime), "HH:mm")}`;
                    // Tablet/Smartphone: Minuten „:00" weglassen (Vorlage 3.2: „19–09").
                    const shortRange = timeRange.replace(/:00/g, "");
                    const barColor = isTeam ? "#0284c7" : slot.bg;
                    const nameLabel = isTeam
                      ? "Team"
                      : s.user?.name
                        ? compact
                          ? nameInitials(s.user.name)
                          : lastName(s.user.name)
                        : "?";
                    return (
                      <span
                        key={s.id}
                        data-testid={`day-chip-${s.id}`}
                        role={chipClickable ? "button" : undefined}
                        tabIndex={chipClickable ? -1 : undefined}
                        title={`${s.user?.name ?? ""} · ${timeRange}${s.isVertretung ? " · Vertretung" : ""}`.trim()}
                        onClick={chipClickable ? (e) => { e.stopPropagation(); onShiftClick(s); } : undefined}
                        onKeyDown={chipClickable ? (e) => {
                          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onShiftClick(s); }
                        } : undefined}
                        className={[
                          "relative overflow-hidden border border-[#e6e6e2]",
                          compact ? "flex h-5 items-center" : "flex flex-col items-stretch",
                          compact ? "rounded-[5px]" : "rounded-[6px]",
                          chipClickable ? "cursor-pointer" : "",
                        ].filter(Boolean).join(" ")}
                      >
                        {/* Farbbalken links (volle Höhe) — einzige Stelle mit der Slot-Farbe */}
                        <span
                          aria-hidden="true"
                          className={`absolute left-0 top-0 bottom-0 ${compact ? "w-[4px]" : "w-[3px]"}`}
                          style={{ backgroundColor: barColor }}
                        />
                        {/* Enge Abstände im Compact-Zweig: bei ~57 px Zellbreite
                            müssen Kürzel UND bis zu zwei 12-px-Icons passen. */}
                        {compact ? (
                          <span className="flex w-full items-center justify-between gap-[2px] bg-white py-0 pl-[5px] pr-[1px] leading-none">
                            <span data-testid={`day-chip-label-${s.id}`} className="truncate text-[11px] font-bold text-[#151515]">
                              {nameLabel}
                            </span>
                            {/* Alle Abweichungen sind unabhängig — eine
                                Vertretung kann zugleich Entwurf/Vorschlag sein
                                und zeigt dann beide Icons. Priorität von links
                                nach rechts aufsteigend: Entwurf < Vertretung <
                                Ausfall — das wichtigste Icon liegt im Badge-
                                Stack rechts oben und bleibt voll sichtbar. */}
                            {(status !== "FIX" || s.isVertretung || hasAusfall) && (
                              /* Im Kombinationsfall überlappen die
                                 12-px-Icons leicht (Badge-Stack), damit das
                                 Kürzel in der ~57-px-Zelle sichtbar bleibt. */
                              <span className="flex shrink-0 items-center -space-x-[7px]">
                                {status !== "FIX" && (
                                  <StatusBadge
                                    kind="draft"
                                    label={status === "ANGEBOTEN" ? "Vorschlag" : "Entwurf"}
                                    calendarCompact
                                  />
                                )}
                                {s.isVertretung && (
                                  <StatusBadge kind="vertretung" label="Vertretung" calendarCompact />
                                )}
                                {hasAusfall && (
                                  <StatusBadge
                                    kind="warning"
                                    label="Ausfall: Assistenzkraft abwesend"
                                    calendarCompact
                                  />
                                )}
                              </span>
                            )}
                          </span>
                        ) : (
                          <>
                            {/* Zeile 1: Name + Status-Badge Variante C.
                                Ausfall-Warnung (Task #726) rechts außen —
                                gleiche Priorität wie im Compact-Zweig. */}
                            <span className="flex items-center justify-between gap-1 bg-white py-[2px] pl-[7px] pr-1 leading-none">
                              <span className="truncate text-[10px] font-bold text-[#151515]">{nameLabel}</span>
                              <span className="flex shrink-0 items-center gap-[3px]">
                                {status === "FIX" ? (
                                  <StatusBadge kind="confirmed" label="Bestätigt" />
                                ) : (
                                  <StatusBadge
                                    kind="draft"
                                    label={status === "ANGEBOTEN" ? "Vorschlag" : "Entwurf"}
                                  />
                                )}
                                {hasAusfall && (
                                  <StatusBadge
                                    kind="warning"
                                    label="Ausfall: Assistenzkraft abwesend"
                                  />
                                )}
                              </span>
                            </span>
                            {/* Zeile 2: Uhr-Badge + Uhrzeit (+ Vertretung rechts) auf Grauweiß */}
                            <span className="flex items-center gap-[3px] bg-[#f1f1ee] py-[2px] pl-[7px] pr-1 leading-none">
                              <StatusBadge kind="clock" />
                              <span className="truncate text-[9px] text-[#444444]">
                                <span className="min-[900px]:hidden">{isTeam ? "Teamdienst" : shortRange}</span>
                                <span className="hidden min-[900px]:inline">{isTeam ? "Teamdienst" : timeRange}</span>
                              </span>
                              {s.isVertretung && (
                                <span
                                  className="ml-auto inline-flex shrink-0 items-center gap-[2px] text-[#0f6e8c]"
                                  title="Vertretung"
                                >
                                  <StatusBadge kind="vertretung" />
                                  <span className="hidden min-[900px]:inline text-[8px] font-semibold">Vertretung</span>
                                </span>
                              )}
                            </span>
                          </>
                        )}
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Überlauf-Zähler (nur Pillen-Modi; eingeklappt zählt der Zähler-Text) */}
              {variant !== "collapsed" && hiddenCount > 0 && (
                <span
                  data-testid={`day-more-${format(day, "yyyy-MM-dd")}`}
                  className="self-start px-1 text-[7px] font-semibold text-muted-foreground/60 leading-none"
                >
                  +{hiddenCount}
                </span>
              )}

            </div>
          );
        })}
      </div>

      {/* ── Tagesdetail-Panel ──────────────────────────────────────────────── */}
      {/* Kein overflow-hidden hier: die Menüleiste ist sticky und klebt beim
          Seiten-Scroll unter dem Dienstplan-Header — ein overflow-Ancestor
          würde position:sticky unwirksam machen. Eckenrundung tragen deshalb
          Menüleiste (oben) und Listencontainer (unten) selbst. */}
      <div
        ref={detailPanelRef}
        className="rounded-lg border border-border/40 mt-2 bg-card"
        role="region"
        aria-live="polite"
        aria-label={`Tagesdetails ${format(selectedDay, "EEEE, d. MMMM", { locale: de })}`}
        data-testid="day-detail-panel"
      >
        {/* ── Menüleiste (Arbeitsanweisung 06.08.2026, Punkt 4; Vorlage
            tagesleiste-jahreskalender-v3_2, Punkt 1): Dropdown Anzeigetyp,
            Dropdown Zeitraum, Datum fett, rechts „Dienst anlegen".
            Sticky unterhalb der Dienstplan-Kopfleiste (zweite Sticky-Ebene,
            Höhe wie die Wochentag-Zeile über headerH versetzt); bg-card als
            undurchsichtige Fläche, damit Einträge darunter weiterscrollen. ── */}
        <div
          className="sticky z-30 flex flex-wrap items-center gap-2.5 rounded-t-lg border-b border-[#eeeeee] bg-card px-4 py-3"
          style={{ top: headerH || 0 }}
          data-testid="day-detail-menu"
        >
          <Select value={detailType} onValueChange={(v) => setDetailType(v as typeof detailType)}>
            <SelectTrigger
              className="h-auto w-auto gap-1.5 rounded-lg border-[#d8d8d4] bg-card px-2.5 py-1.5 text-[12.5px] font-semibold text-[#092948] shadow-none"
              data-testid="day-detail-type-menu"
              aria-label="Anzeigetyp"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="alle">Alle</SelectItem>
              <SelectItem value="dienste">Dienste</SelectItem>
              <SelectItem value="abwesenheiten">Abwesenheiten</SelectItem>
            </SelectContent>
          </Select>
          <Select value={detailRange} onValueChange={(v) => setDetailRange(v as typeof detailRange)}>
            <SelectTrigger
              className="h-auto w-auto gap-1.5 rounded-lg border-[#d8d8d4] bg-card px-2.5 py-1.5 text-[12.5px] font-semibold text-[#092948] shadow-none"
              data-testid="day-detail-range-menu"
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
            <p className="text-[13px] font-extrabold text-[#092948]" data-testid="day-detail-header">
              {format(selectedDay, "EEEE, d. MMMM yyyy", { locale: de })}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {detailShifts.length === 0
                ? detailType === "abwesenheiten"
                  ? "Keine Abwesenheiten"
                  : "Keine Dienste geplant"
                : `${detailShifts.length} ${
                    detailType === "abwesenheiten"
                      ? detailShifts.length === 1 ? "Abwesenheit" : "Abwesenheiten"
                      : detailShifts.length === 1 ? "Dienst" : "Dienste"
                  }`}
            </p>
          </div>
          {canEdit && !selectionMode && (
            <Button size="sm" variant="outline" className="gap-1 shrink-0 ml-auto" data-testid="add-shift" onClick={() => onAddShift(selectedDay)}>
              <Plus className="h-3.5 w-3.5" />
              Dienst anlegen
            </Button>
          )}
        </div>
        {/* ── Eintragsliste: einzeilige Zeilen mit 3-px-Farbbalken
            (Arbeitspaket 07.08.2026, Punkt 5); bei Zeitraum > 1 Tag mit
            Tagesüberschriften gruppiert. Kein inneres Scroll-Fenster:
            die Liste läuft in voller Länge im normalen Seiten-Scroll. ── */}
        <div className="rounded-b-lg bg-card">
          {detailGroups.length > 0 ? (
            detailGroups.map((group) => (
              <div key={group.key} data-testid={`day-detail-group-${group.key}`}>
                {detailRange !== "tag" && (
                  // Tagesüberschriften: mindestens so groß/fett wie das Datum
                  // in der Kopfzeile — beim Scrollen durch lange Zeiträume
                  // sind sie der einzige Orientierungsanker.
                  <div className="border-b border-[#f1f1ee] bg-muted/40 px-4 py-2 text-[13px] font-extrabold text-[#092948]">
                    {format(group.day, "EEEE, d. MMMM", { locale: de })}
                  </div>
                )}
                {group.shifts.map((shift) => (
                  <DayDetailRow
                    key={shift.id}
                    shift={shift}
                    barColor={shift.type === "team" ? "#0284c7" : getPersonSlot(shift.userId).bg}
                    modelMap={modelMap}
                    onClick={canEdit && !selectionMode ? () => onShiftClick(shift) : undefined}
                    onConfirm={canEdit && !selectionMode ? onConfirmShift : undefined}
                  />
                ))}
              </div>
            ))
          ) : (
            <p className="px-4 py-3 text-xs text-muted-foreground">
              {detailType === "abwesenheiten" ? "Keine Abwesenheiten" : "Keine Dienste geplant"}
            </p>
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
  mobileGridExpanded,
  onToggleMobileGridExpanded,
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
  mobileGridExpanded: boolean;
  onToggleMobileGridExpanded: () => void;
  month: number;
  year: number;
  onMonthSelect: (month: number, year: number) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
}) {
  const { selectedTeamId } = useTeam();
  const personColors = usePersonColors();
  // Abwesenheitskalender als Popup (HANDOFF 05.08.2026): gleiches Layout wie
  // auf der Seite /abwesenheiten, aufrufbar direkt aus dem Dienstplan.
  const [absCalOpen, setAbsCalOpen] = useState(false);
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
    <h1 className={`text-lg md:text-xl font-serif font-bold text-foreground ${stacked ? "min-w-0 shrink truncate" : "shrink-0"}`}>
      Dienstplan
    </h1>
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
        aria-label="Assistenzkraft filtern"
      >
        <SelectValue placeholder="Alle Assistenzkräfte" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all" data-testid="assistant-option-all">
          Alle Assistenzkräfte
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

  return (
    <>
    <PageStickyHeader
      stacked={stacked}
      measureRef={measureRef}
      month={month}
      year={year}
      onMonthSelect={onMonthSelect}
      onPrevMonth={onPrevMonth}
      onNextMonth={onNextMonth}
      prevMonthTestId="prev-month"
      nextMonthTestId="next-month"
      title={title}
      assistantFilter={assistantFilter}
      actions={
        <>
          {viewToggles}
          {/* 3.3: Auf-/Zuklappen des Smartphone-Monatsrasters (oben rechts) */}
          {mobileView === "grid" && (
            <Button
              variant="outline"
              size="sm"
              className={`md:hidden ${showLabels ? "gap-1.5" : "h-9 w-9 shrink-0 px-0"}`}
              onClick={onToggleMobileGridExpanded}
              title={mobileGridExpanded ? "Monatsraster zuklappen" : "Monatsraster aufklappen"}
              aria-label={mobileGridExpanded ? "Monatsraster zuklappen" : "Monatsraster aufklappen"}
              data-testid="toggle-mobile-expand"
            >
              {mobileGridExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              {showLabels && <span>{mobileGridExpanded ? "Zuklappen" : "Aufklappen"}</span>}
            </Button>
          )}
          {confirmAllButton}
          {exportButton}
          {selectionButton}
          <Button
            variant="outline"
            size="sm"
            className={showLabels ? "gap-1.5" : `h-9 shrink-0 px-0 ${stacked ? "w-8" : "w-9"}`}
            onClick={() => setAbsCalOpen(true)}
            title="Abwesenheitskalender öffnen (Jahresübersicht)"
            aria-label="Abwesenheitskalender öffnen"
            data-testid="open-abwesenheits-kalender"
          >
            <CalendarDays className="h-4 w-4" />
            {showLabels && <span>Abwesenheiten</span>}
          </Button>
        </>
      }
    />
    <Dialog open={absCalOpen} onOpenChange={setAbsCalOpen}>
      <DialogContent
        className="w-[96vw] max-w-[1400px] max-h-[90vh] overflow-y-auto"
        data-testid="abwesenheits-kalender-popup"
      >
        <DialogHeader>
          <DialogTitle>Abwesenheitskalender</DialogTitle>
          <DialogDescription className="sr-only">
            Jahresübersicht aller Abwesenheiten mit Direktanlage per Klick.
          </DialogDescription>
        </DialogHeader>
        <AbwesenheitsKalender />
      </DialogContent>
    </Dialog>
  </>
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
  // 3.3: Smartphone-Monatsraster startet bei jedem Aufruf eingeklappt
  // (Mini-Balken + Zähler); der Header-Button klappt für die laufende Ansicht
  // auf (kompakte Initialen-Pillen). Bewusst nicht persistiert — die Vorlage
  // sieht den eingeklappten Zustand als festen Startpunkt vor.
  const [mobileExpanded, setMobileExpanded] = useState<"collapsed" | "expanded">("collapsed");
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
      mobileGridExpanded={mobileExpanded === "expanded"}
      onToggleMobileGridExpanded={() =>
        setMobileExpanded(mobileExpanded === "expanded" ? "collapsed" : "expanded")
      }
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
            variant={mobileExpanded === "expanded" ? "compact" : "collapsed"}
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
                    return (
                    <th
                      key={day.toISOString()}
                      scope="col"
                      data-testid={isSelectionMode ? `col-header-${format(day, "yyyy-MM-dd")}` : undefined}
                      data-selected={colSelected ? "true" : "false"}
                      onClick={isSelectionMode && isAdmin ? () => toggleDate(day) : undefined}
                      className={`p-2 font-medium text-center w-[88px] min-w-[88px] ${
                        colSelected
                          ? "bg-assistenz-mint ring-1 ring-inset ring-assistenz-brand"
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
                    return (
                    <tr
                      key={assistant.id}
                      className="border-b last:border-0 hover:bg-muted/20 transition-colors"
                    >
                      <th scope="row" className="px-3 py-1.5 font-medium sticky left-0 bg-card hover:bg-muted/20 transition-colors z-10 shadow-[1px_0_0_0_hsl(var(--border))]">
                        {isAdmin ? (
                          <span className="inline-flex items-center gap-2">
                            <span className={`inline-block h-2.5 w-2.5 rounded-full shrink-0 ${userDotClass(assistant.id, personColors)}`} />
                            {assistant.name}
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
                                ? "bg-assistenz-mint/60"
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
                              {regular.map((s) => (
                                <ShiftBadge
                                  key={s.id}
                                  shift={s}
                                  modelMap={modelMap}
                                  onClick={isAdmin && !isSelectionMode ? (e) => { e.stopPropagation(); openEdit(s); } : undefined}
                                  onConfirm={isAdmin && !isSelectionMode ? confirmShift : undefined}
                                />
                              ))}
                              {regular.length === 0 && isAdmin && (
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
