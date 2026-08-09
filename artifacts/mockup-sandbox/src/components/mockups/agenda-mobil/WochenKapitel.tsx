import { Plus } from "lucide-react";

/**
 * Variante A — „Wochen-Kapitel"
 *
 * Mobile Listenansicht des Dienstplans (Dezember 2026, wie im Nutzer-Screenshot):
 * - Tage sind unter kompakten Wochen-Überschriften (KW + Datumsbereich) gruppiert;
 *   jede Woche ist ein eigener Kartenblock mit Luft dazwischen.
 * - Leere Tage sind EINZEILIG: Hinweis „tippen zum Schicht hinzufügen" steht
 *   dezent neben dem Tag.
 * - Wochenende: getönte Zeile + fetterer Wochentag (nicht nur Farbe).
 * - Heute: Hellgelb (App-Primary) mit dunkelblauem Text, wie im echten Kalender.
 *
 * Farbwerte entsprechen den echten App-Token: primary #ebf18b,
 * primary-foreground hsl(210 90% 19%), muted hsl(0 0% 96%),
 * muted-foreground hsl(210 15% 40%), border hsl(0 0% 90%),
 * Personenfarben aus der barrierefreien Assistenz-Palette.
 */

const BRAND = "hsl(210 90% 19%)"; // Dunkelblau (primary-foreground)
const MUTED_FG = "hsl(210 15% 40%)";
const BORDER = "hsl(0 0% 90%)";
const PRIMARY = "#ebf18b"; // Hellgelb
const WEEKEND_BG = "hsl(210 30% 96%)"; // kühle Tönung, klar von muted unterscheidbar

type Shift = {
  name: string;
  detail: string;
  bg: string;
  fg: string;
};

type Day = {
  n: number;
  wd: string; // ausgeschriebener Wochentag
  weekend?: boolean;
  today?: boolean;
  shifts?: Shift[];
};

type Week = { label: string; days: Day[] };

const WEEKS: Week[] = [
  {
    label: "KW 49 · 1.–6. Dezember",
    days: [
      {
        n: 1,
        wd: "Dienstag",
        shifts: [
          { name: "Anna Keller", detail: "Frühdienst · 08:00–14:00", bg: "#d4f0f0", fg: "#0f6b6b" },
          { name: "Murat Öztürk", detail: "Spätdienst · 14:00–22:00", bg: "#e2d4f0", fg: "#6b21a8" },
        ],
      },
      { n: 2, wd: "Mittwoch" },
      { n: 3, wd: "Donnerstag" },
      { n: 4, wd: "Freitag" },
      { n: 5, wd: "Samstag", weekend: true },
      { n: 6, wd: "Sonntag", weekend: true },
    ],
  },
  {
    label: "KW 50 · 7.–13. Dezember",
    days: [
      { n: 7, wd: "Montag" },
      { n: 8, wd: "Dienstag" },
      {
        n: 9,
        wd: "Mittwoch",
        shifts: [
          { name: "Anna Keller", detail: "Nachtdienst · 22:00–06:00", bg: "#d4f0f0", fg: "#0f6b6b" },
        ],
      },
      {
        n: 10,
        wd: "Donnerstag",
        today: true,
        shifts: [
          { name: "Jule Brandt", detail: "Frühdienst · 08:00–14:00 · Entwurf", bg: "#cae677", fg: "#3f6212" },
        ],
      },
      { n: 11, wd: "Freitag" },
      { n: 12, wd: "Samstag", weekend: true },
      { n: 13, wd: "Sonntag", weekend: true },
    ],
  },
  {
    label: "KW 51 · 14.–20. Dezember",
    days: [
      { n: 14, wd: "Montag" },
      { n: 15, wd: "Dienstag" },
      { n: 16, wd: "Mittwoch" },
      { n: 17, wd: "Donnerstag" },
      { n: 18, wd: "Freitag" },
      { n: 19, wd: "Samstag", weekend: true },
      { n: 20, wd: "Sonntag", weekend: true },
    ],
  },
];

function DayRow({ day }: { day: Day }) {
  const hasShifts = (day.shifts?.length ?? 0) > 0;
  const rowBg = day.today
    ? PRIMARY
    : day.weekend
      ? WEEKEND_BG
      : "transparent";
  const mainColor = day.today ? BRAND : "hsl(210 10% 15%)";

  return (
    <div style={{ background: rowBg }}>
      {/* Tageszeile — bei leeren Tagen die EINZIGE Zeile */}
      <button
        type="button"
        className="w-full flex items-center gap-3 px-4 text-left"
        style={{ minHeight: 44, color: mainColor }}
      >
        <span className="text-sm font-semibold min-w-[24px]">{day.n}</span>
        <span
          className="text-sm"
          style={{ fontWeight: day.weekend || day.today ? 600 : 400 }}
        >
          {day.wd}
        </span>
        {day.today && (
          <span
            className="text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-px"
            style={{ background: BRAND, color: PRIMARY }}
          >
            Heute
          </span>
        )}
        {!hasShifts && (
          <span
            className="text-xs truncate"
            style={{ color: day.today ? "hsl(210 60% 30%)" : "hsl(210 10% 62%)" }}
          >
            tippen zum Schicht hinzufügen
          </span>
        )}
        <span
          className="ml-auto flex items-center gap-1 text-xs"
          style={{ color: day.today ? BRAND : MUTED_FG }}
        >
          {hasShifts && <span className="font-medium">{day.shifts!.length}</span>}
          <Plus className="h-3.5 w-3.5" />
        </span>
      </button>

      {/* Detailzeilen NUR bei Tagen mit Einträgen */}
      {hasShifts && (
        <div className="px-3 pb-2 space-y-1.5 bg-white">
          {day.shifts!.map((s) => (
            <div
              key={s.name + s.detail}
              className="w-full text-xs rounded border px-2 py-1 leading-snug"
              style={{ background: s.bg, color: s.fg, borderColor: "rgba(0,0,0,0.08)" }}
            >
              <div className="font-medium truncate">{s.name}</div>
              <div>{s.detail}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function WochenKapitel() {
  return (
    <div className="min-h-screen bg-white font-sans" style={{ color: "hsl(210 10% 15%)" }}>
      {/* Kopfzeile wie in der App */}
      <div
        className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 bg-white"
        style={{ borderBottom: `1px solid ${BORDER}` }}
      >
        <h2 className="text-base font-bold" style={{ color: BRAND }}>
          Dienstplan · Dezember 2026
        </h2>
        <span className="text-xs" style={{ color: MUTED_FG }}>
          Listenansicht
        </span>
      </div>

      <div className="p-3 space-y-4">
        {WEEKS.map((week) => (
          <section key={week.label}>
            {/* Wochen-Überschrift */}
            <h3
              className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: MUTED_FG }}
            >
              {week.label}
            </h3>
            {/* Wochen-Block */}
            <div
              className="rounded-xl overflow-hidden"
              style={{ border: `1px solid ${BORDER}` }}
            >
              {week.days.map((day, i) => (
                <div
                  key={day.n}
                  style={i > 0 ? { borderTop: `1px solid ${BORDER}` } : undefined}
                >
                  <DayRow day={day} />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
