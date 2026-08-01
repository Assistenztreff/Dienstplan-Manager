import { isAdminRole } from "@/lib/roles";
import { useMemo, useRef, useState } from "react";
import {
  useGetHoursBalance,
  useListUsers,
  useGetMonthClosingDiff,
} from "@workspace/api-client-react";
import type { MonthClosingDiff } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Download, Lock, Table2, LayoutGrid, Archive } from "lucide-react";
import { MonthYearPicker } from "@/components/month-year-picker";
import { PageStickyHeader } from "@/components/page-sticky-header";
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
import { TeamSwitcher } from "@/components/team-switcher";
import { useTeam } from "@/context/team";
import { useAuth } from "@/context/auth";
import { hasAccess } from "@/lib/entitlements";
import { PlanUpgradeLink } from "@/components/plan-limit-banner";
import { useSelectedAssistant, type Assistant } from "@/components/assistant-filter";
import { PLAN_FEATURE_MESSAGES } from "@/lib/api-error";
import { type HeaderTier, useIsMobileViewport, useHeaderTier } from "@/lib/header-tier";
import { formatDays } from "@/lib/utils";
import { MonthClosingCard, RecalculationSection, PayrollTotalsCard } from "@/components/month-closing";
import { GesamtAuswertungMatrix } from "@/components/gesamt-auswertung-matrix";
import { StatementExportDialog } from "@/components/statement-export-dialog";
import { downloadLohnnachweiseAsZip } from "@/lib/pdf-zip-export";

function formatEur(n: number): string {
  return n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

// --- Lokale Hilfsfunktionen --------------------------------------------------

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
  zipExportDisabled,
  zipExportTitle,
  onZipExport,
  zipProgress,
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
  view: AuswertungView;
  onView: (v: AuswertungView) => void;
  exportDisabled: boolean;
  exportTitle?: string;
  onExport: () => void;
  zipExportDisabled: boolean;
  zipExportTitle?: string;
  onZipExport: () => void;
  zipProgress: { done: number; total: number } | null;
  month: number;
  year: number;
  onMonthSelect: (month: number, year: number) => void;
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
    `${month}/${year}`,
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

  const zipLabel = zipProgress
    ? `${zipProgress.done} von ${zipProgress.total} PDFs…`
    : showLabels
    ? "ZIP Export"
    : undefined;

  const zipButton = (
    <Button
      variant="outline"
      size="sm"
      className={showLabels ? "gap-1.5" : `h-9 shrink-0 px-0 ${stacked ? "w-8" : "w-9"}`}
      onClick={onZipExport}
      disabled={zipExportDisabled}
      title={zipExportTitle ?? "Alle Lohnnachweise als ZIP herunterladen"}
      aria-label="ZIP Export"
      data-testid="export-zip-button"
    >
      <Archive className="h-4 w-4" />
      {zipLabel && <span className="whitespace-nowrap">{zipLabel}</span>}
    </Button>
  );

  return (
    <PageStickyHeader
      stacked={stacked}
      measureRef={measureRef}
      month={month}
      year={year}
      onMonthSelect={onMonthSelect}
      onPrevMonth={onPrevMonth}
      onNextMonth={onNextMonth}
      prevMonthTestId="month-prev"
      nextMonthTestId="month-next"
      title={title}
      assistantFilter={assistantFilter}
      actions={
        <>
          {viewToggle}
          {exportButton}
          {zipButton}
        </>
      }
    />
  );
}

export default function Auswertungen() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [exportOpen, setExportOpen] = useState(false);
  const [zipProgress, setZipProgress] = useState<{ done: number; total: number } | null>(null);
  const isZipExporting = zipProgress !== null;

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

  async function handleZipExport() {
    if (!Array.isArray(balances) || balances.length === 0) return;
    setZipProgress({ done: 0, total: balances.length });
    try {
      await downloadLohnnachweiseAsZip({
        balances,
        month,
        year,
        teamId: selectedTeamId,
        onProgress: (done, total) => setZipProgress({ done, total }),
      });
    } catch (err) {
      if (!navigator.onLine) return;
      const { toast } = await import("sonner");
      toast.error("ZIP-Export fehlgeschlagen.");
      console.error(err);
    } finally {
      setZipProgress(null);
    }
  }

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
        zipExportDisabled={
          !canPayrollExport ||
          // Teamleiter ohne canViewPayroll dürfen den Lohn-ZIP nicht exportieren
          // (ZIP-Export ist für Lohnbüro-Weitergabe; lohnfreie Variante genügt nicht).
          (currentUser?.isTeamleiter === true && !currentUser?.canViewPayroll) ||
          isLoading ||
          !Array.isArray(balances) ||
          balances.length === 0 ||
          isZipExporting
        }
        zipExportTitle={
          currentUser?.isTeamleiter && !currentUser?.canViewPayroll
            ? "Lohn-ZIP-Export erfordert die Lohndaten-Berechtigung im Team"
            : canPayrollExport
              ? undefined
              : PLAN_FEATURE_MESSAGES.payrollExport
        }
        onZipExport={handleZipExport}
        zipProgress={zipProgress}
        month={month}
        year={year}
        onMonthSelect={(m, y) => setCurrentDate(new Date(y, m - 1, 1))}
        onPrevMonth={prevMonth}
        onNextMonth={nextMonth}
      />

      {/* Transparenz: Entwürfe/Vorschläge bleiben im Dienstplan sichtbar,
          zählen aber bewusst nicht in Auswertungen und Stundennachweis. */}
      <p className="text-xs text-muted-foreground" data-testid="fix-only-hint">
        Es zählen nur bestätigte Dienste — Entwürfe und Vorschläge fließen nicht ein.
      </p>

      <StatementExportDialog
        showFixOnlyHint
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
              onSelectAssistant={setSelectedAssistant}
              month={month}
              year={year}
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
                        {/* SV-pflichtige Abwesenheits-Zuschläge (§ 11 BUrlG / § 2 EFZG):
                            Urlaub/Krank auf Sonntag/Feiertag/Nacht — nur wenn vorhanden. */}
                        {(() => {
                          const absTotal =
                            (balance.absenceNightSurchargeHours ?? 0) +
                            (balance.absenceSundaySurchargeHours ?? 0) +
                            (balance.absenceHolidaySurchargeHours ?? 0);
                          if (absTotal === 0) return null;
                          const absHours =
                            (balance.absenceNightHours ?? 0) +
                            (balance.absenceSundayHours ?? 0) +
                            (balance.absenceHolidayHours ?? 0);
                          return (
                            <div className="flex items-center justify-between text-sm pt-1 border-t border-border/40">
                              <span className="text-muted-foreground flex items-center gap-1">
                                <span className="text-xs bg-amber-100 text-amber-800 rounded px-1 font-medium">SV-pflichtig</span>
                                Urlaub/Krank
                              </span>
                              <span className="font-medium">
                                {absHours} h
                                <span className="text-amber-700"> (+{absTotal} h)</span>
                              </span>
                            </div>
                          );
                        })()}
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
                          {/* SV-pflichtiger Anteil der Zuschläge (Urlaub/Krank): nur wenn vorhanden. */}
                          {(() => {
                            const absPayTotal =
                              (balance.absenceNightSurchargePay ?? 0) +
                              (balance.absenceSundaySurchargePay ?? 0) +
                              (balance.absenceHolidaySurchargePay ?? 0);
                            if (absPayTotal === 0) return null;
                            return (
                              <div className="flex items-center justify-between text-sm">
                                <span className="text-muted-foreground flex items-center gap-1">
                                  <span className="text-xs bg-amber-100 text-amber-800 rounded px-1 font-medium">SV-pflichtig</span>
                                  Urlaub/Krank
                                </span>
                                <span className="font-medium">{formatEur(absPayTotal)}</span>
                              </div>
                            );
                          })()}
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
