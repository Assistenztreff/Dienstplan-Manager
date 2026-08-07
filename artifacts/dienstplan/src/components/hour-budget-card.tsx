// ---------------------------------------------------------------------------
// Stundenbilanz-Kachel fürs Dashboard (Premium, Arbeitsanweisung 06.08.2026,
// Punkt 2.2): genehmigte / verbrauchte / verbleibende Assistenzstunden des
// laufenden Monats plus laufender Jahressaldo. Abwesenheitsstunden zählen
// nicht als Verbrauch (im Budget bereits enthalten).
// Die Kachel erscheint erst, sobald in den Einstellungen mindestens ein
// Stundenbudget hinterlegt ist (hasBudgets) — ohne Budget bliebe die Kachel
// reine Leerfläche. Free-Konten sehen nichts: das Feature-Gate setzt der
// Server mit 403 durch, die Karte blendet sich dann einfach aus.
// ---------------------------------------------------------------------------
import { useGetHourBudgetBalance } from "@workspace/api-client-react";
import type { HourBudgetBalance } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Gauge } from "lucide-react";
import { useLocation } from "wouter";
import { formatHours } from "@/lib/utils";
import { format } from "date-fns";
import { de } from "date-fns/locale";

export function HourBudgetDashboardCard({ teamId }: { teamId: number | null }) {
  const [, navigate] = useLocation();
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const { data, isLoading, isError } = useGetHourBudgetBalance(
    { month, year, ...(teamId != null ? { teamId } : {}) },
    { query: { retry: false } } as any,
  ) as {
    data: HourBudgetBalance | undefined;
    isLoading: boolean;
    isError: boolean;
  };

  // 403 (Free-Plan / plan_feature_required) oder sonstiger Fehler: Karte
  // komplett ausblenden — Free soll die Funktion nicht sehen.
  if (isError) return null;
  if (isLoading) {
    return <Skeleton className="h-28 w-full rounded-xl" data-testid="hour-budget-loading" />;
  }
  if (!data) return null;
  // Erst zeigen, sobald in den Einstellungen ein Stundenbudget hinterlegt ist.
  if (!data.hasBudgets) return null;

  const monthLabel = format(now, "MMMM", { locale: de });

  return (
    <Card className="border-border/50 shadow-sm" data-testid="hour-budget-balance-card">
      <CardContent className="py-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-medium">Stundenbilanz {monthLabel}</h3>
          </div>
          <button
            type="button"
            onClick={() => navigate("/einstellungen")}
            className="text-xs text-muted-foreground underline underline-offset-4 hover:no-underline"
            data-testid="hour-budget-settings-link"
          >
            Stundenbudget verwalten
          </button>
        </div>
        {data.approvedHours === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="hour-budget-empty-hint">
            Für {monthLabel} ist kein Stundenbudget hinterlegt — genehmigte Stunden
            zählen mit 0. Lege in den Einstellungen ein Stundenbudget an.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-2xl font-bold" data-testid="hour-budget-approved">
                  {formatHours(data.approvedHours)}
                </p>
                <p className="text-xs text-muted-foreground">genehmigt</p>
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="hour-budget-consumed">
                  {formatHours(data.consumedHours)}
                </p>
                <p className="text-xs text-muted-foreground">verbraucht</p>
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="hour-budget-remaining">
                  {formatHours(data.remainingHours)}
                </p>
                <p className="text-xs text-muted-foreground">verbleibend</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-3" data-testid="hour-budget-year-balance">
              Jahressaldo {year}: {formatHours(data.yearBalance)}{" "}
              {data.yearBalance >= 0 ? "angespart" : "überzogen"} (genehmigt{" "}
              {formatHours(data.yearApprovedHours)} · verbraucht{" "}
              {formatHours(data.yearConsumedHours)})
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
