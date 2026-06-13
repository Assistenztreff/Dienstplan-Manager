import { useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";

type ShiftKind = "active" | "standby" | "night" | "full_day" | "vacation" | "sick";

type MockShift = {
  id: number;
  assistant: string;
  from: string;
  to: string;
  kind: ShiftKind;
};

const KIND_LABELS: Record<ShiftKind, string> = {
  active: "Aktivdienst",
  standby: "Bereitschaft",
  night: "Nachtdienst",
  full_day: "24h-Dienst",
  vacation: "Urlaub",
  sick: "Krank",
};

const KIND_BADGE: Record<ShiftKind, string> = {
  active: "bg-primary/10 text-primary border-primary/25",
  standby: "bg-amber-50 text-amber-800 border-amber-200",
  night: "bg-blue-50 text-blue-800 border-blue-200",
  full_day: "bg-purple-50 text-purple-800 border-purple-200",
  vacation: "bg-yellow-100 text-yellow-900 border-yellow-400",
  sick: "bg-slate-200 text-slate-700 border-slate-400",
};

const KIND_DOT: Record<ShiftKind, string> = {
  active: "bg-primary",
  standby: "bg-amber-500",
  night: "bg-blue-500",
  full_day: "bg-purple-500",
  vacation: "bg-yellow-400",
  sick: "bg-slate-400",
};

const ASSISTANTS = ["Alle", "Anna Berger", "Tom Krause", "Lea Sommer"];

const ASSISTANT_COLORS: Record<string, ShiftKind> = {
  "Anna Berger": "active",
  "Tom Krause": "night",
  "Lea Sommer": "standby",
};

// Beispiel-Schichten für Juni 2026 (Schlüssel = Tag im Monat)
const SHIFTS: Record<number, MockShift[]> = {
  2: [
    { id: 1, assistant: "Anna Berger", from: "07:00", to: "15:00", kind: "active" },
    { id: 2, assistant: "Tom Krause", from: "22:00", to: "06:00", kind: "night" },
  ],
  3: [{ id: 3, assistant: "Lea Sommer", from: "08:00", to: "20:00", kind: "standby" }],
  5: [
    { id: 4, assistant: "Anna Berger", from: "07:00", to: "15:00", kind: "active" },
    { id: 5, assistant: "Lea Sommer", from: "15:00", to: "23:00", kind: "active" },
    { id: 6, assistant: "Tom Krause", from: "22:00", to: "06:00", kind: "night" },
  ],
  9: [{ id: 7, assistant: "Tom Krause", from: "00:00", to: "24:00", kind: "full_day" }],
  12: [
    { id: 8, assistant: "Anna Berger", from: "—", to: "—", kind: "vacation" },
    { id: 9, assistant: "Lea Sommer", from: "08:00", to: "16:00", kind: "active" },
  ],
  13: [
    { id: 10, assistant: "Anna Berger", from: "07:00", to: "15:00", kind: "active" },
    { id: 11, assistant: "Tom Krause", from: "15:00", to: "23:00", kind: "standby" },
  ],
  16: [{ id: 12, assistant: "Lea Sommer", from: "—", to: "—", kind: "sick" }],
  19: [
    { id: 13, assistant: "Anna Berger", from: "07:00", to: "15:00", kind: "active" },
    { id: 14, assistant: "Tom Krause", from: "22:00", to: "06:00", kind: "night" },
    { id: 15, assistant: "Lea Sommer", from: "15:00", to: "23:00", kind: "active" },
  ],
  23: [{ id: 16, assistant: "Anna Berger", from: "08:00", to: "20:00", kind: "standby" }],
  26: [
    { id: 17, assistant: "Tom Krause", from: "00:00", to: "24:00", kind: "full_day" },
    { id: 18, assistant: "Lea Sommer", from: "07:00", to: "15:00", kind: "active" },
  ],
};

// Juni 2026 beginnt an einem Montag, hat 30 Tage.
const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const FIRST_WEEKDAY_OFFSET = 0; // Montag
const DAYS_IN_MONTH = 30;
const TODAY = 13;

function fullWeekday(day: number): string {
  const names = [
    "Montag",
    "Dienstag",
    "Mittwoch",
    "Donnerstag",
    "Freitag",
    "Samstag",
    "Sonntag",
  ];
  return names[(FIRST_WEEKDAY_OFFSET + day - 1) % 7];
}

export function MobileKalender() {
  const [selectedDay, setSelectedDay] = useState<number>(TODAY);
  const [filter, setFilter] = useState<string>("Alle");

  const cells: (number | null)[] = [
    ...Array.from({ length: FIRST_WEEKDAY_OFFSET }, () => null),
    ...Array.from({ length: DAYS_IN_MONTH }, (_, i) => i + 1),
  ];

  function dayShifts(day: number): MockShift[] {
    const all = SHIFTS[day] ?? [];
    return filter === "Alle" ? all : all.filter((s) => s.assistant === filter);
  }

  const selectedShifts = dayShifts(selectedDay);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Kopfbereich mit Monatsnavigation */}
      <div className="px-4 pt-5 pb-3 border-b border-border/50">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h1 className="text-xl font-serif font-bold">Dienstplan</h1>
            <p className="text-xs text-muted-foreground">Monatsübersicht</p>
          </div>
          <div className="flex items-center gap-2">
            <button className="h-8 w-8 rounded-md border border-border flex items-center justify-center text-muted-foreground">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-medium min-w-[90px] text-center">Juni 2026</span>
            <button className="h-8 w-8 rounded-md border border-border flex items-center justify-center text-muted-foreground">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Assistenten-Filter */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 mt-3 -mx-1 px-1">
          {ASSISTANTS.map((name) => {
            const active = filter === name;
            return (
              <button
                key={name}
                onClick={() => setFilter(name)}
                className={`shrink-0 text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card text-muted-foreground border-border"
                }`}
              >
                {name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Monatsgitter */}
      <div className="px-3 pt-3">
        <div className="grid grid-cols-7 gap-1 mb-1">
          {WEEKDAYS.map((d) => (
            <div
              key={d}
              className="text-center text-[11px] font-medium text-muted-foreground py-1"
            >
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((day, idx) => {
            if (day === null) return <div key={`e${idx}`} />;
            const shifts = dayShifts(day);
            const isToday = day === TODAY;
            const isSelected = day === selectedDay;
            const dots = shifts.slice(0, 3);
            return (
              <button
                key={day}
                onClick={() => setSelectedDay(day)}
                className={`aspect-square rounded-lg flex flex-col items-center justify-start pt-1.5 gap-1 border transition-colors ${
                  isSelected
                    ? "border-primary bg-primary/5"
                    : "border-transparent hover:bg-muted/50"
                }`}
              >
                <span
                  className={`text-xs leading-none flex items-center justify-center ${
                    isToday
                      ? "bg-primary text-primary-foreground rounded-full h-6 w-6 font-semibold"
                      : "h-6 w-6 font-medium"
                  }`}
                >
                  {day}
                </span>
                <span className="flex items-center gap-0.5 h-1.5">
                  {dots.map((s) => (
                    <span
                      key={s.id}
                      className={`h-1.5 w-1.5 rounded-full ${KIND_DOT[s.kind]}`}
                    />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tagesdetails */}
      <div className="flex-1 mt-3 border-t border-border/50 bg-muted/20">
        <div className="px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">
              {fullWeekday(selectedDay)}, {selectedDay}. Juni
            </p>
            <p className="text-xs text-muted-foreground">
              {selectedShifts.length === 0
                ? "Keine Schichten"
                : `${selectedShifts.length} ${
                    selectedShifts.length === 1 ? "Schicht" : "Schichten"
                  }`}
            </p>
          </div>
          <button className="flex items-center gap-1 text-xs font-medium text-primary border border-primary/30 rounded-md px-2.5 py-1.5">
            <Plus className="h-3.5 w-3.5" />
            Schicht
          </button>
        </div>

        <div className="px-3 pb-4 space-y-2">
          {selectedShifts.length === 0 ? (
            <p className="text-xs text-muted-foreground px-1 py-6 text-center">
              Keine Schichten an diesem Tag — tippen Sie auf „Schicht", um eine
              anzulegen.
            </p>
          ) : (
            selectedShifts.map((s) => (
              <div
                key={s.id}
                className="bg-card rounded-lg border border-border/50 p-3 flex items-center gap-3"
              >
                <span
                  className={`h-9 w-9 shrink-0 rounded-full flex items-center justify-center text-xs font-semibold ${
                    KIND_BADGE[ASSISTANT_COLORS[s.assistant] ?? "active"]
                  }`}
                >
                  {s.assistant
                    .split(" ")
                    .map((p) => p[0])
                    .join("")}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{s.assistant}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.kind === "vacation" || s.kind === "sick"
                      ? "ganztägig"
                      : `${s.from}–${s.to}`}
                  </p>
                </div>
                <span
                  className={`shrink-0 text-[11px] px-2 py-1 rounded border ${KIND_BADGE[s.kind]}`}
                >
                  {KIND_LABELS[s.kind]}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
