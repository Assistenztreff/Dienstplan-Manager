import { formatAbsenceTimeSpan } from "@/lib/absence-time";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  format,
  isSameDay,
  startOfDay,
  startOfWeek,
  addDays,
  differenceInCalendarDays,
  isWithinInterval,
} from "date-fns";
import { de } from "date-fns/locale";
import { Card } from "@/components/ui/card";
import { Check, ChevronDown, Users, MessageSquare } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { useTeam } from "@/context/team";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { userBadgeClass, type PersonColorAssignment } from "@/lib/shift-model-colors";
import { type PersonSlot, getPersonSlots } from "@/lib/barrierefreie-farben";
import { useAssistantPalette } from "@/lib/use-assistant-palette";
import { type Assistant } from "@/components/assistant-filter";

export type Shift = {
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
  pauseMinutes?: number | null;
};

export const PLANNING_STATUS_LABELS: Record<string, string> = {
  VORLAEUFIG: "Entwurf",
  ANGEBOTEN: "Vorschlag",
};

const PLANNING_STATUS_BADGE_CLASSES: Record<string, string> = {
  VORLAEUFIG: "bg-foreground/10 text-foreground/70",
  ANGEBOTEN: "bg-sky-200 text-sky-900",
};

export function isConfirmableShift(shift: Shift): boolean {
  if (shift.type === "vacation" || shift.type === "sick") return false;
  return shift.planningStatus === "VORLAEUFIG" || shift.planningStatus === "ANGEBOTEN";
}

export function planningStatusBadgeOutline(shift: Shift): string {
  if (shift.planningStatus === "VORLAEUFIG") return "border-dashed opacity-70";
  if (shift.planningStatus === "ANGEBOTEN") return "border-dashed";
  return "";
}

export type ShiftModelInfo = { name: string };

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

export function shiftLabel(shift: Shift, modelMap: Map<number, ShiftModelInfo>): string {
  if (shift.type === "work") {
    return (shift.shiftModelId ? modelMap.get(shift.shiftModelId)?.name : undefined) ?? "Dienst";
  }
  return SHIFT_TYPE_LABELS[shift.type] ?? shift.type;
}

// Kollisionsarme Team-Farbzuordnung (userId → Palettenfarbe), von der Seite
// aus der Team-Mitgliederliste berechnet. Ohne Provider (oder für IDs
// außerhalb des Teams, z. B. Aushilfe-Spiegel) greift der Hash-Fallback.
export const PersonColorsContext = createContext<PersonColorAssignment | undefined>(undefined);

export function usePersonColors(): PersonColorAssignment | undefined {
  return useContext(PersonColorsContext);
}

/** Kategoriale Personen-Slot-Farben (userId → Slot) — gemeinsame Quelle für
 *  die Tagesleiste unter dem Kalender UND die mobile Listenansicht, damit der
 *  3-px-Farbbalken überall dieselbe Farbe pro Assistenzkraft trägt.
 *  Zuweisung: Assistenzkraft sortiert nach ID (= Anlagereihenfolge) → Slot 1, 2, ...
 *  Bei >12 Assistenzkräften: wrap-around ab Slot 1 (zweite Runde). */
export function usePersonSlotLookup(): (userId: number) => PersonSlot {
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
export function dienstStatusColor(status: string, hasAusfall: boolean, isVertretung: boolean | null | undefined): string {
  if (hasAusfall) return "#b23b3b";
  if (isVertretung) return "#0f6e8c";
  if (status === "FIX") return "#1e8f4e";
  if (status === "ANGEBOTEN") return "#0284c7";
  return "#b5790a";
}

/** Kontraststarke Textfarbe für die Statusbeschriftung auf dem hellgrauen
 *  Hintergrund der zweiten Desktop-Pillenzeile (mindestens WCAG AA). */
export function dienstStatusTextColor(status: string, hasAusfall: boolean, isVertretung: boolean | null | undefined): string {
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
export function dienstStatusLabel(status: string, hasAusfall: boolean, isVertretung: boolean | null | undefined): string {
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
export function PillAvatar({ color, label }: { color: string; label: string }) {
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

export function usePersistentState<T extends string>(key: string, fallback: T, allowed: readonly T[]): [T, (value: T) => void] {
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

export const WEEKDAY_LABELS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
// Arbeitsauftrag 15.08.2026 (Monatsraster Desktop, Punkt 1): volle Wochentags-
// namen im Desktop-Kopf; wird der Platz knapp (<900 px), greifen die Kürzel.
export const WEEKDAY_LABELS_FULL = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

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
export function isAbsenceShift(shift: Shift): boolean {
  return ABSENCE_TYPES.has(shift.type);
}

function dayKey(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

/** Grilling 26.08.2026, Punkt 3: Tap auf eine Zelle im eingeklappten
 *  Smartphone-Monatsraster scrollt zur passenden Zeile in der Wochen-Liste
 *  darunter — ersetzt den früheren Scroll auf das (entfernte) Tagesdetail-
 *  Panel. DOM-Query statt Ref-Weiterreichung, da MonthGrid und ScheduleList
 *  Geschwister-Komponenten sind (gleiches Muster wie die headerH-Messung
 *  über `[data-dienstplan-header]`). Der Aufruf erfolgt im selben Klick-
 *  Handler wie `onSelectDay` — React hat den neuen `selectedDay` zu diesem
 *  Zeitpunkt noch nicht gerendert (relevant bei Zeitraum „Heute"/„Diese
 *  Woche", deren Liste dann noch die ALTE Zeile zeigt); ein rAF wartet auf
 *  den nächsten Render. Bei aktivem Typ-Filter (z. B. „Nur Abwesenheiten")
 *  kann die Zielzeile ausgeblendet sein — dann bleibt es ein No-op. */
export function scrollToAgendaDay(day: Date): void {
  requestAnimationFrame(() => {
    const el = document.querySelector(
      `[data-testid="agenda-day-${dayKey(day)}"]`,
    );
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

/** Nachname für die Kalender-Pille (Spec §2.1: Zeile 1 zeigt nur den Nachnamen). */
export function lastName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1]! : name.trim();
}

/** Arbeitsanweisung 17.08.2026 (Folgeauftrag): Avatar-Initiale der Kalender-
 *  Pille zeigt nur noch EINEN Buchstaben — den Anfangsbuchstaben des
 *  Nachnamens (Vorbild: schlankere Vergleichs-Ansicht) statt der bisherigen
 *  zwei Buchstaben (Vor-/Nachname). Andere Initialen-Anzeigen (Filterleiste,
 *  Auswertungstabellen) bleiben unverändert bei nameInitials().  */
export function lastNameInitial(name: string): string {
  const ln = lastName(name);
  return ln.length > 0 ? ln[0]!.toUpperCase() : "?";
}

/** Zweizeilige Namensdarstellung für die Tabellenansicht. */
export function nameLines(name: string): { firstName: string; lastName: string } {
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

export function TeamAbsenceOverview({
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

export type DialogState =
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
export function isMirrorShift(shift: Shift, selectedTeamId: number | null): boolean {
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
