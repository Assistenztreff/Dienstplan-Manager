import { useMemo } from "react";
import {
  buildPersonColorAssignment,
  userInitialsClass,
  nameInitials,
} from "@/lib/shift-model-colors";
import { formatDays } from "@/lib/utils";

// Ein Eintrag aus GET /dashboard/hours-balance (nur die hier genutzten Felder).
export type MatrixBalance = {
  userId: number;
  userName: string;
  valuedHours: number;
  plannedHours: number;
  totalFulfilledHours: number;
  sickHours: number;
  vacationDaysTaken: number;
  nightPercent: number;
  nightHours: number;
  nightSurchargeHours: number;
  sundayPercent: number;
  sundayHours: number;
  sundaySurchargeHours: number;
  holidayPercent: number;
  holidayHours: number;
  holidaySurchargeHours: number;
  // Vorbereitete zukünftige Abrechnungskategorien (Server liefert 0-Defaults).
  teamsitzungStunden?: number;
  bereitschaftenAnzahl?: number;
  bereitschaftsStunden?: number;
  vertretungenAnzahl?: number;
  vertretungsStunden?: number;
  hourlyWage?: number | null;
  basePay?: number | null;
  nightSurchargePay?: number | null;
  sundaySurchargePay?: number | null;
  holidaySurchargePay?: number | null;
  totalPay?: number | null;
};

export type MatrixRecalc = {
  diffPay: number;
  diffBasePay: number;
  diffSurchargePay: number;
};

function formatEur(n: number): string {
  return n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

type Row = {
  key: string;
  label: string;
  render: (b: MatrixBalance) => React.ReactNode;
  /** true, wenn die Zeile für diese Kraft keinen Wert ≠ 0 hat (dezente Darstellung, wenn ALLE leer). */
  isEmpty?: (b: MatrixBalance) => boolean;
  highlight?: boolean;
  isTotal?: boolean;
};

// Kompakte Gesamtübersicht bei Filter „Alle": Kategorien als Zeilen,
// Assistenzkräfte als Spalten. Datenquelle ist ausschließlich das bereits
// geladene hours-balance-Array — keine eigenen Requests. Enthält bereits die
// vorbereiteten zukünftigen Abrechnungskategorien (Teamsitzung, Bereitschaften,
// Vertretungen) mit 0-Defaults — Zeilen ohne jegliche Werte bleiben optisch
// dezent, fehlen aber nicht.
export function GesamtAuswertungMatrix({
  balances,
  recalcByUser,
  prevMonthLabel,
}: {
  balances: MatrixBalance[];
  recalcByUser?: Map<number, MatrixRecalc>;
  prevMonthLabel?: string;
}) {
  const personColors = useMemo(
    () => buildPersonColorAssignment(balances.map((b) => b.userId)),
    [balances],
  );

  // Zuschlagszeilen dynamisch: nur Arten, für die mindestens eine Kraft einen
  // Satz > 0 hat (0%-Zuschläge werden — wie in den Einzelkarten — nicht gelistet).
  const anyNight = balances.some((b) => b.nightPercent > 0);
  const anySunday = balances.some((b) => b.sundayPercent > 0);
  const anyHoliday = balances.some((b) => b.holidayPercent > 0);
  // Geldzeilen nur, wenn mindestens eine Kraft einen Stundenlohn hat
  // (gleiches Gating wie die Einzelkarten; Free-Plan sieht die Seite ohnehin nicht).
  const anyWage = balances.some((b) => b.hourlyWage != null);
  const anyRecalc =
    recalcByUser != null && balances.some((b) => recalcByUser.has(b.userId));

  // Zeilen-Label mit Prozentsatz, wenn alle Kräfte denselben Satz haben
  // (Normalfall innerhalb eines Teams — gleiche Beschriftung wie die
  // Einzelkarten, z. B. „Nacht (25%)"); bei gemischten Sätzen steht der
  // Satz stattdessen in der jeweiligen Zelle.
  const uniformPercent = (get: (b: MatrixBalance) => number): number | null => {
    const set = new Set(balances.map(get).filter((p) => p > 0));
    return set.size === 1 ? [...set][0]! : null;
  };
  const nightUniform = uniformPercent((b) => b.nightPercent);
  const sundayUniform = uniformPercent((b) => b.sundayPercent);
  const holidayUniform = uniformPercent((b) => b.holidayPercent);

  const surchargeHoursCell = (
    percent: number,
    hours: number,
    plus: number,
    uniform: number | null,
  ): React.ReactNode =>
    percent > 0 ? (
      <>
        {uniform == null && (
          <span className="text-muted-foreground">({percent}%) </span>
        )}
        {hours} h <span className="text-emerald-700">(+{plus} h)</span>
      </>
    ) : (
      <span className="text-muted-foreground">—</span>
    );

  const moneyCell = (b: MatrixBalance, value: number | null | undefined) =>
    b.hourlyWage != null ? (
      formatEur(value ?? 0)
    ) : (
      <span className="text-muted-foreground">—</span>
    );

  const rows: Row[] = [
    {
      key: "worked",
      label: "Geleistete Stunden (gewertet)",
      render: (b) => `${b.valuedHours} / ${b.plannedHours} h`,
      highlight: true,
    },
    {
      key: "fulfilled",
      label: "Erfüllt gesamt (inkl. Urlaub/Krank)",
      render: (b) => `${b.totalFulfilledHours} h`,
    },
    {
      key: "sick",
      label: "Krankheitsstunden (Lohnfortzahlung)",
      render: (b) => `${b.sickHours} h`,
      isEmpty: (b) => b.sickHours === 0,
    },
    {
      key: "vacation",
      label: "Urlaubstage (genommen)",
      render: (b) => `${formatDays(b.vacationDaysTaken)}`,
      isEmpty: (b) => b.vacationDaysTaken === 0,
    },
    ...(anyNight
      ? [
          {
            key: "nightHours",
            label: nightUniform != null ? `Nacht (${nightUniform}%)` : "Nachtstunden (Zuschlag)",
            render: (b: MatrixBalance) =>
              surchargeHoursCell(b.nightPercent, b.nightHours, b.nightSurchargeHours, nightUniform),
          },
        ]
      : []),
    ...(anySunday
      ? [
          {
            key: "sundayHours",
            label: sundayUniform != null ? `Sonntag (${sundayUniform}%)` : "Sonntagsstunden (Zuschlag)",
            render: (b: MatrixBalance) =>
              surchargeHoursCell(b.sundayPercent, b.sundayHours, b.sundaySurchargeHours, sundayUniform),
          },
        ]
      : []),
    ...(anyHoliday
      ? [
          {
            key: "holidayHours",
            label: holidayUniform != null ? `Feiertag (${holidayUniform}%)` : "Feiertagsstunden (Zuschlag)",
            render: (b: MatrixBalance) =>
              surchargeHoursCell(b.holidayPercent, b.holidayHours, b.holidaySurchargeHours, holidayUniform),
          },
        ]
      : []),
    // --- Vorbereitete Abrechnungskategorien (Default 0) ---
    {
      key: "teamsitzung",
      label: "Teamsitzung",
      render: (b) => `${b.teamsitzungStunden ?? 0} h`,
      isEmpty: (b) => (b.teamsitzungStunden ?? 0) === 0,
    },
    {
      key: "bereitschaften",
      label: "Bereitschaften",
      render: (b) => `${b.bereitschaftenAnzahl ?? 0} (Anz.) / ${b.bereitschaftsStunden ?? 0} h`,
      isEmpty: (b) =>
        (b.bereitschaftenAnzahl ?? 0) === 0 && (b.bereitschaftsStunden ?? 0) === 0,
    },
    {
      key: "vertretungen",
      label: "Vertretungen",
      render: (b) => `${b.vertretungenAnzahl ?? 0} (Anz.) / ${b.vertretungsStunden ?? 0} h`,
      isEmpty: (b) =>
        (b.vertretungenAnzahl ?? 0) === 0 && (b.vertretungsStunden ?? 0) === 0,
    },
    ...(anyWage
      ? [
          {
            key: "basePay",
            label: "Grundlohn",
            render: (b: MatrixBalance) => moneyCell(b, b.basePay),
          },
          ...(anyNight
            ? [
                {
                  key: "nightPay",
                  label: "Nachtzuschlag (€)",
                  render: (b: MatrixBalance) => moneyCell(b, b.nightSurchargePay),
                },
              ]
            : []),
          ...(anySunday
            ? [
                {
                  key: "sundayPay",
                  label: "Sonntagszuschlag (€)",
                  render: (b: MatrixBalance) => moneyCell(b, b.sundaySurchargePay),
                },
              ]
            : []),
          ...(anyHoliday
            ? [
                {
                  key: "holidayPay",
                  label: "Feiertagszuschlag (€)",
                  render: (b: MatrixBalance) => moneyCell(b, b.holidaySurchargePay),
                },
              ]
            : []),
          ...(anyRecalc
            ? [
                {
                  key: "recalc",
                  label: prevMonthLabel
                    ? `Nachberechnung ${prevMonthLabel}`
                    : "Nachberechnung Vormonat",
                  render: (b: MatrixBalance) => {
                    const r = recalcByUser?.get(b.userId);
                    if (!r) return <span className="text-muted-foreground">—</span>;
                    return (
                      <span className={r.diffPay < 0 ? "text-red-700" : "text-emerald-800"}>
                        {r.diffPay > 0 ? "+" : ""}
                        {formatEur(r.diffPay)}
                      </span>
                    );
                  },
                },
              ]
            : []),
          {
            key: "total",
            label: anyRecalc
              ? "GESAMT (brutto) inkl. Nachberechnung"
              : "GESAMT (brutto)",
            render: (b: MatrixBalance) =>
              b.hourlyWage != null ? (
                formatEur((b.totalPay ?? 0) + (recalcByUser?.get(b.userId)?.diffPay ?? 0))
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
            isTotal: true,
          },
        ]
      : []),
  ];

  return (
    <div
      className="w-full rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden"
      data-testid="gesamt-auswertung-matrix"
    >
      <div className="p-4 bg-muted/40 border-b border-border/50 flex justify-between items-center gap-2 flex-wrap">
        <h3 className="text-base font-semibold text-foreground">
          Gesamtübersicht – Alle Assistenzkräfte
        </h3>
        <span className="text-xs text-muted-foreground font-medium">
          {balances.length === 1 ? "1 Assistenzkraft" : `${balances.length} Assistenzkräfte`}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border/60 bg-muted/50">
              <th
                scope="col"
                className="sticky left-0 z-10 bg-muted p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider min-w-[180px] max-w-[240px]"
              >
                Kategorie
              </th>
              {balances.map((b) => (
                <th
                  key={b.userId}
                  scope="col"
                  className="p-3 text-center min-w-[140px]"
                  data-testid={`matrix-col-${b.userId}`}
                >
                  <div className="flex items-center justify-center gap-2">
                    <span
                      aria-hidden="true"
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold leading-none ${userInitialsClass(b.userId, personColors)}`}
                    >
                      {nameInitials(b.userName)}
                    </span>
                    <span className="text-sm font-semibold text-foreground whitespace-nowrap">
                      {b.userName}
                    </span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              // Kategorien ohne jeglichen Wert (alle Spalten 0) bleiben
              // sichtbar, werden aber optisch dezent dargestellt.
              const allEmpty =
                row.isEmpty != null && balances.every((b) => row.isEmpty!(b));
              const rowStyle = row.isTotal
                ? "bg-primary/10 font-semibold border-t-2 border-foreground/40"
                : row.highlight
                  ? "bg-muted/40 font-medium"
                  : idx % 2 === 0
                    ? "bg-card"
                    : "bg-muted/20";
              const stickyBg = row.isTotal
                ? "bg-primary/10"
                : row.highlight
                  ? "bg-muted/40"
                  : idx % 2 === 0
                    ? "bg-card"
                    : "bg-muted/20";
              return (
                <tr
                  key={row.key}
                  className={`border-b border-border/40 ${rowStyle} ${allEmpty ? "text-muted-foreground/70" : ""}`}
                  data-testid={`matrix-row-${row.key}`}
                >
                  <th
                    scope="row"
                    className={`sticky left-0 z-10 p-3 text-sm font-medium text-left ${stickyBg} ${allEmpty ? "text-muted-foreground" : "text-foreground"}`}
                  >
                    {row.label}
                  </th>
                  {balances.map((b) => (
                    <td
                      key={b.userId}
                      className={`p-3 text-sm text-center tabular-nums whitespace-nowrap ${allEmpty ? "text-muted-foreground/70" : ""}`}
                      data-testid={`matrix-cell-${row.key}-${b.userId}`}
                    >
                      {row.render(b)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
