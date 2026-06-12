import { useState } from "react";
import { useGetHoursBalance } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { Progress } from "@/components/ui/progress";

export default function Auswertungen() {
  const [currentDate, setCurrentDate] = useState(new Date());
  
  const month = currentDate.getMonth() + 1;
  const year = currentDate.getFullYear();
  
  const { data: balances, isLoading } = useGetHoursBalance({ month, year }) as any; // Usually returns array of HoursBalance

  const prevMonth = () => setCurrentDate(new Date(year, month - 2, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month, 1));

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-serif font-bold text-foreground">Auswertungen</h2>
          <p className="text-muted-foreground mt-1">Soll/Ist-Abgleich der Stunden</p>
        </div>
        
        <div className="flex items-center gap-4">
          <Button variant="outline" size="icon" onClick={prevMonth}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="font-medium text-lg min-w-40 text-center">
            {format(currentDate, 'MMMM yyyy', { locale: de })}
          </span>
          <Button variant="outline" size="icon" onClick={nextMonth}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {isLoading ? (
          <>
            <Skeleton className="h-32 w-full rounded-xl" />
            <Skeleton className="h-32 w-full rounded-xl" />
          </>
        ) : balances && Array.isArray(balances) ? (
          balances.map((balance: any) => {
            const percentage = Math.min(100, Math.max(0, (balance.actualHours / balance.plannedHours) * 100)) || 0;
            const isOvertime = balance.actualHours > balance.plannedHours;
            
            return (
              <Card key={balance.userId} className="border-border/50 shadow-sm">
                <CardContent className="p-6">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold mb-1">{balance.userName}</h3>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
                        <div>Soll: <span className="font-medium text-foreground">{balance.plannedHours} h</span></div>
                        <div>Ist: <span className="font-medium text-foreground">{balance.actualHours} h</span></div>
                        <div>Differenz: <span className={`font-medium ${isOvertime ? 'text-primary' : balance.actualHours < balance.plannedHours ? 'text-amber-600' : 'text-green-600'}`}>
                          {balance.balance > 0 ? '+' : ''}{balance.balance} h
                        </span></div>
                      </div>
                      
                      <div className="space-y-2">
                        <Progress value={percentage} className="h-2" />
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>0 h</span>
                          <span>{percentage.toFixed(0)}% erreicht</span>
                          <span>{balance.plannedHours} h</span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="w-full md:w-48 p-4 bg-muted/30 rounded-lg border border-border/50 flex flex-col items-center justify-center">
                      <span className="text-sm text-muted-foreground mb-1">Urlaubstage</span>
                      <span className="text-2xl font-bold">{balance.vacationDaysRemaining}</span>
                      <span className="text-xs text-muted-foreground mt-1">von {balance.vacationDaysUsed + balance.vacationDaysRemaining} verfuegbar</span>
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
