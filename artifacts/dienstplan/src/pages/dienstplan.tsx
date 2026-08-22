import { isAdminRole } from "@/lib/roles";
import { formatAbsenceTimeSpan } from "@/lib/absence-time";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams, useLocation } from "wouter";
import {
  useListShifts,
  useListUsers,
  useListShiftModels,
  useUpdateShift,
  useSendShiftProposals,
  useBulkConfirmOwnShifts,
  useGetHoursBalance,
  type User,
  type ShiftModel,
  type HoursBalance,
} from "@workspace/api-client-react";
import { useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isToday, getDay, getISOWeek, isValid, startOfDay, endOfDay, startOfWeek, endOfWeek, addDays, addMonths, differenceInCalendarDays, isWithinInterval } from "date-fns";
import { de } from "date-fns/locale";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Plus, List, LayoutGrid, Table2, Check, X, CalendarPlus, Trash2, Pencil, ChevronDown, Users, Lock, MessageSquare, ChevronsDownUp, Send, Palmtree, MoreHorizontal, FileDown, SquareDashedMousePointer, Scale, ChevronsLeft } from "lucide-react";
import { StatusBadge, type StatusBadgeKind } from "@/components/status-badge";
import type { LucideIcon } from "lucide-react";
import { ShiftDialog } from "@/components/shift-dialog";
import { BulkDeleteDialog } from "@/components/bulk-delete-dialog";
import { BulkEditDialog } from "@/components/bulk-edit-dialog";
import { TeamSwitcher } from "@/components/team-switcher";
import { useTeam } from "@/context/team";
import { useAuth, hasTeamAccessLevel } from "@/context/auth";
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
import { useIsMobile } from "@/hooks/use-mobile";
import { toast } from "sonner";
import { useSelectedAssistant, type Assistant } from "@/components/assistant-filter";
import {
  StundenkontoPanel,
  StundenkontoReihe,
  useSelectedUserIds,
  useIsWideStundenkontoLayout,
} from "@/components/stundenkonto-leiste";
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
import { AbwesenheitsKalender, ABSENCE_CATEGORY } from "@/components/abwesenheits-kalender";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  SHIFT_LIST_STALE_TIME_MS,
  SHIFT_LIST_GC_TIME_MS,
  REFERENCE_DATA_STALE_TIME_MS,
  prefetchAdjacentMonthShifts,
  upsertShiftsInCache,
  invalidateShiftDerivedQueries,
} from "@/lib/shift-cache";

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
  /** Halbtägiger Urlaub (#862): true = bewusst gewählter Teil-Tag, false/undefined = ganztägig. */
  isPartialAbsence?: boolean | null;
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

/** Rechter 4px-Statusfarbbalken der Kalender-Pille (Arbeitsanweisung
 *  17.08.2026 Punkt 3): zeigt den Dienst-/Schichtstatus (nicht die Person).
 *  Priorität — dieselbe Reihenfolge wie der Icon-Stack —: Krankheit >
 *  Vertretung > Basis-Status (Entwurf/Versendet/Bestätigt). Exakt dieselben
 *  Hex-Werte wie StatusBadge (status-badge.tsx), keine neue Farbquelle.
 *  ANGEBOTEN ("Vorschlag versendet, wartet auf Bestätigung") bekommt seit
 *  18.08.2026 eine eigene Farbe (Himmelblau), statt wie zuvor dieselbe wie
 *  der noch unversendete Entwurf (VORLAEUFIG). */
function dienstStatusColor(status: string, hasAusfall: boolean, isVertretung: boolean | null | undefined): string {
  if (hasAusfall) return "#b23b3b";
  if (isVertretung) return "#0f6e8c";
  if (status === "FIX") return "#1e8f4e";
  if (status === "ANGEBOTEN") return "#0284c7";
  return "#b5790a";
}

/** Kontraststarke Textfarbe für die Statusbeschriftung auf dem hellgrauen
 *  Hintergrund der zweiten Desktop-Pillenzeile (mindestens WCAG AA). */
function dienstStatusTextColor(status: string, hasAusfall: boolean, isVertretung: boolean | null | undefined): string {
  if (hasAusfall) return "#b23b3b";
  if (isVertretung) return "#0f6e8c";
  if (status === "FIX") return "#1a7e45";
  if (status === "ANGEBOTEN") return "#0267a0";
  return "#966408";
}

/** Textlabel zum Statusfarbbalken der Desktop-/Tablet-Pille (wiedereingeführt
 *  auf Nutzerwunsch, s. Bildvergleich Monatsraster vs. Referenz-Mockup):
 *  dieselbe Prioritätsreihenfolge wie dienstStatusColor(), damit Farbe und
 *  Text immer zusammenpassen. Nur in der zweizeiligen Desktop-Pille genutzt
 *  (@[215px]-Schwelle in Zeile 2) — die Smartphone-Pille hat keine Zeile 2. */
function dienstStatusLabel(status: string, hasAusfall: boolean, isVertretung: boolean | null | undefined): string {
  if (hasAusfall) return "Krank";
  if (isVertretung) return "Vertretung";
  if (status === "FIX") return "Bestätigt";
  return status === "ANGEBOTEN" ? "Vorschlag" : "Entwurf";
}

/** Avatar-Kreis mit Initiale (Arbeitsanweisung 17.08.2026, Folgeauftrag: 1–2 px
 *  kleiner als zuvor — 17×17 px statt 19×19 px, dafür nur noch der eine
 *  Nachnamen-Anfangsbuchstabe statt zweier Initialen, siehe lastNameInitial()),
 *  Hintergrund = Personen-/Slot-Farbe (barColor/slot.bg, keine neue
 *  Farbquelle), zentrierte weiße fette Initiale. Gemeinsam für alle drei
 *  Pillen-Varianten (zweizeilig, minimiert, Smartphone-einzeilig). */
function PillAvatar({ color, label }: { color: string; label: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-full text-[8px] font-bold leading-none text-white"
      style={{ backgroundColor: color }}
    >
      {label}
    </span>
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
// Arbeitsauftrag 15.08.2026 (Monatsraster Desktop, Punkt 1): volle Wochentags-
// namen im Desktop-Kopf; wird der Platz knapp (<900 px), greifen die Kürzel.
const WEEKDAY_LABELS_FULL = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

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

/** Arbeitsanweisung 17.08.2026 (Folgeauftrag): Avatar-Initiale der Kalender-
 *  Pille zeigt nur noch EINEN Buchstaben — den Anfangsbuchstaben des
 *  Nachnamens (Vorbild: schlankere Vergleichs-Ansicht) statt der bisherigen
 *  zwei Buchstaben (Vor-/Nachname). Andere Initialen-Anzeigen (Filterleiste,
 *  Auswertungstabellen) bleiben unverändert bei nameInitials().  */
function lastNameInitial(name: string): string {
  const ln = lastName(name);
  return ln.length > 0 ? ln[0]!.toUpperCase() : "?";
}

/** Zweizeilige Namensdarstellung für die Tabellenansicht. */
function nameLines(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" "),
  };
}

type AbsenceRange = {
  userId: number;
  userName: string;
  type: string;
  start: Date;
  end: Date;
  days: number;
  shift: Shift;
  /** Halbtägiger Urlaub (#862): nur bei einem einzelnen Teil-Tag gesetzt. */
  timeSpan?: string;
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
      .map((s) => ({
        s,
        d: startOfDay(new Date(s.startTime)),
        // Halbtägiger Urlaub (#862) darf nicht unsichtbar in einen
        // angrenzenden ganztägigen Lauf desselben Typs verschmelzen — sonst
        // würde die Zeitspanne beim Zusammenfassen verlorengehen. Ein Lauf
        // bricht deshalb zusätzlich am Wechsel ganztägig↔teilweise. Maßgeblich
        // ist die persistierte Nutzer-Absicht (isPartialAbsence), NICHT die
        // Uhrzeiten: ein ganztägiger Eintrag kann über das Lohnausfallprinzip
        // die echten Uhrzeiten eines ersetzten Dienstes geerbt haben.
        fullDay: !s.isPartialAbsence,
      }))
      .sort((a, b) => a.d.getTime() - b.d.getTime());

    let runStartIdx = 0;
    for (let i = 1; i <= sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = i < sorted.length ? sorted[i] : undefined;
      const consecutive =
        cur != null &&
        differenceInCalendarDays(cur.d, prev.d) <= 1 &&
        cur.fullDay === prev.fullDay;
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
          timeSpan:
            !first.fullDay && isSameDay(first.d, prev.d)
              ? formatAbsenceTimeSpan(first.s.startTime, first.s.endTime)
              : undefined,
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
  if (isSameDay(r.start, r.end)) {
    const dayLabel = format(r.start, "EEEE, d. MMMM", { locale: de });
    // Halbtägiger Urlaub (#862): Zeitspanne direkt am Tag anzeigen, statt sie
    // wie einen ganztägigen Eintrag ohne Uhrzeit erscheinen zu lassen.
    return r.timeSpan ? `${dayLabel}, ${r.timeSpan}` : dayLabel;
  }
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
  | { mode: "confirm-all" }
  | { mode: "send-proposals" };


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
            kind={
              shift.planningStatus === "FIX"
                ? "confirmed"
                : shift.planningStatus === "ANGEBOTEN"
                  ? "sent"
                  : "draft"
            }
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
  variant = "compact",
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
  /** "compact" (Standard, Smartphone) oder "comfortable" (Desktop, mehr Luft). */
  variant?: "compact" | "comfortable";
}) {
  const comfortable = variant === "comfortable";
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
      className={comfortable ? "space-y-4" : "space-y-3"}
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
            <h3 className={`border-b border-border/40 bg-muted/40 font-bold uppercase tracking-wide text-muted-foreground ${comfortable ? "px-5 py-2 text-xs" : "px-4 py-1.5 text-[11px]"}`}>
              KW {getISOWeek(first)} · {rangeLabel}
            </h3>
            {week.days.map((day) => {
              const dayShifts = shifts.filter((s) => isSameDay(new Date(s.startTime), day));
              // Task #792: Ausfall-UserIds für diesen Tag — damit DayDetailRow
              // das Warn-Icon auf Dienst-Zeilen zeigen kann (analog MonthGrid).
              const dayAusfallUserIds = new Set(
                dayShifts
                  .filter((s) => isAbsenceShift(s) && ABSENCE_CATEGORY[s.type] === "ausfall")
                  .map((s) => s.userId),
              );
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
                  // Task #846: wie im Monatsraster deckt die Detailzeilen-Liste
                  // (bg-card, s. u.) einen ring-inset ab — echter Rand statt
                  // Ring, damit die Auswahl auch bei Tagen MIT Einträgen um die
                  // ganze Karte sichtbar bleibt. border-[2px] ist IMMER gesetzt
                  // (sonst transparent) statt nur bei Auswahl, sonst würde die
                  // Karte beim Aus-/Abwählen um die Randbreite wachsen/
                  // schrumpfen (Layout-Sprung) — nur die Farbe wechselt.
                  className={
                    bulkSelected
                      ? "border-[2px] border-assistenz-brand bg-assistenz-mint"
                      : "border-[2px] border-transparent border-b-border/30 last:border-b-transparent"
                  }
                >
                  <button
                    type="button"
                    className={`flex w-full items-center text-left transition-colors ${comfortable ? "min-h-[52px] gap-4 px-5 py-3" : "min-h-[44px] gap-3 px-4 py-2"} ${
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
                    <span className={`min-w-[24px] font-semibold tabular-nums ${comfortable ? "text-base" : "text-sm"}`}>{format(day, "d")}</span>
                    <span className={`${comfortable ? "text-base" : "text-sm"} ${weekend ? "font-bold" : ""}`}>
                      {format(day, "EEEEEE", { locale: de })}
                    </span>
                    {isCurrentDay && (
                      <span className="rounded bg-primary-foreground px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                        Heute
                      </span>
                    )}
                    {canEdit && (
                      <span
                        className={`ml-auto flex items-center gap-1.5 ${comfortable ? "text-sm" : "text-xs"} ${
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
                        <Plus className={`shrink-0 ${comfortable ? "h-4 w-4" : "h-3.5 w-3.5"}`} />
                      </span>
                    )}
                  </button>

                  {/* Nur Tage MIT Einträgen bekommen Detailzeilen — leere Tage
                      bleiben einzeilig. Zeilen im selben Format
                      wie die Tagesleiste unter dem Kalender (DayDetailRow). */}
                  {dayShifts.length > 0 && (
                    <div className="border-t border-border/20 bg-card">
                      {dayShifts.map((shift) => (
                        <div key={shift.id}>
                          <DayDetailRow
                            shift={shift}
                            testId={`shift-badge-${shift.id}`}
                            showName={canEdit}
                            modelMap={modelMap}
                            comfortable={comfortable}
                            hasAusfall={!isAbsenceShift(shift) && dayAusfallUserIds.has(shift.userId)}
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

/** Einzeilige Tagesleisten-Zeile — Pillen-Design (18.08.2026, Task #850):
 *  Links Avatar (Personenfarbe) + Name + Uhrzeit; rechts Statustext
 *  („Dienst · bestätigt", Zustandswort eingefärbt) + Icon-Stack + 4-px-
 *  Statusfarbbalken. Gleiche Farb-/Icon-Quellen wie die Kalender-Pille
 *  (dienstStatusColor / StatusBadge). Zeilenhöhe unverändert.
 *  Abwesenheiten und Teamdienste folgen dem selben Layout. */
function DayDetailRow({
  shift,
  modelMap,
  onClick,
  onConfirm,
  testId,
  showName = true,
  comfortable = false,
  hasAusfall = false,
}: {
  shift: Shift;
  modelMap: Map<number, ShiftModelInfo>;
  onClick?: () => void;
  onConfirm?: (shift: Shift) => void;
  /** Überschreibt die data-testid (mobile Listenansicht nutzt `shift-badge-<id>`,
   *  damit bestehende E2E-Selektoren weiter greifen). */
  testId?: string;
  /** Namensspalte ausblenden (Lesemodus der mobilen Listenansicht). */
  showName?: boolean;
  /** Großzügigeres Padding/Schrift für die Desktop-Persistenzliste. */
  comfortable?: boolean;
  /** Task #792: Person ist am selben Tag krank/kind-krank — rotes Warn-Icon anzeigen. */
  hasAusfall?: boolean;
}) {
  const { selectedTeamId } = useTeam();
  const getPersonSlot = usePersonSlotLookup();
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
  // Halbtägiger Urlaub (#862): eigene Zeitspanne statt "ganztägig" zeigen,
  // damit die Tagesleiste den echten Zeitraum erkennbar macht.
  const timeLabel = isAbsence
    ? !shift.isPartialAbsence
      ? "ganztägig"
      : formatAbsenceTimeSpan(shift.startTime, shift.endTime)
    : isTeam
      ? ""
      : `${format(new Date(shift.startTime), "HH:mm")}–${format(new Date(shift.endTime), "HH:mm")}`;
  const clickable = !!onClick && !mirror;

  // Avatar-Farbe: Personenslot für Arbeits-/Abwesenheitsschichten,
  // Himmelblau (#0284c7) für Teamdienste (wie in der Kalender-Pille).
  const slot = getPersonSlot(shift.userId);
  const avatarColor = isTeam ? "#0284c7" : slot.bg;
  const avatarLabel = isTeam ? "T" : shift.user?.name ? lastNameInitial(shift.user.name) : "?";

  // Rechter Statusfarbbalken: exakt dieselbe Prioritätslogik wie in der Pille.
  const statusBarColor = dienstStatusColor(status, hasAusfall, shift.isVertretung);

  // Basis-Status-Icon (ohne Vertretung/Krank-Overlay).
  const baseIconKind: StatusBadgeKind =
    status === "FIX" ? "confirmed" : status === "ANGEBOTEN" ? "sent" : "draft";

  const confirmable = onConfirm && !mirror && isConfirmableShift(shift);

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
      className={`relative flex items-center overflow-hidden border-b border-[#f1f1ee] last:border-b-0 ${comfortable ? "gap-2.5 py-3 pl-4 pr-[8px] text-sm" : "min-h-[44px] gap-2 py-1.5 pl-3 pr-[8px] text-[12.5px]"} ${planningStatusBadgeOutline(shift)} ${
        clickable
          ? "cursor-pointer transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
          : ""
      }`}
    >
      {/* Avatar: runder Initialen-Kreis in der Personenfarbe (wie in der
          Kalender-Pille); 2 px größer als die Schriftgröße des Namens. */}
      <span
        aria-hidden="true"
        className={`flex shrink-0 items-center justify-center rounded-full font-bold leading-none text-white ${comfortable ? "h-[17px] w-[17px] text-[8px]" : "h-[15px] w-[15px] text-[7.5px]"}`}
        style={{ backgroundColor: avatarColor }}
      >
        {avatarLabel}
      </span>

      {/* Linke Gruppe: Name + Uhrzeit — nimmt den verfügbaren Platz auf;
          der Rest der Zeile bleibt rechts-ausgerichtet (shrink-0). */}
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        {showName && shift.user && (
          <span className="shrink truncate font-semibold text-[#151515]">
            {shift.user.name}
          </span>
        )}
        {timeLabel && (
          <span className="shrink-0 whitespace-nowrap tabular-nums text-[11.5px] text-[#555555]">
            {timeLabel}
          </span>
        )}
      </span>

      {/* Bestätigen-Button (Entwurf/Vorschlag): stoppt das Bubbling,
          damit der Zeilenklick (Bearbeiten) nicht feuert. */}
      {confirmable && (
        <button
          type="button"
          data-testid={`shift-confirm-${shift.id}`}
          title="Als verbindlich bestätigen"
          onClick={(e) => {
            e.stopPropagation();
            onConfirm(shift);
          }}
          className={`relative inline-flex shrink-0 items-center gap-1 rounded-md border border-[#d8d8d4] bg-white px-2 py-0.5 font-semibold text-[#092948] transition-colors hover:border-[#092948] ${comfortable ? "text-xs" : "text-[11px] after:absolute after:inset-x-0 after:top-1/2 after:h-[44px] after:-translate-y-1/2 after:content-['']"}`}
        >
          <Check className="h-3 w-3" />
          Bestätigen
        </button>
      )}

      {/* Notiz-Icon */}
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

      {/* Rechte Statusgruppe: Statustext (Zustandswort eingefärbt) +
          Icon-Stack + 4-px-Farbbalken (absolute).
          4-px-Abstand zum Balken durch pr-[8px] auf dem Elternelement. */}
      <span className={`flex shrink-0 items-center gap-1 text-[11.5px] text-[#555555] ${comfortable ? "" : "max-w-[160px]"}`}>
        {/* Statustext */}
        <span className="truncate">
          {isAbsence ? (
            <>Abwesenheit · {label}</>
          ) : (
            <>
              {isTeam ? "Teamdienst" : "Dienst"}
              {einsatzLabel ? ` · ${einsatzLabel}` : ""}
              {shift.isVertretung ? " · Vertretung" : ""}
              {" · "}
              <span style={{ color: statusBarColor }}>{statusText}</span>
            </>
          )}
        </span>
        {/* Icon-Stack: aufsteigend wichtig — Basis-Status links, Ausfall ganz
            rechts (wie in der Kalender-Pille). */}
        <span className="flex shrink-0 items-center -space-x-[5px]">
          <StatusBadge
            kind={baseIconKind}
            compact
            label={status === "FIX" ? "Bestätigt" : status === "ANGEBOTEN" ? "Vorschlag" : "Entwurf"}
          />
          {shift.isVertretung && (
            <StatusBadge kind="vertretung" compact label="Vertretung" />
          )}
          {hasAusfall && (
            <StatusBadge kind="krank" compact label="Ausfall: Assistenzkraft abwesend" />
          )}
        </span>
      </span>

      {/* Rechter 4-px-Statusfarbbalken — gleiche Farbe wie in der Kalender-
          Pille; overflow:hidden auf dem Elternelement clippt ihn bündig. */}
      <span
        aria-hidden="true"
        className="absolute bottom-0 right-0 top-0 w-[4px]"
        style={{ backgroundColor: statusBarColor }}
      />
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
  pillMinimiert = false,
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
  /** Darstellungsdichte: full = Desktop/Tablet (zweizeilige Pille), collapsed =
   *  Smartphone-Dauerzustand (einzeilige Initialen-Pille, Arbeitsanweisung
   *  16.08.2026 Punkt 3 — der frühere „compact"-Zwischenzustand entfällt). */
  variant?: "full" | "collapsed";
  /** Arbeitsanweisung 17.08.2026 Punkt 1: globaler Minimiert-Umschalter für
   *  Desktop/Tablet (nur bei variant="full" relevant) — kollabiert die
   *  zweizeilige Pille auf eine Zeile. */
  pillMinimiert?: boolean;
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

  // ── Zeilenhöhe: immer inhaltsbasiert (Task #847) ──────────────────────────
  // Früher gab es zwei Modi: bei ≤2 Einträgen/Tag wurde das Grid künstlich auf
  // 100svh minus Kopfzeilen gestreckt (gleichmäßige 1fr-Verteilung), ab 3
  // Einträgen wurden reine Inhalts-Zeilen verwendet. Das erzeugte zwei Fehler:
  // (1) der Abstand von der Pille zur nächsten Tageszeile war Restfläche vom
  // Viewport, nicht fix — bei Browser-Zoom <100% wuchs er sichtbar mit, weil
  // 100svh in CSS-Pixeln bei kleinerem Zoom größer wird; (2) ein einzelner
  // dritter Eintrag an einem Tag kippte das Layout-Modell des GESAMTEN Monats
  // von "gestreckt" auf "kompakt" (sichtbarer Sprung). Jetzt gilt immer die
  // Inhalts-Variante: jede Wochenzeile ist so hoch wie ihre "belegteste"
  // Zelle (CSS-Grid-Auto-Sizing), der Abstand unter der letzten Pille ist ein
  // fixes Padding (siehe Grauzone unten) und skaliert damit 1:1 mit dem Zoom.
  // Ist ein Monat dienst-arm, ist er dadurch von selbst kompakt genug, um
  // unter der Sticky-Kopfzeile vollständig sichtbar zu sein — ohne dass wir
  // ihn künstlich auf Bildschirmhöhe ziehen müssen.

  // ── Sticky-Header-Höhe messen (ResizeObserver) ────────────────────────────
  // Der Dienstplan-Header klebt bei top:0; die Wochenzeile klebt direkt
  // darunter und braucht dessen Höhe als eigenen `top`-Versatz.
  const [headerH, setHeaderH] = useState(0);
  const weekdayRowRef = useRef<HTMLDivElement>(null);
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
        className={[
          "sticky z-20 grid grid-cols-7 bg-[#f1f1ee]",
          // Punkt 2 (15.08.2026): Der 1-px-Rahmen (#dfe4ea) läuft um das gesamte
          // Raster inklusive Wochentag-Zeile; mobil bleibt der bisherige Look.
          variant === "full"
            ? "border-x border-t border-b border-[#dfe4ea]"
            : "border-b border-border/30",
        ].join(" ")}
        style={{ top: headerH || 0 }}
      >
        {WEEKDAY_LABELS.map((d, i) => (
          // Desktop (Punkt 1, 15.08.2026): volle Wochentagsnamen, 15 px — unter
          // 900 px reicht der Platz für „Donnerstag" nicht mehr, dann Kürzel.
          // Smartphone (Arbeitspaket 07.08.2026): Kürzel, 11 px, Versalien.
          <div
            key={d}
            className={
              variant === "full"
                ? "py-1.5 text-center text-[15px] font-semibold text-[#151515]"
                : "py-1 text-center text-[11px] font-semibold uppercase tracking-wider text-[#151515]"
            }
          >
            {variant === "full" ? (
              <>
                <span className="hidden min-[900px]:inline">{WEEKDAY_LABELS_FULL[i]}</span>
                <span className="min-[900px]:hidden">{d}</span>
              </>
            ) : (
              d
            )}
          </div>
        ))}
      </div>

      {/* ── Kalender-Grid ─────────────────────────────────────────────────── */}
      {/* Task #847: Zeilen sind immer reine Inhalts-Zeilen (auto) — keine
          Viewport-Streckung mehr. Jede Wochenzeile ist so hoch wie ihre
          belegteste Zelle; ein zusätzlicher Eintrag an einem Tag ändert nur
          diese eine Zeile, nie das Layout-Modell des ganzen Monats. Ist ein
          Monat dienst-arm, ist er dadurch von selbst kompakt genug, um unter
          der Sticky-Kopfzeile ganz sichtbar zu sein — ohne Zutun. */}
      <div
        className={[
          "grid grid-cols-7 gap-px",
          // Punkt 2 (15.08.2026): 1 px #dfe4ea als Außenrahmen UND als Spalten-/
          // Zeilentrennlinien — gap-px lässt die Hintergrundfarbe durchscheinen.
          variant === "full"
            ? "border border-t-0 border-[#dfe4ea] bg-[#dfe4ea]"
            : "rounded-b-lg border border-t-0 border-border/30 bg-border/20",
        ].join(" ")}
        style={
          variant !== "full"
            ? // Smartphone (Punkt 4): keine feste Grid-Höhe — die Zellen sind
              // quadratisch (1:1) als Mindestmaß und Zeilen wachsen mit Inhalt.
              { gridTemplateColumns: "repeat(7, 1fr)" }
            : { gridTemplateColumns: "repeat(7, 1fr)", overflow: "visible" }
        }
        data-testid="month-grid"
      >
        {blanks.map((_, i) => (
          <div
            key={`blank-${i}`}
            className={variant === "full" ? "bg-muted/10" : "rounded-[5px] bg-muted/10"}
            data-testid="month-grid-blank"
          />
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
           // Desktop/Tablet zeigen bis zu vier Pillen; die Smartphone-Zelle
           // (Dauerzustand „collapsed") bleibt mit höchstens zwei einzeiligen
           // Initialen-Pillen gleich hoch.
           const pillLimit = variant === "collapsed" ? 2 : 4;
           const visiblePills = nonAbsence.slice(0, pillLimit);
          const hiddenCount = nonAbsence.length - visiblePills.length;
          // Task #726: Personen mit einer Ausfall-Abwesenheit (Krank/Kind krank)
          // am selben Tag — deren Dienst-Pillen erhalten das rote Warn-Icon.
          const ausfallUserIds = new Set(
            absences
              .filter((s) => ABSENCE_CATEGORY[s.type] === "ausfall")
              .map((s) => s.userId),
          );
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
                "relative flex w-full flex-col items-stretch transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
                // Desktop (Punkt 3, 15.08.2026): keine Rundung/kein Außen-Padding
                // mehr — die Grauzone (Pillenbereich) stößt bündig an die
                // Trennlinien. Smartphone behält Rundung + 2-px-Innenabstand.
                // min-w-0 statt overflow-hidden: Spaltenbreite bleibt stabil
                // (truncate greift), aber Zeilen wachsen mit dem Inhalt.
                variant === "full"
                  ? "min-w-0 rounded-none p-0"
                  : "min-w-0 rounded-[5px] p-0.5",
                // Zellhintergrund, exklusiv: Auswahl (Mint) > Weiß.
                // Task #826: Am Heute-Tag zeigt NUR die Mint-Fläche die
                // Auswahl an — der Auswahl-Rahmen entfällt dort, damit der
                // Heute-Rahmen die einzige Kante bleibt.
                bulkSelected
                  ? today
                    ? "bg-assistenz-mint"
                    : "bg-assistenz-mint"
                  : selected && !selectionMode
                    ? today
                      ? "bg-assistenz-mint/60"
                      : "bg-assistenz-mint/60"
                    : "bg-white hover:bg-accent/20",
                // Heute (Task #826) + Auswahl (Task #846): 2-px-Rahmen um die
                // GANZE Zelle inkl. Dienstpillen-Bereich — echter Border statt
                // ring-inset, weil ein Ring Teil der Box-Shadow-Ebene der
                // Zelle ist und von der opaken Pillen-Grauzone (Kind-Element)
                // darunter überdeckt wird; ein Border bleibt immer sichtbar.
                // Die Randbreite (border-[2px]) ist IMMER gesetzt, auch ohne
                // Auswahl (dort transparent) — sonst würde eine Zelle beim
                // Anklicken/Abwählen um die Randbreite wachsen/schrumpfen
                // (Layout-Sprung). Nur die Randfarbe wechselt:
                // Heute > Auswahl > unsichtbar.
                "border-[2px]",
                today
                  ? "border-[#092948]"
                  : bulkSelected || (selected && !selectionMode)
                    ? "border-assistenz-brand"
                    : "border-transparent",
              ].filter(Boolean).join(" ")}
            >
              {/* Kopfzeile (3.4): Datum LINKS, Plus RECHTS in derselben Zeile.
                  Nur das Plus legt einen neuen Dienst an; der Zellenklick wählt.
                  Desktop (Punkt 3): weißer oberer Bereich mit eigenem Padding,
                  da die Zelle selbst dort kein Padding mehr trägt. */}
              <span
                className={`flex items-center justify-between gap-1 ${
                  variant === "full" ? "px-1 py-1" : ""
                }`}
              >
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

              {/* 3.3 Dauerzustand (Arbeitsanweisung 16.08.2026): das ehemals
                  „aufgeklappte" einzeilige Pillendesign ist jetzt die EINZIGE
                  Smartphone-Darstellung — der bisherige Mini-Balken-Zweig und
                  der Auf-/Zuklapp-Umschalter entfallen ersatzlos. */}
              {variant === "collapsed" ? (
                (visiblePills.length > 0 || absences.length > 0) && (
                  // Arbeitsanweisung 17.08.2026 Punkt 6, Folgeauftrag: die
                  // Grauzone war mit #eef0f3 kaum vom weißen Zellenkopf zu
                  // unterscheiden — auf #e4e8ee (spürbar dunkler, dieselbe
                  // Farbe wie am Desktop, s. u.) angehoben, damit sich die
                  // weißen Pillen sichtbar abheben.
                  <div className="flex flex-col gap-[2px] rounded-b-[4px] border-t border-[#dfe4ea] bg-[#e4e8ee] px-[1px] py-[2px]">
                  {visiblePills.length > 0 && (
                    <div
                      className="flex flex-col min-w-0 gap-[2px]"
                      data-testid={`day-pills-${format(day, "yyyy-MM-dd")}`}
                    >
                      {visiblePills.map((s) => {
                        const isTeam = s.type === "team";
                        const slot = getPersonSlot(s.userId);
                        const status = s.planningStatus ?? "FIX";
                        // Task #726: eingeplante Assistenzkraft ist am selben Tag
                        // krank/Kind krank → roter Ausfall-Hinweis an der Pille.
                        const hasAusfall = !isTeam && ausfallUserIds.has(s.userId);
                        const chipClickable = canEdit && !selectionMode;
                        const timeRange = `${format(new Date(s.startTime), "HH:mm")}–${format(new Date(s.endTime), "HH:mm")}`;
                        const barColor = isTeam ? "#0284c7" : slot.bg;
                        // Arbeitsanweisung 17.08.2026 Punkt 4: der Avatar-Kreis
                        // zeigt jetzt die Initialen — das Namensfeld daneben zeigt
                        // deshalb den Nachnamen (dieselbe Funktion wie Desktop/
                        // Tablet), nicht mehr die Initialen als Text-Duplikat.
                        // Arbeitsanweisung 17.08.2026 Punkt 4 (nach Messung korrigiert):
                        // bei ~48 px Pillenbreite kollabiert ein zusaetzliches
                        // Namensfeld neben Avatar + bis zu drei 12-px-Icons auf 0 px
                        // Breite. Entscheidung: kein separates Namensfeld in der
                        // Smartphone-Pille, die Avatar-Initialen sind hier die
                        // einzige Personen-Kennung (voller Name im title-Attribut).
                        const avatarLabel = isTeam ? "T" : s.user?.name ? lastNameInitial(s.user.name) : "?";
                        const statusColor = dienstStatusColor(status, hasAusfall, s.isVertretung);
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
                              "relative flex items-stretch overflow-hidden rounded-[5px] border border-[#e6e6e2]",
                              "shadow-[0_2px_3px_rgba(9,41,72,0.12)]",
                              chipClickable ? "cursor-pointer" : "",
                            ].filter(Boolean).join(" ")}
                          >
                            {/* Punkt 3 (17.08.2026): rechter 4px-Statusfarbbalken —
                                zeigt den Dienststatus, nicht die Person. Kein
                                linker Farbbalken mehr (Punkt 1, 17.08.2026):
                                nur die Avatar-Farbe bleibt als Personenkennung. */}
                            <span
                              aria-hidden="true"
                              className="absolute right-0 top-0 bottom-0 w-[4px]"
                              style={{ backgroundColor: statusColor }}
                            />
                            {/* Zeile 1: Avatar + Status-Icons. Enge Abstände: bei
                                ~57 px Zellbreite müssen Avatar UND bis zu drei
                                13-px-Icons passen (kein Namensfeld, s. Kommentar
                                oben). */}
                            <span className="flex w-full items-center justify-between gap-[3px] bg-white py-0 pl-[3px] pr-[6px] leading-none">
                              <PillAvatar color={barColor} label={avatarLabel} />
                              {/* Arbeitsanweisung 16.08.2026: Status-Icon jetzt
                                  IMMER sichtbar (inkl. grünem Bestätigt-Haken),
                                  nicht mehr nur bei Abweichung. Priorität von
                                  links nach rechts aufsteigend: Basis-Status <
                                  Vertretung < Ausfall — das wichtigste Icon
                                  liegt im Badge-Stack rechts oben. */}
                              <span className="flex shrink-0 items-center -space-x-[7px]">
                                {status === "FIX" ? (
                                  <StatusBadge kind="confirmed" label="Bestätigt" calendarCompact />
                                ) : (
                                  <StatusBadge
                                    kind={status === "ANGEBOTEN" ? "sent" : "draft"}
                                    label={status === "ANGEBOTEN" ? "Vorschlag" : "Entwurf"}
                                    calendarCompact
                                  />
                                )}
                                {s.isVertretung && (
                                  <StatusBadge kind="vertretung" label="Vertretung" calendarCompact />
                                )}
                                {hasAusfall && (
                                  <StatusBadge
                                    kind="krank"
                                    label="Ausfall: Assistenzkraft abwesend"
                                    calendarCompact
                                  />
                                )}
                              </span>
                            </span>
                          </span>
                        );
                      })}
                      {hiddenCount > 0 && (
                        <span
                          data-testid={`day-more-${format(day, "yyyy-MM-dd")}`}
                          className="self-start px-1 text-[7px] font-semibold text-muted-foreground/60 leading-none"
                        >
                          +{hiddenCount}
                        </span>
                      )}
                    </div>
                  )}
                  {/* Arbeitsanweisung 17.08.2026 Punkt 7: statt der bisherigen
                      Kategorie-Aufzählung ("Geplant"/"Ausfall"/"Absage" in
                      Kategoriefarbe) jetzt eine einzige Gesamtzahl aller
                      Abwesenheits-Einträge des Tages, dunkel statt bunt —
                      besser von den (farbigen) Status-Labels unterscheidbar. */}
                  {absences.length > 0 && (
                    <span
                      className="mt-[2px] px-[1px] text-[8px] font-semibold leading-tight text-[#151515]"
                      data-testid={`day-absence-text-${format(day, "yyyy-MM-dd")}`}
                    >
                      {absences.length} Abw.
                    </span>
                  )}
                  </div>
                )
              ) : variant === "full" && (
                /* Desktop/Tablet: zweizeilige Pille mit Uhrzeit. Grauzone
                   #eef0f3 unter der Kopfzeile, Trennlinie in Rahmenfarbe.
                   Task #847: Mindesthöhe an leeren Tagen ist jetzt exakt
                   "Platz für eine einzeilige Pille" (23 px, siehe minimierte
                   Pille) + das eigene py-1-Padding (4 px oben/unten) = 31 px —
                   kein künstlicher Puffer mehr. flex-1 lässt die Grauzone bei
                   einem geschäftigeren Nachbartag INNERHALB derselben Woche
                   trotzdem mitwachsen (CSS-Grid-Zeilen stretchen die Zellen
                   einer Reihe auf die Höhe der belegtesten Zelle); nach oben
                   wächst die Zelle unbegrenzt mit den eigenen Diensten. */
                <div className="flex min-h-[31px] min-w-0 flex-1 flex-col gap-[3px] border-t border-[#dfe4ea] bg-[#e4e8ee] px-1 py-1">
                  {visiblePills.map((s) => {
                    const isTeam = s.type === "team";
                    const slot = getPersonSlot(s.userId);
                    const status = s.planningStatus ?? "FIX";
                    // Task #726: eingeplante Assistenzkraft ist am selben Tag
                    // krank/Kind krank → roter Ausfall-Hinweis an der Pille.
                    const hasAusfall = !isTeam && ausfallUserIds.has(s.userId);
                    const chipClickable = canEdit && !selectionMode;
                    const startOnly = format(new Date(s.startTime), "HH:mm");
                    const timeRange = `${startOnly}–${format(new Date(s.endTime), "HH:mm")}`;
                    const barColor = isTeam ? "#0284c7" : slot.bg;
                    // Arbeitsanweisung 17.08.2026 Punkt 2: bei genug Platz voller
                    // Name, sonst (Container < 155px bzw. Minimiert-Modus immer)
                    // nur der Nachname.
                    const fullName = isTeam ? "Team" : s.user?.name ?? "?";
                    const shortNameLabel = isTeam ? "Team" : s.user?.name ? lastName(s.user.name) : "?";
                    const avatarLabel = isTeam ? "T" : s.user?.name ? nameInitials(s.user.name) : "?";
                    const statusColor = dienstStatusColor(status, hasAusfall, s.isVertretung);
                    const statusLabel = dienstStatusLabel(status, hasAusfall, s.isVertretung);
                    const commonHandlers = {
                      role: chipClickable ? ("button" as const) : undefined,
                      tabIndex: chipClickable ? -1 : undefined,
                      title: `${s.user?.name ?? ""} · ${timeRange}${s.isVertretung ? " · Vertretung" : ""}`.trim(),
                      onClick: chipClickable ? (e: React.MouseEvent) => { e.stopPropagation(); onShiftClick(s); } : undefined,
                      onKeyDown: chipClickable ? (e: React.KeyboardEvent) => {
                        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onShiftClick(s); }
                      } : undefined,
                    };
                    const statusBadgeStack = (
                      <>
                        {status === "FIX" ? (
                          <StatusBadge kind="confirmed" label="Bestätigt" calendarCompact={pillMinimiert} />
                        ) : (
                          <StatusBadge
                            kind={status === "ANGEBOTEN" ? "sent" : "draft"}
                            label={status === "ANGEBOTEN" ? "Vorschlag" : "Entwurf"}
                            calendarCompact={pillMinimiert}
                          />
                        )}
                        {pillMinimiert && s.isVertretung && (
                          <StatusBadge kind="vertretung" label="Vertretung" calendarCompact />
                        )}
                        {hasAusfall && (
                          <StatusBadge
                            kind="krank"
                            label="Ausfall: Assistenzkraft abwesend"
                            calendarCompact={pillMinimiert}
                          />
                        )}
                      </>
                    );
                    // Punkt 1 (17.08.2026): globaler Minimiert-Umschalter —
                    // kollabiert die zweizeilige Pille auf eine Zeile (Avatar/
                    // Farbbalken · Nachname · Uhrzeit · Status-Icon), Zeile 2
                    // entfällt komplett. Punkt 2: Uhrzeit reagiert per
                    // Container-Query auf die tatsächliche Pillenbreite
                    // (< 115 px im Minimiert-Modus → nur Dienstbeginn).
                    if (pillMinimiert) {
                      return (
                        <span
                          key={s.id}
                          data-testid={`day-chip-${s.id}`}
                          {...commonHandlers}
                          className={[
                            // Task #847: keine feste h-6 mehr — die Höhe ergibt
                            // sich aus dem Inhalt (min-h-[23px] unten), damit die
                            // minimierte Pille exakt so hoch ist wie Zeile 1 der
                            // zweizeiligen Pille (dieselbe Mindesthöhe, Punkt 5,
                            // 17.08.2026). Vorher: h-6 (24px) vs. natürliche
                            // Inhaltshöhe 21px → wirkte 2px niedriger als Zeile 1.
                            "@container relative flex items-center overflow-hidden rounded-[6px] border",
                            "border-[#c7ced8] shadow-[0_3px_5px_rgba(9,41,72,0.13)]",
                            chipClickable ? "cursor-pointer" : "",
                          ].filter(Boolean).join(" ")}
                        >
                          {/* Punkt 3 (17.08.2026): rechter 4px-Statusfarbbalken —
                              zeigt den Dienststatus, nicht die Person. Kein
                              linker Farbbalken mehr (Arbeitsanweisung
                              17.08.2026 Punkt 1: nur die Avatar-Farbe bleibt
                              als Personenkennung). */}
                          <span
                            aria-hidden="true"
                            className="absolute right-0 top-0 bottom-0 w-[4px]"
                            style={{ backgroundColor: statusColor }}
                          />
                          <span className="flex min-h-[23px] w-full items-center gap-[4px] bg-white py-[2px] pl-[6px] pr-[6px] leading-none">
                            <PillAvatar color={barColor} label={avatarLabel} />
                            {/* Arbeitsanweisung 17.08.2026, Folgeauftrag: kein
                                shrink-0 mehr — der Name soll bei wenig Platz
                                wie im ausgeklappten Modus per truncate mit „…"
                                abgekürzt werden, statt starr seine volle Breite
                                zu behaupten und dabei die Status-Icons daneben
                                aus der Pille zu drängen. */}
                            <span data-testid={`day-chip-label-${s.id}`} className="min-w-0 truncate text-[12px] font-bold text-[#151515]">
                              {shortNameLabel}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-[10px] font-semibold text-[#444444]">
                              {isTeam ? (
                                "Teamdienst"
                              ) : (
                                <>
                                  <span className="@max-[114px]:hidden">{timeRange}</span>
                                  <span className="hidden @max-[114px]:inline">{startOnly}</span>
                                </>
                              )}
                            </span>
                            <span className="flex shrink-0 items-center -space-x-[7px]">{statusBadgeStack}</span>
                          </span>
                        </span>
                      );
                    }
                    return (
                      <span
                        key={s.id}
                        data-testid={`day-chip-${s.id}`}
                        {...commonHandlers}
                        className={[
                          "@container relative flex flex-col items-stretch overflow-hidden rounded-[6px] border",
                          // Punkt 5 (15.08.2026): Desktop-Pillen leicht erhaben —
                          // Kontur #c7ced8 + weicher Schatten.
                          "border-[#c7ced8] shadow-[0_3px_5px_rgba(9,41,72,0.13)]",
                          chipClickable ? "cursor-pointer" : "",
                        ].filter(Boolean).join(" ")}
                      >
                        {/* Punkt 3 (17.08.2026): rechter 4px-Statusfarbbalken —
                            zeigt den Dienststatus, nicht die Person. Kein
                            linker Farbbalken mehr (Arbeitsanweisung
                            17.08.2026 Punkt 1: nur die Avatar-Farbe bleibt
                            als Personenkennung). */}
                        <span
                          aria-hidden="true"
                          className="absolute right-0 top-0 bottom-0 w-[4px]"
                          style={{ backgroundColor: statusColor }}
                        />
                        {/* Zeile 1: Avatar + Name + Status-Badge Variante C.
                            Ausfall-Warnung (Task #726) rechts außen. Feste
                            Mindesthöhe (Punkt 5, 17.08.2026): die Zeile darf
                            bei schmalen Containern nicht schrumpfen, sonst
                            wirken die Status-Icons überproportional groß. */}
                        <span className="flex min-h-[23px] items-center justify-between gap-1 bg-white py-[2px] pl-[6px] pr-[6px] leading-none">
                          <span className="flex min-w-0 items-center gap-[4px]">
                            <PillAvatar color={barColor} label={avatarLabel} />
                            <span className="min-w-0 truncate text-[12px] font-bold text-[#151515]">
                              <span className="@max-[154px]:hidden">{fullName}</span>
                              <span className="hidden @max-[154px]:inline">{shortNameLabel}</span>
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-[3px]">{statusBadgeStack}</span>
                        </span>
                        {/* Zeile 2: Uhr-Badge + Uhrzeit (+ Vertretung rechts) auf
                            Grauweiß. Punkt 2 (17.08.2026): Container-Query statt
                            fixem Viewport-Breakpoint — reagiert auf die
                            tatsächliche Pillenbreite (< 215 px → reduziert).
                            Feste Mindesthöhe (Punkt 5) aus demselben Grund wie
                            Zeile 1. */}
                        <span className="flex min-h-[23px] items-center gap-[3px] bg-[#f1f1ee] py-[2px] pl-[6px] pr-[6px] leading-none">
                          <StatusBadge kind="clock" />
                          <span className="truncate text-[11px] font-semibold text-[#444444]">
                            {isTeam ? (
                              "Teamdienst"
                            ) : (
                              <>
                                {/* Schwelle messtechnisch ermittelt (headless
                                    Overflow-Test mit dieser Schrift/Icon-Breite):
                                    98 px sind die tatsächlich benötigte Breite
                                    für "HH:MM–HH:MM" inkl. Uhr-Icon + Innenabstand
                                    — nicht mehr der zuvor geschätzte Rundwert
                                    214 px, der die Endzeit weit vor dem echten
                                    Platzmangel abgeschnitten hat. */}
                                <span className="@max-[97px]:hidden">{timeRange}</span>
                                <span className="hidden @max-[97px]:inline">{startOnly}</span>
                              </>
                            )}
                          </span>
                          {/* Status-Beschriftung rechts (auf Nutzerwunsch wieder
                              eingeführt): dieselbe Priorität wie statusColor/
                              statusBadgeStack (Krank > Vertretung > Bestätigt/
                              Entwurf). Schwelle ebenfalls messtechnisch ermittelt:
                              168 px sind die tatsächlich benötigte Breite für
                              Uhr-Icon + volle Uhrzeit + Wechsel-Icon + längste
                              Beschriftung "Vertretung" (Worst Case) — deutlich
                              unter dem alten Schätzwert 215 px, der die
                              Beschriftung schon wegfallen ließ, obwohl noch
                              sichtbar Platz zwischen Uhrzeit und Pillenrand war.
                              Zwischen 98–167 px bleibt jetzt die volle Uhrzeit
                              sichtbar, nur die Beschriftung entfällt zuerst
                              (weniger wichtig als Start-/Endzeit). */}
                          <span
                            className="ml-auto hidden shrink-0 items-center gap-[2px] @[168px]:inline-flex"
                            style={{ color: dienstStatusTextColor(status, hasAusfall, s.isVertretung) }}
                            title={statusLabel}
                          >
                            {s.isVertretung && <StatusBadge kind="vertretung" />}
                            <span className="text-[10px] font-semibold">{statusLabel}</span>
                          </span>
                        </span>
                      </span>
                    );
                  })}
                  {/* Überlauf-Zähler: liegt IM Pillen-Container, damit er
                      innerhalb der Grauzone bleibt — die füllt die Zelle seit
                      Punkt 3 (15.08.2026) bis ganz unten. */}
                  {hiddenCount > 0 && (
                    <span
                      data-testid={`day-more-${format(day, "yyyy-MM-dd")}`}
                      className="self-start px-1 text-[7px] font-semibold text-muted-foreground/60 leading-none"
                    >
                      +{hiddenCount}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {/* Punkt 2 (15.08.2026): Auffüller NACH dem Monatsende, damit auch die
            letzte Zeile durchgehende Trennlinien statt einer grauen Fläche
            zeigt. Eigene testid — e2e zählt month-grid-blank == Monats-Offset. */}
        {variant === "full" &&
          Array.from({ length: numWeeks * 7 - blanks.length - days.length }).map((_, i) => (
            <div key={`tail-blank-${i}`} className="bg-muted/10" data-testid="month-grid-tail-blank" />
          ))}
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
            detailGroups.map((group) => {
              // Task #792: Ausfall-Icon in der Tagesleisten-Detailansicht —
              // pro Gruppe (= Tag) die Ausfall-UserIds vorberechnen.
              const groupAusfallIds = new Set(
                group.shifts
                  .filter((s) => isAbsenceShift(s) && ABSENCE_CATEGORY[s.type] === "ausfall")
                  .map((s) => s.userId),
              );
              return (
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
                      hasAusfall={!isAbsenceShift(shift) && groupAusfallIds.has(shift.userId)}
                      modelMap={modelMap}
                      onClick={canEdit && !selectionMode ? () => onShiftClick(shift) : undefined}
                      onConfirm={canEdit && !selectionMode ? onConfirmShift : undefined}
                    />
                  ))}
                </div>
              );
            })
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
  canPlan,
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
  pillMinimiert,
  onTogglePillMinimiert,
  canSeeStundenkonto,
  stundenkontoOpen,
  onToggleStundenkonto,
}: {
  isAdmin: boolean;
  canPlan: boolean;
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
  /** Arbeitsanweisung 17.08.2026 Punkt 1: globaler Minimiert-Umschalter,
   *  nur auf Desktop/Tablet relevant (Smartphone hat bereits einen eigenen
   *  einzeiligen Dauerzustand). */
  pillMinimiert: boolean;
  onTogglePillMinimiert: () => void;
  /** Task #857: Stundenkonto ersetzt für berechtigte Admins den einfachen
   *  Assistenzkraft-Dropdown (assistantFilter unten) durch das Panel/die
   *  Reihe im Seitenkörper. Der Umschalter hier ist nur ≥1100px relevant
   *  (darunter ist die Reihe immer sichtbar, kein Ein-/Ausklappen nötig). */
  canSeeStundenkonto: boolean;
  stundenkontoOpen: boolean;
  onToggleStundenkonto: () => void;
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
    canPlan,
    assistants.length,
    String(selectedAssistant),
    selectedTeamId ?? "none",
    confirmableCount,
    canBasicExport,
    canBulkEdit,
    canSeeStundenkonto,
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

  // Task #857: Für canSeeStundenkonto-Admins ersetzt das Stundenkonto (Panel/
  // Reihe) den Filter nur im Desktop-Kalenderkörper (≥768px). Auf
  // Smartphone-Breite gibt es dort kein Äquivalent — der klassische
  // Einzel-Filter bleibt daher unterhalb von md sichtbar (display:contents
  // reicht die Kinder unverändert an den Kopfzeilen-Flex weiter).
  const assistantFilter = canPlan && assistants.length > 0 && (
    <div className={canSeeStundenkonto ? "contents md:hidden" : "contents"}>
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
    {/* Gruppentrennlinie nach dem Assistenzkraft-Filter (Task #856),
        nur in den einzeiligen Stufen. */}
    {!stacked && (
      <span aria-hidden="true" className="h-6 w-px shrink-0 bg-border" />
    )}
    </div>
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
            { value: "grid", label: "Monat", icon: LayoutGrid },
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
            { value: "grid", label: "Monat", icon: LayoutGrid },
          ]}
        />
      </div>
      {/* Arbeitsanweisung 17.08.2026 Punkt 1: globaler Minimiert-Umschalter
          für die Monatsraster-Pillen, nur relevant auf Desktop/Tablet UND nur
          in der Monatsansicht (Tabelle hat keine Pillen). */}
      {desktopView === "grid" && (
        <div className="hidden md:block" data-testid="pill-minimiert-toggle-wrapper">
          <Button
            variant={pillMinimiert ? "default" : "outline"}
            size="sm"
            className={showLabels ? "gap-1.5" : `h-9 shrink-0 px-0 ${stacked ? "w-8" : "w-9"}`}
            onClick={onTogglePillMinimiert}
            title={pillMinimiert ? "Pillen wieder zweizeilig anzeigen" : "Pillen minimieren (einzeilig)"}
            aria-label="Dienst-Pillen minimieren"
            aria-pressed={pillMinimiert}
            data-testid="toggle-pill-minimiert"
          >
            <ChevronsDownUp className="h-4 w-4" />
            {showLabels && <span>Minimiert</span>}
          </Button>
        </div>
      )}
      {/* Task #857: Ein-/Ausklappen des Stundenkonto-Panels — nur ≥1100px
          relevant (min-[1100px] identisch zur JS-Schwelle in
          stundenkonto-leiste.tsx); darunter zeigt der Seitenkörper die
          Reihe immer, ein Umschalten wäre wirkungslos. */}
      {canSeeStundenkonto && (
        <div className="hidden min-[1100px]:block" data-testid="stundenkonto-toggle-wrapper">
          <Button
            variant={stundenkontoOpen ? "default" : "outline"}
            size="sm"
            className={showLabels ? "gap-1.5" : `h-9 shrink-0 px-0 ${stacked ? "w-8" : "w-9"}`}
            onClick={onToggleStundenkonto}
            title={stundenkontoOpen ? "Stundenkonto ausblenden" : "Stundenkonto einblenden"}
            aria-label="Stundenkonto ein-/ausblenden"
            aria-pressed={stundenkontoOpen}
            data-testid="toggle-stundenkonto"
          >
            <Scale className="h-4 w-4" />
            {showLabels && <span>Stundenkonto</span>}
          </Button>
        </div>
      )}
    </>
  );

  const confirmAllButton = isAdmin && (
    <Button
      variant="outline"
      size="sm"
      className={showLabels ? "gap-1.5" : `relative h-9 shrink-0 px-0 ${stacked ? "w-8" : "w-9"}`}
      onClick={onConfirmAll}
      disabled={isBulkConfirming || confirmableCount === 0}
      title={confirmableCount === 0 ? "Keine Entwürfe zum Versenden" : "Vorschlag senden"}
      aria-label="Vorschlag senden"
      data-testid="confirm-all-drafts"
    >
      <Send className="h-4 w-4" />
      {showLabels ? (
        <>
          <span>Senden</span>
          {confirmableCount > 0 && (
            <span className="rounded-full bg-primary/20 px-1.5 text-xs font-semibold text-assistenz-brand">
              {confirmableCount}
            </span>
          )}
        </>
      ) : confirmableCount > 0 ? (
        <span className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary/20 px-1 text-[10px] font-semibold text-assistenz-brand ring-1 ring-assistenz-brand/20 backdrop-blur-sm">
          {confirmableCount}
        </span>
      ) : null}
    </Button>
  );

  // Aktive Mehrfachauswahl bleibt als eigener Beenden-Button in der
  // Hauptleiste sichtbar (ein Klick zum Verlassen des Modus); der Einstieg
  // wandert ins Überlauf-Menü (Task #856).
  const endSelectionButton = canPlan && canBulkEdit && isSelectionMode && (
    <Button
      variant="default"
      size="icon"
      className="relative h-9 w-9 shrink-0 after:absolute after:-inset-1 after:content-['']"
      onClick={onToggleSelection}
      title="Auswahl beenden"
      aria-label="Auswahl beenden"
      data-testid="toggle-selection-mode"
    >
      <X className="h-4 w-4" />
    </Button>
  );

  // Überlauf-Menü (Task #856): seltener genutzte Aktionen — PDF-Export,
  // Mehrfachauswahl-Einstieg und Abwesenheitskalender — hinter einem
  // „Weitere Aktionen"-Trigger. Labels im Menü sind immer sichtbar,
  // unabhängig von der Header-Stufe.
  const showSelectionEntry = canPlan && !isSelectionMode;
  const overflowMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="relative h-9 w-9 shrink-0 px-0 after:absolute after:-inset-1 after:content-['']"
          title="Weitere Aktionen"
          aria-label="Weitere Aktionen"
          data-testid="header-overflow"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canBasicExport && (
          <DropdownMenuItem
            className="min-h-[44px] gap-2"
            onSelect={onExport}
            disabled={isExporting}
            title="Monatsübersicht als PDF: bestätigte Dienste und Abwesenheiten, ohne Zeiterfassung."
            data-testid="simple-month-export"
          >
            <FileDown className="h-4 w-4" />
            <span>{isExporting ? "Exportiere..." : "Monat als PDF exportieren"}</span>
          </DropdownMenuItem>
        )}
        {showSelectionEntry &&
          (canBulkEdit ? (
            <DropdownMenuItem
              className="min-h-[44px] gap-2"
              onSelect={onToggleSelection}
              title="Auswählen"
              aria-label="Auswählen"
              data-testid="toggle-selection-mode"
            >
              <SquareDashedMousePointer className="h-4 w-4" />
              <span>Auswählen</span>
            </DropdownMenuItem>
          ) : (
            // Bewusst klickbar statt `disabled`: auf Touch-Geräten gibt es
            // keinen Tooltip — der Klick führt direkt zur Preise-/Premium-Seite.
            <DropdownMenuItem
              className="min-h-[44px] gap-2"
              onSelect={() => navigateHeader("/preise")}
              title="Massenbearbeitung ist in Premium enthalten. Preise & Premium ansehen."
              aria-label="Auswählen (Premium) — Preise & Premium ansehen"
              data-testid="toggle-selection-mode-locked"
            >
              <Lock className="h-4 w-4" />
              <span>Auswählen</span>
            </DropdownMenuItem>
          ))}
        {(canBasicExport || showSelectionEntry) && <DropdownMenuSeparator />}
        <DropdownMenuItem
          className="min-h-[44px] gap-2"
          onSelect={() => setAbsCalOpen(true)}
          title="Abwesenheitskalender öffnen (Jahresübersicht)"
          aria-label="Abwesenheitskalender öffnen"
          data-testid="open-abwesenheits-kalender"
        >
          <Palmtree className="h-4 w-4" />
          <span>Abwesenheit eintragen</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // Gruppentrennlinie zwischen Aktions-Gruppen (nur einzeilige Stufen).
  const groupDivider = !stacked && (
    <span aria-hidden="true" className="h-6 w-px shrink-0 bg-border" />
  );

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
          {groupDivider}
          {confirmAllButton}
          {endSelectionButton}
          {overflowMenu}
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
function DienstplanTableView({
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
    <div className="flex flex-col gap-3 animate-in fade-in duration-300">
      {header}

      {forwardPlanningBlocked && (
        <PlanLimitBanner>
          Im Free-Tarif nur bis nächsten Monat planbar. Für eine längere Vorausplanung ist ein
          Upgrade auf Premium nötig.
        </PlanLimitBanner>
      )}

      {/* Assistenz-Banner: Vorgeschlagene Dienste bestätigen */}
      {!isAdmin && myAngebotenShifts.length > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3">
          <div className="flex items-center gap-2 text-sky-900">
            <Check className="h-4 w-4 shrink-0 text-sky-600" />
            <span className="text-sm font-medium">
              {myAngebotenShifts.length === 1
                ? "1 Dienstvorschlag wartet auf Ihre Bestätigung."
                : `${myAngebotenShifts.length} Dienstvorschläge warten auf Ihre Bestätigung.`}
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
              minimal
            />
          </div>
        )}
        <div className={`w-full transition-opacity duration-150 ${isTransitioning ? "opacity-60" : ""}`}>
        {mobileView === "list" ? (
          <AgendaView
            days={days}
            shifts={visibleShifts}
            modelMap={modelMap}
            onDayClick={(day) => openCreate(day)}
            onShiftClick={openEdit}
            onConfirmShift={confirmShift}
            canEdit={canPlan}
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
            canEdit={canPlan}
            selectionMode={isSelectionMode}
            selectedDates={selectedDates}
            onToggleDate={toggleDate}
            onNavigateMonth={navigateMonthWithFocus}
            focusDate={monthGridFocusDate}
            onFocusDateHandled={() => setMonthGridFocusDate(null)}
            variant="collapsed"
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

      {/* ── Persistente Wochen-Kapitel-Liste ───────────────────────────────
           Erscheint dauerhaft unterhalb der Hauptansicht, unabhängig vom
           gewählten Ansicht-Umschalter. Smartphone: kompaktes Design.
           Desktop: großzügiger skaliert (comfortable-Variante). ── */}
      <div className="md:hidden" data-testid="persistent-week-list-mobile">
        <AgendaView
          days={days}
          shifts={visibleShifts}
          modelMap={modelMap}
          onDayClick={(day) => openCreate(day)}
          onShiftClick={openEdit}
          onConfirmShift={confirmShift}
          canEdit={canPlan}
          selectionMode={isSelectionMode}
          selectedDates={selectedDates}
          onToggleDate={toggleDate}
          variant="compact"
        />
      </div>
      <div className="hidden md:block" data-testid="persistent-week-list-desktop">
        <AgendaView
          days={days}
          shifts={visibleShifts}
          modelMap={modelMap}
          onDayClick={(day) => openCreate(day)}
          onShiftClick={openEdit}
          onConfirmShift={confirmShift}
          canEdit={canPlan}
          selectionMode={isSelectionMode}
          selectedDates={selectedDates}
          onToggleDate={toggleDate}
          variant="comfortable"
        />
      </div>

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
          assistants={assistants}
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
    </PersonColorsContext.Provider>
  );
}
