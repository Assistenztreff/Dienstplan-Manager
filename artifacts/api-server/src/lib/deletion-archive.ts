// ---------------------------------------------------------------------------
// Loesch-Archiv (Stufe 5): der Nachweis, bevor eine Assistenzkraft verschwindet.
// ---------------------------------------------------------------------------
// Erzeugt aus der Datenbank ein vollstaendiges Archiv aller aufbewahrungs-
// pflichtigen Daten einer Person: Stundenliste, Stundenkonto, Lohnauswertung
// und Aenderungshistorie. Als ZIP mit CSV-Tabellen — bewusst ein Format, das
// jedes Tabellenprogramm und jedes Archivsystem in zehn Jahren noch oeffnet.
//
// WARUM SERVERSEITIG: das Archiv darf nicht davon abhaengen, was der Browser
// gerade tut. Derselbe Puffer wird dem Planer als Download geliefert UND in
// deletion_archives abgelegt — die Datei in seinem Ordner ist damit byte-gleich
// mit der im Archiv, nicht nur inhaltlich aehnlich.
//
// Rechtlicher Rahmen: § 16 ArbZG und § 17 MiLoG verlangen zwei Jahre
// Aufbewahrung, § 3 Abs. 2 Nr. 1 ArbSchG die Dokumentation der tatsaechlich
// geleisteten Arbeitszeit. Das FORMAT ist frei — die Software muss den
// Nachweis nur zuverlaessig erzeugen und darf ihn nicht vorher stillschweigend
// vernichten. Genau das ist der Zweck dieser Datei.
// ---------------------------------------------------------------------------

import JSZip from "jszip";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { computeHoursBalances } from "./hours-balance-service";

/** Ergebnis eines Archiv-Laufs: dieselben Bytes gehen an Download UND Ablage. */
export type DeletionArchiveResult = {
  fileName: string;
  contentType: string;
  content: Buffer;
  /** Monate, die das Archiv abdeckt — fuer die Zusammenfassung im Dialog. */
  monate: number;
  zeilen: { stundenliste: number; aenderungen: number };
};

/**
 * CSV-Feld nach RFC 4180. Excel oeffnet CSV standardmaessig mit Semikolon in
 * deutscher Lokalisierung — deshalb Semikolon als Trenner und ein
 * vorangestelltes "sep=;", damit ein Doppelklick sofort Spalten zeigt statt
 * einer einzigen Textspalte.
 */
function csvFeld(wert: unknown): string {
  if (wert == null) return "";
  const s = String(wert);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csv(kopf: string[], zeilen: unknown[][]): string {
  const alle = [kopf, ...zeilen].map((z) => z.map(csvFeld).join(";"));
  // BOM: ohne ihn zeigt Excel Umlaute als Mojibake.
  return "﻿" + "sep=;\n" + alle.join("\r\n") + "\r\n";
}

/** Deutsche Dezimalschreibweise — die CSVs sind fuer Menschen und Excel. */
function zahl(n: number | null | undefined, stellen = 2): string {
  if (n == null) return "";
  return n.toFixed(stellen).replace(".", ",");
}

function datum(d: Date | string | null | undefined): string {
  if (d == null) return "";
  const dd = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(dd.getTime()) ? "" : dd.toLocaleDateString("de-DE");
}

function uhrzeit(d: Date | string | null | undefined): string {
  if (d == null) return "";
  const dd = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dd.getTime())) return "";
  return dd.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

const TYP_LABELS: Record<string, string> = {
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

const AENDERUNGS_LABELS: Record<string, string> = {
  planner_edit: "Planer-Korrektur",
  deviation_accepted: "Meldung angenommen",
  correction_withdrawn: "Korrektur zurueckgenommen",
};

type ShiftZeile = {
  start_time: string;
  end_time: string;
  type: string;
  planning_status: string | null;
  pause_minutes: number | null;
  valued_hours: string | number | null;
  notes: string | null;
};

/**
 * Baut das vollstaendige Archiv einer Person.
 *
 * `callerUserId` ist der anfragende Planer — die Lohnauswertung laeuft ueber
 * denselben Team-Scope wie die Auswertungsseite, damit hier keine zweite,
 * abweichende Sicht auf dieselben Zahlen entsteht.
 */
export async function buildDeletionArchive(
  callerUserId: number,
  user: { id: number; name: string; email?: string | null },
  teamId: number | null,
): Promise<DeletionArchiveResult> {
  // 1) Stundenliste: die volle Historie, nicht nur zwei Jahre. Die Daten
  //    verschwinden gleich — was jetzt nicht ins Archiv kommt, ist weg.
  const shifts = await db.execute<ShiftZeile>(sql`
    SELECT start_time, end_time, type, planning_status, pause_minutes,
           valued_hours, notes
    FROM shifts
    WHERE user_id = ${user.id}
    ORDER BY start_time
  `);

  const stundenlisteZeilen = shifts.rows.map((s) => {
    const start = new Date(s.start_time);
    const ende = new Date(s.end_time);
    const brutto = (ende.getTime() - start.getTime()) / 3_600_000;
    const netto = brutto - (Number(s.pause_minutes ?? 0) / 60);
    return [
      datum(start),
      TYP_LABELS[s.type] ?? s.type,
      uhrzeit(start),
      uhrzeit(ende),
      s.pause_minutes ?? 0,
      zahl(netto),
      s.valued_hours == null ? "" : zahl(Number(s.valued_hours)),
      s.planning_status ?? "FIX",
      s.notes ?? "",
    ];
  });

  // 2) Zeiterfassung (Ist-Zeiten) — bei aktivierter Zeiterfassung die
  //    eigentliche Aufzeichnung nach § 3 Abs. 2 Nr. 1 ArbSchG.
  const zeiten = await db.execute<{
    actual_start: string | null;
    actual_end: string | null;
    actual_hours: number | null;
    pause_minutes: number | null;
    status: string | null;
    confirmed_at: string | null;
  }>(sql`
    SELECT actual_start, actual_end, actual_hours, pause_minutes, status, confirmed_at
    FROM time_tracking
    WHERE user_id = ${user.id}
    ORDER BY actual_start NULLS LAST
  `);

  // 3) Aenderungshistorie — dieselbe Quelle wie der Vormonats-Block im
  //    Stundenlisten-Export (Stufe 4).
  const aenderungen = await db.execute<{
    change_source: string;
    created_at: string;
    changed_by_name: string | null;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  }>(sql`
    SELECT c.change_source, c.created_at, cb.name AS changed_by_name,
           c.before, c.after
    FROM shift_changes c
    LEFT JOIN users cb ON cb.id = c.changed_by
    WHERE c.user_id = ${user.id}
    ORDER BY (c.after->>'startTime')::timestamptz, c.id
  `);

  // 4) Stundenkonto + Lohnauswertung je Monat. Der Zeitraum ergibt sich aus
  //    den vorhandenen Diensten — ohne Dienste gibt es nichts zu bilanzieren.
  const monate: { monat: number; jahr: number }[] = [];
  if (shifts.rows.length > 0) {
    const erster = new Date(shifts.rows[0]!.start_time);
    const letzter = new Date(shifts.rows[shifts.rows.length - 1]!.start_time);
    const cursor = new Date(erster.getFullYear(), erster.getMonth(), 1);
    const ende = new Date(letzter.getFullYear(), letzter.getMonth(), 1);
    // Obergrenze gegen einen versehentlich weit zurueckdatierten Dienst:
    // 20 Jahre sind weit jenseits jeder Aufbewahrungsfrist.
    let schutz = 0;
    while (cursor <= ende && schutz++ < 240) {
      monate.push({ monat: cursor.getMonth() + 1, jahr: cursor.getFullYear() });
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }

  const kontoZeilen: unknown[][] = [];
  const lohnZeilen: unknown[][] = [];
  for (const m of monate) {
    const rows = await computeHoursBalances(
      callerUserId,
      m.monat,
      m.jahr,
      teamId ?? undefined,
    );
    const r = rows?.find((x) => x.userId === user.id);
    if (!r) continue;
    const label = `${String(m.monat).padStart(2, "0")}/${m.jahr}`;
    kontoZeilen.push([
      label,
      zahl(r.contractMonthlyTargetHours),
      zahl(r.plannedHours),
      zahl(r.actualHours),
      zahl(r.balance),
      zahl(r.workedHours),
      zahl(r.sickHours),
      zahl(r.vacationHoursUsed),
      zahl(r.vacationHoursRemaining),
    ]);
    lohnZeilen.push([
      label,
      zahl(r.valuedHours),
      r.hourlyWage == null ? "" : zahl(r.hourlyWage),
      zahl(r.basePay),
      zahl(r.nightSurchargeHours),
      zahl(r.nightSurchargePay),
      zahl(r.sundaySurchargeHours),
      zahl(r.sundaySurchargePay),
      zahl(r.holidaySurchargeHours),
      zahl(r.holidaySurchargePay),
      zahl(r.totalPay),
      r.billingMethod,
    ]);
  }

  // 5) Vertraege — Grundlage jeder Soll-Zahl oben.
  // Der Stundenlohn haengt am Konto (users.hourly_wage), nicht am Vertrag —
  // deshalb der Join statt einer Vertragsspalte, die es nicht gibt.
  const vertraege = await db.execute<{
    start_date: string;
    end_date: string | null;
    weekly_hours: number | null;
    workdays_per_week: number | null;
    vacation_days: number | null;
    vacation_hours_used: number | null;
    billing_method: string | null;
    notes: string | null;
  }>(sql`
    SELECT start_date, end_date, weekly_hours, workdays_per_week,
           vacation_days, vacation_hours_used, billing_method, notes
    FROM contracts
    WHERE user_id = ${user.id}
    ORDER BY start_date
  `);

  const zip = new JSZip();
  const jetzt = new Date();

  zip.file(
    "00-hinweis.txt",
    [
      "Loesch-Archiv einer Assistenzkraft",
      "==================================",
      "",
      `Person:          ${user.name}`,
      user.email ? `E-Mail:          ${user.email}` : "",
      `Konto-ID:        ${user.id}`,
      `Archiv erstellt: ${jetzt.toLocaleString("de-DE")}`,
      "",
      "Dieses Archiv wurde vom Dienstplan-Manager erzeugt, BEVOR das Konto",
      "geloescht wurde. Es enthaelt die aufbewahrungspflichtigen Aufzeichnungen",
      "zur Arbeitszeit dieser Person.",
      "",
      "Inhalt:",
      "  10-stundenliste.csv   Alle Dienste und Abwesenheiten, volle Historie",
      "  20-zeiterfassung.csv  Erfasste Ist-Zeiten",
      "  30-stundenkonto.csv   Soll/Ist/Saldo je Monat",
      "  40-lohnauswertung.csv Stunden, Grundlohn und Zuschlaege je Monat",
      "  50-aenderungen.csv    Jede Aenderung an einem bestaetigten Dienst",
      "  60-vertraege.csv      Vertragsdaten (Grundlage der Soll-Zahlen)",
      "",
      "Aufbewahrung: § 16 ArbZG und § 17 MiLoG sehen zwei Jahre vor,",
      "§ 3 Abs. 2 Nr. 1 ArbSchG die Dokumentation selbst. Das Format ist frei —",
      "diese Dateien abgelegt zu haben genuegt. Bitte an einem Ort sichern, der",
      "unabhaengig von dieser Software ist.",
      "",
      "Eine identische Kopie liegt zusaetzlich im Server-Archiv der Anwendung.",
      "",
    ]
      .filter((z) => z !== "")
      .join("\r\n"),
  );

  zip.file(
    "10-stundenliste.csv",
    csv(
      ["Datum", "Art", "Von", "Bis", "Pause (Min)", "Stunden", "Bewertete Stunden", "Status", "Notiz"],
      stundenlisteZeilen,
    ),
  );

  zip.file(
    "20-zeiterfassung.csv",
    csv(
      ["Datum", "Ist-Beginn", "Ist-Ende", "Pause (Min)", "Ist-Stunden", "Status", "Bestaetigt am"],
      zeiten.rows.map((z) => [
        datum(z.actual_start),
        uhrzeit(z.actual_start),
        uhrzeit(z.actual_end),
        z.pause_minutes ?? 0,
        z.actual_hours == null ? "" : zahl(Number(z.actual_hours)),
        z.status ?? "",
        z.confirmed_at ? `${datum(z.confirmed_at)} ${uhrzeit(z.confirmed_at)}` : "",
      ]),
    ),
  );

  zip.file(
    "30-stundenkonto.csv",
    csv(
      [
        "Monat", "Vertrags-Soll", "Geplant", "Ist", "Saldo",
        "Gearbeitet", "Krank", "Urlaub verbraucht", "Urlaub Rest",
      ],
      kontoZeilen,
    ),
  );

  zip.file(
    "40-lohnauswertung.csv",
    csv(
      [
        "Monat", "Bewertete Stunden", "Stundenlohn", "Grundlohn",
        "Nacht-Std.", "Nachtzuschlag", "Sonntag-Std.", "Sonntagszuschlag",
        "Feiertag-Std.", "Feiertagszuschlag", "Gesamt", "Abrechnungsart",
      ],
      lohnZeilen,
    ),
  );

  zip.file(
    "50-aenderungen.csv",
    csv(
      [
        "Dienst-Datum", "Vorher von", "Vorher bis", "Vorher Pause",
        "Nachher von", "Nachher bis", "Nachher Pause",
        "Geaendert von", "Ausloeser", "Geaendert am",
      ],
      aenderungen.rows.map((a) => {
        const v = a.before as { startTime?: string; endTime?: string; pauseMinutes?: number };
        const n = a.after as { startTime?: string; endTime?: string; pauseMinutes?: number };
        return [
          datum(n.startTime ?? v.startTime),
          uhrzeit(v.startTime),
          uhrzeit(v.endTime),
          v.pauseMinutes ?? 0,
          uhrzeit(n.startTime),
          uhrzeit(n.endTime),
          n.pauseMinutes ?? 0,
          a.changed_by_name ?? "",
          AENDERUNGS_LABELS[a.change_source] ?? a.change_source,
          `${datum(a.created_at)} ${uhrzeit(a.created_at)}`,
        ];
      }),
    ),
  );

  zip.file(
    "60-vertraege.csv",
    csv(
      [
        "Von", "Bis", "Wochenstunden", "Arbeitstage/Woche", "Urlaubstage",
        "Urlaub verbraucht (Std.)", "Abrechnungsart", "Notiz",
      ],
      vertraege.rows.map((v) => [
        datum(v.start_date),
        v.end_date ? datum(v.end_date) : "unbefristet",
        v.weekly_hours == null ? "" : zahl(Number(v.weekly_hours)),
        v.workdays_per_week == null ? "" : zahl(Number(v.workdays_per_week), 1),
        v.vacation_days ?? "",
        v.vacation_hours_used == null ? "" : zahl(Number(v.vacation_hours_used)),
        v.billing_method ?? "",
        v.notes ?? "",
      ]),
    ),
  );

  const content = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

  const sicherName = user.name
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase() || `konto-${user.id}`;
  const stempel = `${jetzt.getFullYear()}-${String(jetzt.getMonth() + 1).padStart(2, "0")}-${String(jetzt.getDate()).padStart(2, "0")}`;

  return {
    fileName: `archiv-${sicherName}-${stempel}.zip`,
    contentType: "application/zip",
    content,
    monate: monate.length,
    zeilen: { stundenliste: stundenlisteZeilen.length, aenderungen: aenderungen.rows.length },
  };
}
