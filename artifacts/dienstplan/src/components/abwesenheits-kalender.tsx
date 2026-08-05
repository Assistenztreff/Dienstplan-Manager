/**
 * Abwesenheitskalender — Jahresansicht (HANDOFF-abwesenheiten-menue.md, 05.08.2026).
 *
 * - 2 Zeilen à 6 quadratische Mini-Monatskalender (Desktop), Tage mit
 *   Abwesenheiten in Kategoriefarbe: Gelb = geplant, Rot = Ausfall, Grau = Absage.
 * - Smartphone: Akkordeon (ein Monat pro Zeile mit Zähler, aktueller Monat offen).
 * - Filter: Assistenzkraft (nur Verwaltung) + Farb-Chips (Legende + Filter).
 * - Direktanlage: Klick auf Tag (= Start), zweiter Klick (= Ende) öffnet den
 *   Anlage-Dialog für den Zeitraum; gleicher Tag = einzelner Tag.
 * - Klick auf einen belegten Tag öffnet Details mit Löschen (rechtebasiert).
 * - Wird als eigene Seiten-Sektion (/abwesenheiten) UND als Popup (Dienstplan)
 *   verwendet — gleiches Layout an beiden Stellen.
 */
import { useMemo, useState } from "react";
import {
  useCreateShift,
  useDeleteShift,
  useListShifts,
  useListUsers,
  ApiError,
  type ShiftInputType,
  type User,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
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
import { ChevronDown, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { useAuth } from "@/context/auth";
import { isAdminRole } from "@/lib/roles";
import { useToast } from "@/hooks/use-toast";
import { planUpgradeMessage, readableApiError } from "@/lib/api-error";
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
  const canManage = isAdminRole(currentUser?.role) || !!currentUser?.isTeamleiter;

  const { data: users } = useListUsers(undefined, {
    query: { enabled: canManage },
  } as Parameters<typeof useListUsers>[1]) as { data?: User[] };
  const { data: allShifts } = useListShifts();
  const createShift = useCreateShift();
  const deleteShift = useDeleteShift();

  const assistants = useMemo(
    () => (users ?? []).filter((u) => u.role === "assistant"),
    [users],
  );

  const [year, setYear] = useState(() => new Date().getFullYear());
  // Personenfilter: „alle" (nur Verwaltung) oder konkrete userId als String.
  const [personFilter, setPersonFilter] = useState<string>(
    canManage ? "alle" : String(currentUser?.id ?? ""),
  );
  const [enabledCategories, setEnabledCategories] = useState<
    Record<AbsenceCategory, boolean>
  >({ geplant: true, ausfall: true, absage: true });
  // Start-Anker für die Direktanlage per Zwei-Klick (yyyy-MM-dd).
  const [anchor, setAnchor] = useState<string | null>(null);
  const [createDraft, setCreateDraft] = useState<{ from: string; to: string } | null>(null);
  const [createUserId, setCreateUserId] = useState<string>("");
  const [createType, setCreateType] = useState<string>("vacation");
  const [createError, setCreateError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dayDetail, setDayDetail] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  // Smartphone-Akkordeon: aktueller Monat startet aufgeklappt.
  const [openMonth, setOpenMonth] = useState<number>(() => new Date().getMonth());

  // ── Abwesenheiten des Jahres, gruppiert pro Tag ──────────────────────────
  const absencesByDay = useMemo(() => {
    const map = new Map<string, AbsenceShiftLite[]>();
    for (const s of (allShifts ?? []) as AbsenceShiftLite[]) {
      if (!ABSENCE_TYPES.includes(s.type)) continue;
      const d = new Date(s.startTime);
      if (d.getFullYear() !== year) continue;
      const k = dayKeyOf(d);
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
    await queryClient.invalidateQueries({
      predicate: (q) => q.queryKey[0] === "/api/shifts",
    });
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
    setAnchor(null);
  }

  function handleDayClick(dayKey: string, hasAbsences: boolean) {
    if (hasAbsences) {
      setAnchor(null);
      setDayDetail(dayKey);
      return;
    }
    if (!anchor) {
      setAnchor(dayKey);
      return;
    }
    openCreate(anchor, dayKey);
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
    // Tage mit bereits vorhandener Abwesenheit desselben Typs überspringen
    // (gleiche Dedup-Regel wie das klassische Formular).
    const existing = new Set(
      ((allShifts ?? []) as AbsenceShiftLite[])
        .filter((s) => s.userId === uid && s.type === createType)
        .map((s) => dayKeyOf(new Date(s.startTime))),
    );
    const toCreate = days.filter((d) => !existing.has(dayKeyOf(d)));
    if (toCreate.length === 0) {
      setCreateError("Für den gewählten Zeitraum bestehen bereits Abwesenheiten dieses Typs.");
      return;
    }
    setSaving(true);
    // Bereits erfolgreich angelegte Tage merken, damit ein erneuter Versuch
    // nach einem Teilfehler nicht am serverseitigen Duplikatschutz klemmt.
    const createdKeys = new Set<string>();
    try {
      // Sequentiell anlegen (Read-Modify-Write des Urlaubskontos serverseitig).
      for (const day of toCreate) {
        const key = dayKeyOf(day);
        await createShift.mutateAsync({
          data: {
            userId: uid,
            startTime: new Date(`${key}T00:00:00`).toISOString(),
            endTime: new Date(`${key}T23:59:59`).toISOString(),
            type: createType as ShiftInputType,
            shiftModelId: null,
          },
        });
        createdKeys.add(key);
      }
      await invalidate();
      for (const day of toCreate) void warnIfMonthClosed(day, null);
      toast({
        title: `${ABSENCE_TYPE_LABELS[createType] ?? "Abwesenheit"} eingetragen`,
        description: `${toCreate.length} ${toCreate.length === 1 ? "Tag" : "Tage"} angelegt`,
      });
      setCreateDraft(null);
    } catch (err) {
      // Teilfehler: Serverdaten sofort nachladen — die bereits angelegten Tage
      // landen dadurch in `existing` und werden beim erneuten Speichern
      // automatisch übersprungen.
      if (createdKeys.size > 0) await invalidate();
      // Hinweis auf Teil-Anlage voranstellen, damit klar ist, dass bereits
      // angelegte Tage beim erneuten Versuch übersprungen werden.
      const partialPrefix =
        createdKeys.size > 0
          ? `${createdKeys.size} ${createdKeys.size === 1 ? "Tag wurde" : "Tage wurden"} bereits angelegt (werden beim erneuten Versuch übersprungen). `
          : "";
      const planMsg = planUpgradeMessage(err);
      if (err instanceof ApiError && err.status === 401) {
        setCreateError("Sitzung abgelaufen. Bitte Seite neu laden und erneut anmelden.");
      } else if (planMsg) {
        setCreateError(partialPrefix + planMsg);
      } else if (err instanceof ApiError && err.status === 403) {
        setCreateError(partialPrefix + "Keine Berechtigung zum Eintragen von Abwesenheiten.");
      } else if (err instanceof ApiError && err.status === 400) {
        setCreateError(partialPrefix + readableApiError(err, "Eintragen fehlgeschlagen. Bitte erneut versuchen."));
      } else {
        setCreateError(partialPrefix + "Eintragen fehlgeschlagen. Bitte erneut versuchen.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    setDeletingId(id);
    try {
      await deleteShift.mutateAsync({ id });
      await invalidate();
      toast({ title: "Abwesenheit entfernt" });
      // Wenn für den Tag nichts mehr übrig ist, Detailansicht schließen.
      if (dayDetail && visibleAbsences(dayDetail).length <= 1) setDayDetail(null);
    } catch {
      if (!navigator.onLine) return; // Banner erklärt den Grund bereits.
      toast({ title: "Entfernen fehlgeschlagen", variant: "destructive" });
    } finally {
      setDeletingId(null);
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
    return (
      <div
        key={monthKey}
        className="rounded-lg border border-border/40 bg-card p-1.5"
        data-testid={`abwkal-month-${monthKey}`}
      >
        <p className="mb-1 text-center text-[11px] font-semibold">
          {format(monthStart, "MMMM", { locale: de })}
        </p>
        <div className="grid grid-cols-7 gap-px">
          {WEEKDAYS.map((w) => (
            <span
              key={w}
              className="text-center text-[8px] font-medium uppercase text-muted-foreground/70"
            >
              {w}
            </span>
          ))}
          {Array.from({ length: offset }).map((_, i) => (
            <span key={`blank-${i}`} className="aspect-square" />
          ))}
          {days.map((day) => {
            const k = dayKeyOf(day);
            const cat = dominantCategory(k);
            const isAnchor = anchor === k;
            const hasAbsences = visibleAbsences(k).length > 0;
            return (
              <button
                key={k}
                type="button"
                data-testid={`abwkal-day-${k}`}
                data-category={cat ?? undefined}
                onClick={() => handleDayClick(k, hasAbsences)}
                title={
                  hasAbsences
                    ? visibleAbsences(k)
                        .map((s) => `${userName(s.userId)}: ${ABSENCE_TYPE_LABELS[s.type] ?? s.type}`)
                        .join(", ")
                    : undefined
                }
                className={[
                  "aspect-square rounded-[3px] text-[10px] leading-none tabular-nums transition-colors",
                  cat ? `${CATEGORY_STYLE[cat].cell} font-semibold` : "hover:bg-accent/40 text-foreground/70",
                  isAnchor ? "ring-2 ring-inset ring-primary" : "",
                ].filter(Boolean).join(" ")}
              >
                {format(day, "d")}
              </button>
            );
          })}
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

      {anchor && (
        <p className="text-xs text-muted-foreground" data-testid="abwkal-anchor-hint">
          Starttag {format(new Date(`${anchor}T00:00:00`), "d. MMMM", { locale: de })} gewählt —
          Endtag antippen (oder denselben Tag für einen einzelnen Tag).
        </p>
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
              return (
                <div
                  key={s.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border/40 px-3 py-2"
                  data-testid={`abwkal-day-entry-${s.id}`}
                >
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
                      className="h-8 w-8 p-0 text-destructive"
                      onClick={() => handleDelete(s.id)}
                      disabled={deletingId === s.id}
                      aria-label="Abwesenheit löschen"
                      data-testid={`abwkal-delete-${s.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
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
