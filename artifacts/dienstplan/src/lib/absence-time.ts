// Halbtägiger Urlaub (#862): gemeinsame Zeit-Helfer für alle Stellen, die
// Abwesenheiten anzeigen (Tagesleiste, Team-Abwesenheiten-Übersicht,
// Abwesenheiten-Seite, Monatszelle mobil) oder anlegen (Schicht-Dialog).
//
// Spiegelt isPlainFullDay() im API-Server (shift-metrics-resolve.ts): ein
// „ganztägiger" Eintrag folgt der Konvention 00:00–23:59 IN UTC (so werden
// ganztägige Abwesenheiten angelegt). Die gespeicherten Zeitstempel sind
// UTC-ISO-Strings — getUTCHours/-Minutes lesen sie zeitzonenunabhängig vom
// Browser der Nutzerin (sonst würde Europe/Berlin die Stunden verschieben).
export function isPlainFullDayIso(startIso: string, endIso: string): boolean {
  const start = new Date(startIso);
  const end = new Date(endIso);
  return (
    start.getUTCHours() === 0 &&
    start.getUTCMinutes() === 0 &&
    end.getUTCHours() === 23 &&
    end.getUTCMinutes() === 59
  );
}

// Anders als isPlainFullDayIso() ist das hier eine ANZEIGE, keine reine
// Sentinel-Prüfung: der halbtägige Eintrag transportiert eine echte, vom
// Nutzer gewählte Uhrzeit (nicht die feste 00:00–23:59-UTC-Konvention).
// Genau wie normale Dienstzeiten (toTimeString() im Schicht-Dialog, via
// date-fns format()) muss sie im Browser der Betrachterin gelesen werden —
// getUTCHours() würde in Europe/Berlin eine falsche, um den UTC-Offset
// verschobene Uhrzeit anzeigen (z. B. 13:00–17:00 als 12:00–16:00 im Winter).
/** "13:00–17:00 Uhr" aus zwei ISO-Zeitstempeln (gleicher lokaler Kalendertag), in Browser-Lokalzeit. */
export function formatAbsenceTimeSpan(startIso: string, endIso: string): string {
  const fmt = (iso: string) => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  return `${fmt(startIso)}–${fmt(endIso)} Uhr`;
}
