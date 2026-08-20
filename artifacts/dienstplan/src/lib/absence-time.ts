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

/** "13:00–17:00 Uhr" aus zwei UTC-ISO-Zeitstempeln (gleicher Kalendertag). */
export function formatAbsenceTimeSpan(startIso: string, endIso: string): string {
  const fmt = (iso: string) => {
    const d = new Date(iso);
    return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  };
  return `${fmt(startIso)}–${fmt(endIso)} Uhr`;
}
