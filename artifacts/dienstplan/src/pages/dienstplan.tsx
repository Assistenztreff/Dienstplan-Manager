import { useState } from "react";
import { useListShifts, useListUsers } from "@workspace/api-client-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isToday } from "date-fns";
import { de } from "date-fns/locale";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { ShiftDialog } from "@/components/shift-dialog";

type Shift = {
  id: number;
  userId: number;
  startTime: string;
  endTime: string;
  type: string;
  notes?: string | null;
  user?: { name: string } | null;
};

const SHIFT_TYPE_LABELS: Record<string, string> = {
  active: "Aktivdienst",
  standby: "Bereitschaft",
  night: "Nachtdienst",
  full_day: "24h-Dienst",
  vacation: "Urlaub",
  sick: "Krank",
};

const SHIFT_TYPE_CLASSES: Record<string, string> = {
  active: "bg-primary/10 text-primary border-primary/25 hover:bg-primary/20",
  standby: "bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100",
  night: "bg-blue-50 text-blue-800 border-blue-200 hover:bg-blue-100",
  full_day: "bg-purple-50 text-purple-800 border-purple-200 hover:bg-purple-100",
  vacation: "bg-yellow-50 text-yellow-800 border-yellow-300 hover:bg-yellow-100",
  sick: "bg-slate-100 text-slate-600 border-slate-300 hover:bg-slate-200",
};

type DialogState =
  | { mode: "closed" }
  | { mode: "create"; date: Date; userId?: number }
  | { mode: "edit"; shift: Shift };

type Assistant = { id: number; name: string };

function ShiftBadge({
  shift,
  showName,
  onClick,
}: {
  shift: Shift;
  showName?: boolean;
  onClick?: (e: React.MouseEvent) => void;
}) {
  const classes =
    SHIFT_TYPE_CLASSES[shift.type] ?? "bg-secondary text-secondary-foreground border-border/50 hover:bg-muted";
  return (
    <div
      className={`text-xs rounded border px-2 py-1 leading-snug cursor-pointer transition-colors ${classes}`}
      onClick={onClick}
    >
      {showName && shift.user && (
        <div className="font-medium truncate">{shift.user.name}</div>
      )}
      <div>
        {format(new Date(shift.startTime), "HH:mm")}–{format(new Date(shift.endTime), "HH:mm")}
      </div>
      <div className="text-[11px] opacity-70">{SHIFT_TYPE_LABELS[shift.type] ?? shift.type}</div>
    </div>
  );
}

function AgendaView({
  days,
  shifts,
  onDayClick,
  onShiftClick,
}: {
  days: Date[];
  shifts: Shift[];
  onDayClick: (day: Date) => void;
  onShiftClick: (shift: Shift) => void;
}) {
  return (
    <div className="space-y-1">
      {days.map((day) => {
        const dayShifts = shifts.filter((s) => isSameDay(new Date(s.startTime), day));
        const isCurrentDay = isToday(day);

        return (
          <div key={day.toISOString()} className="rounded-lg border border-border/40 overflow-hidden">
            {/* Day header — tap to add a shift */}
            <button
              type="button"
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                isCurrentDay
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-muted/40 text-foreground hover:bg-muted/70"
              }`}
              onClick={() => onDayClick(day)}
            >
              <span className="text-sm font-semibold min-w-[24px]">{format(day, "d")}</span>
              <span className="text-sm">{format(day, "EEEE", { locale: de })}</span>
              <span
                className={`ml-auto flex items-center gap-1 text-xs ${
                  isCurrentDay ? "opacity-80" : "text-muted-foreground"
                }`}
              >
                {dayShifts.length > 0 && (
                  <span className="font-medium">{dayShifts.length}</span>
                )}
                <Plus className="h-3.5 w-3.5" />
              </span>
            </button>

            {/* Shift cards */}
            <div className="bg-card px-3 py-2 space-y-1.5">
              {dayShifts.length > 0 ? (
                dayShifts.map((shift) => (
                  <ShiftBadge
                    key={shift.id}
                    shift={shift}
                    showName
                    onClick={(e) => {
                      e.stopPropagation();
                      onShiftClick(shift);
                    }}
                  />
                ))
              ) : (
                <p className="text-xs text-muted-foreground">Keine Schichten — tippen zum Hinzufügen</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Dienstplan() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [dialog, setDialog] = useState<DialogState>({ mode: "closed" });

  const month = currentDate.getMonth() + 1;
  const year = currentDate.getFullYear();

  const { data: shifts, isLoading: shiftsLoading } = useListShifts({ month, year });
  const { data: users, isLoading: usersLoading } = useListUsers();

  const prevMonth = () => setCurrentDate(new Date(year, month - 2, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month, 1));

  const start = startOfMonth(currentDate);
  const end = endOfMonth(currentDate);
  const days = eachDayOfInterval({ start, end });

  const assistants: Assistant[] = (users ?? [])
    .filter((u) => u.role === "assistant")
    .map((u) => ({ id: u.id, name: u.name }));

  const allShifts: Shift[] = shifts ?? [];
  const isLoading = shiftsLoading || usersLoading;

  function openCreate(date: Date, userId?: number) {
    setDialog({ mode: "create", date, userId });
  }

  function openEdit(shift: Shift) {
    setDialog({ mode: "edit", shift });
  }

  function closeDialog() {
    setDialog({ mode: "closed" });
  }

  const Header = () => (
    <div className="flex items-center justify-between">
      <div>
        <h2 className="text-2xl md:text-3xl font-serif font-bold text-foreground">Dienstplan</h2>
        <p className="text-muted-foreground mt-1 text-sm">Monatsansicht der Schichten</p>
      </div>
      <div className="flex items-center gap-2 md:gap-4">
        <Button variant="outline" size="icon" onClick={prevMonth}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="font-medium text-sm md:text-lg min-w-[120px] md:min-w-40 text-center">
          {format(currentDate, "MMMM yyyy", { locale: de })}
        </span>
        <Button variant="outline" size="icon" onClick={nextMonth}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        <Header />
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <Header />

      {/* Mobile: Agenda-Ansicht */}
      <div className="md:hidden">
        <AgendaView
          days={days}
          shifts={allShifts}
          onDayClick={(day) => openCreate(day)}
          onShiftClick={openEdit}
        />
      </div>

      {/* Desktop: Tabellen-Ansicht */}
      <Card className="hidden md:block overflow-x-auto border-border/50 shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="p-3 text-left font-medium sticky left-0 bg-muted/50 backdrop-blur-sm z-10 w-48">
                Assistent
              </th>
              {days.map((day) => (
                <th
                  key={day.toISOString()}
                  className={`p-2 font-medium text-center min-w-[56px] ${
                    isToday(day) ? "bg-primary/10" : ""
                  }`}
                >
                  <div className="text-xs text-muted-foreground">{format(day, "E", { locale: de })}</div>
                  <div
                    className={`text-sm ${
                      isToday(day)
                        ? "bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center mx-auto"
                        : ""
                    }`}
                  >
                    {format(day, "d")}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {assistants.length === 0 ? (
              <tr>
                <td colSpan={days.length + 1} className="p-8 text-center text-muted-foreground">
                  Keine Assistenten gefunden.
                </td>
              </tr>
            ) : (
              assistants.map((assistant) => (
                <tr
                  key={assistant.id}
                  className="border-b last:border-0 hover:bg-muted/20 transition-colors"
                >
                  <td className="p-3 font-medium sticky left-0 bg-card hover:bg-muted/20 transition-colors z-10 shadow-[1px_0_0_0_hsl(var(--border))]">
                    {assistant.name}
                  </td>
                  {days.map((day) => {
                    const dayShifts = allShifts.filter(
                      (s) => s.userId === assistant.id && isSameDay(new Date(s.startTime), day)
                    );
                    return (
                      <td
                        key={day.toISOString()}
                        className={`p-1 border-l border-border/30 align-top cursor-pointer group ${
                          isToday(day) ? "bg-primary/5" : "hover:bg-muted/30"
                        }`}
                        onClick={() => openCreate(day, assistant.id)}
                        title="Klicken zum Anlegen einer Schicht"
                      >
                        <div className="space-y-1 min-h-[32px]">
                          {dayShifts.map((s) => (
                            <ShiftBadge
                              key={s.id}
                              shift={s}
                              onClick={(e) => {
                                e.stopPropagation();
                                openEdit(s);
                              }}
                            />
                          ))}
                          {dayShifts.length === 0 && (
                            <div className="hidden group-hover:flex items-center justify-center h-8 text-muted-foreground/40">
                              <Plus className="h-3.5 w-3.5" />
                            </div>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      {/* Shift Dialog */}
      <ShiftDialog
        open={dialog.mode !== "closed"}
        onClose={closeDialog}
        preselectedDate={dialog.mode === "create" ? dialog.date : undefined}
        preselectedUserId={dialog.mode === "create" ? dialog.userId : undefined}
        editShift={dialog.mode === "edit" ? dialog.shift : undefined}
        assistants={assistants}
        month={month}
        year={year}
      />
    </div>
  );
}
