/**
 * Abwesenheitskalender — Jahresansicht (HANDOFF-abwesenheiten-menue.md, 05.08.2026).
 *
 * - 2 Zeilen à 6 quadratische Mini-Monatskalender (Desktop), Tage mit
 *   Abwesenheiten in Kategoriefarbe: Gelb = geplant, Rot = Ausfall, Grau = Absage.
 * - Smartphone: Akkordeon (ein Monat pro Zeile mit Zähler, aktueller Monat offen).
 * - Filter: Assistenzkraft (nur Verwaltung) + Farb-Chips (Legende + Filter).
 * - Direktanlage mit Zwei-Stufen-Klick wie im Dienstplan: erster Klick wählt
 *   den Tag, zweiter Klick auf denselben Tag öffnet den Anlage-Dialog, Klick
 *   auf einen anderen Tag verschiebt nur die Auswahl.
 * - Mehrfachauswahl (Umschalter neben der Legende): Tagesklicks togglen die
 *   Auswahl, „Abwesenheit eintragen" öffnet den Dialog für den Zeitraum vom
 *   frühesten bis zum spätesten gewählten Tag (inklusiv).
 * - Klick auf einen belegten Tag öffnet Details mit Löschen (rechtebasiert).
 * - Wird als eigene Seiten-Sektion (/abwesenheiten) UND als Popup (Dienstplan)
 *   verwendet — gleiches Layout an beiden Stellen.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  useBulkCreateAbsence,
  useBulkDeleteShifts,
  useDeleteShift,
  useListShifts,
  useListUsers,
  ApiError,
  type BulkAbsenceInput,
  type User,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  format,
  getDay,
  startOfMonth,
} from "date-fns";
import { de } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckSquare, ChevronDown, ChevronLeft, ChevronRight, Trash2, X } from "lucide-react";
import { useAuth, hasTeamAccessLevel } from "@/context/auth";
import { isAdminRole } from "@/lib/roles";
import { useToast } from "@/hooks/use-toast";
import { planUpgradeMessage, readableApiError } from "@/lib/api-error";
import {
  invalidateShiftDerivedQueries,
  removeShiftsFromCache,
  upsertShiftsInCache,
} from "@/lib/shift-cache";
import { warnIfMonthClosed } from "@/lib/month-closing-warning";

// ── Kategorien (HANDOFF): 3 Kategoriefarben statt 8 Einzelfarben ────────────
// Die Abrechnung unterscheidet weiterhin alle 8 Arten — nur die Kalender-
// Darstellung gruppagiert auf geplant/ausfall/absage.
export type AbsenceCategory = "geplant" | "ausfall" | "absage";

export const ABSENCE_CATEGORY: Record<string, AbsenceCategory> = {
  vacation: "geplant",
  freizeitausgleich: "geplant",
  freistellung: "geplant",
  urlaubsabgeltung: "geplant",
  sick: "ausfall",
  kind_krank: "ausfall",
  abgesagt_ag: "absage",
  abgesagt_an: "absage",
};

export const ABSENCE_TYPE_LABELS: Record<string, string> = {
  vacation: "Urlaub",
  sick: "Krank",
  freizeitausgleich: "Freizeitausgleich",
  kind_krank: "Kind krank",
  freistellung: "Freistellung (bezahlt)",
  urlaubsabgeltung: "Urlaubsabgeltung",
  abgesagt_ag: "Abgesagt (Arbeitgeber)",
  abgesagt_an: "Abgesagt (Assistenz)",
};

const ABSENCE_TYPES = Object.keys(ABSENCE_CATEGORY);

const CATEGORY_STYLE: Record<
  AbsenceCategory,
  { chip: string; cell: string; label: string }
> = {
  geplant: {
    chip: "bg-amber-400",
    cell: "bg-amber-400 text-amber-950",
    label: "Geplant (Urlaub, Freizeitausgleich, …)",
  },
  ausfall: {
    chip: "bg-red-500",
    cell: "bg-red-500 text-white",
    label: "Ausfall (Krank, Kind krank)",
  },
  absage: {
    chip: "bg-slate-400",
    cell: "bg-slate-400 text-slate-950",
    label: "Absage (AG/AK)",
  },
};

// Dominanz bei mehreren Kategorien am selben Tag: Ausfall > geplant > Absage.
const CATEGORY_PRIORITY: AbsenceCategory[] = ["ausfall", "geplant", "absage"];

type AbsenceShiftLite = {
  id: number;
  userId: number;
  startTime: string;
  endTime: string;
  type: string;
  user?: { name: string } | null;
};

function dayKeyOf(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

export function AbwesenheitsKalender() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();
  const canManage =
    isAdminRole(currentUser?.role) ||
    !!currentUser?.isTeamleiter ||
    hasTeamAccessLevel(currentUser, "stufe1");

  const { data: users } = useListUsers(undefined, {
    query: { enabled: canManage },
  } as Parameters<typeof useListUsers>[1]) as { data?: User[] };
  const [year, setYear] = useState(() => new Date().getFullYear());
  // Serverseitiger Zeitraum-Default (Task #871): ohne Parameter liefert
  // GET /shifts nur den aktuellen Kalendermonat. Der Jahreskalender braucht
  // das GANZE gewählte Jahr — { year } schaltet auf Jahresfilterung statt
  // Monats-Default; die bestehende clientseitige Jahres-Filterung unten
  // bleibt als Sicherheitsnetz erhalten.
  const { data: allShifts } = useListShifts({ year });
  const bulkCreateAbsence = useBulkCreateAbsence();
  const deleteShift = useDeleteShift();
  const bulkDeleteShifts = useBulkDeleteShifts();

  const assistants = useMemo(
    () => (users ?? []).filter((u) => u.role === "assistant"),
    [users],
  );

  // Personenfilter: „alle" (nur Verwaltung) oder konkrete userId als String.
  const [personFilter, setPersonFilter] = useState<string>(
    canManage ? "alle" : String(currentUser?.id ?? ""),
  );
  const [enabledCategories, setEnabledCategories] = useState<
    Record<AbsenceCategory, boolean>
  >({ geplant: true, ausfall: true, absage: true });
  // Gewählter Tag für die Direktanlage (Zwei-Stufen-Klick, yyyy-MM-dd).
  const [selected, setSelected] = useState<string | null>(null);
  // Mehrfachauswahl: tagweises An-/Abwählen für Zeitraum-Anlage.
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [createDraft, setCreateDraft] = useState<{ from: string; to: string } | null>(null);
  const [createUserId, setCreateUserId] = useState<string>("");
  const [createType, setCreateType] = useState<string>("vacation");
  const [createError, setCreateError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dayDetail, setDayDetail] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  // Für "Zeitraum löschen": userId+type des laufenden Bulk-Deletes.
  const [deletingRange, setDeletingRange] = useState<string | null>(null);
  // Smartphone-Akkordeon: aktueller Monat startet aufgeklappt.
  const [openMonth, setOpenMonth] = useState<number>(() => new Date().getMonth());

  // ── Tastatur-Navigation: Roving-Tabindex (WAI-ARIA-Grid-Pattern) ─────────
  // Ein Ref-Map für alle Tages-Buttons des sichtbaren Jahres.
  const dayRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());
  // Der aktuell fokussierte Tag (yyyy-MM-dd); null = keiner / erster des Monats.
  const [focusedDayKey, setFocusedDayKey] = useState<string | null>(null);
  // Beim Monatswechsel (Akkordeon) muss der Fokus nach dem Rendern gesetzt werden.
  const pendingFocusKey = useRef<string | null>(null);

  // Roving-Tabindex zurücksetzen, wenn das Jahr wechselt.
  useEffect(() => {
    setFocusedDayKey(null);
    pendingFocusKey.current = null;
    dayRefs.current.clear();
  }, [year]);

  // Nach dem Öffnen eines Akkordeon-Monats: ausstehenden Fokus setzen.
  useEffect(() => {
    const k = pendingFocusKey.current;
    if (!k) return;
    const el = dayRefs.current.get(k);
    if (el && el.offsetParent !== null) {
      pendingFocusKey.current = null;
      setFocusedDayKey(k);
      el.focus();
    }
  }, [openMonth]);

  /**
   * Setzt Fokus auf einen Tag (per dayKey). Falls der Tag in einem geschlossenen
   * Akkordeon-Monat liegt, öffnet es diesen zuerst und setzt den Fokus danach.
   */
  function moveFocusToDay(k: string) {
    const el = dayRefs.current.get(k);
    if (el && el.offsetParent !== null) {
      setFocusedDayKey(k);
      el.focus();
    } else {
      // Monat noch nicht gerendert (Akkordeon) → aufklappen, dann fokussieren.
      pendingFocusKey.current = k;
      const targetMonthIdx = Number(k.slice(5, 7)) - 1;
      setOpenMonth(targetMonthIdx);
    }
  }

  /**
   * Tastatur-Handler für einen Tages-Button im Mini-Monatsraster.
   * ArrowLeft/Right/Up/Down bewegen den Fokus, PageUp/Down wechseln den Monat,
   * Home/End gehen zum Wochenanfang/-ende, Enter/Space aktivieren den Tag.
   */
  function handleDayKeyDown(e: React.KeyboardEvent, k: string) {
    const d = new Date(`${k}T00:00:00`);
    let target: Date | null = null;

    switch (e.key) {
      case "ArrowRight": target = addDays(d, 1); break;
      case "ArrowLeft":  target = addDays(d, -1); break;
      case "ArrowDown":  target = addDays(d, 7); break;
      case "ArrowUp":    target = addDays(d, -7); break;
      case "PageDown":   target = addMonths(d, 1); break;
      case "PageUp":     target = addMonths(d, -1); break;
      case "Home": {
        const col = (getDay(d) + 6) % 7;
        target = addDays(d, -col);
        break;
      }
      case "End": {
        const col = (getDay(d) + 6) % 7;
        target = addDays(d, 6 - col);
        break;
      }
      case "Enter":
      case " ": {
        e.preventDefault();
        handleDayClick(k, visibleAbsences(k).length > 0);
        return;
      }
      default: return;
    }

    if (!target) return;
    e.preventDefault();

    // Jahresgrenzen einhalten.
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31);
    if (target < yearStart) target = yearStart;
    if (target > yearEnd) target = yearEnd;
    // Monatstag-Clamp für PageUp/PageDown (z.B. 31. Jan → 28. Feb).
    const targetYear = target.getFullYear();
    if (targetYear !== year) return;

    moveFocusToDay(dayKeyOf(target));
  }

  // ── Abwesenheiten des Jahres, gruppiert pro Tag ──────────────────────────
  const absencesByDay = useMemo(() => {
    const map = new Map<string, AbsenceShiftLite[]>();
    for (const s of (allShifts ?? []) as AbsenceShiftLite[]) {
      if (!ABSENCE_TYPES.includes(s.type)) continue;
      // UTC-Datum aus dem ISO-String extrahieren (kein `new Date()`, damit
      // Abwesenheiten mit T00:00:00.000Z auch in Zeitzonen westlich UTC dem
      // richtigen Kalender-Tag zugeordnet werden).
      const k = s.startTime.substring(0, 10);
      if (Number(s.startTime.substring(0, 4)) !== year) continue;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(s);
    }
    return map;
  }, [allShifts, year]);

  const matchesPerson = (s: AbsenceShiftLite): boolean =>
    !canManage || personFilter === "alle" || s.userId === Number(personFilter);

  /** Sichtbare Abwesenheiten eines Tages (Personen- + Kategoriefilter). */
  const visibleAbsences = (dayKey: string): AbsenceShiftLite[] =>
    (absencesByDay.get(dayKey) ?? []).filter(
      (s) => matchesPerson(s) && enabledCategories[ABSENCE_CATEGORY[s.type] ?? "geplant"],
    );

  const dominantCategory = (dayKey: string): AbsenceCategory | null => {
    const cats = new Set(visibleAbsences(dayKey).map((s) => ABSENCE_CATEGORY[s.type]));
    return CATEGORY_PRIORITY.find((c) => cats.has(c)) ?? null;
  };

  const monthAbsenceCount = (monthIdx: number): number => {
    let count = 0;
    for (const [k, list] of absencesByDay) {
      if (Number(k.slice(5, 7)) !== monthIdx + 1) continue;
      count += list.filter(
        (s) => matchesPerson(s) && enabledCategories[ABSENCE_CATEGORY[s.type] ?? "geplant"],
      ).length;
    }
    return count;
  };

  const userName = (id: number): string =>
    assistants.find((u) => u.id === id)?.name ??
    (currentUser?.id === id ? currentUser.name : undefined) ??
    "Unbekannt";

  async function invalidate() {
    await invalidateShiftDerivedQueries(queryClient);
  }

  // ── Direktanlage: Klick-Logik ────────────────────────────────────────────
  function openCreate(fromKey: string, toKey: string) {
    const [from, to] = fromKey <= toKey ? [fromKey, toKey] : [toKey, fromKey];
    setCreateDraft({ from, to });
    setCreateUserId(
      canManage
        ? personFilter !== "alle"
          ? personFilter
          : ""
        : String(currentUser?.id ?? ""),
    );
    setCreateType("vacation");
    setCreateError(null);
    setSelected(null);
  }

  // Zwei-Stufen-Klick wie im Dienstplan-Monatskalender: erster Klick wählt
  // den Tag nur aus, zweiter Klick auf denselben Tag öffnet den Dialog,
  // Klick auf einen anderen Tag verschiebt nur die Auswahl.
  function handleDayClick(dayKey: string, hasAbsences: boolean) {
    if (selectionMode) {
      // Mehrfachauswahl: Klicks öffnen keinen Dialog, sondern togglen Tage.
      setSelectedDates((prev) =>
        prev.includes(dayKey) ? prev.filter((d) => d !== dayKey) : [...prev, dayKey],
      );
      return;
    }
    if (hasAbsences) {
      setSelected(null);
      setDayDetail(dayKey);
      return;
    }
    if (selected === dayKey) {
      openCreate(dayKey, dayKey);
      return;
    }
    setSelected(dayKey);
  }

  function toggleSelectionMode() {
    setSelected(null);
    setSelectionMode((prev) => {
      if (prev) setSelectedDates([]);
      return !prev;
    });
  }

  // Zeitraum-Anlage aus der Mehrfachauswahl: frühester bis spätester
  // gewählter Tag, inklusiv (gleiche Range-Semantik wie bisher).
  function openCreateFromSelection() {
    if (selectedDates.length === 0) return;
    const sorted = [...selectedDates].sort();
    openCreate(sorted[0], sorted[sorted.length - 1]);
  }

  async function handleCreateSave() {
    if (!createDraft) return;
    setCreateError(null);
    const uid = Number(createUserId);
    if (!uid) {
      setCreateError("Bitte eine Assistenzkraft auswählen.");
      return;
    }
    const start = new Date(`${createDraft.from}T00:00:00`);
    const end = new Date(`${createDraft.to}T00:00:00`);
    const days = eachDayOfInterval({ start, end });
    setSaving(true);
    try {
      // Sammelauftrag (Task #715): der ganze Zeitraum in EINEM Request,
      // transaktional (ganz oder gar nicht). Tage mit bestehender Abwesenheit
      // desselben Typs überspringt der Server und meldet sie zurück.
      const result = await bulkCreateAbsence.mutateAsync({
        data: {
          userId: uid,
          type: createType as BulkAbsenceInput["type"],
          days: days.map((day) => {
            const key = dayKeyOf(day);
            return {
              startTime: `${key}T00:00:00.000Z`,
              endTime: `${key}T23:59:59.000Z`,
            };
          }),
          shiftModelId: null,
        },
      });
      if (result.createdCount === 0) {
        setCreateError("Für den gewählten Zeitraum bestehen bereits Abwesenheiten dieses Typs.");
        return;
      }
      // Sofort reagieren: angelegte Einträge direkt in die geladenen Listen
      // einfügen, ersetzte Arbeitsdienste entfernen; der Abgleich läuft im
      // Hintergrund.
      upsertShiftsInCache(queryClient, result.shifts, result.teamId);
      removeShiftsFromCache(queryClient, result.replacedShiftIds);
      void invalidate();
      const skippedKeys = new Set(result.skippedDates);
      for (const day of days) {
        if (!skippedKeys.has(dayKeyOf(day))) void warnIfMonthClosed(day, null);
      }
      toast({
        title: `${ABSENCE_TYPE_LABELS[createType] ?? "Abwesenheit"} eingetragen`,
        description:
          `${result.createdCount} ${result.createdCount === 1 ? "Tag" : "Tage"} angelegt` +
          (result.skippedCount > 0 ? `, ${result.skippedCount} bereits vorhanden` : ""),
      });
      setCreateDraft(null);
      setSelectedDates([]);
      setSelectionMode(false);
    } catch (err) {
      const planMsg = planUpgradeMessage(err);
      if (err instanceof ApiError && err.status === 401) {
        setCreateError("Sitzung abgelaufen. Bitte Seite neu laden und erneut anmelden.");
      } else if (planMsg) {
        setCreateError(planMsg);
      } else if (err instanceof ApiError && err.status === 403) {
        setCreateError("Keine Berechtigung zum Eintragen von Abwesenheiten.");
      } else if (err instanceof ApiError && err.status === 400) {
        setCreateError(readableApiError(err, "Eintragen fehlgeschlagen. Bitte erneut versuchen."));
      } else {
        setCreateError("Eintragen fehlgeschlagen. Bitte erneut versuchen.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    setDeletingId(id);
    try {
      await deleteShift.mutateAsync({ id });
      // Sofort reagieren: Eintrag aus dem Cache nehmen statt auf Reload zu warten.
      removeShiftsFromCache(queryClient, [id]);
      void invalidate();
      toast({ title: "Abwesenheit entfernt" });
      // Wenn für den Tag nichts mehr übrig ist, Detailansicht schließen.
      if (dayDetail && visibleAbsences(dayDetail).length <= 1) setDayDetail(null);
    } catch {
      if (!navigator.onLine) return;
      toast({ title: "Entfernen fehlgeschlagen", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  }

  /**
   * Findet alle Shift-IDs, die zum gleichen zusammenhängenden Abwesenheits-
   * Zeitraum gehören wie der angeklickte Eintrag (selber Nutzer, selbe Art,
   * lückenlos aufeinanderfolgende Tage).
   */
  function findAbsenceRangeIds(userId: number, type: string, dayKey: string): number[] {
    const same = ((allShifts ?? []) as AbsenceShiftLite[])
      .filter((s) => s.userId === userId && s.type === type)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));

    // Aufeinanderfolgende Tage zu Segmenten gruppieren (Lücke > 1 Tag = neues Segment).
    const segments: { id: number; key: string }[][] = [];
    let seg: { id: number; key: string }[] = [];
    for (const s of same) {
      const key = s.startTime.substring(0, 10);
      if (seg.length === 0) {
        seg.push({ id: s.id, key });
      } else {
        const lastKey = seg[seg.length - 1].key;
        const diffDays = Math.round(
          (new Date(`${key}T00:00:00`).getTime() - new Date(`${lastKey}T00:00:00`).getTime()) /
            86_400_000,
        );
        if (diffDays <= 1) {
          seg.push({ id: s.id, key });
        } else {
          segments.push(seg);
          seg = [{ id: s.id, key }];
        }
      }
    }
    if (seg.length > 0) segments.push(seg);

    const found = segments.find((sg) => sg.some((e) => e.key === dayKey));
    return found ? found.map((e) => e.id) : [];
  }

  /** Löscht alle Tage eines zusammenhängenden Abwesenheits-Zeitraums auf einmal. */
  async function handleDeleteRange(userId: number, type: string, dayKey: string) {
    const rangeKey = `${userId}:${type}`;
    const ids = findAbsenceRangeIds(userId, type, dayKey);
    if (!ids.length) return;
    setDeletingRange(rangeKey);
    try {
      await bulkDeleteShifts.mutateAsync({ data: { ids } });
      removeShiftsFromCache(queryClient, ids);
      void invalidate();
      toast({ title: `${ids.length} Abwesenheitstag${ids.length === 1 ? "" : "e"} entfernt` });
      setDayDetail(null);
    } catch {
      if (!navigator.onLine) return;
      toast({ title: "Entfernen fehlgeschlagen", variant: "destructive" });
    } finally {
      setDeletingRange(null);
    }
  }

  // ── Mini-Monat (quadratische Tageszellen) ────────────────────────────────
  function renderMonth(monthIdx: number) {
    const monthStart = new Date(year, monthIdx, 1);
    const days = eachDayOfInterval({
      start: startOfMonth(monthStart),
      end: endOfMonth(monthStart),
    });
    const offset = (getDay(monthStart) + 6) % 7;
    const monthKey = format(monthStart, "yyyy-MM");

    // Roving-Tabindex: welcher Tag dieses Monats bekommt tabIndex=0?
    // Priorität: fokussierter Tag > gewählter Tag (Einzel) > erster Tag.
    const focusedInMonth = focusedDayKey?.startsWith(monthKey) ? focusedDayKey : null;
    const selectedInMonth =
      !selectionMode && selected?.startsWith(monthKey) ? selected : null;
    const tabbableKey = focusedInMonth ?? selectedInMonth ?? dayKeyOf(monthStart);

    return (
      <div
        key={monthKey}
        className="rounded-lg border border-border/40 bg-card p-1.5"
        data-testid={`abwkal-month-${monthKey}`}
      >
        <p className="mb-1 text-center text-[11px] font-semibold">
          {format(monthStart, "MMMM", { locale: de })}
        </p>
        <div
          className="grid grid-cols-7 gap-px"
          role="grid"
          aria-label={format(monthStart, "MMMM yyyy", { locale: de })}
        >
          <div role="row" className="contents">
            {WEEKDAYS.map((w) => (
              <span
                key={w}
                role="columnheader"
                aria-label={["Montag","Dienstag","Mittwoch","Donnerstag","Freitag","Samstag","Sonntag"][WEEKDAYS.indexOf(w)]}
                className="text-center text-[8px] font-medium uppercase text-muted-foreground/70"
              >
                {w}
              </span>
            ))}
          </div>
          <div role="row" className="contents">
            {Array.from({ length: offset }).map((_, i) => (
              <span key={`blank-${i}`} role="gridcell" className="aspect-square" />
            ))}
            {days.map((day) => {
              const k = dayKeyOf(day);
              const cat = dominantCategory(k);
              const isSelected = selectionMode
                ? selectedDates.includes(k)
                : selected === k;
              const absences = visibleAbsences(k);
              const hasAbsences = absences.length > 0;
              const absenceDesc = hasAbsences
                ? absences
                    .map((s) => `${userName(s.userId)}: ${ABSENCE_TYPE_LABELS[s.type] ?? s.type}`)
                    .join(", ")
                : null;
              const ariaLabel = [
                format(day, "EEEE, d. MMMM yyyy", { locale: de }),
                absenceDesc,
              ]
                .filter(Boolean)
                .join(" — ");
              return (
                <button
                  key={k}
                  ref={(el) => {
                    if (el) dayRefs.current.set(k, el);
                    else dayRefs.current.delete(k);
                  }}
                  type="button"
                  role="gridcell"
                  data-testid={`abwkal-day-${k}`}
                  data-category={cat ?? undefined}
                  data-selected={isSelected ? "true" : undefined}
                  aria-selected={isSelected}
                  aria-label={ariaLabel}
                  tabIndex={k === tabbableKey ? 0 : -1}
                  onClick={() => handleDayClick(k, hasAbsences)}
                  onKeyDown={(e) => handleDayKeyDown(e, k)}
                  onFocus={() => setFocusedDayKey(k)}
                  title={absenceDesc ?? undefined}
                  className={[
                    "aspect-square rounded-[3px] text-[10px] leading-none tabular-nums transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                    cat ? `${CATEGORY_STYLE[cat].cell} font-semibold` : "hover:bg-accent/40 text-foreground/70",
                    isSelected ? "ring-2 ring-inset ring-primary" : "",
                  ].filter(Boolean).join(" ")}
                >
                  {format(day, "d")}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="abwesenheits-kalender">
      {/* Kopf: Jahres-Navigation + Personenfilter + Farb-Chips */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => setYear((y) => y - 1)}
            aria-label="Vorheriges Jahr"
            data-testid="abwkal-prev-year"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[3.5rem] text-center text-sm font-semibold tabular-nums" data-testid="abwkal-year-label">
            {year}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => setYear((y) => y + 1)}
            aria-label="Nächstes Jahr"
            data-testid="abwkal-next-year"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        {canManage ? (
          <Select value={personFilter} onValueChange={setPersonFilter}>
            <SelectTrigger className="h-8 w-[180px] text-xs" data-testid="abwkal-person-filter" aria-label="Assistenzkraft filtern">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="alle">Assistenzkraft: Alle</SelectItem>
              {assistants.map((u) => (
                <SelectItem key={u.id} value={String(u.id)}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-xs text-muted-foreground" data-testid="abwkal-person-self">
            {currentUser?.name}
          </span>
        )}
        <Button
          variant={selectionMode ? "default" : "outline"}
          size="sm"
          className="h-8 gap-1.5 px-2.5 text-xs"
          onClick={toggleSelectionMode}
          aria-pressed={selectionMode}
          title={selectionMode ? "Auswahl beenden" : "Mehrfachauswahl: mehrere Tage an-/abwählen"}
          aria-label={selectionMode ? "Auswahl beenden" : "Mehrfachauswahl"}
          data-testid="abwkal-toggle-selection"
        >
          {selectionMode ? <X className="h-3.5 w-3.5" /> : <CheckSquare className="h-3.5 w-3.5" />}
          Mehrfachauswahl
        </Button>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {(Object.keys(CATEGORY_STYLE) as AbsenceCategory[]).map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() =>
                setEnabledCategories((prev) => ({ ...prev, [cat]: !prev[cat] }))
              }
              aria-pressed={enabledCategories[cat]}
              data-testid={`abwkal-chip-${cat}`}
              title={CATEGORY_STYLE[cat].label}
              className={[
                "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-medium transition-opacity",
                enabledCategories[cat] ? "border-border/60" : "border-border/30 opacity-40",
              ].join(" ")}
            >
              <span className={`h-2.5 w-2.5 rounded-full ${CATEGORY_STYLE[cat].chip}`} />
              {cat === "geplant" ? "Geplant" : cat === "ausfall" ? "Ausfall" : "Absage"}
            </button>
          ))}
        </div>
      </div>

      {!selectionMode && selected && (
        <p className="text-xs text-muted-foreground" data-testid="abwkal-selected-hint">
          {format(new Date(`${selected}T00:00:00`), "EEEE, d. MMMM", { locale: de })} gewählt —
          zum Eintragen denselben Tag erneut antippen.
        </p>
      )}

      {selectionMode && (
        <div
          className="flex flex-wrap items-center gap-2"
          data-testid="abwkal-selection-bar"
        >
          <p className="text-xs text-muted-foreground">
            {selectedDates.length === 0
              ? "Mehrfachauswahl aktiv — Tage antippen, um sie an- oder abzuwählen."
              : `${selectedDates.length} ${selectedDates.length === 1 ? "Tag" : "Tage"} ausgewählt`}
          </p>
          <Button
            size="sm"
            className="h-8 text-xs"
            disabled={selectedDates.length === 0}
            onClick={openCreateFromSelection}
            data-testid="abwkal-create-from-selection"
          >
            Abwesenheit eintragen
          </Button>
        </div>
      )}

      {/* Desktop/Tablet: 2 Zeilen à 6 quadratische Monate */}
      <div className="hidden md:grid md:grid-cols-3 xl:grid-cols-6 gap-2" data-testid="abwkal-grid">
        {Array.from({ length: 12 }).map((_, i) => renderMonth(i))}
      </div>

      {/* Smartphone: Akkordeon, ein Monat pro Zeile */}
      <div className="md:hidden space-y-1" data-testid="abwkal-accordion">
        {Array.from({ length: 12 }).map((_, i) => {
          const monthStart = new Date(year, i, 1);
          const count = monthAbsenceCount(i);
          const open = openMonth === i;
          return (
            <div key={i} className="rounded-lg border border-border/40 bg-card">
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-sm"
                onClick={() => setOpenMonth(open ? -1 : i)}
                aria-expanded={open}
                data-testid={`abwkal-acc-toggle-${format(monthStart, "yyyy-MM")}`}
              >
                <span className="font-medium">{format(monthStart, "MMMM", { locale: de })}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {count > 0 && `${count} ${count === 1 ? "Abwesenheit" : "Abwesenheiten"}`}
                  <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
                </span>
              </button>
              {open && <div className="px-1.5 pb-1.5">{renderMonth(i)}</div>}
            </div>
          );
        })}
      </div>

      {/* Anlage-Dialog (Direktanlage aus dem Kalender) */}
      <Dialog open={createDraft != null} onOpenChange={(o) => !o && setCreateDraft(null)}>
        <DialogContent className="max-w-sm" data-testid="abwkal-create-dialog">
          <DialogHeader>
            <DialogTitle>Abwesenheit eintragen</DialogTitle>
            <DialogDescription>
              {createDraft &&
                (createDraft.from === createDraft.to
                  ? format(new Date(`${createDraft.from}T00:00:00`), "EEEE, d. MMMM yyyy", { locale: de })
                  : `${format(new Date(`${createDraft.from}T00:00:00`), "d. MMMM", { locale: de })} bis ${format(new Date(`${createDraft.to}T00:00:00`), "d. MMMM yyyy", { locale: de })}`)}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {canManage && (
              <div className="space-y-1.5">
                <Label>Assistenzkraft</Label>
                <Select value={createUserId} onValueChange={setCreateUserId}>
                  <SelectTrigger data-testid="abwkal-create-user">
                    <SelectValue placeholder="Assistenzkraft auswählen" />
                  </SelectTrigger>
                  <SelectContent>
                    {assistants.map((u) => (
                      <SelectItem key={u.id} value={String(u.id)}>
                        {u.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Art</Label>
              <Select value={createType} onValueChange={setCreateType}>
                <SelectTrigger data-testid="abwkal-create-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ABSENCE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {ABSENCE_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {createError && (
              <p className="text-sm text-destructive" data-testid="abwkal-create-error">
                {createError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDraft(null)}>
              Abbrechen
            </Button>
            <Button onClick={handleCreateSave} disabled={saving} data-testid="abwkal-create-save">
              {saving ? "Speichern..." : "Speichern"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail-Dialog für belegte Tage (inkl. Löschen) */}
      <Dialog open={dayDetail != null} onOpenChange={(o) => !o && setDayDetail(null)}>
        <DialogContent className="max-w-sm" data-testid="abwkal-day-dialog">
          <DialogHeader>
            <DialogTitle>
              {dayDetail &&
                format(new Date(`${dayDetail}T00:00:00`), "EEEE, d. MMMM yyyy", { locale: de })}
            </DialogTitle>
            <DialogDescription>Abwesenheiten an diesem Tag</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {(dayDetail ? visibleAbsences(dayDetail) : []).map((s) => {
              const canDelete = canManage || s.userId === currentUser?.id;
              const rangeKey = `${s.userId}:${s.type}`;
              const rangeIds = canDelete ? findAbsenceRangeIds(s.userId, s.type, s.startTime.substring(0, 10)) : [];
              const rangeSize = rangeIds.length;
              const isRangeDeleting = deletingRange === rangeKey;
              const isSingleDeleting = deletingId === s.id;
              const anyDeleting = isRangeDeleting || isSingleDeleting;
              return (
                <div
                  key={s.id}
                  className="rounded-md border border-border/40 px-3 py-2 space-y-2"
                  data-testid={`abwkal-day-entry-${s.id}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{userName(s.userId)}</p>
                      <p className="text-xs text-muted-foreground">
                        {ABSENCE_TYPE_LABELS[s.type] ?? s.type}
                      </p>
                    </div>
                    {canDelete && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-destructive shrink-0"
                        onClick={() => handleDelete(s.id)}
                        disabled={anyDeleting}
                        aria-label="Nur diesen Tag löschen"
                        title="Nur diesen Tag löschen"
                        data-testid={`abwkal-delete-${s.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  {/* Zeitraum-Lösch-Button: erscheint nur bei Zeiträumen > 1 Tag */}
                  {canDelete && rangeSize > 1 && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 w-full gap-1.5 text-xs text-destructive border-destructive/30 hover:bg-destructive/5"
                      onClick={() => handleDeleteRange(s.userId, s.type, s.startTime.substring(0, 10))}
                      disabled={anyDeleting}
                      data-testid={`abwkal-delete-range-${s.id}`}
                    >
                      <Trash2 className="h-3 w-3" />
                      {isRangeDeleting
                        ? "Wird gelöscht…"
                        : `Zeitraum löschen (${rangeSize} Tage)`}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
