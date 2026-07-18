import { isAdminRole } from "@/lib/roles";
import { useState } from "react";
import { useGetHoursBalance, useListUsers, getHoursBalance } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Download, Lock } from "lucide-react";
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
import { AssistantFilter, useSelectedAssistant, type Assistant } from "@/components/assistant-filter";
import { exportStatementSectionsPdf } from "@/lib/pdf-export";
import { PLAN_FEATURE_MESSAGES } from "@/lib/api-error";
import { formatDays } from "@/lib/utils";

function monthIndex(date: Date): number {
  return date.getFullYear() * 12 + date.getMonth();
}

function formatEur(n: number): string {
  return n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
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

  // Gemerkter Assistenten-Filter (nur Admin): zeigt nur die gewählte Person.
  const visibleBalances =
    isAdmin && selectedAssistant !== "all" && Array.isArray(balances)
      ? balances.filter((b: any) => b.userId === selectedAssistant)
      : balances;

  const prevMonth = () => setCurrentDate(new Date(year, month - 2, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month, 1));

  const monthLabel = format(currentDate, "MMMM yyyy", { locale: de });

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <div>
            <h2 className="text-2xl md:text-3xl font-serif font-bold text-foreground">Auswertungen</h2>
            <p className="text-muted-foreground mt-1 text-sm">Soll/Ist-Abgleich der Stunden</p>
            {/* Transparenz: Entwürfe/Vorschläge bleiben im Dienstplan sichtbar,
                zählen aber bewusst nicht in Auswertungen und Stundennachweis. */}
            <p className="text-xs text-muted-foreground mt-1" data-testid="fix-only-hint">
              Es zählen nur bestätigte Dienste — Entwürfe und Vorschläge fließen nicht ein.
            </p>
          </div>
          <TeamSwitcher />
        </div>

        <div className="flex items-center gap-2 md:gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={prevMonth} data-testid="month-prev">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span
              className="font-medium text-sm md:text-lg min-w-[120px] md:min-w-40 text-center"
              data-testid="month-label"
            >
              {monthLabel}
            </span>
            <Button variant="outline" size="icon" onClick={nextMonth} data-testid="month-next">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {/* Premium-Gate payrollExport (UX; autoritativ setzt der Server via
              hours-balance durch — die einzige Datenquelle des PDF-Nachweises). */}
          <Button
            variant="outline"
            onClick={() => setExportOpen(true)}
            disabled={!canPayrollExport || isLoading || !visibleBalances || visibleBalances.length === 0}
            title={canPayrollExport ? undefined : PLAN_FEATURE_MESSAGES.payrollExport}
            className="gap-2"
            data-testid="export-pdf-button"
          >
            <Download className="h-4 w-4" />
            Als PDF exportieren
          </Button>
        </div>
      </div>

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

      {isAdmin && assistants.length > 0 && (
        <AssistantFilter
          assistants={assistants}
          selected={selectedAssistant}
          onSelect={setSelectedAssistant}
        />
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
          </div>
        ) : isLoading ? (
          <>
            <Skeleton className="h-48 w-full rounded-xl" />
            <Skeleton className="h-48 w-full rounded-xl" />
          </>
        ) : visibleBalances && Array.isArray(visibleBalances) && visibleBalances.length > 0 ? (
          visibleBalances.map((balance: any) => {
            const percentage =
              balance.plannedHours > 0
                ? Math.min(100, Math.max(0, (balance.valuedHours / balance.plannedHours) * 100))
                : 0;
            const isOvertime = balance.valuedHours > balance.plannedHours;

            return (
              <Card key={balance.userId} className="border-border/50 shadow-sm">
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
                          hinterlegt ist. Geld ist stets IST-basiert. */}
                      {balance.hourlyWage != null && (
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 space-y-2">
                          <div className="text-xs font-medium uppercase tracking-wide text-emerald-700">
                            Lohnauswertung (Ist)
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
                          <div className="flex items-center justify-between text-sm pt-1.5 border-t border-emerald-200">
                            <span className="font-medium text-emerald-800">Gesamtlohn (brutto)</span>
                            <span className="font-semibold text-emerald-800">{formatEur(balance.totalPay ?? 0)}</span>
                          </div>
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
        ) : (
          <div className="p-12 text-center border rounded-xl bg-card">
            <p className="text-muted-foreground">Keine Auswertungsdaten fuer diesen Zeitraum gefunden.</p>
          </div>
        )}
      </div>
    </div>
  );
}
