import { useState } from "react";
import { useListShifts, useListUsers } from "@workspace/api-client-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay } from "date-fns";
import { de } from "date-fns/locale";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

export default function Dienstplan() {
  const [currentDate, setCurrentDate] = useState(new Date());
  
  const month = currentDate.getMonth() + 1;
  const year = currentDate.getFullYear();
  
  const { data: shifts, isLoading: shiftsLoading } = useListShifts({ month, year });
  const { data: users, isLoading: usersLoading } = useListUsers();

  const prevMonth = () => setCurrentDate(new Date(year, month - 2, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month, 1));

  const start = startOfMonth(currentDate);
  const end = endOfMonth(currentDate);
  const days = eachDayOfInterval({ start, end });

  const assistants = users?.filter(u => u.role === "assistant") || [];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-serif font-bold text-foreground">Dienstplan</h2>
          <p className="text-muted-foreground mt-1">Monatsansicht der Schichten</p>
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

      <Card className="overflow-x-auto border-border/50 shadow-sm">
        {(shiftsLoading || usersLoading) ? (
          <div className="p-8 space-y-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="p-3 text-left font-medium sticky left-0 bg-muted/50 backdrop-blur-sm z-10 w-48">
                  Assistent
                </th>
                {days.map(day => (
                  <th key={day.toISOString()} className="p-3 font-medium text-center min-w-16">
                    <div className="text-xs text-muted-foreground">{format(day, 'E', { locale: de })}</div>
                    <div>{format(day, 'd')}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {assistants.map(assistant => (
                <tr key={assistant.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="p-3 font-medium sticky left-0 bg-card hover:bg-muted/30 transition-colors z-10 shadow-[1px_0_0_0_hsl(var(--border))]">
                    {assistant.name}
                  </td>
                  {days.map(day => {
                    const dayShifts = shifts?.filter(s => 
                      s.userId === assistant.id && 
                      isSameDay(new Date(s.startTime), day)
                    ) || [];
                    
                    return (
                      <td key={day.toISOString()} className="p-2 text-center border-l border-border/30">
                        {dayShifts.map(s => (
                          <div 
                            key={s.id} 
                            className={`text-xs py-1 px-2 rounded-md mb-1 ${
                              s.type === 'active' ? 'bg-primary/10 text-primary border border-primary/20' :
                              s.type === 'night' ? 'bg-blue-900/10 text-blue-700 border border-blue-900/20' :
                              'bg-secondary text-secondary-foreground border border-border/50'
                            }`}
                          >
                            {format(new Date(s.startTime), 'HH:mm')}
                            <br/>
                            {format(new Date(s.endTime), 'HH:mm')}
                          </div>
                        ))}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {assistants.length === 0 && (
                <tr>
                  <td colSpan={days.length + 1} className="p-8 text-center text-muted-foreground">
                    Keine Assistenten gefunden.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
