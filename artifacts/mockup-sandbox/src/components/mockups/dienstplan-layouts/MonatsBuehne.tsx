import "./_group.css";
import { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Table2,
  CalendarDays,
  Check,
  Download,
  CheckSquare,
  Users,
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

type Assistant = {
  id: number;
  name: string;
  initials: string;
  bg: string;
  fg: string;
};

const ASSISTANTS: Assistant[] = [
  { id: 0, name: "Anna Schmidt", initials: "AS", bg: "#d4f0f0", fg: "#0f6b6b" },
  { id: 1, name: "Max Müller", initials: "MM", bg: "#ebf18b", fg: "#55600a" },
  { id: 2, name: "Lisa Weber", initials: "LW", bg: "#cae677", fg: "#3f6212" },
  { id: 3, name: "Tom Bauer", initials: "TB", bg: "#fed4b1", fg: "#9a3412" },
  { id: 4, name: "Sarah Klein", initials: "SK", bg: "#e2d4f0", fg: "#6b21a8" },
  { id: 5, name: "Jonas Vogt", initials: "JV", bg: "#f0d4e2", fg: "#9d174d" },
  { id: 6, name: "Mira Lang", initials: "ML", bg: "#f5c7a9", fg: "#7c2d12" },
];

type ShiftStatus = "fix" | "draft" | "proposal";
type Shift = { a: number; d: number; t: string; n: string; s: ShiftStatus };

const SHIFTS: Shift[] = [
  { a: 0, d: 1, t: "06–14", n: "Frühdienst", s: "fix" },
  { a: 0, d: 2, t: "06–14", n: "Frühdienst", s: "fix" },
  { a: 0, d: 6, t: "06–14", n: "Frühdienst", s: "fix" },
  { a: 0, d: 8, t: "06–14", n: "Frühdienst", s: "draft" },
  { a: 0, d: 13, t: "14–22", n: "Spätdienst", s: "fix" },
  { a: 0, d: 15, t: "06–14", n: "Frühdienst", s: "fix" },
  { a: 0, d: 20, t: "06–14", n: "Frühdienst", s: "fix" },
  { a: 0, d: 22, t: "06–14", n: "Frühdienst", s: "proposal" },
  { a: 0, d: 28, t: "14–22", n: "Spätdienst", s: "fix" },
  { a: 0, d: 30, t: "06–14", n: "Frühdienst", s: "fix" },

  { a: 1, d: 1, t: "14–22", n: "Spätdienst", s: "fix" },
  { a: 1, d: 3, t: "14–22", n: "Spätdienst", s: "fix" },
  { a: 1, d: 7, t: "06–14", n: "Frühdienst", s: "fix" },
  { a: 1, d: 9, t: "14–22", n: "Spätdienst", s: "draft" },
  { a: 1, d: 14, t: "14–22", n: "Spätdienst", s: "fix" },
  { a: 1, d: 16, t: "14–22", n: "Spätdienst", s: "fix" },
  { a: 1, d: 21, t: "14–22", n: "Spätdienst", s: "fix" },
  { a: 1, d: 23, t: "22–06", n: "Nachtdienst", s: "fix" },
  { a: 1, d: 29, t: "14–22", n: "Spätdienst", s: "proposal" },
  { a: 1, d: 31, t: "14–22", n: "Spätdienst", s: "fix" },

  { a: 2, d: 2, t: "22–06", n: "Nachtdienst", s: "fix" },
  { a: 2, d: 4, t: "22–06", n: "Nachtdienst", s: "fix" },
  { a: 2, d: 10, t: "22–06", n: "Nachtdienst", s: "draft" },
  { a: 2, d: 12, t: "22–06", n: "Nachtdienst", s: "proposal" },
  { a: 2, d: 17, t: "22–06", n: "Nachtdienst", s: "fix" },
  { a: 2, d: 19, t: "22–06", n: "Nachtdienst", s: "fix" },
  { a: 2, d: 24, t: "22–06", n: "Nachtdienst", s: "fix" },

  { a: 3, d: 5, t: "06–14", n: "Frühdienst", s: "fix" },
  { a: 3, d: 6, t: "14–22", n: "Spätdienst", s: "fix" },
  { a: 3, d: 11, t: "24h", n: "24h Dienst", s: "fix" },
  { a: 3, d: 18, t: "24h", n: "24h Dienst", s: "fix" },
  { a: 3, d: 22, t: "Bereitsch.", n: "Bereitschaft", s: "draft" },

  { a: 4, d: 3, t: "06–14", n: "Frühdienst", s: "fix" },
  { a: 4, d: 7, t: "14–22", n: "Spätdienst", s: "fix" },
  { a: 4, d: 10, t: "06–14", n: "Frühdienst", s: "fix" },
  { a: 4, d: 15, t: "14–22", n: "Spätdienst", s: "draft" },
  { a: 4, d: 20, t: "22–06", n: "Nachtdienst", s: "fix" },
  { a: 4, d: 25, t: "06–14", n: "Frühdienst", s: "fix" },
  { a: 4, d: 27, t: "06–14", n: "Frühdienst", s: "fix" },

  { a: 5, d: 4, t: "14–22", n: "Spätdienst", s: "fix" },
  { a: 5, d: 8, t: "22–06", n: "Nachtdienst", s: "fix" },
  { a: 5, d: 13, t: "22–06", n: "Nachtdienst", s: "fix" },
  { a: 5, d: 16, t: "06–14", n: "Frühdienst", s: "proposal" },
  { a: 5, d: 22, t: "22–06", n: "Nachtdienst", s: "fix" },
  { a: 5, d: 26, t: "Bereitsch.", n: "Bereitschaft", s: "fix" },
  { a: 5, d: 30, t: "22–06", n: "Nachtdienst", s: "fix" },

  { a: 6, d: 5, t: "22–06", n: "Nachtdienst", s: "fix" },
  { a: 6, d: 9, t: "06–14", n: "Frühdienst", s: "fix" },
  { a: 6, d: 12, t: "06–14", n: "Frühdienst", s: "fix" },
  { a: 6, d: 18, t: "14–22", n: "Spätdienst", s: "draft" },
  { a: 6, d: 23, t: "06–14", n: "Frühdienst", s: "fix" },
  { a: 6, d: 25, t: "14–22", n: "Spätdienst", s: "fix" },
  { a: 6, d: 29, t: "06–14", n: "Frühdienst", s: "fix" },
  { a: 6, d: 31, t: "22–06", n: "Nachtdienst", s: "fix" },
];

type Absence = {
  a: number;
  from: number;
  to: number;
  kind: "urlaub" | "krank";
  label: string;
};

const ABSENCES: Absence[] = [
  { a: 2, from: 27, to: 31, kind: "urlaub", label: "Urlaub" },
  { a: 3, from: 24, to: 26, kind: "krank", label: "Krank" },
];

const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
// 1. Juli 2026 = Mittwoch → Index 2
function weekdayOf(day: number): string {
  return WEEKDAYS[(day + 1) % 7];
}
function isWeekend(day: number): boolean {
  const wd = (day + 1) % 7;
  return wd === 5 || wd === 6;
}

const TODAY = 25;
const DAY_COL_W = 34;

export function MonatsBuehne() {
  const [absOpen, setAbsOpen] = useState(true);

  const shiftMap = new Map<string, Shift>();
  for (const s of SHIFTS) shiftMap.set(`${s.a}-${s.d}`, s);

  const absenceForCell = (a: number, d: number) =>
    ABSENCES.find((x) => x.a === a && d >= x.from && d <= x.to);

  return (
    <div className="dienstplan-mockup min-h-screen w-full bg-background px-8 py-6">
      <div className="mx-auto max-w-[1200px]">
        {/* Titel-Zeile */}
        <div className="flex items-center justify-between">
          <h1 className="font-serif text-lg font-bold text-foreground">
            Dienstplan
          </h1>
        </div>

        {/* Zentrierte Monatsbühne */}
        <div className="mt-3 flex items-center justify-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 text-muted-foreground"
            aria-label="Vorheriger Monat"
          >
            <ChevronLeft className="h-6 w-6" />
          </Button>
          <h2 className="font-serif text-[28px] font-bold leading-none text-foreground min-w-[220px] text-center">
            Juli 2026
          </h2>
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 text-muted-foreground"
            aria-label="Nächster Monat"
          >
            <ChevronRight className="h-6 w-6" />
          </Button>
        </div>

        {/* Werkzeugzeile: zwei Gruppen */}
        <div className="mt-4 flex items-center justify-between gap-4">
          {/* Links: Kontext */}
          <div className="flex items-center gap-2">
            <Select defaultValue="standard">
              <SelectTrigger className="h-9 w-[160px] text-sm">
                <SelectValue placeholder="Team" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">Standard-Team</SelectItem>
                <SelectItem value="nacht">Nachtteam</SelectItem>
              </SelectContent>
            </Select>

            <Select defaultValue="all">
              <SelectTrigger className="h-9 w-[190px] text-sm">
                <SelectValue placeholder="Alle Assistenten" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Assistenten</SelectItem>
                {ASSISTANTS.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    <span className="flex items-center gap-2">
                      <span
                        className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold"
                        style={{ backgroundColor: a.bg, color: a.fg }}
                      >
                        {a.initials}
                      </span>
                      {a.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Ansichts-Umschalter */}
            <div className="flex items-center rounded-md border border-input p-0.5">
              <button
                className="flex h-8 items-center gap-1.5 rounded px-3 text-xs font-medium"
                style={{ backgroundColor: "#ebf18b", color: "#05305b" }}
                aria-pressed="true"
              >
                <CalendarDays className="h-4 w-4" />
                Monat
              </button>
              <button className="flex h-8 items-center gap-1.5 rounded px-3 text-xs font-medium text-muted-foreground hover:text-foreground">
                <Table2 className="h-4 w-4" />
                Tabelle
              </button>
            </div>
          </div>

          {/* Rechts: Aktionen */}
          <div className="flex items-center gap-2">
            <Button
              className="h-9 gap-2 font-semibold"
              style={{ backgroundColor: "#ebf18b", color: "#05305b" }}
            >
              <Check className="h-4 w-4" />
              Alle bestätigen
              <span
                className="flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-[11px] font-bold"
                style={{ backgroundColor: "#fff", color: "#05305b" }}
              >
                4
              </span>
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9"
              aria-label="Monats-PDF"
              title="Monats-PDF"
            >
              <Download className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9"
              aria-label="Mehrfachauswahl"
              title="Mehrfachauswahl"
            >
              <CheckSquare className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Kennzahlen-Zeile */}
        <div className="mt-4 flex items-center gap-2">
          <span className="rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-foreground">
            53 Dienste
          </span>
          <span className="rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-foreground">
            4 Entwürfe offen
          </span>
          <span className="rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-foreground">
            2 Abwesenheiten
          </span>
        </div>

        {/* Tabelle */}
        <div className="mt-4 overflow-x-auto rounded-lg border border-border bg-card">
          <table className="border-collapse" style={{ minWidth: 160 + 31 * DAY_COL_W }}>
            <thead>
              <tr>
                <th className="sticky left-0 z-10 w-[160px] min-w-[160px] border-b border-r border-border bg-card px-3 py-2 text-left text-xs font-semibold text-muted-foreground">
                  Assistent
                </th>
                {DAYS.map((d) => {
                  const today = d === TODAY;
                  const weekend = isWeekend(d);
                  return (
                    <th
                      key={d}
                      className="border-b border-border px-0 py-1.5 text-center"
                      style={{
                        width: DAY_COL_W,
                        minWidth: DAY_COL_W,
                        backgroundColor: today
                          ? "rgba(235,241,139,0.35)"
                          : weekend
                            ? "rgba(0,0,0,0.03)"
                            : undefined,
                      }}
                    >
                      <div className="text-[9px] font-medium uppercase text-muted-foreground">
                        {weekdayOf(d)}
                      </div>
                      <div className="mt-0.5 flex justify-center">
                        <span
                          className="flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold text-foreground"
                          style={
                            today
                              ? { backgroundColor: "#ebf18b" }
                              : undefined
                          }
                        >
                          {d}
                        </span>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {ASSISTANTS.map((asst) => (
                <tr key={asst.id}>
                  <td className="sticky left-0 z-10 w-[160px] min-w-[160px] border-b border-r border-border bg-card px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: asst.bg }}
                      />
                      <span className="truncate text-xs font-medium text-foreground">
                        {asst.name}
                      </span>
                    </div>
                  </td>
                  {DAYS.map((d) => {
                    const today = d === TODAY;
                    const weekend = isWeekend(d);
                    const absence = absenceForCell(asst.id, d);
                    const shift = shiftMap.get(`${asst.id}-${d}`);
                    const cellBg = today
                      ? "rgba(235,241,139,0.14)"
                      : weekend
                        ? "rgba(0,0,0,0.02)"
                        : undefined;
                    return (
                      <td
                        key={d}
                        className="border-b border-border/60 p-0.5 align-top"
                        style={{
                          width: DAY_COL_W,
                          minWidth: DAY_COL_W,
                          height: 52,
                          backgroundColor: cellBg,
                        }}
                      >
                        {absence ? (
                          <div
                            className="flex h-full items-center justify-center text-[8px] font-semibold"
                            style={{
                              backgroundColor:
                                absence.kind === "urlaub"
                                  ? "#fde68a"
                                  : "#e2e8f0",
                              color:
                                absence.kind === "urlaub"
                                  ? "#92400e"
                                  : "#334155",
                              borderTop:
                                absence.kind === "urlaub"
                                  ? "1px solid #d97706"
                                  : "1px solid #94a3b8",
                              borderBottom:
                                absence.kind === "urlaub"
                                  ? "1px solid #d97706"
                                  : "1px solid #94a3b8",
                              borderLeft:
                                d === absence.from
                                  ? absence.kind === "urlaub"
                                    ? "1px solid #d97706"
                                    : "1px solid #94a3b8"
                                  : undefined,
                              borderRight:
                                d === absence.to
                                  ? absence.kind === "urlaub"
                                    ? "1px solid #d97706"
                                    : "1px solid #94a3b8"
                                  : undefined,
                              borderTopLeftRadius: d === absence.from ? 4 : 0,
                              borderBottomLeftRadius: d === absence.from ? 4 : 0,
                              borderTopRightRadius: d === absence.to ? 4 : 0,
                              borderBottomRightRadius: d === absence.to ? 4 : 0,
                            }}
                          >
                            {d === absence.from ? absence.label : ""}
                          </div>
                        ) : shift ? (
                          <div
                            className="flex h-full flex-col justify-center rounded px-1 py-0.5 text-center leading-tight"
                            style={{
                              backgroundColor: asst.bg,
                              color: asst.fg,
                              opacity: shift.s === "draft" ? 0.6 : 1,
                              border:
                                shift.s === "draft"
                                  ? `1px dashed ${asst.fg}`
                                  : shift.s === "proposal"
                                    ? `1px solid ${asst.fg}`
                                    : "1px solid transparent",
                            }}
                            title={`${shift.t} ${shift.n}`}
                          >
                            <span className="text-[9px] font-bold">
                              {shift.t}
                            </span>
                          </div>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Team-Abwesenheiten Karte */}
        <div className="mt-4 rounded-lg border border-border bg-card">
          <button
            onClick={() => setAbsOpen((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-3"
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Users className="h-4 w-4" />
              Team-Abwesenheiten
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                2 Zeiträume
              </span>
            </span>
            <ChevronDown
              className={`h-4 w-4 text-muted-foreground transition-transform ${absOpen ? "rotate-180" : ""}`}
            />
          </button>
          {absOpen && (
            <div className="border-t border-border px-4 py-3 space-y-4">
              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase text-muted-foreground">
                  KW 30 · 20.–26. Juli
                </div>
                <div className="flex items-center gap-3 rounded-md bg-background px-3 py-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: ASSISTANTS[3].bg }}
                  />
                  <span className="w-32 text-sm font-medium text-foreground">
                    Tom Bauer
                  </span>
                  <span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">
                    Krankheit
                  </span>
                  <span className="text-sm text-muted-foreground">
                    24.–26. Juli 2026
                  </span>
                  <span className="ml-auto text-xs font-medium text-muted-foreground">
                    3 Tage
                  </span>
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase text-muted-foreground">
                  KW 31 · 27. Juli–2. Aug.
                </div>
                <div className="flex items-center gap-3 rounded-md bg-background px-3 py-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: ASSISTANTS[2].bg }}
                  />
                  <span className="w-32 text-sm font-medium text-foreground">
                    Lisa Weber
                  </span>
                  <span className="rounded bg-amber-200 px-2 py-0.5 text-xs font-medium text-amber-800">
                    Urlaub
                  </span>
                  <span className="text-sm text-muted-foreground">
                    27.–31. Juli 2026
                  </span>
                  <span className="ml-auto text-xs font-medium text-muted-foreground">
                    5 Tage
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
