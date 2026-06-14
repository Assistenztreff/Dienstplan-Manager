import { useGetDashboardSummary } from "@workspace/api-client-react";
import type { DashboardWarnings } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { format, parseISO } from "date-fns";
import { de } from "date-fns/locale";
import { AlertTriangle, CalendarX, Clock, CheckCircle2, Plane } from "lucide-react";
import { TeamSwitcher } from "@/components/team-switcher";
import { useTeam } from "@/context/team";

function WarningsSection({ warnings }: { warnings: DashboardWarnings }) {
  const { pendingTimeEntries, lowVacationAssistants, uncoveredDays, lowVacationThreshold, horizonDays } = warnings;
  const hasWarnings =
    pendingTimeEntries > 0 || lowVacationAssistants.length > 0 || uncoveredDays.length > 0;

  if (!hasWarnings) {
    return (
      <Card className="border-emerald-200 bg-emerald-50/50 shadow-sm">
        <CardContent className="flex items-center gap-3 py-5">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
          <p className="text-sm text-emerald-800">
            Alles in Ordnung. Keine offenen Punkte fuer die naechsten {horizonDays} Tage.
          </p>
        </CardContent>
      </Card>
    );
  }

  const previewDays = uncoveredDays.slice(0, 5);
  const restDays = uncoveredDays.length - previewDays.length;

  return (
    <Card className="border-amber-200 bg-amber-50/40 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold text-amber-900">
          <AlertTriangle className="h-5 w-5 text-amber-600" />
          Hinweise
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {pendingTimeEntries > 0 && (
          <div className="flex items-start gap-3">
            <Clock className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <p className="text-sm font-medium text-foreground">
                {pendingTimeEntries} offene {pendingTimeEntries === 1 ? "Zeiterfassung" : "Zeiterfassungen"}
              </p>
              <p className="text-sm text-muted-foreground">Noch nicht bestaetigt und warten auf Pruefung.</p>
            </div>
          </div>
        )}

        {lowVacationAssistants.length > 0 && (
          <div className="flex items-start gap-3">
            <Plane className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <p className="text-sm font-medium text-foreground">
                {lowVacationAssistants.length}{" "}
                {lowVacationAssistants.length === 1 ? "Assistent" : "Assistenten"} mit wenig Resturlaub
                <span className="font-normal text-muted-foreground"> (Schwelle: {lowVacationThreshold} Tage)</span>
              </p>
              <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">
                {lowVacationAssistants.map((a) => (
                  <li key={a.userId}>
                    {a.userName}: {a.vacationDaysRemaining} {a.vacationDaysRemaining === 1 ? "Tag" : "Tage"} Resturlaub
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {uncoveredDays.length > 0 && (
          <div className="flex items-start gap-3">
            <CalendarX className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <p className="text-sm font-medium text-foreground">
                {uncoveredDays.length} {uncoveredDays.length === 1 ? "Tag" : "Tage"} ohne geplante Schicht
                <span className="font-normal text-muted-foreground"> (naechste {horizonDays} Tage)</span>
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {previewDays.map((d) => format(parseISO(d), "EEE, dd.MM.", { locale: de })).join(" · ")}
                {restDays > 0 ? ` · +${restDays} weitere` : ""}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  
  const { selectedTeamId } = useTeam();

  const { data: summary, isLoading } = useGetDashboardSummary(
    { month, year, ...(selectedTeamId != null ? { teamId: selectedTeamId } : {}) }
  );

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-3xl font-serif font-bold text-foreground">Dashboard</h2>
          <p className="text-muted-foreground mt-1">Uebersicht fuer {format(now, 'MMMM yyyy', { locale: de })}</p>
        </div>
        <TeamSwitcher />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32 w-full rounded-xl" />)}
        </div>
      ) : summary ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="border-border/50 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Aktive Assistenten</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{summary.totalAssistants}</div>
              </CardContent>
            </Card>
            <Card className="border-border/50 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Schichten Heute</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{summary.activeShiftsToday}</div>
              </CardContent>
            </Card>
            <Card className="border-border/50 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Offene Zeiteintraege</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{summary.pendingTimeEntries}</div>
              </CardContent>
            </Card>
            <Card className="border-border/50 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Stundenbilanz Monat</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">
                  {summary.monthlyActualHours} <span className="text-lg text-muted-foreground font-normal">/ {summary.monthlyPlannedHours} h</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {summary.warnings && <WarningsSection warnings={summary.warnings} />}
        </>
      ) : (
        <div className="p-8 text-center border rounded-xl bg-card">
          <p className="text-muted-foreground">Keine Daten verfuegbar.</p>
        </div>
      )}
    </div>
  );
}
