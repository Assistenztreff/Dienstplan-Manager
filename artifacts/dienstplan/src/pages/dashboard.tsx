import { useGetDashboardSummary } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { de } from "date-fns/locale";

export default function Dashboard() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  
  const { data: summary, isLoading } = useGetDashboardSummary(
    { month, year }
  );

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h2 className="text-3xl font-serif font-bold text-foreground">Dashboard</h2>
        <p className="text-muted-foreground mt-1">Uebersicht fuer {format(now, 'MMMM yyyy', { locale: de })}</p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32 w-full rounded-xl" />)}
        </div>
      ) : summary ? (
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
      ) : (
        <div className="p-8 text-center border rounded-xl bg-card">
          <p className="text-muted-foreground">Keine Daten verfuegbar.</p>
        </div>
      )}
    </div>
  );
}
