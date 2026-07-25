import "./_group.css";
import React, { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Table2,
  CalendarDays,
  Check,
  Download,
  CheckSquare,
  Users,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Person = {
  id: number;
  name: string;
  fill: string;
  text: string;
};

const PEOPLE: Person[] = [
  { id: 0, name: "Anna Schmidt", fill: "#d4f0f0", text: "#0f6b6b" },
  { id: 1, name: "Max Müller", fill: "#ebf18b", text: "#55600a" },
  { id: 2, name: "Lisa Weber", fill: "#cae677", text: "#3f6212" },
  { id: 3, name: "Tom Bauer", fill: "#fed4b1", text: "#9a3412" },
  { id: 4, name: "Sarah Klein", fill: "#e2d4f0", text: "#6b21a8" },
  { id: 5, name: "Jonas Vogt", fill: "#f0d4e2", text: "#9d174d" },
  { id: 6, name: "Mira Lang", fill: "#f5c7a9", text: "#7c2d12" },
];

type ShiftStatus = "fix" | "draft" | "proposal";
type Shift = {
  person: number;
  day: number;
  time: string;
  name: string;
  status: ShiftStatus;
};

const SHIFTS: Shift[] = [
  // Anna – Frühdienst
  { person: 0, day: 1, time: "06–14", name: "Frühdienst", status: "fix" },
  { person: 0, day: 2, time: "06–14", name: "Frühdienst", status: "fix" },
  { person: 0, day: 6, time: "06–14", name: "Frühdienst", status: "fix" },
  { person: 0, day: 8, time: "06–14", name: "Frühdienst", status: "fix" },
  { person: 0, day: 13, time: "06–14", name: "Frühdienst", status: "fix" },
  { person: 0, day: 15, time: "06–14", name: "Frühdienst", status: "draft" },
  { person: 0, day: 20, time: "06–14", name: "Frühdienst", status: "fix" },
  { person: 0, day: 22, time: "06–14", name: "Frühdienst", status: "fix" },
  { person: 0, day: 28, time: "06–14", name: "Frühdienst", status: "proposal" },
  // Max – Spätdienst
  { person: 1, day: 1, time: "14–22", name: "Spätdienst", status: "fix" },
  { person: 1, day: 3, time: "14–22", name: "Spätdienst", status: "fix" },
  { person: 1, day: 7, time: "14–22", name: "Spätdienst", status: "fix" },
  { person: 1, day: 9, time: "14–22", name: "Spätdienst", status: "draft" },
  { person: 1, day: 14, time: "14–22", name: "Spätdienst", status: "fix" },
  { person: 1, day: 16, time: "14–22", name: "Spätdienst", status: "fix" },
  { person: 1, day: 21, time: "14–22", name: "Spätdienst", status: "fix" },
  { person: 1, day: 23, time: "14–22", name: "Spätdienst", status: "fix" },
  { person: 1, day: 29, time: "14–22", name: "Spätdienst", status: "fix" },
  // Lisa – Nachtdienst (Urlaub 27–31)
  { person: 2, day: 2, time: "22–06", name: "Nachtdienst", status: "fix" },
  { person: 2, day: 4, time: "22–06", name: "Nachtdienst", status: "fix" },
  { person: 2, day: 8, time: "22–06", name: "Nachtdienst", status: "fix" },
  { person: 2, day: 10, time: "22–06", name: "Nachtdienst", status: "fix" },
  { person: 2, day: 15, time: "22–06", name: "Nachtdienst", status: "proposal" },
  { person: 2, day: 21, time: "22–06", name: "Nachtdienst", status: "fix" },
  // Tom – Frühdienst (krank 24–26)
  { person: 3, day: 4, time: "06–14", name: "Frühdienst", status: "fix" },
  { person: 3, day: 6, time: "06–14", name: "Frühdienst", status: "fix" },
  { person: 3, day: 11, time: "06–14", name: "Frühdienst", status: "fix" },
  { person: 3, day: 13, time: "06–14", name: "Frühdienst", status: "draft" },
  { person: 3, day: 18, time: "06–14", name: "Frühdienst", status: "fix" },
  { person: 3, day: 20, time: "06–14", name: "Frühdienst", status: "fix" },
  // Sarah – Spätdienst
  { person: 4, day: 5, time: "14–22", name: "Spätdienst", status: "fix" },
  { person: 4, day: 7, time: "14–22", name: "Spätdienst", status: "fix" },
  { person: 4, day: 12, time: "14–22", name: "Spätdienst", status: "fix" },
  { person: 4, day: 14, time: "14–22", name: "Spätdienst", status: "draft" },
  { person: 4, day: 19, time: "14–22", name: "Spätdienst", status: "fix" },
  { person: 4, day: 25, time: "14–22", name: "Spätdienst", status: "fix" },
  { person: 4, day: 30, time: "14–22", name: "Spätdienst", status: "fix" },
  // Jonas – Bereitschaft
  { person: 5, day: 3, time: "18–08", name: "Bereitschaft", status: "fix" },
  { person: 5, day: 10, time: "18–08", name: "Bereitschaft", status: "fix" },
  { person: 5, day: 17, time: "18–08", name: "Bereitschaft", status: "proposal" },
  { person: 5, day: 24, time: "18–08", name: "Bereitschaft", status: "fix" },
  { person: 5, day: 28, time: "18–08", name: "Bereitschaft", status: "fix" },
  // Mira – 24h Dienst
  { person: 6, day: 6, time: "00–24", name: "24h Dienst", status: "fix" },
  { person: 6, day: 12, time: "00–24", name: "24h Dienst", status: "fix" },
  { person: 6, day: 18, time: "00–24", name: "24h Dienst", status: "draft" },
  { person: 6, day: 25, time: "00–24", name: "24h Dienst", status: "fix" },
  { person: 6, day: 30, time: "00–24", name: "24h Dienst", status: "fix" },
];

type Absence = {
  person: number;
  kind: "Urlaub" | "Krankheit";
  from: number;
  to: number;
};

const ABSENCES: Absence[] = [
  { person: 2, kind: "Urlaub", from: 27, to: 31 },
  { person: 3, kind: "Krankheit", from: 24, to: 26 },
];

const DAYS_IN_MONTH = 31;
const TODAY = 25;
const WD = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
// 1. Juli 2026 = Mittwoch => Index 2
const weekdayOf = (day: number) => WD[(day - 1 + 2) % 7];
const isWeekend = (day: number) => {
  const wd = (day - 1 + 2) % 7;
  return wd === 5 || wd === 6;
};

const NAME_COL = 168;
const DAY_COL = 90;

const initials = (name: string) =>
  name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2);

function PersonDot({ p }: { p: Person }) {
  return (
    <span
      className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
      style={{ backgroundColor: p.fill, border: `1px solid ${p.text}` }}
    />
  );
}

export function Cockpit() {
  const [view, setView] = useState<"table" | "month">("month");

  const abwByWeek = [
    {
      label: "KW 30 · 20.–26. Juli",
      items: ABSENCES.filter((a) => a.from <= 26 && a.to >= 20),
    },
    {
      label: "KW 31 · 27. Juli–2. Aug.",
      items: ABSENCES.filter((a) => a.to >= 27),
    },
  ].filter((w) => w.items.length > 0);

  return (
    <div className="dienstplan-mockup min-h-screen flex bg-white">
      {/* ===== Steuerungs-Seitenleiste ===== */}
      <aside
        className="shrink-0 flex flex-col text-white"
        style={{ width: 258, backgroundColor: "#092948" }}
      >
        <div className="flex flex-col gap-5 p-4 overflow-y-auto">
          {/* Titel */}
          <h1 className="font-serif text-2xl font-bold tracking-tight text-white">
            Dienstplan
          </h1>

          {/* Team + Assistenten */}
          <div className="flex flex-col gap-2.5">
            <div>
              <label className="text-[11px] font-medium text-white/60 uppercase tracking-wide">
                Team
              </label>
              <Select defaultValue="std">
                <SelectTrigger className="mt-1 h-9 border-white/20 bg-white/5 text-white text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="std">Standard-Team</SelectItem>
                  <SelectItem value="nacht">Nachtteam</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-white/60 uppercase tracking-wide">
                Assistent:in
              </label>
              <Select defaultValue="all">
                <SelectTrigger className="mt-1 h-9 border-white/20 bg-white/5 text-white text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle Assistenten</SelectItem>
                  {PEOPLE.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-bold"
                          style={{ backgroundColor: p.fill, color: p.text }}
                        >
                          {initials(p.name)}
                        </span>
                        {p.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Monatsnavigation prominent */}
          <div className="rounded-lg bg-white/5 border border-white/10 p-3">
            <div className="flex items-center justify-between">
              <button
                className="flex h-8 w-8 items-center justify-center rounded-md text-white/70 hover:bg-white/10"
                aria-label="Vorheriger Monat"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <div className="text-center leading-tight">
                <div className="font-serif text-lg font-bold text-white">Juli</div>
                <div className="text-xs text-white/60">2026</div>
              </div>
              <button
                className="flex h-8 w-8 items-center justify-center rounded-md text-white/70 hover:bg-white/10"
                aria-label="Nächster Monat"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Ansichts-Umschalter */}
          <div className="flex items-center rounded-md border border-white/15 bg-white/5 p-0.5">
            <button
              onClick={() => setView("table")}
              aria-pressed={view === "table"}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded py-1.5 text-xs font-medium transition-colors ${
                view === "table"
                  ? "text-[#092948]"
                  : "text-white/70 hover:text-white"
              }`}
              style={view === "table" ? { backgroundColor: "#ebf18b" } : undefined}
            >
              <Table2 className="h-4 w-4" /> Tabelle
            </button>
            <button
              onClick={() => setView("month")}
              aria-pressed={view === "month"}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded py-1.5 text-xs font-medium transition-colors ${
                view === "month"
                  ? "text-[#092948]"
                  : "text-white/70 hover:text-white"
              }`}
              style={view === "month" ? { backgroundColor: "#ebf18b" } : undefined}
            >
              <CalendarDays className="h-4 w-4" /> Monat
            </button>
          </div>

          {/* Aktions-Buttons */}
          <div className="flex flex-col gap-2">
            <button
              className="flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm font-semibold text-[#092948]"
              style={{ backgroundColor: "#ebf18b" }}
            >
              <span className="flex items-center gap-2">
                <Check className="h-4 w-4" /> Alle bestätigen
              </span>
              <span
                className="flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-xs font-bold"
                style={{ backgroundColor: "#fff", color: "#092948" }}
              >
                4
              </span>
            </button>
            <button className="flex items-center gap-2 rounded-md border border-white/20 bg-white/5 px-3 py-2 text-sm font-medium text-white hover:bg-white/10">
              <Download className="h-4 w-4" /> Monats-PDF
            </button>
            <button className="flex items-center gap-2 rounded-md border border-white/20 bg-white/5 px-3 py-2 text-sm font-medium text-white hover:bg-white/10">
              <CheckSquare className="h-4 w-4" /> Mehrfachauswahl
            </button>
          </div>

          {/* Team-Abwesenheiten (feste Sektion) */}
          <div className="mt-auto rounded-lg border border-white/10 bg-white/5 p-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-semibold text-white">
                <Users className="h-4 w-4" /> Team-Abwesenheiten
              </span>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-white/80">
                2 Zeiträume
              </span>
            </div>
            <div className="mt-3 flex flex-col gap-3">
              {abwByWeek.map((w) => (
                <div key={w.label}>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-white/40">
                    {w.label}
                  </div>
                  <div className="mt-1 flex flex-col gap-1.5">
                    {w.items.map((a) => {
                      const p = PEOPLE[a.person];
                      return (
                        <div
                          key={`${a.person}-${a.from}`}
                          className="flex items-center gap-2 text-xs"
                        >
                          <PersonDot p={p} />
                          <div className="flex-1 min-w-0">
                            <div className="truncate font-medium text-white">
                              {p.name}
                            </div>
                            <div className="text-white/50">
                              {a.kind} · {a.from}.–{a.to}. Juli
                            </div>
                          </div>
                          <span className="text-white/50">
                            {a.to - a.from + 1} T
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </aside>

      {/* ===== Monats-Tabelle (Held) ===== */}
      <main className="flex-1 min-w-0 overflow-auto p-4">
        <div
          className="inline-grid min-w-full rounded-lg border border-border bg-[#f9f9f9]"
          style={{
            gridTemplateColumns: `${NAME_COL}px repeat(${DAYS_IN_MONTH}, ${DAY_COL}px)`,
            gridAutoRows: "minmax(64px, auto)",
          }}
        >
          {/* Heutige Spalte Hintergrund */}
          <div
            className="bg-primary/10"
            style={{ gridColumn: `${TODAY + 1} / ${TODAY + 2}`, gridRow: `1 / -1` }}
          />

          {/* Kopfzeile */}
          <div
            className="sticky left-0 z-20 flex items-center bg-[#092948] px-3 text-xs font-semibold text-white"
            style={{ gridColumn: "1 / 2", gridRow: "1 / 2" }}
          >
            Assistent:in
          </div>
          {Array.from({ length: DAYS_IN_MONTH }, (_, i) => i + 1).map((day) => {
            const today = day === TODAY;
            return (
              <div
                key={`h-${day}`}
                className={`flex flex-col items-center justify-center border-l border-border/60 py-1.5 ${
                  isWeekend(day) ? "bg-black/[0.03]" : ""
                }`}
                style={{ gridColumn: `${day + 1} / ${day + 2}`, gridRow: "1 / 2" }}
              >
                <span className="text-[10px] font-medium uppercase text-muted-foreground">
                  {weekdayOf(day)}
                </span>
                <span
                  className={`mt-0.5 flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                    today ? "text-[#092948]" : "text-foreground"
                  }`}
                  style={today ? { backgroundColor: "#ebf18b" } : undefined}
                >
                  {day}
                </span>
              </div>
            );
          })}

          {/* Assistenten-Zeilen */}
          {PEOPLE.map((p, rowIdx) => {
            const row = rowIdx + 2;
            return (
              <React.Fragment key={p.id}>
                <div
                  className="sticky left-0 z-10 flex items-center gap-2 border-t border-border bg-[#f9f9f9] px-3 text-sm font-medium"
                  style={{ gridColumn: "1 / 2", gridRow: `${row} / ${row + 1}` }}
                >
                  <PersonDot p={p} />
                  <span className="truncate">{p.name}</span>
                </div>
                {Array.from({ length: DAYS_IN_MONTH }, (_, i) => i + 1).map(
                  (day) => {
                    const cellShifts = SHIFTS.filter(
                      (s) => s.person === p.id && s.day === day,
                    );
                    return (
                      <div
                        key={`${p.id}-${day}`}
                        className={`flex flex-col gap-1 border-l border-t border-border/50 p-1 ${
                          isWeekend(day) ? "bg-black/[0.015]" : ""
                        }`}
                        style={{
                          gridColumn: `${day + 1} / ${day + 2}`,
                          gridRow: `${row} / ${row + 1}`,
                        }}
                      >
                        {cellShifts.map((s, i) => (
                          <div
                            key={i}
                            className={`rounded px-1 py-0.5 text-center leading-tight ${
                              s.status === "draft"
                                ? "border border-dashed opacity-60"
                                : s.status === "proposal"
                                  ? "border border-solid"
                                  : ""
                            }`}
                            style={{
                              backgroundColor: p.fill,
                              color: p.text,
                              borderColor:
                                s.status === "fix" ? "transparent" : p.text,
                            }}
                          >
                            <div className="text-[10px] font-bold">{s.time}</div>
                            <div className="text-[9px] font-medium">{s.name}</div>
                          </div>
                        ))}
                      </div>
                    );
                  },
                )}
              </React.Fragment>
            );
          })}

          {/* Abwesenheits-Balken (Overlay) */}
          {ABSENCES.map((a) => {
            const row = a.person + 2;
            const isUrlaub = a.kind === "Urlaub";
            return (
              <div
                key={`abs-${a.person}`}
                className="z-30 m-1 flex items-center justify-center rounded text-[10px] font-semibold"
                style={{
                  gridColumn: `${a.from + 1} / ${a.to + 2}`,
                  gridRow: `${row} / ${row + 1}`,
                  backgroundColor: isUrlaub ? "#fde68a" : "#e2e8f0",
                  border: isUrlaub ? "1px solid #d97706" : "1px solid #94a3b8",
                  color: isUrlaub ? "#78350f" : "#334155",
                }}
              >
                {a.kind} · {a.from}.–{a.to}. Juli
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
