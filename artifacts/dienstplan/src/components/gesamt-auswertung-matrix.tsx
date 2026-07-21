import { useMemo } from "react";
import type { HoursBalance } from "@workspace/api-client-react";
import {
  buildPersonColorAssignment,
  userInitialsClass,
  nameInitials,
} from "@/lib/shift-model-colors";
import { formatDays } from "@/lib/utils";

function formatEur(n: number): string {
  return n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

type MatrixRow = {
  label: string;
  render: (b: HoursBalance) => string;
  /** true, wenn die Zeile in KEINER Spalte einen Wert ≠ 0 hat (dezente Darstellung). */
  isEmpty?: (b: HoursBalance) => boolean;
  highlight?: boolean;
  isTotal?: boolean;
};

// Gesamtübersicht als Matrix (Kategorien × Assistenzkräfte) für den
// "Alle"-Filter der Auswertungen-Seite. Enthält bereits die vorbereiteten
// zukünftigen Abrechnungskategorien (Teamsitzung, Bereitschaften,
// Vertretungen) mit 0-Defaults — Zeilen ohne jegliche Werte bleiben optisch
// dezent, fehlen aber nicht.
export function GesamtAuswertungMatrix({ balances }: { balances: HoursBalance[] }) {
  const personColors = useMemo(
    () => buildPersonColorAssignment(balances.map((b) => b.userId)),
    [balances],
  );

  const hasPay = balances.some((b) => b.totalPay != null);

  const rows: MatrixRow[] = [
    {
      label: "Geleistete Stunden (bewertet)",
      render: (b) => `${b.valuedHours} / ${b.plannedHours} h`,
      highlight: true,
    },
    {
      label: "Krankheitsstunden (Lohnfortzahlung)",
      render: (b) => `${b.sickHours} h`,
      isEmpty: (b) => b.sickHours === 0,
    },
    {
      label: "Urlaubstage (genommen)",
      render: (b) => `${formatDays(b.vacationDaysTaken)} Tage`,
      isEmpty: (b) => b.vacationDaysTaken === 0,
    },
    {
      label: "Nachtstunden (Zuschlag)",
      render: (b) => `${b.nightHours} h`,
      isEmpty: (b) => b.nightHours === 0,
    },
    // --- Vorbereitete Abrechnungskategorien (Default 0) ---
    {
      label: "Teamsitzung",
      render: (b) => `${b.teamsitzungStunden ?? 0} h`,
      isEmpty: (b) => (b.teamsitzungStunden ?? 0) === 0,
    },
    {
      label: "Bereitschaften",
      render: (b) => `${b.bereitschaftenAnzahl ?? 0} (Anz.) / ${b.bereitschaftsStunden ?? 0} h`,
      isEmpty: (b) => (b.bereitschaftenAnzahl ?? 0) === 0 && (b.bereitschaftsStunden ?? 0) === 0,
    },
    {
      label: "Vertretungen",
      render: (b) => `${b.vertretungenAnzahl ?? 0} (Anz.) / ${b.vertretungsStunden ?? 0} h`,
      isEmpty: (b) => (b.vertretungenAnzahl ?? 0) === 0 && (b.vertretungsStunden ?? 0) === 0,
    },
    ...(hasPay
      ? ([
          {
            label: "Grundlohn",
            render: (b) => (b.basePay != null ? formatEur(b.basePay) : "—"),
          },
          {
            label: "Nachtzuschlag (€)",
            render: (b) =>
              b.nightSurchargePay != null ? formatEur(b.nightSurchargePay) : "—",
            isEmpty: (b) => (b.nightSurchargePay ?? 0) === 0,
          },
          {
            label: "GESAMT LOHN (BRUTTO)",
            render: (b) => (b.totalPay != null ? formatEur(b.totalPay) : "—"),
            isTotal: true,
          },
        ] as MatrixRow[])
      : []),
  ];

  return (
    <div
      className="w-full bg-card rounded-xl border border-border/50 shadow-sm overflow-hidden"
      data-testid="gesamt-auswertung-matrix"
    >
      <div className="p-4 bg-muted/40 border-b border-border/50 flex justify-between items-center gap-2 flex-wrap">
        <h3 className="text-base font-semibold text-foreground">
          Gesamtübersicht – Alle Assistenzkräfte
        </h3>
        <span className="text-xs text-muted-foreground font-medium">
          {balances.length} {balances.length === 1 ? "Assistenzkraft" : "Assistenzkräfte"} erfasst
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[700px]">
          <thead>
            <tr className="border-b border-border/60 bg-muted/60">
              <th className="p-3 text-xs font-bold text-muted-foreground uppercase tracking-wider w-64">
                Kategorie
              </th>
              {balances.map((b) => (
                <th key={b.userId} className="p-3 text-center min-w-[140px]">
                  <div className="flex items-center justify-center gap-2">
                    <span
                      aria-hidden="true"
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold leading-none ${userInitialsClass(b.userId, personColors)}`}
                    >
                      {nameInitials(b.userName)}
                    </span>
                    <span className="text-sm font-semibold text-foreground">{b.userName}</span>
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
              const isEven = idx % 2 === 0;
              const rowStyle = row.isTotal
                ? "bg-primary/10 font-bold border-t-2 border-foreground/40"
                : row.highlight
                  ? "bg-muted/50 font-semibold"
                  : isEven
                    ? "bg-card"
                    : "bg-muted/20";

              return (
                <tr
                  key={row.label}
                  className={`border-b border-border/40 transition-colors ${rowStyle} ${allEmpty ? "text-muted-foreground/70" : ""}`}
                  data-testid={`matrix-row-${idx}`}
                >
                  <td
                    className={`p-3 text-sm font-medium ${allEmpty ? "text-muted-foreground" : "text-foreground"}`}
                  >
                    {row.label}
                  </td>
                  {balances.map((b) => (
                    <td
                      key={b.userId}
                      className={`p-3 text-sm text-center font-mono ${allEmpty ? "text-muted-foreground/70" : "text-foreground"}`}
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
