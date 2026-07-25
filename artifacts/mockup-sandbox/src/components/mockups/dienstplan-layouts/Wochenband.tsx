import "./_group.css";
import { useState } from "react";
import {
  Table2,
  CalendarDays,
  Download,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Users,
  Check,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
  initials: string;
  area: string;
  text: string;
};

const ASSISTANTS: Person[] = [
  { id: 0, name: "Anna Schmidt", initials: "AS", area: "#d4f0f0", text: "#0f6b6b" },
  { id: 1, name: "Max Müller", initials: "MM", area: "#ebf18b", text: "#55600a" },
  { id: 2, name: "Lisa Weber", initials: "LW", area: "#cae677", text: "#3f6212" },
  { id: 3, name: "Tom Bauer", initials: "TB", area: "#fed4b1", text: "#9a3412" },
  { id: 4, name: "Sarah Klein", initials: "SK", area: "#e2d4f0", text: "#6b21a8" },
  { id: 5, name: "Jonas Vogt", initials: "JV", area: "#f0d4e2", text: "#9d174d" },
  { id: 6, name: "Mira Lang", initials: "ML", area: "#f5c7a9", text: "#7c2d12" },
];

const SERVICES: Record<string, { time: string; name: string }> = {
  F: { time: "06–14", name: "Frühdienst" },
  S: { time: "14–22", name: "Spätdienst" },
  N: { time: "22–06", name: "Nachtdienst" },
  B: { time: "", name: "Bereitschaft" },
  D24: { time: "24h", name: "24h Dienst" },
};

type Status = "fix" | "draft" | "proposal";
type Shift = { day: number; a: number; svc: string; status: Status };

const SHIFTS: Shift[] = [
  { day: 1, a: 0, svc: "F", status: "fix" },
  { day: 1, a: 5, svc: "S", status: "fix" },
  { day: 1, a: 6, svc: "N", status: "fix" },
  { day: 2, a: 1, svc: "F", status: "fix" },
  { day: 2, a: 4, svc: "S", status: "fix" },
  { day: 3, a: 2, svc: "F", status: "fix" },
  { day: 3, a: 3, svc: "S", status: "fix" },
  { day: 3, a: 6, svc: "B", status: "fix" },
  { day: 4, a: 0, svc: "S", status: "fix" },
  { day: 4, a: 5, svc: "D24", status: "fix" },
  { day: 5, a: 6, svc: "F", status: "fix" },
  { day: 6, a: 0, svc: "F", status: "draft" },
  { day: 6, a: 1, svc: "S", status: "fix" },
  { day: 6, a: 4, svc: "N", status: "fix" },
  { day: 7, a: 2, svc: "F", status: "fix" },
  { day: 7, a: 5, svc: "S", status: "fix" },
  { day: 8, a: 3, svc: "F", status: "fix" },
  { day: 8, a: 6, svc: "S", status: "fix" },
  { day: 9, a: 4, svc: "F", status: "fix" },
  { day: 9, a: 0, svc: "N", status: "fix" },
  { day: 10, a: 1, svc: "F", status: "fix" },
  { day: 10, a: 5, svc: "S", status: "proposal" },
  { day: 11, a: 2, svc: "D24", status: "fix" },
  { day: 12, a: 6, svc: "F", status: "fix" },
  { day: 12, a: 3, svc: "S", status: "fix" },
  { day: 13, a: 0, svc: "F", status: "fix" },
  { day: 13, a: 4, svc: "S", status: "fix" },
  { day: 13, a: 5, svc: "N", status: "fix" },
  { day: 14, a: 1, svc: "F", status: "fix" },
  { day: 14, a: 2, svc: "S", status: "fix" },
  { day: 15, a: 3, svc: "F", status: "draft" },
  { day: 15, a: 6, svc: "S", status: "fix" },
  { day: 16, a: 4, svc: "F", status: "fix" },
  { day: 16, a: 0, svc: "S", status: "fix" },
  { day: 17, a: 5, svc: "F", status: "fix" },
  { day: 17, a: 1, svc: "N", status: "fix" },
  { day: 18, a: 2, svc: "F", status: "fix" },
  { day: 18, a: 6, svc: "B", status: "fix" },
  { day: 19, a: 0, svc: "D24", status: "fix" },
  { day: 20, a: 1, svc: "F", status: "fix" },
  { day: 20, a: 4, svc: "S", status: "fix" },
  { day: 20, a: 5, svc: "N", status: "fix" },
  { day: 21, a: 2, svc: "F", status: "fix" },
  { day: 21, a: 3, svc: "S", status: "fix" },
  { day: 22, a: 6, svc: "F", status: "fix" },
  { day: 22, a: 0, svc: "S", status: "fix" },
  { day: 23, a: 4, svc: "F", status: "proposal" },
  { day: 23, a: 5, svc: "S", status: "fix" },
  { day: 24, a: 1, svc: "F", status: "fix" },
  { day: 24, a: 6, svc: "N", status: "fix" },
  { day: 25, a: 0, svc: "F", status: "fix" },
  { day: 25, a: 4, svc: "S", status: "fix" },
  { day: 25, a: 5, svc: "N", status: "fix" },
  { day: 25, a: 2, svc: "F", status: "fix" },
  { day: 26, a: 1, svc: "S", status: "fix" },
  { day: 26, a: 6, svc: "F", status: "fix" },
  { day: 27, a: 0, svc: "F", status: "fix" },
  { day: 27, a: 5, svc: "S", status: "fix" },
  { day: 28, a: 1, svc: "F", status: "fix" },
  { day: 28, a: 4, svc: "S", status: "fix" },
  { day: 29, a: 6, svc: "F", status: "fix" },
  { day: 29, a: 3, svc: "S", status: "fix" },
  { day: 30, a: 0, svc: "S", status: "fix" },
  { day: 30, a: 5, svc: "F", status: "draft" },
  { day: 31, a: 4, svc: "F", status: "fix" },
  { day: 31, a: 1, svc: "N", status: "fix" },
];

type Absence = {
  a: number;
  kind: "urlaub" | "krank";
  from: number;
  to: number;
  label: string;
};

const ABSENCES: Absence[] = [
  { a: 3, kind: "krank", from: 24, to: 26, label: "Krank" },
  { a: 2, kind: "urlaub", from: 27, to: 31, label: "Urlaub" },
];

const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const TODAY = 25;
const GRID = "84px repeat(7, minmax(0, 1fr))";

type Week = { label: string; kw: string; days: number[] };
const WEEKS: Week[] = [
  { label: "29. Juni – 5. Juli", kw: "KW 27", days: [1, 2, 3, 4, 5] },
  { label: "6. – 12. Juli", kw: "KW 28", days: [6, 7, 8, 9, 10, 11, 12] },
  { label: "13. – 19. Juli", kw: "KW 29", days: [13, 14, 15, 16, 17, 18, 19] },
  { label: "20. – 26. Juli", kw: "KW 30", days: [20, 21, 22, 23, 24, 25, 26] },
  { label: "27. – 31. Juli", kw: "KW 31", days: [27, 28, 29, 30, 31] },
];

function weekday(day: number): string {
  return WD[new Date(2026, 6, day).getDay()];
}

function findAbsence(day: number, a: number): Absence | undefined {
  return ABSENCES.find((x) => x.a === a && day >= x.from && day <= x.to);
}

function ShiftBadge({ shift }: { shift: Shift }) {
  const p = ASSISTANTS[shift.a];
  const svc = SERVICES[shift.svc];
  const draft = shift.status === "draft";
  return (
    <div
      className="rounded-md px-1.5 py-1 text-[11px] leading-tight"
      style={{
        backgroundColor: p.area,
        color: p.text,
        opacity: draft ? 0.6 : 1,
        border: draft
          ? `1px dashed ${p.text}`
          : shift.status === "proposal"
            ? `1px solid ${p.text}`
            : "1px solid transparent",
      }}
    >
      {svc.time && <span className="font-semibold">{svc.time} </span>}
      <span>{svc.name}</span>
    </div>
  );
}

function DayCell({ day, a }: { day: number; a: number }) {
  const absence = findAbsence(day, a);
  if (absence) {
    const isFirst = day === absence.from;
    const isLast = day === absence.to;
    const isUrlaub = absence.kind === "urlaub";
    return (
      <div
        className="flex items-center justify-center text-[11px] font-semibold"
        style={{
          backgroundColor: isUrlaub ? "#fde68a" : "#e2e8f0",
          color: isUrlaub ? "#92400e" : "#334155",
          borderTop: isUrlaub ? "1px solid #d97706" : "1px solid #94a3b8",
          borderBottom: isUrlaub ? "1px solid #d97706" : "1px solid #94a3b8",
          borderLeft: isUrlaub ? "1px solid #d97706" : "1px solid #94a3b8",
          borderRight: isUrlaub ? "1px solid #d97706" : "1px solid #94a3b8",
          borderTopWidth: isFirst ? 1 : 0,
          borderBottomWidth: isLast ? 1 : 0,
          borderRadius: `${isFirst ? 6 : 0}px ${isFirst ? 6 : 0}px ${isLast ? 6 : 0}px ${isLast ? 6 : 0}px`,
          minHeight: 34,
        }}
      >
        {isFirst ? absence.label : ""}
      </div>
    );
  }
  const shifts = SHIFTS.filter((s) => s.day === day && s.a === a);
  if (shifts.length === 0) return <div className="min-h-[34px]" />;
  return (
    <div className="flex flex-col gap-1">
      {shifts.map((s, i) => (
        <ShiftBadge key={i} shift={s} />
      ))}
    </div>
  );
}

export function Wochenband() {
  const [absOpen, setAbsOpen] = useState(true);

  return (
    <div className="dienstplan-mockup flex min-h-screen flex-col bg-white">
      {/* Kompakte Kopfleiste */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#e5e5e5] px-4 py-2.5">
        <h1 className="font-serif text-lg font-bold text-[#05305b]">Dienstplan</h1>

        <Select defaultValue="standard">
          <SelectTrigger className="h-8 w-[150px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="standard">Standard-Team</SelectItem>
            <SelectItem value="nacht">Nachtteam</SelectItem>
          </SelectContent>
        </Select>

        <Select defaultValue="alle">
          <SelectTrigger className="h-8 w-[170px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="alle">Alle Assistenten</SelectItem>
            {ASSISTANTS.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>
                <span className="flex items-center gap-2">
                  <span
                    className="flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-bold"
                    style={{ backgroundColor: p.area, color: p.text }}
                  >
                    {p.initials}
                  </span>
                  {p.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Ansichts-Umschalter */}
        <div className="flex items-center rounded-md border border-[#e5e5e5] p-0.5">
          <button className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100">
            <Table2 className="h-3.5 w-3.5" /> Tabelle
          </button>
          <button
            className="flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold text-[#05305b]"
            style={{ backgroundColor: "#ebf18b" }}
          >
            <CalendarDays className="h-3.5 w-3.5" /> Monat
          </button>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            className="h-8 gap-1.5 bg-[#05305b] text-xs text-white hover:bg-[#092948]"
          >
            <Check className="h-3.5 w-3.5" />
            Alle bestätigen
            <span
              className="ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold text-[#05305b]"
              style={{ backgroundColor: "#ebf18b" }}
            >
              4
            </span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            aria-label="Monats-PDF"
          >
            <Download className="h-3.5 w-3.5" /> Monats-PDF
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="h-8 w-8"
            aria-label="Mehrfachauswahl"
          >
            <CheckSquare className="h-4 w-4" />
          </Button>

          {/* Monatsnavigation */}
          <div className="flex items-center gap-1 pl-1">
            <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Vorheriger Monat">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[92px] text-center text-sm font-semibold text-[#05305b]">
              Juli 2026
            </span>
            <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Nächster Monat">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Team-Abwesenheiten als schmale Info-Zeile mit Chips */}
      <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-[#e5e5e5] bg-[#f9f9f9] px-4 py-2">
        <button
          onClick={() => setAbsOpen((v) => !v)}
          className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-[#05305b]"
        >
          <Users className="h-3.5 w-3.5" />
          Team-Abwesenheiten
          <span className="rounded-full bg-[#ebf18b] px-1.5 py-0.5 text-[10px] font-bold">
            2 Zeiträume
          </span>
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${absOpen ? "" : "-rotate-90"}`}
          />
        </button>
        {absOpen &&
          ABSENCES.map((abs, i) => {
            const p = ASSISTANTS[abs.a];
            const isUrlaub = abs.kind === "urlaub";
            const tage = abs.to - abs.from + 1;
            return (
              <div
                key={i}
                className="flex shrink-0 items-center gap-2 rounded-full border px-3 py-1 text-xs"
                style={{
                  backgroundColor: isUrlaub ? "#fef3c7" : "#f1f5f9",
                  borderColor: isUrlaub ? "#d97706" : "#94a3b8",
                }}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: p.text }}
                />
                <span className="font-semibold text-slate-700">{p.name}</span>
                <span className="text-slate-500">{abs.label}</span>
                <span className="text-slate-500">
                  {abs.from}.–{abs.to}.7.
                </span>
                <span className="font-medium text-slate-600">{tage} Tage</span>
              </div>
            );
          })}
      </div>

      {/* Transponierte Tabelle: Zeilen = Tage, Spalten = Assistenzkräfte */}
      <div className="flex-1 overflow-auto">
        {/* Sticky Assistenten-Kopf */}
        <div
          className="sticky top-0 z-20 grid border-b border-[#e5e5e5] bg-white"
          style={{ gridTemplateColumns: GRID }}
        >
          <div className="px-2 py-2 text-[11px] font-semibold text-slate-400">
            Tag
          </div>
          {ASSISTANTS.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-1.5 border-l border-[#eee] px-2 py-2"
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: p.text }}
              />
              <span className="truncate text-xs font-semibold text-slate-700">
                {p.name}
              </span>
            </div>
          ))}
        </div>

        {WEEKS.map((week) => (
          <div key={week.kw}>
            {/* Sticky Wochenüberschrift */}
            <div
              className="sticky top-[41px] z-10 flex items-center gap-2 border-y border-[#e5e5e5] bg-[#f4f6df] px-3 py-1.5"
            >
              <span className="text-xs font-bold text-[#05305b]">
                Woche {week.label}
              </span>
              <span className="rounded bg-white/70 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                {week.kw}
              </span>
            </div>

            {week.days.map((day) => {
              const isToday = day === TODAY;
              return (
                <div
                  key={day}
                  className="grid border-b border-[#f0f0f0]"
                  style={{
                    gridTemplateColumns: GRID,
                    backgroundColor: isToday ? "rgba(235,241,139,0.10)" : "white",
                  }}
                >
                  {/* Tages-Label */}
                  <div className="flex items-center gap-1.5 px-2 py-1.5">
                    <span className="text-[10px] font-medium uppercase text-slate-400">
                      {weekday(day)}
                    </span>
                    <span
                      className={
                        isToday
                          ? "flex h-6 w-6 items-center justify-center rounded-full text-sm font-bold text-[#05305b]"
                          : "flex h-6 w-6 items-center justify-center text-sm font-semibold text-slate-600"
                      }
                      style={isToday ? { backgroundColor: "#ebf18b" } : undefined}
                    >
                      {day}
                    </span>
                  </div>
                  {ASSISTANTS.map((p) => (
                    <div
                      key={p.id}
                      className="border-l border-[#f0f0f0] p-1"
                    >
                      <DayCell day={day} a={p.id} />
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
