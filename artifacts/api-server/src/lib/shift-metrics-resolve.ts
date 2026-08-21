// Reine Berechnungslogik für die Roh-Kennzahlen einer Schicht (analog zu
// dashboard-warnings.ts und dashboard-hours-balance.ts). Bewusst frei von DB- und
// Express-Abhängigkeiten, damit die Fallunterscheidung Arbeit vs. Abwesenheit und
// das Zusammenspiel mit der eigentlichen Zuschlagsrechnung (computeShiftMetrics)
// isoliert per Unit-Test abgesichert werden kann.
//
// Die eigentliche Nacht-/Sonntags-/Feiertagsberechnung lebt in
// @workspace/db (shift-metrics.ts); hier wird nur entschieden, ob eine Schicht
// als Abwesenheit (Urlaub/Krank) plan-basiert gewertet wird oder als Arbeit
// durch computeShiftMetrics läuft.

import {
  computeShiftMetrics,
  isGermanHoliday,
  type NightWindow,
  type GermanState,
  type ShiftMetrics,
} from "@workspace/db";

// Urlaub und Krankheit sind Abwesenheiten: sie referenzieren kein Schichtmodell
// und lösen keine Zuschlagsberechnung aus.
export function isAbsenceType(type: string): boolean {
  // "freizeitausgleich" (Ersatzruhetag nach § 11 Abs. 3 ArbZG) ist ein bezahlter
  // Ausgleichs-Ruhetag und wird wie eine Abwesenheit gewertet: volle Tages-
  // Gutschrift ohne Zuschläge, statt einer Arbeitswertung.
  //
  // Neue Abrechnungskategorien (ebenfalls Abwesenheits-Verhalten in der Route:
  // Duplikat-Check pro Tag, Ersetzung des geplanten Dienstes, FIX-Zwang, kein
  // Aushilfe-Einsatz):
  //  - kind_krank:       unbezahlt (Krankengeld der Kasse) — Metriken = 0
  //  - freistellung:     bezahlte Freistellung — Lohnfortzahlung wie Krankheit
  //  - abgesagt_ag:      vom Arbeitgeber abgesagt — bezahlt (Lohnausfallprinzip)
  //  - abgesagt_an:      vom Arbeitnehmer abgesagt — unbezahlt, Metriken = 0
  //  - urlaubsabgeltung: ausgezahlter Urlaub — gewertete Stunden nur als Basis
  //    für den Euro-Wert der Auswertung (fließt dort nicht in Soll/Erfüllt).
  return (
    type === "vacation" ||
    type === "sick" ||
    type === "freizeitausgleich" ||
    type === "kind_krank" ||
    type === "freistellung" ||
    type === "abgesagt_ag" ||
    type === "abgesagt_an" ||
    type === "urlaubsabgeltung"
  );
}

// Unbezahlte Kategorien: reine Info-Zählung, KEINE gewerteten Stunden und keine
// Zuschläge — sie dürfen weder Erfüllung noch Lohn erzeugen.
export function isUnpaidAbsenceType(type: string): boolean {
  return type === "kind_krank" || type === "abgesagt_an";
}

// Ein "ganztägiger" Abwesenheitseintrag folgt der Frontend-Konvention
// 00:00–23:59 (Tagesbeginn bis Tagesende) und trägt KEINE echten Schichtzeiten.
// Alles andere (vom geplanten Dienst geerbte oder aus einem Schichtmodell
// abgeleitete Zeiten) gilt als konkrete Schicht und löst die Zuschlagsrechnung
// aus. Ganztägige Abwesenheiten werden in UTC gespeichert (00:00–23:59 Z, so
// legt das Frontend sie an). Deshalb UTC lesen — getHours() wäre die lokale
// Zeit des Node-Prozesses und würde in Europe/Berlin 01:00 statt 00:00 sehen.
export function isPlainFullDay(start: Date, end: Date): boolean {
  return (
    start.getUTCHours() === 0 &&
    start.getUTCMinutes() === 0 &&
    end.getUTCHours() === 23 &&
    end.getUTCMinutes() === 59
  );
}

// §11-BUrlG-Durchschnitt: gutzuschreibende Tages-Stunden eines Urlaubs-/Krank-Tages
// = bestätigte Arbeits-IST-Stunden der Referenzperiode / Anzahl gearbeiteter Tage.
// Ohne gearbeitete Tage (keine Historie) → null (Aufrufer nimmt Fallback).
export function averageDailyHours(totalHours: number, workedDays: number): number | null {
  if (workedDays <= 0) return null;
  return Math.round((totalHours / workedDays) * 100) / 100;
}

export interface ResolveShiftMetricsInput {
  type: string;
  startTime: Date;
  endTime: Date;
  // Vertragliche Soll-Stunden des Tages — gelten bei Abwesenheit als gewertete
  // Stunden (Lohnfortzahlung). Bei Arbeitsschichten ignoriert.
  plannedHours: number;
  // Zeitwertung des Schichtmodells in Prozent. Legacy-Schichten ohne Modell: 100.
  valuationPercent: number;
}

// Ermittelt die Roh-Kennzahlen einer Schicht ohne jede DB-Abhängigkeit.
//
// - Urlaub/Krankheit mit konkreten Zeiten (Lohnausfallprinzip): Nacht-/Sonntags-/
//   Feiertagsstunden aus dem Zeitfenster werden fortgezahlt (wie der ersetzte Dienst).
// - Urlaub/Krankheit ganztägig (00:00–23:59): Sonntagsstunden und Feiertagsstunden
//   werden aus den geplanten Tagesstunden berechnet; Nachtstunden entfallen (kein
//   konkretes Zeitfenster bekannt). Rechtsgrundlage: §11 BUrlG, §2 EFZG.
//   Diese Zuschläge sind SV-pflichtig (§3b EStG gilt nur für geleistete Arbeit).
// - Arbeitsschicht: delegiert an computeShiftMetrics (Wertung + Nacht-/Sonntags-/
//   Feiertagsstunden inkl. landesspezifischer Feiertage).
export function resolveShiftMetrics(
  input: ResolveShiftMetricsInput,
  window: NightWindow,
  state?: GermanState | null
): ShiftMetrics {
  // Team-Dienst (Teamsitzung): trägt selbst KEINE gewerteten Stunden — die
  // Stunden-Gutschrift (Anzahl Team-Tage × konfigurierte teamMeetingHours je
  // Assistenzkraft) wird erst bei der Auswertung aus den Konto-Einstellungen
  // berechnet, damit spätere Einstellungs-Änderungen sofort wirken. Keine
  // Zuschläge (out of scope).
  if (input.type === "team") {
    return { valuedHours: 0, nightHours: 0, sundayHours: 0, holidayHours: 0 };
  }
  // Unbezahlte Kategorien (Kind-krank, vom Arbeitnehmer abgesagt): KEINE
  // Zuschläge, aber gewertete Stunden wie andere Abwesenheiten speichern —
  // die Auswertung filtert diese Typen ohnehin aus Soll/Erfüllt/Lohn heraus
  // und nutzt valuedHours nur als Info-Kennzahl (z. B. "AN abgesagt: 8 h",
  // nicht die Roh-Dauer 24 h eines Ganztags-Eintrags).
  if (isUnpaidAbsenceType(input.type)) {
    return {
      valuedHours: input.plannedHours,
      nightHours: 0,
      sundayHours: 0,
      holidayHours: 0,
    };
  }
  if (isAbsenceType(input.type)) {
    const start = new Date(input.startTime);
    const end = new Date(input.endTime);
    // Ein ganztägiger Abwesenheitseintrag (00:00–23:59, kein zugrundeliegender
    // Dienst) wird rein plan-basiert gewertet: die vollen geplanten Tages-Soll-
    // Stunden gelten als erfüllt. Da kein konkretes Zeitfenster bekannt ist,
    // können Nachtstunden nicht berechnet werden. Sonntagsstunden und Feiertagsstunden
    // werden dagegen aus den geplanten Stunden ermittelt (§11 BUrlG, §2 EFZG):
    // Ein Urlaubs-/Kranktag am Sonntag oder Feiertag ist genauso zu vergüten wie
    // ein entsprechender Arbeitsdienst (Lohnausfallprinzip).
    // Feiertag hat Vorrang vor Sonntag (kein Doppelzuschlag — analog computeDayCategoryHours).
    if (isPlainFullDay(start, end)) {
      const holidayDay = isGermanHoliday(start, state);
      const sundayDay = start.getUTCDay() === 0;
      return {
        valuedHours: input.plannedHours,
        nightHours: 0,
        sundayHours: sundayDay && !holidayDay ? input.plannedHours : 0,
        holidayHours: holidayDay ? input.plannedHours : 0,
      };
    }
    // Zuschlagsfortzahlung (Lohnausfallprinzip): Deckt die Abwesenheit einen
    // konkret geplanten Dienst ab (echte Schichtzeiten — vom Primary-Lookup
    // geerbt oder aus einem Schichtmodell abgeleitet), werden dessen Nacht-/
    // Sonntags-/Feiertagsstunden aus dem Zeitfenster berechnet und fortgezahlt.
    // Ein 24h-Dienst (identische Start-/Enduhrzeit über die Tagesgrenze) ist ein
    // Spezialfall dieses Zeitfensters.
    const m = computeShiftMetrics(
      { startTime: start, endTime: end, isAbsence: false, valuationPercent: 100 },
      window,
      state
    );
    return {
      valuedHours: input.plannedHours,
      nightHours: m.nightHours,
      sundayHours: m.sundayHours,
      holidayHours: m.holidayHours,
    };
  }
  return computeShiftMetrics(
    {
      startTime: new Date(input.startTime),
      endTime: new Date(input.endTime),
      isAbsence: false,
      valuationPercent: input.valuationPercent,
    },
    window,
    state
  );
}
