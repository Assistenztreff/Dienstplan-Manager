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
 *
 * Unterhalb der Monatstabelle steht der Vormonats-Block: alle Aenderungen an
 * bereits bestaetigten Diensten des Vormonats, eine Zeile je Aenderung, mit
 * altem Wert, neuem Wert, wer und wann. Quelle ist NICHT die Schichtliste,
 * sondern die Aenderungshistorie (GET /shifts/changes/history) — die Schicht
 * traegt nur ihren heutigen Stand, der ueberschriebene Wert steht allein in
 * der Historie. Die ersten fuenf Spalten sind identisch zur Tabelle darueber
 * und zeigen den NEUEN Wert; rechts daneben stehen der alte Wert und die
 * Herkunft der Aenderung.
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

// ---------------------------------------------------------------------------
// Vormonats-Block: Aenderungen an bestaetigten Diensten
// ---------------------------------------------------------------------------

/** Snapshot der zeitrelevanten Felder eines Dienstes (aus shift_changes). */
export type StundenlisteChangeSnapshot = {
  startTime: string;
  endTime: string;
  pauseMinutes: number;
  userId: number;
  userName?: string | null;
};

/** Eine Aenderung, wie sie GET /shifts/changes/history liefert. */
export type StundenlisteChange = {
  id: number;
  changeSource: string;
  changedByName?: string | null;
  shiftType?: string | null;
  createdAt: string;
  before: StundenlisteChangeSnapshot;
  after: StundenlisteChangeSnapshot;
};

// Wie die Aenderung zustande kam — steht in Klammern hinter dem Namen, statt
// eine zehnte Spalte zu kosten.
const CHANGE_SOURCE_LABELS: Record<string, string> = {
  planner_edit: "Planer-Korrektur",
  deviation_accepted: "Meldung angenommen",
  correction_withdrawn: "Korrektur zurückgenommen",
};

/**
 * Netto-Stunden eines Snapshots: Spanne minus Pause.
 *
 * Bewusst NICHT valuedHours wie in der Monatstabelle — der bewertete Wert des
 * alten Standes existiert nirgends mehr, er wurde beim Ueberschreiben ersetzt.
 * Beide Spalten des Blocks (vorher/nachher) rechnen deshalb gleich, damit die
 * Differenz stimmt.
 */
function snapshotStunden(snap: StundenlisteChangeSnapshot): number {
  const brutto =
    (new Date(snap.endTime).getTime() - new Date(snap.startTime).getTime()) / 3_600_000;
  return Math.round((brutto - (snap.pauseMinutes ?? 0) / 60) * 100) / 100;
}

/** "08:00–17:00" bzw. "08:00–17:00 · 30 Min Pause", wenn eine Pause gesetzt ist. */
function snapshotZeit(snap: StundenlisteChangeSnapshot): string {
  const zeit = formatZeit(snap.startTime, snap.endTime);
  return snap.pauseMinutes > 0 ? `${zeit} · ${snap.pauseMinutes} Min Pause` : zeit;
}

/**
 * Der alte Wert als eine Zelle. Datum und Name stehen nur dann mit drin, wenn
 * sie sich geaendert haben — ein verschobener Dienst und ein Assistenten-
 * Wechsel sind selbst getrackte Aenderungen und wuerden sonst untergehen.
 */
function vorherText(c: StundenlisteChange): string {
  const teile: string[] = [];
  const vorherTag = new Date(c.before.startTime).toDateString();
  const nachherTag = new Date(c.after.startTime).toDateString();
  if (vorherTag !== nachherTag) teile.push(formatDatum(c.before.startTime));
  if (c.before.userId !== c.after.userId) teile.push(c.before.userName ?? "—");
  teile.push(snapshotZeit(c.before));
  return teile.join(" · ");
}

function formatZeitpunkt(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })} ${d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`;
}

type ChangeRow = {
  datum: string;
  name: string;
  typ: string;
  zeit: string;
  stunden: number;
  vorher: string;
  stundenVorher: number;
  geaendertVon: string;
  geaendertAm: string;
};

/** Baut die Zeilen des Vormonats-Blocks, sortiert nach Dienst-Datum, dann Aenderungszeitpunkt. */
export function buildAenderungsRows(changes: StundenlisteChange[]): ChangeRow[] {
  return changes
    .map((c) => ({
      datum: formatDatum(c.after.startTime),
      name: c.after.userName ?? c.before.userName ?? "—",
      typ: c.shiftType ? (TYPE_LABELS[c.shiftType] ?? c.shiftType) : "Dienst",
      zeit: snapshotZeit(c.after),
      stunden: snapshotStunden(c.after),
      vorher: vorherText(c),
      stundenVorher: snapshotStunden(c.before),
      geaendertVon: [
        c.changedByName ?? "—",
        CHANGE_SOURCE_LABELS[c.changeSource]
          ? `(${CHANGE_SOURCE_LABELS[c.changeSource]})`
          : "",
      ]
        .filter(Boolean)
        .join(" "),
      geaendertAm: formatZeitpunkt(c.createdAt),
      _sort: new Date(c.after.startTime).getTime(),
      _id: c.id,
    }))
    .sort((a, b) => a._sort - b._sort || a._id - b._id)
    .map(({ _sort, _id, ...row }) => row);
}

function buildAenderungsAoa(
  changes: StundenlisteChange[],
  prevMonthLabel: string,
): (string | number)[][] {
  const rows = buildAenderungsRows(changes);
  const leer = ["", "", "", "", "", "", "", "", ""];
  const kopf = [
    "Datum",
    "Assistenzkraft",
    "Art",
    "Zeit",
    "Stunden",
    "Vorher",
    "Std. vorher",
    "Geändert von",
    "Geändert am",
  ];
  const hinweis = [
    "Jede Zeile ist eine Änderung an einem bereits bestätigten Dienst. Mehrfach geänderte Dienste stehen mehrfach.",
    "", "", "", "", "", "", "", "",
  ];
  if (rows.length === 0) {
    return [
      leer,
      [`Änderungen am Vormonat – ${prevMonthLabel}`, "", "", "", "", "", "", "", ""],
      ["Keine Änderungen an bestätigten Diensten im Vormonat.", "", "", "", "", "", "", "", ""],
    ];
  }
  return [
    leer,
    [`Änderungen am Vormonat – ${prevMonthLabel}`, "", "", "", "", "", "", "", ""],
    hinweis,
    kopf,
    ...rows.map((r) => [
      r.datum,
      r.name,
      r.typ,
      r.zeit,
      r.stunden,
      r.vorher,
      r.stundenVorher,
      r.geaendertVon,
      r.geaendertAm,
    ]),
  ];
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

/** Zeilenindex der "Gesamt"-Zeile — ab da beginnt der Vormonats-Block. */
function monatsBlockZeilen(rows: Row[]): number {
  // Titel + Kopfzeile + Datenzeilen + Gesamt
  return 3 + rows.length;
}

export async function buildStundenlisteBuffer(
  shifts: StundenlisteShift[],
  month: number,
  year: number,
  /**
   * Aenderungen am Vormonat (GET /shifts/changes/history). Bleibt der Wert
   * undefined, entfaellt der Block ganz — ein leeres Array erzeugt dagegen
   * bewusst die Zeile "Keine Änderungen": ein sichtbares "geprüft, nichts da"
   * ist als Nachweis mehr wert als ein fehlender Abschnitt.
   */
  vormonatsChanges?: StundenlisteChange[],
): Promise<ArrayBuffer> {
  // Interop-sicher: im Vite-Dev-Modus hat das xlsx-Modul keinen default-Export.
  const XLSX = await import("xlsx").then((m) => m.default ?? m);

  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString("de-DE", {
    month: "long",
    year: "numeric",
  });
  const prevMonthLabel = new Date(year, month - 2, 1).toLocaleDateString("de-DE", {
    month: "long",
    year: "numeric",
  });

  const rows = buildStundenlisteRows(shifts);
  const aoa = buildAoa(rows, monthLabel);
  const monatsZeilen = monatsBlockZeilen(rows);
  const changeAoa = vormonatsChanges
    ? buildAenderungsAoa(vormonatsChanges, prevMonthLabel)
    : [];
  const ws = XLSX.utils.aoa_to_sheet([...aoa, ...changeAoa]);

  // Zwei Nachkommastellen: Stunden-Spalte des Monats (C4) und im
  // Vormonats-Block zusaetzlich "Std. vorher" (C6).
  if (ws["!ref"]) {
    const range = XLSX.utils.decode_range(ws["!ref"]);
    for (let r = range.s.r + 2; r <= range.e.r; r++) {
      for (const c of [4, 6]) {
        const addr = XLSX.utils.encode_cell({ r, c });
        if (ws[addr]?.t === "n") ws[addr].z = "0.00";
      }
    }
  }

  ws["!cols"] = [
    { wch: 16 },
    { wch: 26 },
    { wch: 18 },
    { wch: 24 },
    { wch: 10 },
    { wch: 34 },
    { wch: 12 },
    { wch: 30 },
    { wch: 18 },
  ];
  // Titelzeilen ueber die volle Breite: Monatstitel oben, Blocktitel und
  // Hinweis im Vormonats-Block (dessen erste Zeile ist die Leerzeile).
  const merges = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 8 } }];
  if (changeAoa.length > 0) {
    const titelZeile = monatsZeilen + 1;
    merges.push({ s: { r: titelZeile, c: 0 }, e: { r: titelZeile, c: 8 } });
    merges.push({ s: { r: titelZeile + 1, c: 0 }, e: { r: titelZeile + 1, c: 8 } });
  }
  ws["!merges"] = merges;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Stundenliste");
  return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

export async function downloadStundenlisteXlsx(
  shifts: StundenlisteShift[],
  month: number,
  year: number,
  vormonatsChanges?: StundenlisteChange[],
): Promise<void> {
  const buf = await buildStundenlisteBuffer(shifts, month, year, vormonatsChanges);
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
