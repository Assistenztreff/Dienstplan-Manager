import { Plus } from "lucide-react";

/**
 * Variante B — „Kompakte Zeilenliste"
 *
 * Mobile Listenansicht des Dienstplans (Dezember 2026, wie im Nutzer-Screenshot):
 * - EINE durchgehende, ruhige Liste statt Einzelkarten; feine Trennlinien.
 * - Wochenwechsel = deutlicher Trenner mit kleinem KW-Label in der Linie.
 * - Wochenende als zusammenhängender Block: Tönung + 3-px-Markierung am linken
 *   Rand (dunkelblau) + fetterer Wochentag — nicht nur Farbe.
 * - Leere Tage EINZEILIG mit Hinweis „tippen zum Schicht hinzufügen" neben dem Tag.
 * - Heute: Hellgelb (App-Primary) mit dunkelblauem Text.
 *
 * Farbwerte = echte App-Token (primary #ebf18b, Dunkelblau hsl(210 90% 19%),
 * border hsl(0 0% 90%), muted-foreground hsl(210 15% 40%), Assistenz-Palette).
 */

const BRAND = "hsl(210 90% 19%)";
const MUTED_FG = "hsl(210 15% 40%)";
const BORDER = "hsl(0 0% 90%)";
const PRIMARY = "#ebf18b";
const WEEKEND_BG = "hsl(210 30% 96%)";

type Shift = { name: string; detail: string; bg: string; fg: string };

type Row =
  | { kind: "week"; label: string }
  | {
      kind: "day";
      n: number;
      wd: string; // Kurzform, z. B. "Di"
      weekend?: boolean;
      today?: boolean;
      shifts?: Shift[];
    };

const ROWS: Row[] = [
  { kind: "week", label: "KW 49 · 1.–6. Dez." },
  {
    kind: "day", n: 1, wd: "Di",
    shifts: [
      { name: "Anna Keller", detail: "Frühdienst · 08:00–14:00", bg: "#d4f0f0", fg: "#0f6b6b" },
      { name: "Murat Öztürk", detail: "Spätdienst · 14:00–22:00", bg: "#e2d4f0", fg: "#6b21a8" },
    ],
  },
  { kind: "day", n: 2, wd: "Mi" },
  { kind: "day", n: 3, wd: "Do" },
  { kind: "day", n: 4, wd: "Fr" },
  { kind: "day", n: 5, wd: "Sa", weekend: true },
  { kind: "day", n: 6, wd: "So", weekend: true },
  { kind: "week", label: "KW 50 · 7.–13. Dez." },
  { kind: "day", n: 7, wd: "Mo" },
  { kind: "day", n: 8, wd: "Di" },
  {
    kind: "day", n: 9, wd: "Mi",
    shifts: [
      { name: "Anna Keller", detail: "Nachtdienst · 22:00–06:00", bg: "#d4f0f0", fg: "#0f6b6b" },
    ],
  },
  {
    kind: "day", n: 10, wd: "Do", today: true,
    shifts: [
      { name: "Jule Brandt", detail: "Frühdienst · 08:00–14:00 · Entwurf", bg: "#cae677", fg: "#3f6212" },
    ],
  },
  { kind: "day", n: 11, wd: "Fr" },
  { kind: "day", n: 12, wd: "Sa", weekend: true },
  { kind: "day", n: 13, wd: "So", weekend: true },
  { kind: "week", label: "KW 51 · 14.–20. Dez." },
  { kind: "day", n: 14, wd: "Mo" },
  { kind: "day", n: 15, wd: "Di" },
  { kind: "day", n: 16, wd: "Mi" },
  { kind: "day", n: 17, wd: "Do" },
  { kind: "day", n: 18, wd: "Fr" },
  { kind: "day", n: 19, wd: "Sa", weekend: true },
  { kind: "day", n: 20, wd: "So", weekend: true },
];

function WeekSeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2" style={{ background: "hsl(0 0% 98%)" }}>
      <span
        className="text-[10px] font-bold uppercase tracking-wider whitespace-nowrap"
        style={{ color: BRAND }}
      >
        {label}
      </span>
      <span className="h-px flex-1" style={{ background: "hsl(210 40% 80%)" }} />
    </div>
  );
}

function DayRow({ row }: { row: Extract<Row, { kind: "day" }> }) {
  const hasShifts = (row.shifts?.length ?? 0) > 0;
  const rowBg = row.today ? PRIMARY : row.weekend ? WEEKEND_BG : "transparent";
  const mainColor = row.today ? BRAND : "hsl(210 10% 15%)";

  return (
    <div
      style={{
        background: rowBg,
        // Wochenend-Block: Markierung am linken Rand (nicht nur Farbe)
        boxShadow: row.weekend ? `inset 3px 0 0 ${BRAND}` : undefined,
      }}
    >
      <button
        type="button"
        className="w-full flex items-center gap-2.5 px-4 text-left"
        style={{ minHeight: 44, color: mainColor }}
      >
        <span
          className="text-sm font-semibold min-w-[22px] tabular-nums"
          style={{ textAlign: "right" }}
        >
          {row.n}
        </span>
        <span
          className="text-sm min-w-[24px]"
          style={{ fontWeight: row.weekend || row.today ? 700 : 400 }}
        >
          {row.wd}
        </span>
        {row.today && (
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
            style={{ color: row.today ? "hsl(210 60% 30%)" : "hsl(210 10% 62%)" }}
          >
            tippen zum Schicht hinzufügen
          </span>
        )}
        <span
          className="ml-auto flex items-center gap-1 text-xs"
          style={{ color: row.today ? BRAND : MUTED_FG }}
        >
          {hasShifts && <span className="font-medium">{row.shifts!.length}</span>}
          <Plus className="h-3.5 w-3.5" />
        </span>
      </button>

      {hasShifts && (
        <div className="px-4 pb-2 space-y-1.5">
          {row.shifts!.map((s) => (
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

export function KompakteListe() {
  return (
    <div className="min-h-screen bg-white font-sans" style={{ color: "hsl(210 10% 15%)" }}>
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

      <div className="p-3">
        <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
          {ROWS.map((row, i) => (
            <div key={i} style={i > 0 ? { borderTop: `1px solid ${BORDER}` } : undefined}>
              {row.kind === "week" ? <WeekSeparator label={row.label} /> : <DayRow row={row} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
