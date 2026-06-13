// Reine, DB-unabhängige Berechnung der Schicht-Kennzahlen.
//
// Architektur: Pro Schicht werden die gemessenen ROH-Kennzahlen gespeichert
// (bewertete Stunden, Nacht-/Sonntags-/Feiertagsstunden). Die Zuschlags-Prozentsätze
// werden erst bei der Auswertung angewandt, damit Änderungen der Zuschläge
// rückwirkend greifen.
//
// Zeitzone: Alle Berechnungen erfolgen in UTC, konsistent mit den als ISO-Z
// gespeicherten Zeitstempeln. Das Nachtfenster ("23:00") wird als Wanduhrzeit in
// UTC interpretiert.

export type NightWindow = { nightStart: string; nightEnd: string };

export type ShiftMetrics = {
  valuedHours: number;
  nightHours: number;
  sundayHours: number;
  holidayHours: number;
};

export type ShiftMetricsInput = {
  startTime: Date;
  endTime: Date;
  isAbsence: boolean;
  // Zeitwertung des Schichtmodells in Prozent. Legacy-Schichten ohne Modell: 100.
  valuationPercent: number;
};

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function ymdUTC(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate()
  ).padStart(2, "0")}`;
}

// Wandelt "HH:MM" in Minuten-seit-Mitternacht um. Ungültige/außerhalb des Bereichs
// liegende Werte werden defensiv auf 0–23 / 0–59 begrenzt, damit fehlerhafte
// Zuschlags-Einstellungen die Nachtberechnung nicht verfälschen.
function parseHm(s: string): number {
  const [rawH, rawM] = s.split(":").map((x) => Number(x));
  const h = Number.isFinite(rawH) ? Math.min(23, Math.max(0, Math.floor(rawH))) : 0;
  const m = Number.isFinite(rawM) ? Math.min(59, Math.max(0, Math.floor(rawM))) : 0;
  return h * 60 + m;
}

// Ostersonntag (Gregorianischer Algorithmus nach Meeus/Jones/Butcher), als UTC-Datum.
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = März, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

const holidayCache = new Map<number, Set<string>>();

// Bundesweite gesetzliche Feiertage (inkl. beweglicher, Oster-abhängiger) als
// Menge von "YYYY-MM-DD" (UTC). Bundesland-spezifische Feiertage sind außen vor.
export function germanHolidays(year: number): Set<string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;

  const set = new Set<string>();
  const fixed: Array<[number, number]> = [
    [0, 1], // Neujahr
    [4, 1], // Tag der Arbeit
    [9, 3], // Tag der Deutschen Einheit
    [11, 25], // 1. Weihnachtstag
    [11, 26], // 2. Weihnachtstag
  ];
  for (const [mo, da] of fixed) set.add(ymdUTC(new Date(Date.UTC(year, mo, da))));

  const easter = easterSunday(year);
  set.add(ymdUTC(addDays(easter, -2))); // Karfreitag
  set.add(ymdUTC(addDays(easter, 1))); // Ostermontag
  set.add(ymdUTC(addDays(easter, 39))); // Christi Himmelfahrt
  set.add(ymdUTC(addDays(easter, 50))); // Pfingstmontag

  holidayCache.set(year, set);
  return set;
}

export function isGermanHoliday(date: Date): boolean {
  return germanHolidays(date.getUTCFullYear()).has(ymdUTC(date));
}

function overlapMs(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

// Stunden der Schicht, die in das (ggf. über Mitternacht laufende) Nachtfenster fallen.
export function computeNightHours(
  start: Date,
  end: Date,
  nightStart: string,
  nightEnd: string
): number {
  const s = start.getTime();
  const e = end.getTime();
  if (e <= s) return 0;

  const startMin = parseHm(nightStart);
  const endMin = parseHm(nightEnd);
  const wraps = endMin <= startMin; // z.B. 23:00 -> 06:00

  const firstDay = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  let totalMs = 0;
  // Auch das Fenster des Vortags kann in eine früh beginnende Schicht hineinreichen.
  for (let day = firstDay - DAY_MS; day <= e; day += DAY_MS) {
    const winStart = day + startMin * 60_000;
    const winEnd = wraps ? day + DAY_MS + endMin * 60_000 : day + endMin * 60_000;
    totalMs += overlapMs(s, e, winStart, winEnd);
  }
  return round2(totalMs / HOUR_MS);
}

// Stunden auf Sonntagen bzw. Feiertagen. Feiertag hat Vorrang vor Sonntag, damit
// ein Feiertag, der auf einen Sonntag fällt, keinen doppelten Zuschlag auslöst.
export function computeDayCategoryHours(
  start: Date,
  end: Date
): { sundayHours: number; holidayHours: number } {
  const e = end.getTime();
  let cursor = start.getTime();
  if (e <= cursor) return { sundayHours: 0, holidayHours: 0 };

  let sundayMs = 0;
  let holidayMs = 0;
  while (cursor < e) {
    const cur = new Date(cursor);
    const nextMidnight = Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth(), cur.getUTCDate() + 1);
    const segEnd = Math.min(e, nextMidnight);
    const segMs = segEnd - cursor;
    if (isGermanHoliday(cur)) holidayMs += segMs;
    else if (cur.getUTCDay() === 0) sundayMs += segMs;
    cursor = segEnd;
  }
  return { sundayHours: round2(sundayMs / HOUR_MS), holidayHours: round2(holidayMs / HOUR_MS) };
}

export function computeShiftMetrics(input: ShiftMetricsInput, window: NightWindow): ShiftMetrics {
  // Abwesenheiten (Urlaub/Krank) lösen keine Bewertung/Zuschläge aus.
  if (input.isAbsence) {
    return { valuedHours: 0, nightHours: 0, sundayHours: 0, holidayHours: 0 };
  }
  const grossMs = input.endTime.getTime() - input.startTime.getTime();
  const grossHours = grossMs > 0 ? grossMs / HOUR_MS : 0;
  const valuedHours = round2(grossHours * (input.valuationPercent / 100));
  const nightHours = computeNightHours(
    input.startTime,
    input.endTime,
    window.nightStart,
    window.nightEnd
  );
  const { sundayHours, holidayHours } = computeDayCategoryHours(input.startTime, input.endTime);
  return { valuedHours, nightHours, sundayHours, holidayHours };
}
