/**
 * Stundenlisten-Export als Excel (.xlsx) — das Free-Exportformat.
 *
 * Schlichte Tabelle der bestätigten (FIX) Einträge eines Monats: gearbeitete
 * Dienste plus Abwesenheiten (Urlaub, Krank, ...). Bewusst OHNE Zuschläge,
 * Geldwerte oder Soll/Ist — das bleibt den Premium-Exporten (Lohnexport,
 * Zeitkonto) vorbehalten.
 *
 * Datenquelle ist die Schichtliste (GET /shifts) — kein Premium-Gate, analog
 * zum einfachen Monats-PDF (basicExport) in pdf-export.ts.
 */

const TYPE_LABELS: Record<string, string> = {
  active: "Dienst",
  standby: "Bereitschaft",
  night: "Nachtdienst",
  full_day: "24h-Dienst",
  work: "Dienst",
  vacation: "Urlaub",
  sick: "Krank",
  team: "Teamsitzung",
  freizeitausgleich: "Freizeitausgleich",
  kind_krank: "Kind krank",
  freistellung: "Freistellung",
  abgesagt_ag: "Abgesagt (AG)",
  abgesagt_an: "Abgesagt (AN)",
  urlaubsabgeltung: "Urlaubsabgeltung",
  wunschfrei: "Wunschfrei",
};

// Abwesenheits-/Info-Typen ohne gearbeitete Uhrzeit — fuer sie steht in der
// Spalte "Zeit" ein Platzhalter statt einer Spanne.
const DAY_ABSENCE_TYPES = new Set([
  "vacation",
  "sick",
  "freizeitausgleich",
  "kind_krank",
  "freistellung",
  "abgesagt_ag",
  "abgesagt_an",
  "urlaubsabgeltung",
  "wunschfrei",
]);

/** Minimaler Shift-Shape, den der Stundenlisten-Export braucht (GET /shifts). */
export type StundenlisteShift = {
  userId: number;
  startTime: string;
  endTime: string;
  type: string;
  planningStatus?: string | null;
  valuedHours?: number | null;
  user?: { name?: string } | null;
};

type Row = {
  datum: string;
  name: string;
  typ: string;
  zeit: string;
  stunden: number;
};

function formatDatum(iso: string): string {
  return new Date(iso).toLocaleDateString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatZeit(startIso: string, endIso: string): string {
  const fmt = (d: Date) =>
    d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  return `${fmt(new Date(startIso))}–${fmt(new Date(endIso))}`;
}

/** Baut die Tabellenzeilen: nur FIX-Einträge, sortiert nach Datum, dann Name. */
export function buildStundenlisteRows(shifts: StundenlisteShift[]): Row[] {
  return shifts
    .filter((s) => (s.planningStatus ?? "FIX") === "FIX")
    .map((s) => ({
      datum: formatDatum(s.startTime),
      name: s.user?.name ?? "—",
      typ: TYPE_LABELS[s.type] ?? s.type,
      zeit: DAY_ABSENCE_TYPES.has(s.type) ? "ganztägig" : formatZeit(s.startTime, s.endTime),
      stunden:
        s.valuedHours != null && s.valuedHours > 0
          ? Math.round(s.valuedHours * 100) / 100
          : Math.round(
              ((new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 3_600_000) * 100,
            ) / 100,
      _sort: new Date(s.startTime).getTime(),
    }))
    .sort((a, b) => a._sort - b._sort || a.name.localeCompare(b.name, "de"))
    .map(({ _sort, ...row }) => row);
}

function buildAoa(rows: Row[], monthLabel: string): (string | number)[][] {
  const header = ["Datum", "Assistenzkraft", "Art", "Zeit", "Stunden"];
  const dataRows = rows.map((r) => [r.datum, r.name, r.typ, r.zeit, r.stunden]);
  const total = Math.round(rows.reduce((sum, r) => sum + r.stunden, 0) * 100) / 100;
  return [
    [`Stundenliste – ${monthLabel}`, "", "", "", ""],
    header,
    ...dataRows,
    ["Gesamt", "", "", "", total],
  ];
}

export async function buildStundenlisteBuffer(
  shifts: StundenlisteShift[],
  month: number,
  year: number,
): Promise<ArrayBuffer> {
  // Interop-sicher: im Vite-Dev-Modus hat das xlsx-Modul keinen default-Export.
  const XLSX = await import("xlsx").then((m) => m.default ?? m);

  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString("de-DE", {
    month: "long",
    year: "numeric",
  });

  const aoa = buildAoa(buildStundenlisteRows(shifts), monthLabel);
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Stunden-Spalte mit zwei Nachkommastellen formatieren.
  if (ws["!ref"]) {
    const range = XLSX.utils.decode_range(ws["!ref"]);
    for (let r = range.s.r + 2; r <= range.e.r; r++) {
      const addr = XLSX.utils.encode_cell({ r, c: 4 });
      if (ws[addr]?.t === "n") ws[addr].z = "0.00";
    }
  }

  ws["!cols"] = [{ wch: 16 }, { wch: 26 }, { wch: 18 }, { wch: 14 }, { wch: 10 }];
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Stundenliste");
  return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

export async function downloadStundenlisteXlsx(
  shifts: StundenlisteShift[],
  month: number,
  year: number,
): Promise<void> {
  const buf = await buildStundenlisteBuffer(shifts, month, year);
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `stundenliste-${year}-${String(month).padStart(2, "0")}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
