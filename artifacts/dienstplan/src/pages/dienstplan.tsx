import { useState } from "react";
import { useListShifts, useListUsers, useListShiftModels } from "@workspace/api-client-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isToday, getDay } from "date-fns";
import { de } from "date-fns/locale";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Plus, List, CalendarDays, Table2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ShiftDialog } from "@/components/shift-dialog";
import { useAuth } from "@/context/auth";
import { colorBadgeClass, colorDotClass } from "@/lib/shift-model-colors";

type Shift = {
  id: number;
  userId: number;
  startTime: string;
  endTime: string;
  type: string;
  shiftModelId?: number | null;
  notes?: string | null;
  user?: { name: string } | null;
};

type ShiftModelInfo = { name: string; color: string };

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
  vacation: "bg-yellow-100 text-yellow-900 border-yellow-400 hover:bg-yellow-200",
  sick: "bg-slate-200 text-slate-700 border-slate-400 hover:bg-slate-300",
};

function shiftLabel(shift: Shift, modelMap: Map<number, ShiftModelInfo>): string {
  if (shift.type === "work") {
    return (shift.shiftModelId ? modelMap.get(shift.shiftModelId)?.name : undefined) ?? "Dienst";
  }
  return SHIFT_TYPE_LABELS[shift.type] ?? shift.type;
}

function shiftBadgeClasses(shift: Shift, modelMap: Map<number, ShiftModelInfo>): string {
  // Reguläre Dienste: Modellfarbe, sonst Dunkelblau aus dem Branding (primary).
  if (shift.type === "work") {
    const model = shift.shiftModelId ? modelMap.get(shift.shiftModelId) : undefined;
    if (model) return colorBadgeClass(model.color);
    return "bg-primary/10 text-primary border-primary/25 hover:bg-primary/20";
  }
  // Urlaub = Gelb, Krank = Grau; Legacy-Dienste behalten ihre Farbe.
  return (
    SHIFT_TYPE_CLASSES[shift.type] ?? "bg-primary/10 text-primary border-primary/25 hover:bg-primary/20"
  );
}

const WEEKDAY_LABELS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

const SHIFT_TYPE_DOTS: Record<string, string> = {
  active: "bg-primary",
  standby: "bg-amber-500",
  night: "bg-blue-500",
  full_day: "bg-purple-500",
  vacation: "bg-yellow-400",
  sick: "bg-slate-400",
};

function shiftDotClass(shift: Shift, modelMap: Map<number, ShiftModelInfo>): string {
  if (shift.type === "work") {
    const model = shift.shiftModelId ? modelMap.get(shift.shiftModelId) : undefined;
    if (model) return colorDotClass(model.color);
    return "bg-primary";
  }
  return SHIFT_TYPE_DOTS[shift.type] ?? "bg-primary";
}

type DialogState =
  | { mode: "closed" }
  | { mode: "create"; date: Date; userId?: number }
  | { mode: "edit"; shift: Shift };

type Assistant = { id: number; name: string };

function ShiftBadge({
  shift,
  showName,
  modelMap,
  onClick,
}: {
  shift: Shift;
  showName?: boolean;
  modelMap: Map<number, ShiftModelInfo>;
  onClick?: (e: React.MouseEvent) => void;
}) {
  const classes = shiftBadgeClasses(shift, modelMap);
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
      <div className="text-[11px] opacity-70">{shiftLabel(shift, modelMap)}</div>
    </div>
  );
}

function AgendaView({
  days,
  shifts,
  modelMap,
  onDayClick,
  onShiftClick,
  canEdit,
}: {
  days: Date[];
  shifts: Shift[];
  modelMap: Map<number, ShiftModelInfo>;
  onDayClick: (day: Date) => void;
  onShiftClick: (shift: Shift) => void;
  canEdit: boolean;
}) {
  return (
    <div className="space-y-1">
      {days.map((day) => {
        const dayShifts = shifts.filter((s) => isSameDay(new Date(s.startTime), day));
        const isCurrentDay = isToday(day);

        return (
          <div key={day.toISOString()} className="rounded-lg border border-border/40 overflow-hidden">
            <button
              type="button"
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                isCurrentDay
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-muted/40 text-foreground hover:bg-muted/70"
              } ${!canEdit ? "cursor-default pointer-events-none" : ""}`}
              onClick={() => canEdit && onDayClick(day)}
            >
              <span className="text-sm font-semibold min-w-[24px]">{format(day, "d")}</span>
              <span className="text-sm">{format(day, "EEEE", { locale: de })}</span>
              {canEdit && (
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
              )}
            </button>

            <div className="bg-card px-3 py-2 space-y-1.5">
              {dayShifts.length > 0 ? (
                dayShifts.map((shift) => (
                  <ShiftBadge
                    key={shift.id}
                    shift={shift}
                    showName={canEdit}
                    modelMap={modelMap}
                    onClick={canEdit ? (e) => { e.stopPropagation(); onShiftClick(shift); } : undefined}
                  />
                ))
              ) : (
                <p className="text-xs text-muted-foreground">
                  {canEdit ? "Keine Schichten — tippen zum Hinzufügen" : "Keine Schichten"}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MonthGrid({
  days,
  monthStart,
  shifts,
  modelMap,
  selectedDay,
  onSelectDay,
  onAddShift,
  onShiftClick,
  canEdit,
}: {
  days: Date[];
  monthStart: Date;
  shifts: Shift[];
  modelMap: Map<number, ShiftModelInfo>;
  selectedDay: Date;
  onSelectDay: (day: Date) => void;
  onAddShift: (day: Date) => void;
  onShiftClick: (shift: Shift) => void;
  canEdit: boolean;
}) {
  // Montag als erster Wochentag (date-fns: 0 = Sonntag).
  const offset = (getDay(monthStart) + 6) % 7;
  const blanks = Array.from({ length: offset });
  const selectedShifts = shifts.filter((s) => isSameDay(new Date(s.startTime), selectedDay));

  return (
    <div className="space-y-3">
      {/* Monatsgitter mit hellblauem Rahmen, weißen Kästchen */}
      <div className="rounded-2xl bg-sky-50 border border-sky-100 p-2">
        <div className="grid grid-cols-7 gap-1 mb-1">
          {WEEKDAY_LABELS.map((d) => (
            <div key={d} className="text-center text-[11px] font-medium text-muted-foreground py-1">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1" data-testid="month-grid">
          {blanks.map((_, i) => (
            <div key={`blank-${i}`} data-testid="month-grid-blank" />
          ))}
          {days.map((day) => {
            const dayShifts = shifts.filter((s) => isSameDay(new Date(s.startTime), day));
            const selected = isSameDay(day, selectedDay);
            const today = isToday(day);
            const dots = dayShifts.slice(0, 3);
            return (
              <button
                key={day.toISOString()}
                type="button"
                data-testid={`day-cell-${format(day, "yyyy-MM-dd")}`}
                data-selected={selected ? "true" : "false"}
                onClick={() => onSelectDay(day)}
                className={`aspect-square rounded-lg bg-card flex flex-col items-center justify-start pt-1.5 gap-1 border transition-colors ${
                  selected
                    ? "border-primary ring-1 ring-primary"
                    : "border-transparent hover:bg-muted/40"
                }`}
              >
                <span
                  className={`text-xs leading-none flex items-center justify-center h-6 w-6 ${
                    today
                      ? "bg-primary text-primary-foreground rounded-full font-semibold"
                      : "font-medium"
                  }`}
                >
                  {format(day, "d")}
                </span>
                <span className="flex items-center gap-0.5 h-1.5">
                  {dots.map((s) => (
                    <span
                      key={s.id}
                      className={`h-1.5 w-1.5 rounded-full ${shiftDotClass(s, modelMap)}`}
                    />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tagesdetails */}
      <div className="rounded-lg border border-border/40 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 bg-muted/40">
          <div>
            <p className="text-sm font-semibold" data-testid="day-detail-header">
              {format(selectedDay, "EEEE, d. MMMM", { locale: de })}
            </p>
            <p className="text-xs text-muted-foreground">
              {selectedShifts.length === 0
                ? "Keine Schichten"
                : `${selectedShifts.length} ${selectedShifts.length === 1 ? "Schicht" : "Schichten"}`}
            </p>
          </div>
          {canEdit && (
            <Button size="sm" variant="outline" className="gap-1" onClick={() => onAddShift(selectedDay)}>
              <Plus className="h-3.5 w-3.5" />
              Schicht
            </Button>
          )}
        </div>
        <div className="bg-card px-3 py-2 space-y-1.5">
          {selectedShifts.length > 0 ? (
            selectedShifts.map((shift) => (
              <ShiftBadge
                key={shift.id}
                shift={shift}
                showName={canEdit}
                modelMap={modelMap}
                onClick={canEdit ? (e) => { e.stopPropagation(); onShiftClick(shift); } : undefined}
              />
            ))
          ) : (
            <p className="text-xs text-muted-foreground">
              {canEdit ? "Keine Schichten — tippen zum Hinzufügen" : "Keine Schichten"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function ViewToggle({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; icon: LucideIcon }[];
}) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
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
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
            }`}
          >
            <Icon className="h-4 w-4" />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function AssistantFilter({
  assistants,
  selected,
  onSelect,
}: {
  assistants: Assistant[];
  selected: number | "all";
  onSelect: (val: number | "all") => void;
}) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1" data-testid="assistant-filter">
      <button
        type="button"
        data-testid="assistant-chip-all"
        data-active={selected === "all" ? "true" : "false"}
        onClick={() => onSelect("all")}
        className={`shrink-0 rounded-full border px-3 py-1.5 text-xs transition-colors ${
          selected === "all"
            ? "bg-primary text-primary-foreground border-primary"
            : "bg-card text-muted-foreground border-border"
        }`}
      >
        Alle
      </button>
      {assistants.map((a) => (
        <button
          key={a.id}
          type="button"
          data-testid={`assistant-chip-${a.id}`}
          data-active={selected === a.id ? "true" : "false"}
          onClick={() => onSelect(a.id)}
          className={`shrink-0 rounded-full border px-3 py-1.5 text-xs transition-colors ${
            selected === a.id
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-card text-muted-foreground border-border"
          }`}
        >
          {a.name}
        </button>
      ))}
    </div>
  );
}

export default function Dienstplan() {
  const { currentUser } = useAuth();
  const isAdmin = currentUser?.role === "admin";

  const [currentDate, setCurrentDate] = useState(new Date());
  const [dialog, setDialog] = useState<DialogState>({ mode: "closed" });
  const [mobileView, setMobileView] = useState<"list" | "grid">("grid");
  const [desktopView, setDesktopView] = useState<"table" | "grid">("table");
  const [selectedAssistant, setSelectedAssistant] = useState<number | "all">("all");
  const [selectedDay, setSelectedDay] = useState<Date>(() => new Date());

  const month = currentDate.getMonth() + 1;
  const year = currentDate.getFullYear();

  const { data: shifts, isLoading: shiftsLoading } = useListShifts({ month, year });
  const { data: users, isLoading: usersLoading } = useListUsers();

  const goToMonth = (newDate: Date) => {
    setCurrentDate(newDate);
    setSelectedDay(startOfMonth(newDate));
  };
  const prevMonth = () => goToMonth(new Date(year, month - 2, 1));
  const nextMonth = () => goToMonth(new Date(year, month, 1));

  const start = startOfMonth(currentDate);
  const end = endOfMonth(currentDate);
  const days = eachDayOfInterval({ start, end });

  const assistants: Assistant[] = isAdmin
    ? (users ?? []).filter((u) => u.role === "assistant").map((u) => ({ id: u.id, name: u.name }))
    : currentUser
    ? [{ id: currentUser.id, name: currentUser.name }]
    : [];

  const { data: shiftModels } = useListShiftModels();
  const modelMap = new Map<number, ShiftModelInfo>(
    (shiftModels ?? []).map((m) => [m.id, { name: m.name, color: m.color }])
  );

  const allShifts: Shift[] = shifts ?? [];
  const visibleShifts: Shift[] =
    selectedAssistant === "all"
      ? allShifts
      : allShifts.filter((s) => s.userId === selectedAssistant);
  const tableAssistants: Assistant[] =
    selectedAssistant === "all"
      ? assistants
      : assistants.filter((a) => a.id === selectedAssistant);
  const isLoading = shiftsLoading || (isAdmin && usersLoading);

  function openCreate(date: Date, userId?: number) {
    if (!isAdmin) return;
    setDialog({ mode: "create", date, userId });
  }

  function openEdit(shift: Shift) {
    if (!isAdmin) return;
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
        <Button variant="outline" size="icon" onClick={prevMonth} data-testid="prev-month">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span
          className="font-medium text-sm md:text-lg min-w-[120px] md:min-w-40 text-center"
          data-testid="month-label"
        >
          {format(currentDate, "MMMM yyyy", { locale: de })}
        </span>
        <Button variant="outline" size="icon" onClick={nextMonth} data-testid="next-month">
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

      {/* Mobile: umschaltbare Ansicht (Liste / Monatsgitter) */}
      <div className="md:hidden space-y-3" data-testid="dienstplan-mobile">
        <div className="flex items-center justify-between gap-2">
          <ViewToggle
            value={mobileView}
            onChange={(v) => setMobileView(v as "list" | "grid")}
            options={[
              { value: "list", label: "Liste", icon: List },
              { value: "grid", label: "Monat", icon: CalendarDays },
            ]}
          />
        </div>

        {isAdmin && assistants.length > 0 && (
          <AssistantFilter
            assistants={assistants}
            selected={selectedAssistant}
            onSelect={setSelectedAssistant}
          />
        )}

        {mobileView === "list" ? (
          <AgendaView
            days={days}
            shifts={visibleShifts}
            modelMap={modelMap}
            onDayClick={(day) => openCreate(day)}
            onShiftClick={openEdit}
            canEdit={isAdmin}
          />
        ) : (
          <MonthGrid
            days={days}
            monthStart={start}
            shifts={visibleShifts}
            modelMap={modelMap}
            selectedDay={selectedDay}
            onSelectDay={setSelectedDay}
            onAddShift={(day) => openCreate(day)}
            onShiftClick={openEdit}
            canEdit={isAdmin}
          />
        )}
      </div>

      {/* Desktop: umschaltbare Ansicht (Tabelle / Monatsgitter) */}
      <div className="hidden md:block space-y-4" data-testid="dienstplan-desktop">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <ViewToggle
            value={desktopView}
            onChange={(v) => setDesktopView(v as "table" | "grid")}
            options={[
              { value: "table", label: "Tabelle", icon: Table2 },
              { value: "grid", label: "Monat", icon: CalendarDays },
            ]}
          />
          {isAdmin && assistants.length > 0 && (
            <AssistantFilter
              assistants={assistants}
              selected={selectedAssistant}
              onSelect={setSelectedAssistant}
            />
          )}
        </div>

        {desktopView === "grid" ? (
          <MonthGrid
            days={days}
            monthStart={start}
            shifts={visibleShifts}
            modelMap={modelMap}
            selectedDay={selectedDay}
            onSelectDay={setSelectedDay}
            onAddShift={(day) => openCreate(day)}
            onShiftClick={openEdit}
            canEdit={isAdmin}
          />
        ) : (
      <Card className="overflow-x-auto border-border/50 shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="p-3 text-left font-medium sticky left-0 bg-muted/50 backdrop-blur-sm z-10 w-48">
                {isAdmin ? "Assistent" : "Schicht"}
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
            {tableAssistants.length === 0 ? (
              <tr>
                <td colSpan={days.length + 1} className="p-8 text-center text-muted-foreground">
                  Keine Einträge gefunden.
                </td>
              </tr>
            ) : (
              tableAssistants.map((assistant) => (
                <tr
                  key={assistant.id}
                  className="border-b last:border-0 hover:bg-muted/20 transition-colors"
                >
                  <td className="p-3 font-medium sticky left-0 bg-card hover:bg-muted/20 transition-colors z-10 shadow-[1px_0_0_0_hsl(var(--border))]">
                    {isAdmin ? assistant.name : "Meine Schichten"}
                  </td>
                  {days.map((day) => {
                    const dayShifts = allShifts.filter(
                      (s) => s.userId === assistant.id && isSameDay(new Date(s.startTime), day)
                    );
                    return (
                      <td
                        key={day.toISOString()}
                        className={`p-1 border-l border-border/30 align-top ${
                          isAdmin ? "cursor-pointer group" : ""
                        } ${isToday(day) ? "bg-primary/5" : isAdmin ? "hover:bg-muted/30" : ""}`}
                        onClick={isAdmin ? () => openCreate(day, assistant.id) : undefined}
                        title={isAdmin ? "Klicken zum Anlegen einer Schicht" : undefined}
                      >
                        <div className="space-y-1 min-h-[32px]">
                          {dayShifts.map((s) => (
                            <ShiftBadge
                              key={s.id}
                              shift={s}
                              modelMap={modelMap}
                              onClick={isAdmin ? (e) => { e.stopPropagation(); openEdit(s); } : undefined}
                            />
                          ))}
                          {dayShifts.length === 0 && isAdmin && (
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
        )}
      </div>

      {isAdmin && (
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
      )}
    </div>
  );
}
