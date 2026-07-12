import { isAdminRole } from "@/lib/roles";
import { useEffect, useState } from "react";
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
import { userBadgeClass, userDotClass, userInitialsClass, nameInitials } from "@/lib/shift-model-colors";
import { hasAccess, getLimit } from "@/lib/entitlements";
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
};

// Planungsstatus: Entwurf (intern) → Vorschlag (angeboten) → Bestätigt (fix).
// Bestätigte Dienste sind der Normalfall und brauchen kein Extra-Label.
const PLANNING_STATUS_LABELS: Record<string, string> = {
  VORLAEUFIG: "Entwurf",
  ANGEBOTEN: "Vorschlag",
};

const PLANNING_STATUS_BADGE_CLASSES: Record<string, string> = {
  VORLAEUFIG: "bg-foreground/10 text-foreground/70",
  ANGEBOTEN: "bg-sky-200 text-sky-900",
};

// Nicht-bestätigte Dienste werden mit gestricheltem Rand + reduzierter Deckkraft
// dargestellt, damit Entwürfe/Vorschläge auf einen Blick von verbindlichen
// Diensten unterscheidbar sind.
// Entwürfe (VORLAEUFIG) und Vorschläge (ANGEBOTEN) lassen sich mit einem Klick
// auf FIX (verbindlich) setzen; verbindliche Dienste und Abwesenheiten nicht.
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
};

const SHIFT_TYPE_CLASSES: Record<string, string> = {
  active: "bg-primary/10 text-primary border-primary/25 hover:bg-primary/20",
  standby: "bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100",
  night: "bg-blue-50 text-blue-800 border-blue-200 hover:bg-blue-100",
  full_day: "bg-purple-50 text-purple-800 border-purple-200 hover:bg-purple-100",
  vacation: "bg-yellow-100 text-yellow-900 border-yellow-400 hover:bg-yellow-200",
  sick: "bg-slate-200 text-slate-700 border-slate-400 hover:bg-slate-300",
  freizeitausgleich: "bg-emerald-100 text-emerald-900 border-emerald-400 hover:bg-emerald-200",
};

function shiftLabel(shift: Shift, modelMap: Map<number, ShiftModelInfo>): string {
  if (shift.type === "work") {
    return (shift.shiftModelId ? modelMap.get(shift.shiftModelId)?.name : undefined) ?? "Dienst";
  }
  return SHIFT_TYPE_LABELS[shift.type] ?? shift.type;
}

function shiftBadgeClasses(shift: Shift): string {
  // Abwesenheiten (Urlaub = Gelb, Krankheit = Grau) behalten bewusst ihre
  // semantische Farbe, damit sie auf einen Blick als Abwesenheit erkennbar
  // bleiben und nicht mit Arbeitsschichten verwechselt werden.
  if (isAbsenceShift(shift)) {
    return (
      SHIFT_TYPE_CLASSES[shift.type] ?? "bg-primary/10 text-primary border-primary/25 hover:bg-primary/20"
    );
  }
  // Alle übrigen Dienste: Farbe ist fest an die Assistenzkraft (userId) gebunden,
  // nicht an die Schichtart — so erkennt man im Plan sofort, wer arbeitet.
  return userBadgeClass(shift.userId);
}

function usePersistentState<T extends string>(key: string, fallback: T, allowed: readonly T[]): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored != null && (allowed as readonly string[]).includes(stored)) return stored as T;
    } catch {
      // localStorage nicht verfügbar (z. B. privater Modus) — Fallback nutzen
    }
    return fallback;
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Schreiben fehlgeschlagen — Auswahl gilt nur für diese Sitzung
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
  vacation: "bg-yellow-400",
  sick: "bg-slate-400",
  freizeitausgleich: "bg-emerald-500",
};

// Unverbindliche Dienste (Entwurf/Vorschlag) erscheinen im Monatsgitter als
// abgeschwächte Punkte — analog zur reduzierten Deckkraft der Badges. So ist
// auch in der kompaktesten Ansicht erkennbar, dass diese Dienste (noch) nicht
// in Auswertungen und Stundennachweis zählen.
function shiftDotStatusClass(shift: Shift): string {
  if (isAbsenceShift(shift)) return "";
  const status = shift.planningStatus ?? "FIX";
  return status === "FIX" ? "" : "opacity-40";
}

// Abwesenheiten (Urlaub/Krank) werden als ganztägige Tagesblöcke gespeichert —
// ein Datensatz pro Tag. Mehrtägige Abwesenheiten bestehen aus mehreren
// aufeinanderfolgenden Datensätzen desselben Typs.
const ABSENCE_TYPES = new Set(["vacation", "sick", "freizeitausgleich"]);
function isAbsenceShift(shift: Shift): boolean {
  return ABSENCE_TYPES.has(shift.type);
}

// Lokaler Datumsschlüssel (yyyy-MM-dd). Wichtig: aus dem ISO-String NICHT per
// slice extrahieren — die gespeicherte Startzeit ist UTC und kann lokal auf
// einen anderen Tag fallen. Daher über die lokale Date-Repräsentation.
function dayKey(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

// Indexiert Abwesenheiten nach lokalem Tagesschlüssel (für eine bereits auf
// einen Assistenten gefilterte Schichtmenge).
function absenceMapFor(shifts: Shift[]): Map<string, Shift> {
  const m = new Map<string, Shift>();
  for (const s of shifts) {
    if (isAbsenceShift(s)) m.set(dayKey(new Date(s.startTime)), s);
  }
  return m;
}

// Zusammenhängende Abwesenheit (durchgehender Block) eines Assistenten. Jeder
// Tag ist ein eigener Datensatz; hier werden aufeinanderfolgende Tage gleicher
// Art und Person zu einem Zeitraum zusammengefasst.
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
  // Pro Assistent + Abwesenheitsart gruppieren, dann nach Tag sortieren und
  // lückenlos aufeinanderfolgende Tage zu einem Zeitraum verschmelzen.
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
      // <= 1 fasst aufeinanderfolgende Tage zusammen und ignoriert
      // versehentliche Doppel-Datensätze am selben Tag (Differenz 0).
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

// Kompakte Übersicht „wer ist gerade / demnächst abwesend?" über das ganze
// (team-gescopte) Team. Datenquelle: alle Schichten des angezeigten Monats,
// gefiltert auf Abwesenheiten und auf aktuell laufende bzw. anstehende
// Zeiträume (Ende heute oder später). Gruppiert nach Kalenderwoche.
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
  // Standardmaessig eingeklappt, damit im Full-Screen-Layout maximale Hoehe
  // fuer den Kalender bleibt; bei Bedarf per Klick aufklappbar.
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
                            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
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
  // Ein-Klick-Bestätigung (Entwurf/Vorschlag → verbindlich), nur für Admins.
  onConfirm?: (shift: Shift) => void;
}) {
  const classes = shiftBadgeClasses(shift);
  // Abwesenheiten (Urlaub/Krank) haben keine Uhrzeiten → als ganztägiger Block ohne Zeit.
  const isAbsence = shift.type === "vacation" || shift.type === "sick";
  const start = new Date(shift.startTime);
  const end = new Date(shift.endTime);
  const startLabel = format(start, "HH:mm");
  const endLabel = format(end, "HH:mm");
  // 24-Stunden-Dienst: Start- und Enduhrzeit sind identisch (z. B. 08:00–08:00),
  // die Schicht läuft aber volle 24 Stunden (Ende am Folgetag, daher
  // unterschiedliche Zeitpunkte). Der Legacy-Typ "full_day" zählt explizit dazu.
  const is24h =
    shift.type === "full_day" || (startLabel === endLabel && start.getTime() !== end.getTime());
  const label = shiftLabel(shift, modelMap);
  // Abwesenheiten (Urlaub/Krank) sind sofort verbindlich; ein Planungs-Label
  // gilt nur für reguläre Dienste mit Entwurf-/Vorschlag-Status.
  const statusLabel = !isAbsence ? PLANNING_STATUS_LABELS[shift.planningStatus ?? ""] : undefined;
  return (
    <div
      data-testid={`shift-badge-${shift.id}`}
      data-planning-status={shift.planningStatus ?? "FIX"}
      className={`w-full text-xs rounded border px-2 py-1 leading-snug cursor-pointer transition-colors ${classes} ${planningStatusBadgeOutline(shift)}`}
      onClick={onClick}
      title={statusLabel ? `${label} · ${statusLabel}` : label}
    >
      {showName && shift.user && (
        <div className="font-medium truncate">{shift.user.name}</div>
      )}
      {statusLabel && (
        <div
          className={`mb-0.5 inline-flex items-center rounded px-1 py-px text-[10px] font-semibold uppercase tracking-wide ${PLANNING_STATUS_BADGE_CLASSES[shift.planningStatus ?? ""] ?? ""}`}
        >
          {statusLabel}
        </div>
      )}
      {isAbsence ? (
        <div className="font-medium truncate">{label}</div>
      ) : (
        <>
          <div className="truncate">
            {startLabel}–{endLabel}
            {!isSameDay(start, end) && <span className="opacity-70"> (+1)</span>}
          </div>
          {/* Gut sichtbarer Hinweis direkt unter der Endzeit, damit ein 24h-Dienst
              nicht mit einer 0-Stunden- oder normalen Schicht verwechselt wird. */}
          {is24h && (
            <div className="mt-0.5 inline-flex items-center rounded bg-foreground/15 px-1 py-px text-[10px] font-semibold uppercase tracking-wide">
              24h-Dienst
            </div>
          )}
          {/* Schichtname: standardmäßig ausgeschrieben, bei Platzmangel (enge
              Tabellen-/Gitterspalten) per truncate mit Ellipsis gekürzt. */}
          <div className="text-[11px] opacity-70 truncate">{label}</div>
        </>
      )}
      {/* Ein-Klick-Bestätigung direkt am Badge: Entwurf/Vorschlag → verbindlich,
          ohne den Dialog öffnen und den Status manuell umstellen zu müssen. */}
      {onConfirm && isConfirmableShift(shift) && (
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

// Segment eines durchgehenden Abwesenheitsbalkens in der Desktop-Tabelle.
// Jeder Tag einer mehrtägigen Abwesenheit ist ein eigener Datensatz; die
// Segmente werden über negative Ränder visuell zu einem Balken verbunden.
// Der Typ-Name erscheint nur am Anfang (isStart) des Balkens.
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
  const classes = shiftBadgeClasses(shift);
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
}: {
  days: Date[];
  shifts: Shift[];
  modelMap: Map<number, ShiftModelInfo>;
  onDayClick: (day: Date) => void;
  onShiftClick: (shift: Shift) => void;
  onConfirmShift?: (shift: Shift) => void;
  canEdit: boolean;
  // Auswahl-Modus (Massenbearbeitung): Klick auf einen Tag wählt ihn aus.
  selectionMode?: boolean;
  selectedDates?: string[];
  onToggleDate?: (day: Date) => void;
}) {
  const selectedDateSet = new Set(selectedDates ?? []);
  return (
    <div className="space-y-1">
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
  // Auswahl-Modus (Massenbearbeitung): Klick auf einen Tag wählt ihn aus,
  // statt den Tag als Detail zu öffnen.
  selectionMode?: boolean;
  selectedDates?: string[];
  onToggleDate?: (day: Date) => void;
}) {
  const selectedDateSet = new Set(selectedDates ?? []);
  // Montag als erster Wochentag (date-fns: 0 = Sonntag).
  const offset = (getDay(monthStart) + 6) % 7;
  const blanks = Array.from({ length: offset });
  const selectedShifts = shifts.filter((s) => isSameDay(new Date(s.startTime), selectedDay));

  // Abwesenheits-Typen je Tag (über alle sichtbaren Assistenten aggregiert), um
  // zusammenhängende Urlaubs-/Kranktage als durchgehenden Balken mit klar
  // erkennbarem Anfang/Ende darzustellen.
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
      {/* Monatsgitter mit hellblauem Rahmen, weißen Kästchen */}
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
            // Reguläre Dienste als Punkte; Abwesenheiten als verbundener Balken.
            const dots = dayShifts.filter((s) => !isAbsenceShift(s)).slice(0, 3);
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
            // Im Auswahl-Modus zählt die Mehrfach-Auswahl (selectedDates),
            // sonst der einzelne Detail-Tag (selectedDay).
            const bulkSelected = selectionMode && selectedDateSet.has(format(day, "yyyy-MM-dd"));
            return (
              <button
                key={day.toISOString()}
                type="button"
                data-testid={`day-cell-${format(day, "yyyy-MM-dd")}`}
                data-selected={(selectionMode ? bulkSelected : selected) ? "true" : "false"}
                onClick={() => {
                  if (selectionMode) {
                    onToggleDate?.(day);
                    return;
                  }
                  // Tag als Detail auswählen UND (für Admins) direkt den
                  // Schicht-Dialog mit vorbelegtem Datum öffnen — wie in der
                  // Tabellenansicht.
                  onSelectDay(day);
                  if (canEdit) onAddShift(day);
                }}
                className={`aspect-square rounded-lg bg-card flex flex-col items-center justify-start pt-1.5 gap-1 border transition-colors ${
                  bulkSelected
                    ? "border-primary ring-2 ring-primary bg-primary/5"
                    : selected && !selectionMode
                      ? "border-primary ring-1 ring-primary"
                      : "border-transparent hover:bg-muted/40"
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
                <span className="flex flex-col items-stretch gap-0.5 w-full">
                  {absenceBars}
                  {dots.length > 0 && (
                    <span className="flex flex-wrap items-center justify-center gap-0.5">
                      {dots.map((s) => (
                        <span
                          key={s.id}
                          title={s.user?.name}
                          className={`flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-bold leading-none text-white ${userInitialsClass(s.userId)} ${shiftDotStatusClass(s)}`}
                        >
                          {s.user?.name ? nameInitials(s.user.name) : ""}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tagesdetails */}
      <div className="rounded-lg border border-border/40 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 bg-muted/40">
          <div>
            <p className="text-sm font-semibold" data-testid="day-detail-header">
              {format(selectedDay, "EEEE, d. MMMM", { locale: de })}
            </p>
            <p className="text-xs text-muted-foreground">
              {selectedShifts.length === 0
                ? "Keine Schichten"
                : `${selectedShifts.length} ${selectedShifts.length === 1 ? "Schicht" : "Schichten"}`}
            </p>
          </div>
          {canEdit && !selectionMode && (
            <Button size="sm" variant="outline" className="gap-1" data-testid="add-shift" onClick={() => onAddShift(selectedDay)}>
              <Plus className="h-3.5 w-3.5" />
              Schicht
            </Button>
          )}
        </div>
        <div className="bg-card px-3 py-2 space-y-1.5">
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
            <p className="text-xs text-muted-foreground">
              {canEdit ? "Keine Schichten — tippen zum Hinzufügen" : "Keine Schichten"}
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
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; icon: LucideIcon }[];
}) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
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
            className={`flex items-center gap-1.5 rounded-md px-2.5 md:px-3 py-1.5 text-sm font-medium transition-colors ${
              active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
            }`}
          >
            <Icon className="h-4 w-4" />
            {/* Auf kleinen Screens icon-only, um die Header-Zeile schmal zu halten. */}
            <span className="hidden md:inline">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// Anzahl Kalendermonate, die `target` nach `now` liegt (0 = selber Monat,
// negativ = Vergangenheit). Spiegelt die serverseitige historyMonths-Pruefung
// (monthsAhead) fuer das Free-Vorausplanungs-Limit.
function monthsAhead(target: Date, now: Date): number {
  return (
    (target.getFullYear() - now.getFullYear()) * 12 +
    (target.getMonth() - now.getMonth())
  );
}

export default function Dienstplan() {
  const { currentUser } = useAuth();
  const isAdmin = isAdminRole(currentUser?.role);
  // Massenbearbeitung ("Mehrfachauswahl") nur im Premium-Plan.
  const canBulkEdit = hasAccess(currentUser, "bulkEdit");
  // Free-Plan begrenzt die Vorausplanung (historyMonths, Free = 1 → aktueller
  // und naechster Monat). `null` = unbegrenzt (Premium). Bestandsschutz:
  // vergangene/aktuelle Monate bleiben uneingeschraenkt; nur das NEUE Planen in
  // zu weit entfernten Zukunfts-Monaten wird gesperrt (Durchsetzung zusaetzlich
  // serverseitig).
  const forwardLimit = getLimit(currentUser, "historyMonths");

  // Optionales Zieldatum (z.B. vom Dashboard-Hinweis "Tage ohne geplante Schicht").
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

  // Auswahl-Modus (Massenbearbeitung mehrerer Tage). Tage als "yyyy-MM-dd".
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedDates, setSelectedDates] = useState<string[]>([]);

  const month = currentDate.getMonth() + 1;
  const year = currentDate.getFullYear();

  const { selectedTeamId } = useTeam();
  const teamParam = selectedTeamId != null ? { teamId: selectedTeamId } : {};

  const { data: shifts, isLoading: shiftsLoading } = useListShifts({ month, year, ...teamParam });
  const queryClient = useQueryClient();
  const updateShift = useUpdateShift();
  // Verhindert Doppelklicks während eine Bestätigung läuft.
  const [confirmingShiftId, setConfirmingShiftId] = useState<number | null>(null);
  // Läuft gerade die Sammelbestätigung aller Entwürfe/Vorschläge des Monats?
  const [isBulkConfirming, setIsBulkConfirming] = useState(false);
  const { data: users, isLoading: usersLoading } = useListUsers(
    selectedTeamId != null ? { teamId: selectedTeamId } : undefined
  );

  const goToMonth = (newDate: Date) => {
    setCurrentDate(newDate);
    setSelectedDay(startOfMonth(newDate));
    // Auswahl gilt nur für den aktuell sichtbaren Monat — beim Monatswechsel
    // verwerfen, damit Massenaktionen nie auf unsichtbare Tage wirken.
    clearSelection();
  };
  const prevMonth = () => goToMonth(new Date(year, month - 2, 1));
  const nextMonth = () => goToMonth(new Date(year, month, 1));

  // Team-Wechsel zeigt andere Daten — bestehende Auswahl verwerfen.
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

  // Erst prüfen, wenn die Assistentenliste geladen ist (sonst fälschlich zurücksetzen)
  const [selectedAssistant, setSelectedAssistant] = useSelectedAssistant(
    assistants,
    !(isAdmin && usersLoading),
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
    // Free-Plan: Vorausplanung in zu weit entfernte Zukunfts-Monate sperren
    // (freundlicher Hinweis statt rohem 403 beim Speichern).
    if (forwardLimit !== null && monthsAhead(date, new Date()) > forwardLimit) {
      toast.error(
        "Im Free-Tarif nur bis nächsten Monat planbar. Für eine längere Vorausplanung auf Premium upgraden.",
        {
          // Kein Dead-End: direkt zur Preise-/Upgrade-Seite fuehren.
          action: { label: "Zu Premium", onClick: () => navigate("/preise") },
        },
      );
      return;
    }
    setDialog({ mode: "create", date, userId });
  }

  function openEdit(shift: Shift) {
    if (!isAdmin) return;
    setDialog({ mode: "edit", shift });
  }

  // Ein-Klick-Bestätigung aus dem Kalender: setzt einen Entwurf/Vorschlag per
  // PATCH auf FIX (verbindlich), ohne den Dialog zu öffnen. `force: true`, weil
  // sich Zeiten/Zuordnung nicht ändern — eine ggf. bewusst angelegte
  // Überschneidung darf die reine Status-Bestätigung nicht blockieren.
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
      toast.error("Bestätigen fehlgeschlagen. Bitte erneut versuchen.");
    } finally {
      setConfirmingShiftId(null);
    }
  }

  // Alle offenen Entwürfe (VORLAEUFIG) und Vorschläge (ANGEBOTEN) des sichtbaren
  // Monats im aktuellen Team-Scope — Abwesenheiten sind nie betroffen
  // (isConfirmableShift filtert sie aus). Bewusst allShifts statt visibleShifts:
  // Die Sammelaktion gilt für den ganzen Monat, unabhängig vom Assistenten-Filter.
  const confirmableShifts = allShifts.filter(isConfirmableShift);

  // Sammelbestätigung: setzt alle Entwürfe/Vorschläge des Monats nacheinander
  // per PATCH auf FIX. Wie bei der Einzel-Bestätigung mit `force: true`, weil
  // sich Zeiten/Zuordnung nicht ändern. Teilfehler werden gezählt und gemeldet.
  async function confirmAllDrafts() {
    if (!isAdmin || isBulkConfirming) return;
    const targets = allShifts.filter(isConfirmableShift);
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
      // Beim Verlassen die Auswahl leeren.
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

  // Einfacher Monats-Export (Free-Feature "basicExport"): PDF direkt aus der
  // Schichtliste des sichtbaren Monats — bestätigte Dienste UND Abwesenheiten
  // (Urlaub/Krank), ohne Zeiterfassung/Soll-Ist (das bleibt der Premium-
  // Stundennachweis). Für Admins (gefiltert bzw. alle Assistenten) und für
  // Assistenzkräfte (eigene Dienste, serverseitig gescoped).
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
        shifts: visibleShifts,
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
      toast.error("PDF-Export fehlgeschlagen.");
      console.error(err);
    } finally {
      setIsExporting(false);
    }
  }

  // Superkompakte Steuerleiste: Überschrift, Ansicht-Umschalter, Aktionen und
  // Monatswechsler in EINER Zeile (umbricht nur bei extrem wenig Platz).
  // Bleibt im Full-Screen-Layout fix am oberen Rand (shrink-0), damit der
  // Kalender darunter den Rest der Hoehe bekommt. Auf kleinen Screens
  // schrumpfen die Buttons zu reinen Icons (Text erst ab md sichtbar).
  const Header = () => (
    <div className="sticky top-0 z-40 -mx-4 -mt-4 mb-1 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-border/40 bg-white/95 px-4 py-3 backdrop-blur md:-mx-6 md:-mt-6 md:px-6">
      <h2 className="text-lg md:text-xl font-serif font-bold text-foreground">Dienstplan</h2>
      <TeamSwitcher />
      {/* Kompakter Assistenten-Filter direkt neben dem Titel (ersetzt die
          frühere Pillenleiste). Default "Alle Assistenten". */}
      {isAdmin && assistants.length > 0 && (
        <Select
          value={String(selectedAssistant)}
          onValueChange={(v) => setSelectedAssistant(v === "all" ? "all" : Number(v))}
        >
          <SelectTrigger
            className="h-9 w-auto min-w-[170px] gap-2"
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
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold leading-none ${userInitialsClass(a.id)}`}
                  >
                    {nameInitials(a.name)}
                  </span>
                  {a.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        {/* Ansicht-Umschalter: mobil Liste/Monat, ab md Tabelle/Monat. */}
        <div className="md:hidden" data-testid="view-toggles-mobile">
          <ViewToggle
            value={mobileView}
            onChange={(v) => setMobileView(v as "list" | "grid")}
            options={[
              { value: "list", label: "Liste", icon: List },
              { value: "grid", label: "Monat", icon: CalendarDays },
            ]}
          />
        </div>
        <div className="hidden md:block" data-testid="view-toggles-desktop">
          <ViewToggle
            value={desktopView}
            onChange={(v) => setDesktopView(v as "table" | "grid")}
            options={[
              { value: "table", label: "Tabelle", icon: Table2 },
              { value: "grid", label: "Monat", icon: CalendarDays },
            ]}
          />
        </div>
        {/* Sammelaktion: alle Entwürfe/Vorschläge des sichtbaren Monats mit
            einem Klick verbindlich machen. Nur sichtbar, solange es etwas zu
            bestätigen gibt — sonst wäre der Button ein totes Element. */}
        {isAdmin && confirmableShifts.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setDialog({ mode: "confirm-all" })}
            disabled={isBulkConfirming}
            title="Alle Entwürfe bestätigen"
            aria-label="Alle Entwürfe bestätigen"
            data-testid="confirm-all-drafts"
          >
            <Check className="h-4 w-4" />
            <span className="hidden md:inline">Alle bestätigen</span>
            <span className="rounded-full bg-primary/10 px-1.5 text-xs font-semibold text-primary">
              {confirmableShifts.length}
            </span>
          </Button>
        )}
        {/* Einfacher Monats-Export (basicExport, auch im Free-Plan): PDF des
            sichtbaren Monats mit bestätigten Diensten und Abwesenheiten
            (Urlaub/Krank), ohne Zeiterfassung. Sichtbar für Admins UND
            Assistenzkräfte (eigene Dienste). */}
        {canBasicExport && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={handleSimpleExport}
            disabled={isExporting}
            title="Monatsübersicht als PDF: bestätigte Dienste und Abwesenheiten, ohne Zeiterfassung."
            aria-label="Monatsübersicht als PDF exportieren"
            data-testid="simple-month-export"
          >
            <Download className="h-4 w-4" />
            <span className="hidden md:inline">
              {isExporting ? "Exportiere..." : "Monats-PDF"}
            </span>
          </Button>
        )}
        {/* Massenbearbeitung ist ein Premium-Feature. Free-Konten sehen den
            Button deaktiviert mit Upgrade-Hinweis (Durchsetzung zusaetzlich
            serverseitig erforderlich). */}
        {isAdmin &&
          (canBulkEdit ? (
            <Button
              variant={isSelectionMode ? "default" : "outline"}
              size="sm"
              className="gap-1.5"
              onClick={toggleSelectionMode}
              title={isSelectionMode ? "Auswahl beenden" : "Mehrfachauswahl"}
              aria-label={isSelectionMode ? "Auswahl beenden" : "Mehrfachauswahl"}
              data-testid="toggle-selection-mode"
            >
              {isSelectionMode ? <X className="h-4 w-4" /> : <CheckSquare className="h-4 w-4" />}
              <span className="hidden md:inline">
                {isSelectionMode ? "Auswahl beenden" : "Mehrfachauswahl"}
              </span>
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled
              title="Massenbearbeitung ist in Premium enthalten."
              aria-label="Mehrfachauswahl (Premium)"
              data-testid="toggle-selection-mode-locked"
            >
              <Lock className="h-4 w-4" />
              <span className="hidden md:inline">Mehrfachauswahl</span>
            </Button>
          ))}
        {/* Monatswechsler: Pfeile direkt am Monatstext, ohne breite Lücken. */}
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={prevMonth}
            aria-label="Vorheriger Monat"
            data-testid="prev-month"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span
            className="font-medium text-sm md:text-base whitespace-nowrap text-center"
            data-testid="month-label"
          >
            {format(currentDate, "MMMM yyyy", { locale: de })}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={nextMonth}
            aria-label="Nächster Monat"
            data-testid="next-month"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );

  if (isLoading) {
    return (
      /* Gleiches Geruest wie der geladene Zustand: natuerlich fliessender
         Inhalt, der mit der Seite scrollt (kein viewport-fixes Grid mehr). */
      <div className="flex flex-col gap-3 animate-in fade-in duration-300">
        <Header />
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  const forwardPlanningBlocked =
    isAdmin && forwardLimit !== null && monthsAhead(currentDate, new Date()) > forwardLimit;

  return (
    /* Natuerlich fliessendes Layout: der Inhalt waechst mit seiner Hoehe und
       scrollt mit der Seite (der aeussere Scroll-Container liegt im Layout).
       Volle Breite; die Kopfzeile bleibt beim Scrollen sticky oben. */
    <div className="flex flex-col gap-3 animate-in fade-in duration-300">
      <Header />

      {/* Free-Plan: Hinweis, wenn der angezeigte Monat ausserhalb des erlaubten
          Vorausplanungs-Fensters liegt. Bestehende Schichten bleiben sichtbar;
          nur das Anlegen neuer Schichten ist gesperrt. */}
      {forwardPlanningBlocked && (
        <PlanLimitBanner>
          Im Free-Tarif nur bis nächsten Monat planbar. Für eine längere Vorausplanung ist ein
          Upgrade auf Premium nötig.
        </PlanLimitBanner>
      )}

      {/* Mobile: umschaltbare Ansicht (Liste / Monatsgitter). Der Kalender
          nutzt die volle Breite und waechst mit seiner Hoehe (kein interner
          Scrollbalken mehr) — gescrollt wird die ganze Seite. Der Umschalter
          selbst sitzt in der Header-Zeile. Der Assistenten-Filter liegt jetzt
          als kompaktes Select neben dem Titel. */}
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
          />
        )}
        </div>
      </div>

      {/* Desktop: umschaltbare Ansicht (Tabelle / Monatsgitter). Kalender in
          voller Breite; der Inhalt waechst mit seiner Hoehe und scrollt mit
          der Seite (keine starren inneren Scrollbalken). Der Umschalter selbst
          sitzt in der Header-Zeile. */}
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
          />
        ) : (
      /* Tabelle in voller Breite: waechst mit ihrer natuerlichen Hoehe und
         scrollt mit der Seite (kein starrer interner Vertikal-Scroll).
         Horizontal bleibt die Tabelle bei Bedarf wischbar (overflow-x-auto). */
      <Card className="w-full overflow-x-auto border-border/50 shadow-sm">
        <table className="w-full text-sm">
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
                  className={`p-2 font-medium text-center min-w-[56px] ${
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
                // Keine feste Zeilenhoehe: die Zeilen strecken sich ueber die
                // Tabellenhoehe und teilen den Platz gleichmaessig auf.
                return (
                <tr
                  key={assistant.id}
                  className="border-b last:border-0 hover:bg-muted/20 transition-colors"
                >
                  <td className="px-3 py-1.5 font-medium sticky left-0 bg-card hover:bg-muted/20 transition-colors z-10 shadow-[1px_0_0_0_hsl(var(--border))]">
                    {isAdmin ? (
                      <span className="inline-flex items-center gap-2">
                        {/* Farb-Punkt als Legende: gleiche Personenfarbe wie die
                            Dienst-Kacheln dieser Zeile. */}
                        <span className={`inline-block h-2.5 w-2.5 rounded-full shrink-0 ${userDotClass(assistant.id)}`} />
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
                    // Anfang/Ende eines durchgehenden Balkens: Vortag bzw. Folgetag
                    // ohne gleichartige Abwesenheit (oder Monatsrand).
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
                    // Im Auswahl-Modus toggelt ein Klick die Spalte; sonst
                    // legt er eine Schicht für diese Person/diesen Tag an.
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

      {/* Team-Abwesenheits-Übersicht (nur Admin): jetzt UNTER dem Kalender als
          einklappbares Accordion. Zeigt team-weit, wer gerade/demnächst
          abwesend ist — unabhängig vom Assistenten-Filter. */}
      {isAdmin && assistants.length > 0 && (
        <TeamAbsenceOverview
          shifts={allShifts}
          assistants={assistants}
          onShiftClick={openEdit}
          canEdit={isAdmin}
        />
      )}

      {/* Floating Action Bar im Auswahl-Modus mit mindestens einem Tag. */}
      {isAdmin && isSelectionMode && selectedDates.length > 0 && (
        <div
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 shadow-lg"
          data-testid="bulk-action-bar"
        >
          <span className="text-sm font-medium" data-testid="bulk-selected-count">
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
        </div>
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
          shifts={allShifts}
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

      {/* Bestätigungsdialog der Sammelaktion: zeigt die Anzahl der betroffenen
          Entwürfe/Vorschläge, bevor sie verbindlich werden. */}
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
                  // Dialog offen halten, bis alle PATCH-Aufrufe durch sind —
                  // confirmAllDrafts schließt ihn selbst am Ende.
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
          shifts={allShifts}
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
  );
}
