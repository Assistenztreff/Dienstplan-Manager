import { useState } from "react";
import { useGetHoursBalance } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { TeamSwitcher } from "@/components/team-switcher";
import { useTeam } from "@/context/team";
import { exportHoursStatementPdf } from "@/lib/pdf-export";

export default function Auswertungen() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [isExporting, setIsExporting] = useState(false);

  const month = currentDate.getMonth() + 1;
  const year = currentDate.getFullYear();

  const { selectedTeamId } = useTeam();
  const { data: balances, isLoading } = useGetHoursBalance({
    month,
    year,
    ...(selectedTeamId != null ? { teamId: selectedTeamId } : {}),
  }) as any;

  const prevMonth = () => setCurrentDate(new Date(year, month - 2, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month, 1));

  const monthLabel = format(currentDate, "MMMM yyyy", { locale: de });

  const handleExport = async () => {
    if (!balances || balances.length === 0) return;
    setIsExporting(true);
    try {
      await exportHoursStatementPdf({
        balances,
        month,
        year,
        monthLabel,
        teamId: selectedTeamId,
      });
    } catch (err) {
      toast.error("PDF-Export fehlgeschlagen.");
      console.error(err);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <div>
            <h2 className="text-2xl md:text-3xl font-serif font-bold text-foreground">Auswertungen</h2>
            <p className="text-muted-foreground mt-1 text-sm">Soll/Ist-Abgleich der Stunden</p>
          </div>
          <TeamSwitcher />
        </div>

        <div className="flex items-center gap-2 md:gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={prevMonth}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="font-medium text-sm md:text-lg min-w-[120px] md:min-w-40 text-center">
              {monthLabel}
            </span>
            <Button variant="outline" size="icon" onClick={nextMonth}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <Button
            variant="outline"
            onClick={handleExport}
            disabled={isExporting || isLoading || !balances || balances.length === 0}
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            {isExporting ? "Exportiere..." : "Als PDF exportieren"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {isLoading ? (
          <>
            <Skeleton className="h-48 w-full rounded-xl" />
            <Skeleton className="h-48 w-full rounded-xl" />
          </>
        ) : balances && Array.isArray(balances) && balances.length > 0 ? (
          balances.map((balance: any) => {
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
                                  ? "text-primary font-medium"
                                  : balance.valuedHours < balance.plannedHours
                                  ? "text-amber-600 font-medium"
                                  : "text-green-600 font-medium"
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
                        <span className="font-semibold text-primary">{balance.totalFulfilledHours} h</span>
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
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">
                            Nacht ({balance.nightPercent}%)
                          </span>
                          <span className="font-medium">
                            {balance.nightHours} h
                            <span className="text-primary"> (+{balance.nightSurchargeHours} h)</span>
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">
                            Sonntag ({balance.sundayPercent}%)
                          </span>
                          <span className="font-medium">
                            {balance.sundayHours} h
                            <span className="text-primary"> (+{balance.sundaySurchargeHours} h)</span>
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">
                            Feiertag ({balance.holidayPercent}%)
                          </span>
                          <span className="font-medium">
                            {balance.holidayHours} h
                            <span className="text-primary"> (+{balance.holidaySurchargeHours} h)</span>
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Urlaubs-Seite */}
                    <div className="space-y-3">
                      <div className="p-4 bg-yellow-50 rounded-lg border border-yellow-200">
                        <div className="text-xs text-yellow-700 mb-1 font-medium uppercase tracking-wide">
                          Urlaubstage
                        </div>
                        <div className="flex items-end gap-2">
                          <span className="text-3xl font-bold text-yellow-800">
                            {balance.vacationDaysTaken}
                          </span>
                          <span className="text-sm text-yellow-700 mb-0.5">
                            genommen (Monat)
                          </span>
                        </div>
                        <div className="mt-2 text-sm text-yellow-700">
                          <span className="font-medium">{balance.vacationDaysRemaining}</span> von{" "}
                          {balance.vacationDaysRemaining + balance.vacationDaysUsed} verbleibend (Jahr)
                        </div>
                        {balance.vacationDaysRemaining + balance.vacationDaysUsed > 0 && (
                          <Progress
                            value={Math.round(
                              (balance.vacationDaysUsed /
                                (balance.vacationDaysRemaining + balance.vacationDaysUsed)) *
                                100
                            )}
                            className="h-1.5 mt-2 bg-yellow-200 [&>div]:bg-yellow-500"
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
