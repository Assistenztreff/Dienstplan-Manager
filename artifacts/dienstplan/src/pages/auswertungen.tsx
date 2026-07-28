import { isAdminRole } from "@/lib/roles";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  useGetHoursBalance,
  useListUsers,
  useGetMonthClosingDiff,
  getHoursBalance,
  getMonthClosingDiff,
  ApiError,
} from "@workspace/api-client-react";
import type { MonthClosingDiff } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Download, Lock, Table2, LayoutGrid } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  buildPersonColorAssignment,
  userInitialsClass,
  nameInitials,
} from "@/lib/shift-model-colors";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { TeamSwitcher } from "@/components/team-switcher";
import { useTeam } from "@/context/team";
import { useAuth } from "@/context/auth";
import { hasAccess } from "@/lib/entitlements";
import { PlanUpgradeLink } from "@/components/plan-limit-banner";
import { useSelectedAssistant, type Assistant } from "@/components/assistant-filter";
import { exportStatementSectionsPdf, type StatementRecalculation } from "@/lib/pdf-export";
import {
  computeRecalculationMonthTotals,
  mapDiffRowsToRecalculationRows,
} from "@/lib/recalculation-mapping";
import { PLAN_FEATURE_MESSAGES } from "@/lib/api-error";
import { formatDays } from "@/lib/utils";
import { MonthClosingCard, RecalculationSection, PayrollTotalsCard } from "@/components/month-closing";
import { GesamtAuswertungMatrix } from "@/components/gesamt-auswertung-matrix";

function monthIndex(date: Date): number {
  return date.getFullYear() * 12 + date.getMonth();
}

function formatEur(n: number): string {
  return n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

// --- Kompakter Sticky-Header im Dienstplan-Stil ------------------------------
// Gleiche Optik/Mechanik wie der Dienstplan-Header (Tier-Measurement:
// labels → icons → stack), bewusst lokal dupliziert, damit der
// Dienstplan-Header unverändert bleibt (Out-of-Scope der Angleichung).

function usePersistentState<T extends string>(
  key: string,
  fallback: T,
  allowed: readonly T[],
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored != null && (allowed as readonly string[]).includes(stored)) return stored as T;
    } catch {
      // localStorage nicht verfügbar — Fallback nutzen
    }
    return fallback;
  });
  const set = (v: T) => {
    setValue(v);
    try {
      localStorage.setItem(key, v);
    } catch {
      // Schreiben fehlgeschlagen — Auswahl gilt nur für diese Sitzung
    }
  };
  return [value, set];
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

type HeaderTier = "labels" | "icons" | "stack";

const MOBILE_STACK_QUERY = "(max-width: 639px)";

function useIsMobileViewport() {
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.matchMedia(MOBILE_STACK_QUERY).matches : false,
  );
  useLayoutEffect(() => {
    const mql = window.matchMedia(MOBILE_STACK_QUERY);
    const onChange = () => setIsMobile(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return isMobile;
}

function useHeaderTier(contentKey: string, remeasureKey = "") {
  const measureRef = useRef<HTMLDivElement | null>(null);
  const isMobile = useIsMobileViewport();
  const [tier, setTier] = useState<HeaderTier>("labels");
  const tierRef = useRef<HeaderTier>(tier);
  tierRef.current = tier;
  const failedAt = useRef<{ labels: number; icons: number }>({ labels: 0, icons: 0 });

  useLayoutEffect(() => {
    failedAt.current = { labels: 0, icons: 0 };
    setTier("labels");
  }, [contentKey]);

  useLayoutEffect(() => {
    if (isMobile) return;
    const el = measureRef.current;
    if (!el) return;
    const check = () => {
      const t = tierRef.current;
      const width = el.clientWidth;
      if (width === 0) return;
      if (t !== "stack" && el.scrollWidth > width + 1) {
        failedAt.current[t] = Math.max(failedAt.current[t], width);
        setTier(t === "labels" ? "icons" : "stack");
        return;
      }
      if (t === "stack" && width > failedAt.current.icons + 48) {
        setTier("icons");
      } else if (t === "icons" && failedAt.current.labels > 0 && width > failedAt.current.labels + 48) {
        setTier("labels");
      }
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tier, contentKey, remeasureKey, isMobile]);

  return { measureRef, tier: isMobile ? ("stack" as const) : tier };
}

type AuswertungView = "matrix" | "cards";

function AuswertungenHeader({
  isAdmin,
  assistants,
  selectedAssistant,
  onSelectAssistant,
  view,
  onView,
  exportDisabled,
  exportTitle,
  onExport,
  monthLabel,
  onPrevMonth,
  onNextMonth,
}: {
  isAdmin: boolean;
  assistants: Assistant[];
  selectedAssistant: number | "all";
  onSelectAssistant: (v: number | "all") => void;
  view: AuswertungView;
  onView: (v: AuswertungView) => void;
  exportDisabled: boolean;
  exportTitle?: string;
  onExport: () => void;
  monthLabel: string;
  onPrevMonth: () => void;
  onNextMonth: () => void;
}) {
  const { selectedTeamId } = useTeam();
  const personColors = useMemo(
    () => buildPersonColorAssignment(assistants.map((a) => a.id)),
    [assistants],
  );
  const contentKey = [
    isAdmin,
    assistants.length,
    String(selectedAssistant),
    selectedTeamId ?? "none",
    monthLabel,
  ].join("|");
  const { measureRef, tier } = useHeaderTier(contentKey, [view, exportDisabled].join("|"));
  const showLabels = tier === "labels";
  const stacked = tier === "stack";

  const title = (
    <h2
      className={`text-lg md:text-xl font-serif font-bold text-foreground ${stacked ? "min-w-0 shrink truncate" : "shrink-0"}`}
    >
      Auswertungen
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

  const viewToggle = isAdmin && (
    <ViewToggle
      value={view}
      onChange={(v) => onView(v as AuswertungView)}
      showLabels={showLabels}
      options={[
        { value: "matrix", label: "Übersicht", icon: Table2 },
        { value: "cards", label: "Karten", icon: LayoutGrid },
      ]}
    />
  );

  const exportButton = (
    <Button
      variant="outline"
      size="sm"
      className={showLabels ? "gap-1.5" : `h-9 shrink-0 px-0 ${stacked ? "w-8" : "w-9"}`}
      onClick={onExport}
      disabled={exportDisabled}
      title={exportTitle ?? "Stundennachweis als PDF exportieren"}
      aria-label="PDF Export"
      data-testid="export-pdf-button"
    >
      <Download className="h-4 w-4" />
      {showLabels && <span>PDF Export</span>}
    </Button>
  );

  const monthSwitcher = (
    <div className={`flex items-center gap-0.5 ${stacked ? "min-w-0" : "shrink-0"}`}>
      <Button
        variant="ghost"
        size="icon"
        className={stacked ? "h-8 w-6 shrink-0" : "h-8 w-8"}
        onClick={onPrevMonth}
        aria-label="Vorheriger Monat"
        data-testid="month-prev"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span
        className={
          stacked
            ? "min-w-0 truncate whitespace-nowrap text-center text-lg font-normal tracking-tight text-foreground"
            : "whitespace-nowrap text-center text-sm font-medium md:text-base"
        }
        data-testid="month-label"
      >
        {monthLabel}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className={stacked ? "h-8 w-6 shrink-0" : "h-8 w-8"}
        onClick={onNextMonth}
        aria-label="Nächster Monat"
        data-testid="month-next"
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
            {viewToggle}
            {exportButton}
            <div className="ml-auto flex min-w-0 items-center">{monthSwitcher}</div>
          </div>
        </div>
      ) : (
        <div ref={measureRef} className="flex w-full flex-nowrap items-center gap-2">
          {title}
          <TeamSwitcher />
          {assistantFilter}
          <div className="ml-auto flex flex-nowrap items-center gap-1.5">
            {viewToggle}
            {exportButton}
            {monthSwitcher}
          </div>
        </div>
      )}
    </div>
  );
}

type ExportRangeDialogProps = {
  open: boolean;
  onClose: () => void;
  teamId?: number | null;
  assistantFilter: number | "all";
  assistantName?: string;
};

function ExportRangeDialog({
  open,
  onClose,
  teamId,
  assistantFilter,
  assistantName,
}: ExportRangeDialogProps) {
  const [fromDate, setFromDate] = useState(new Date());
  const [toDate, setToDate] = useState(new Date());
  const [isExporting, setIsExporting] = useState(false);

  const fromIndex = monthIndex(fromDate);
  const toIndex = monthIndex(toDate);
  const rangeInvalid = toIndex < fromIndex;
  const monthCount = rangeInvalid ? 0 : toIndex - fromIndex + 1;

  const fromLabel = format(fromDate, "MMMM yyyy", { locale: de });
  const toLabel = format(toDate, "MMMM yyyy", { locale: de });

  const stepFrom = (delta: number) =>
    setFromDate((d) => new Date(d.getFullYear(), d.getMonth() + delta, 1));
  const stepTo = (delta: number) =>
    setToDate((d) => new Date(d.getFullYear(), d.getMonth() + delta, 1));

  async function handleExport() {
    if (rangeInvalid) {
      toast.error("Der Bis-Monat darf nicht vor dem Von-Monat liegen.");
      return;
    }
    setIsExporting(true);
    try {
      // Pro Monat alle (bzw. die gefilterten) Assistenten-Balances laden.
      const months: Array<{
        month: number;
        year: number;
        monthLabel: string;
        balances: any[];
      }> = [];

      for (let i = 0; i < monthCount; i++) {
        const cursor = new Date(fromDate.getFullYear(), fromDate.getMonth() + i, 1);
        const month = cursor.getMonth() + 1;
        const year = cursor.getFullYear();
        const monthLabel = format(cursor, "MMMM yyyy", { locale: de });

        const raw = (await getHoursBalance({
          month,
          year,
          ...(teamId != null ? { teamId } : {}),
        })) as any[];
        const balances =
          assistantFilter !== "all"
            ? raw.filter((b) => b.userId === assistantFilter)
            : raw;

        months.push({ month, year, monthLabel, balances });
      }

      // Reihenfolge: pro Assistent gruppiert, darin chronologisch nach Monat.
      const assistantOrder: Array<{ userId: number; userName: string }> = [];
      const seen = new Set<number>();
      for (const m of months) {
        for (const b of m.balances) {
          if (!seen.has(b.userId)) {
            seen.add(b.userId);
            assistantOrder.push({ userId: b.userId, userName: b.userName });
          }
        }
      }
      assistantOrder.sort((a, b) =>
        a.userName.localeCompare(b.userName, "de", { sensitivity: "base" }),
      );

      const sections: Array<{ balance: any; month: number; year: number; monthLabel: string }> = [];
      for (const assistant of assistantOrder) {
        for (const m of months) {
          const balance = m.balances.find((b) => b.userId === assistant.userId);
          if (balance) {
            sections.push({ balance, month: m.month, year: m.year, monthLabel: m.monthLabel });
          }
        }
      }

      if (sections.length === 0) {
        toast.error("Keine Auswertungsdaten fuer den gewaehlten Zeitraum gefunden.");
        return;
      }

      // Nachberechnung: je exportiertem Monat die Differenzen des jeweiligen
      // Vormonats laden (sofern dieser abgeschlossen wurde) und als eigene,
      // klar beschriftete Position in den PDF-Nachweis aufnehmen.
      const recalculations: StatementRecalculation[] = [];
      let recalcFetchFailed = false;
      for (const m of months) {
        const prev = new Date(m.year, m.month - 2, 1);
        try {
          const diff = await getMonthClosingDiff({
            month: prev.getMonth() + 1,
            year: prev.getFullYear(),
            ...(teamId != null ? { teamId } : {}),
          });
          if (!diff.closed || diff.rows.length === 0) continue;
          const rows = mapDiffRowsToRecalculationRows(diff.rows, assistantFilter);
          if (rows.length === 0) continue;
          recalculations.push({
            monthLabel: m.monthLabel,
            prevLabel: format(prev, "MMMM yyyy", { locale: de }),
            closedAt: diff.closedAt,
            rows,
            monthTotals: computeRecalculationMonthTotals(m.balances),
          });
        } catch (err) {
          // Kein Abschluss/kein Zugriff (403/404) → PDF ohne Nachberechnungs-
          // Seite. Echte Fehler (Netz/Server) NICHT verschlucken: der Export
          // läuft weiter, aber der Nutzer bekommt eine sichtbare Warnung,
          // dass die Nachberechnung im PDF fehlen kann.
          if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
            continue;
          }
          recalcFetchFailed = true;
          console.error(err);
        }
      }
      if (recalcFetchFailed) {
        toast.warning(
          "Nachberechnung konnte nicht geladen werden — das PDF wird ohne Nachberechnungs-Seite erstellt.",
        );
      }

      const first = months[0];
      const last = months[months.length - 1];
      const rangePart =
        months.length === 1
          ? `${first.year}_${String(first.month).padStart(2, "0")}`
          : `${first.year}_${String(first.month).padStart(2, "0")}-${last.year}_${String(last.month).padStart(2, "0")}`;
      const namePart = assistantName
        ? assistantName.replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "")
        : "Alle";

      await exportStatementSectionsPdf({
        sections,
        teamId,
        filename: `Stundennachweis_${namePart}_${rangePart}.pdf`,
        recalculations,
      });
      onClose();
    } catch (err) {
      toast.error("PDF-Export fehlgeschlagen.");
      console.error(err);
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">Stundennachweis exportieren</DialogTitle>
        </DialogHeader>

        <div className="py-2 space-y-4">
          <p className="text-sm text-muted-foreground">
            {assistantName ? (
              <>
                Einzelnachweis fuer{" "}
                <span className="font-medium text-foreground">{assistantName}</span> als PDF.
              </>
            ) : (
              <>Gesamt-Nachweis aller Assistenten als PDF.</>
            )}{" "}
            Waehle den gewuenschten Zeitraum – pro Assistent und Monat entsteht eine Seite.
          </p>
          {/* Gleicher Transparenz-Hinweis wie auf der Auswertungen-Seite: der
              PDF-Nachweis basiert auf hours-balance und enthält nur FIX-Dienste. */}
          <p className="text-xs text-muted-foreground" data-testid="export-fix-only-hint">
            Der Stundennachweis enthält nur bestätigte Dienste. Entwürfe und Vorschläge werden
            nicht mitgezählt.
          </p>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Von-Monat</Label>
              <div className="flex items-center justify-between gap-2">
                <Button variant="outline" size="icon" onClick={() => stepFrom(-1)} disabled={isExporting}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="font-medium text-sm flex-1 text-center" data-testid="export-from-label">
                  {fromLabel}
                </span>
                <Button variant="outline" size="icon" onClick={() => stepFrom(1)} disabled={isExporting}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Bis-Monat</Label>
              <div className="flex items-center justify-between gap-2">
                <Button variant="outline" size="icon" onClick={() => stepTo(-1)} disabled={isExporting}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="font-medium text-sm flex-1 text-center" data-testid="export-to-label">
                  {toLabel}
                </span>
                <Button variant="outline" size="icon" onClick={() => stepTo(1)} disabled={isExporting}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          {rangeInvalid ? (
            <p className="text-xs text-destructive">
              Der Bis-Monat darf nicht vor dem Von-Monat liegen.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {monthCount === 1 ? "1 Monat" : `${monthCount} Monate`} werden exportiert.
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={isExporting}>
            Abbrechen
          </Button>
          <Button onClick={handleExport} disabled={isExporting || rangeInvalid} className="gap-2">
            <Download className="h-4 w-4" />
            {isExporting ? "Exportiere..." : "Als PDF exportieren"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Auswertungen() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [exportOpen, setExportOpen] = useState(false);

  const { currentUser } = useAuth();
  const isAdmin = isAdminRole(currentUser?.role);
  const canPayrollExport = hasAccess(currentUser, "payrollExport");

  // Soll/Ist-Auswertung ist das Premium-Feature "advancedAnalytics" (Server
  // antwortet fuer Free-Konten mit 403 plan_feature_required). Statt eine
  // Anfrage zu feuern, die scheitert, zeigen wir Free-Konten direkt einen
  // Upgrade-Hinweis (Frontend-Gate ist reine UX, Durchsetzung bleibt serverseitig).
  const analyticsLocked = !hasAccess(currentUser, "advancedAnalytics");

  const month = currentDate.getMonth() + 1;
  const year = currentDate.getFullYear();

  const { selectedTeamId } = useTeam();
  const teamParam = selectedTeamId != null ? { teamId: selectedTeamId } : {};
  const { data: balances, isLoading } = useGetHoursBalance(
    {
      month,
      year,
      ...teamParam,
    },
    { query: { enabled: !analyticsLocked } } as any,
  ) as any;

  const { data: users, isLoading: usersLoading } = useListUsers(
    selectedTeamId != null ? { teamId: selectedTeamId } : undefined
  );

  const assistants: Assistant[] = isAdmin
    ? (users ?? []).filter((u) => u.role === "assistant").map((u) => ({ id: u.id, name: u.name }))
    : [];
  const [selectedAssistant, setSelectedAssistant] = useSelectedAssistant(
    assistants,
    !(isAdmin && usersLoading),
  );

  // Ansichts-Umschalter (nur Admin): Gesamtübersichts-Matrix vs. Einzelkarten.
  // Die Kartenansicht funktioniert auch bei Auswahl „Alle" (alle als Karten).
  const [view, setView] = usePersistentState<AuswertungView>(
    "auswertungen.view",
    "matrix",
    ["matrix", "cards"],
  );

  // Nachberechnung des Vormonats (Soft-Close-Diff) — je Assistent im grünen
  // Lohnauswertungs-Kasten unter den Zuschlägen ausgewiesen und zum
  // Gesamtlohn addiert. Endpunkt ist admin- & advancedAnalytics-gegated.
  const prevOfShown = new Date(year, month - 2, 1);
  const prevOfShownLabel = format(prevOfShown, "MMMM yyyy", { locale: de });
  const { data: prevDiff } = useGetMonthClosingDiff(
    {
      month: prevOfShown.getMonth() + 1,
      year: prevOfShown.getFullYear(),
      ...teamParam,
    },
    { query: { enabled: isAdmin && !analyticsLocked } } as any,
  ) as { data: MonthClosingDiff | undefined };
  const recalcByUser = new Map<number, { diffPay: number; diffBasePay: number; diffSurchargePay: number }>();
  // Abwesenheits-Anteil der Nachberechnung (Urlaubs-/Krankheitsstunden des
  // Vormonats) — eigenes Kästchen unter den Krankheitsstunden, unabhängig
  // davon, ob sich der Geldwert geändert hat.
  const recalcAbsenceByUser = new Map<number, { vacationHours: number; sickHours: number }>();
  if (prevDiff?.closed) {
    for (const r of prevDiff.rows) {
      if (r.diffPay != null && r.diffPay !== 0) {
        recalcByUser.set(r.userId, {
          diffPay: r.diffPay,
          diffBasePay: r.diffBasePay ?? 0,
          diffSurchargePay: r.diffSurchargePay ?? 0,
        });
      }
      const vacationHours = r.vacationHours ?? 0;
      const sickHours = r.sickHours ?? 0;
      if (vacationHours > 0 || sickHours > 0) {
        recalcAbsenceByUser.set(r.userId, { vacationHours, sickHours });
      }
    }
  }

  // Gemerkter Assistenten-Filter (nur Admin): zeigt nur die gewählte Person.
  const visibleBalances =
    isAdmin && selectedAssistant !== "all" && Array.isArray(balances)
      ? balances.filter((b: any) => b.userId === selectedAssistant)
      : balances;

  const prevMonth = () => setCurrentDate(new Date(year, month - 2, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month, 1));

  const monthLabel = format(currentDate, "MMMM yyyy", { locale: de });

  return (
    <div className="flex flex-col gap-6 animate-in fade-in duration-300">
      {/* Kompakter Sticky-Header im Dienstplan-Stil: alles in EINER Zeile.
          Premium-Gate payrollExport bleibt reine UX (autoritativ setzt der
          Server via hours-balance durch — die einzige Datenquelle des PDFs). */}
      <AuswertungenHeader
        isAdmin={isAdmin}
        assistants={assistants}
        selectedAssistant={selectedAssistant}
        onSelectAssistant={setSelectedAssistant}
        view={view}
        onView={setView}
        exportDisabled={!canPayrollExport || isLoading || !visibleBalances || visibleBalances.length === 0}
        exportTitle={canPayrollExport ? undefined : PLAN_FEATURE_MESSAGES.payrollExport}
        onExport={() => setExportOpen(true)}
        monthLabel={monthLabel}
        onPrevMonth={prevMonth}
        onNextMonth={nextMonth}
      />

      {/* Transparenz: Entwürfe/Vorschläge bleiben im Dienstplan sichtbar,
          zählen aber bewusst nicht in Auswertungen und Stundennachweis. */}
      <p className="text-xs text-muted-foreground" data-testid="fix-only-hint">
        Es zählen nur bestätigte Dienste — Entwürfe und Vorschläge fließen nicht ein.
      </p>

      <ExportRangeDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        teamId={selectedTeamId}
        assistantFilter={isAdmin ? selectedAssistant : "all"}
        assistantName={
          isAdmin && selectedAssistant !== "all"
            ? assistants.find((a) => a.id === selectedAssistant)?.name
            : undefined
        }
      />

      {/* Monatsabschluss (Soft-Close) + Nachberechnung des Vormonats — nur
          Admin & Premium (die Endpunkte sind advancedAnalytics-gegated). */}
      {isAdmin && !analyticsLocked && (
        <div className="space-y-6">
          <MonthClosingCard month={month} year={year} teamId={selectedTeamId} />
          <RecalculationSection month={month} year={year} teamId={selectedTeamId} />
          {/* Gesamtsummen inkl. Nachberechnungs-Position des Vormonats. */}
          {!isLoading && Array.isArray(visibleBalances) && (
            <PayrollTotalsCard
              month={month}
              year={year}
              teamId={selectedTeamId}
              balances={visibleBalances}
              assistantFilter={selectedAssistant}
            />
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6">
        {analyticsLocked ? (
          <div
            className="p-12 text-center border rounded-xl bg-card space-y-3"
            data-testid="analytics-premium-upsell"
          >
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Lock className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold text-foreground">
              Soll/Ist-Auswertung ist in Premium enthalten
            </h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Der Soll/Ist-Abgleich mit Zuschlägen, Urlaubskonto und PDF-Stundennachweis
              ist Teil des Premium-Tarifs. Für den Zugriff auf die Auswertungen auf
              Premium upgraden.
            </p>
            <PlanUpgradeLink />
          </div>
        ) : isLoading ? (
          <>
            <Skeleton className="h-48 w-full rounded-xl" />
            <Skeleton className="h-48 w-full rounded-xl" />
          </>
        ) : visibleBalances && Array.isArray(visibleBalances) && visibleBalances.length > 0 ? (
          isAdmin && view === "matrix" ? (
            // Ansicht „Übersicht" (nur Admin): kompakte Vergleichs-Matrix statt
            // der Einzelkarten-Liste — gleiche Datenquelle (hours-balance),
            // gefiltert nach der Dropdown-Auswahl; inkl. der vorbereiteten
            // zukünftigen Abrechnungskategorien mit 0-Defaults.
            <GesamtAuswertungMatrix
              balances={visibleBalances}
              recalcByUser={recalcByUser}
              prevMonthLabel={prevOfShownLabel}
            />
          ) : (
          visibleBalances.map((balance: any) => {
            const percentage =
              balance.plannedHours > 0
                ? Math.min(100, Math.max(0, (balance.valuedHours / balance.plannedHours) * 100))
                : 0;
            const isOvertime = balance.valuedHours > balance.plannedHours;

            return (
              <Card
                key={balance.userId}
                className="border-border/50 shadow-sm"
                data-testid={`balance-card-${balance.userId}`}
              >
                <CardContent className="p-5 md:p-6">
                  <h3 className="text-lg font-semibold mb-4">{balance.userName}</h3>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Stunden-Seite */}
                    <div className="space-y-4">
                      {/* Geleistete (gewertete) Arbeitsstunden */}
                      <div>
                        <div className="flex items-center justify-between text-sm mb-1.5">
                          <span className="text-muted-foreground">Geleistete Stunden (gewertet)</span>
                          <span className="font-medium">
                            {balance.valuedHours} / {balance.plannedHours} h
                          </span>
                        </div>
                        <Progress value={percentage} className="h-2" />
                        <div className="flex justify-between text-xs text-muted-foreground mt-1">
                          <span>
                            Differenz:{" "}
                            <span
                              className={
                                isOvertime
                                  ? "text-green-700 font-medium"
                                  : balance.valuedHours < balance.plannedHours
                                  ? "text-amber-700 font-medium"
                                  : "text-green-700 font-medium"
                              }
                            >
                              {balance.balance > 0 ? "+" : ""}
                              {balance.balance} h
                            </span>
                          </span>
                          <span>{percentage.toFixed(0)}% geleistet</span>
                        </div>
                      </div>

                      {/* Erfüllt gesamt inkl. Urlaub/Krank */}
                      <div className="flex items-center justify-between text-sm py-2.5 px-3 bg-primary/5 rounded-lg border border-primary/20">
                        <span className="text-muted-foreground">Erfüllt gesamt (inkl. Urlaub/Krank)</span>
                        <span className="font-semibold text-assistenz-brand">{balance.totalFulfilledHours} h</span>
                      </div>

                      {/* Krankheitsstunden */}
                      <div className="flex items-center justify-between text-sm py-2.5 px-3 bg-slate-50 rounded-lg border border-slate-200">
                        <span className="text-slate-600">Krankheitsstunden (Lohnfortzahlung)</span>
                        <span className="font-semibold text-slate-700">{balance.sickHours} h</span>
                      </div>

                      {/* Nachberechnung: Abwesenheits-Stunden des Vormonats —
                          nur wenn die Nachberechnung einen Urlaubs-/
                          Krankheitsanteil trägt. */}
                      {(() => {
                        const absence = recalcAbsenceByUser.get(balance.userId);
                        if (!absence) return null;
                        const hoursDe = (n: number) =>
                          n.toLocaleString("de-DE", { maximumFractionDigits: 2 });
                        return (
                          <div
                            className="rounded-lg border border-amber-300/70 bg-amber-50/50 px-3 py-2.5 space-y-1.5"
                            data-testid={`recalc-absence-box-${balance.userId}`}
                          >
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-muted-foreground">
                                Nachberechnung Krankheitsstunden Vormonat
                              </span>
                              <span className="font-semibold">{hoursDe(absence.sickHours)} h</span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-muted-foreground">
                                Nachberechnung Urlaubsstunden Vormonat
                              </span>
                              <span className="font-semibold">{hoursDe(absence.vacationHours)} h</span>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Bewertete Stunden & Zuschläge */}
                      <div className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-2">
                        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Bewertete Stunden & Zuschläge
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Bewertete Stunden</span>
                          <span className="font-semibold">{balance.valuedHours} h</span>
                        </div>
                        {/* 0%-Zuschläge werden NICHT aufgelistet (Point 6). */}
                        {balance.nightPercent > 0 && (
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">
                              Nacht ({balance.nightPercent}%)
                            </span>
                            <span className="font-medium">
                              {balance.nightHours} h
                              <span className="text-emerald-700"> (+{balance.nightSurchargeHours} h)</span>
                            </span>
                          </div>
                        )}
                        {balance.sundayPercent > 0 && (
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">
                              Sonntag ({balance.sundayPercent}%)
                            </span>
                            <span className="font-medium">
                              {balance.sundayHours} h
                              <span className="text-emerald-700"> (+{balance.sundaySurchargeHours} h)</span>
                            </span>
                          </div>
                        )}
                        {balance.holidayPercent > 0 && (
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">
                              Feiertag ({balance.holidayPercent}%)
                            </span>
                            <span className="font-medium">
                              {balance.holidayHours} h
                              <span className="text-emerald-700"> (+{balance.holidaySurchargeHours} h)</span>
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Lohnauswertung (Premium): nur wenn ein Stundenlohn
                          hinterlegt ist. Geld folgt der Abrechnungsart
                          (SOLL/IST) — gleiche Basis wie die Stunden-Spalten. */}
                      {balance.hourlyWage != null && (
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 space-y-2">
                          <div className="text-xs font-medium uppercase tracking-wide text-emerald-700">
                            Lohnauswertung ({balance.billingMethod === "IST" ? "Ist" : "Soll"})
                          </div>
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">Grundlohn</span>
                            <span className="font-medium">{formatEur(balance.basePay ?? 0)}</span>
                          </div>
                          {balance.nightPercent > 0 && (balance.nightSurchargePay ?? 0) !== 0 && (
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-muted-foreground">Nachtzuschlag</span>
                              <span className="font-medium">{formatEur(balance.nightSurchargePay ?? 0)}</span>
                            </div>
                          )}
                          {balance.sundayPercent > 0 && (balance.sundaySurchargePay ?? 0) !== 0 && (
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-muted-foreground">Sonntagszuschlag</span>
                              <span className="font-medium">{formatEur(balance.sundaySurchargePay ?? 0)}</span>
                            </div>
                          )}
                          {balance.holidayPercent > 0 && (balance.holidaySurchargePay ?? 0) !== 0 && (
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-muted-foreground">Feiertagszuschlag</span>
                              <span className="font-medium">{formatEur(balance.holidaySurchargePay ?? 0)}</span>
                            </div>
                          )}
                          {(() => {
                            const recalc = recalcByUser.get(balance.userId);
                            const signedEur = (n: number) => `${n > 0 ? "+" : ""}${formatEur(n)}`;
                            if (!recalc) {
                              return (
                                <div className="flex items-center justify-between text-sm pt-1.5 border-t border-emerald-200">
                                  <span className="font-medium text-emerald-800">Gesamtlohn (brutto)</span>
                                  <span className="font-semibold text-emerald-800">{formatEur(balance.totalPay ?? 0)}</span>
                                </div>
                              );
                            }
                            return (
                              <>
                                <div
                                  className="flex items-center justify-between text-sm pt-1.5 border-t border-emerald-200"
                                  data-testid={`payroll-recalc-${balance.userId}`}
                                >
                                  <span className="text-muted-foreground">
                                    Nachberechnung {prevOfShownLabel}
                                    <span className="block text-xs">
                                      Grundlohn {signedEur(recalc.diffBasePay)} · Zuschläge {signedEur(recalc.diffSurchargePay)}
                                    </span>
                                  </span>
                                  <span className={`font-medium whitespace-nowrap ${recalc.diffPay < 0 ? "text-red-700" : "text-emerald-800"}`}>
                                    {signedEur(recalc.diffPay)}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between text-sm pt-1.5 border-t border-emerald-200">
                                  <span className="font-medium text-emerald-800">Gesamtlohn (brutto) inkl. Nachberechnung</span>
                                  <span
                                    className="font-semibold text-emerald-800"
                                    data-testid={`payroll-total-with-recalc-${balance.userId}`}
                                  >
                                    {formatEur((balance.totalPay ?? 0) + recalc.diffPay)}
                                  </span>
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      )}
                    </div>

                    {/* Urlaubs-Seite */}
                    <div className="space-y-3">
                      <div className="p-4 bg-amber-100 rounded-lg border border-amber-400">
                        <div className="text-xs text-amber-950 mb-1 font-medium uppercase tracking-wide">
                          Urlaubstage
                        </div>
                        <div className="flex items-end gap-2">
                          <span className="text-3xl font-bold text-amber-950">
                            {formatDays(balance.vacationDaysTaken)}
                          </span>
                          <span className="text-sm text-amber-950 mb-0.5">
                            genommen (Monat)
                          </span>
                        </div>
                        <div className="mt-2 text-sm text-amber-950">
                          <span className="font-medium">{formatDays(balance.vacationDaysRemaining)}</span> von{" "}
                          {formatDays(balance.vacationDaysRemaining + balance.vacationDaysUsed)} verbleibend (Jahr)
                        </div>
                        {balance.vacationDaysRemaining + balance.vacationDaysUsed > 0 && (
                          <Progress
                            value={Math.round(
                              (balance.vacationDaysUsed /
                                (balance.vacationDaysRemaining + balance.vacationDaysUsed)) *
                                100
                            )}
                            className="h-1.5 mt-2 bg-amber-200 [&>div]:bg-amber-600"
                          />
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
          )
        ) : (
          <div className="p-12 text-center border rounded-xl bg-card">
            <p className="text-muted-foreground">Keine Auswertungsdaten fuer diesen Zeitraum gefunden.</p>
          </div>
        )}
      </div>
    </div>
  );
}
