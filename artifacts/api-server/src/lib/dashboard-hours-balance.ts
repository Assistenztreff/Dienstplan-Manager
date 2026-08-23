// Reine Berechnungslogik für die Soll/Ist-Auswertung (Admin-Zweig von
// /dashboard/hours-balance). Bewusst frei von DB- und Express-Abhängigkeiten,
// damit die komplexe Zuschlags- und Urlaubsrechnung (Nacht-/Sonntags-/
// Feiertagsprozente werden rückwirkend angewandt, Trennung Arbeit vs.
// Urlaub/Krank, Zählung der Urlaubstage pro Monat) isoliert per Unit-Test
// abgesichert werden kann.

import { vacationPoolHours } from "./vacation-hours";

export const DEFAULT_NIGHT_PERCENT = 25;
export const DEFAULT_SUNDAY_PERCENT = 50;
export const DEFAULT_HOLIDAY_PERCENT = 100;
export const DEFAULT_VACATION_DAYS = 30;

export const round2 = (n: number) => Math.round(n * 100) / 100;

// Abwesenheits-Schichtarten: Urlaub, Krankheit UND "freizeitausgleich"
// (Ersatzruhetag nach § 11 Abs. 3 ArbZG — ein bezahlter freier Tag, KEINE
// Arbeitszeit). Muss mit isAbsenceType (shift-metrics-resolve) übereinstimmen;
// bewusst lokal dupliziert, damit dieses Modul DB-/Express-frei bleibt.
const ABSENCE_SHIFT_TYPES = new Set([
  "vacation",
  "sick",
  "freizeitausgleich",
  // Bezahlte neue Kategorien — laufen wie Urlaub/Krank durch die
  // Lohnfortzahlung (Soll aus geerbten Zeiten, Zuschlags-Fortzahlung,
  // Grundlohn aus valuedHours):
  "freistellung",
  "abgesagt_ag",
]);
const isAbsenceShiftType = (type: string): boolean => ABSENCE_SHIFT_TYPES.has(type);

// Rein informative Kategorien: zählen NICHT in Soll/Erfüllt/Zuschläge/Lohn,
// sondern nur in ihre eigenen Auswertungs-Spalten. Muss mit
// isUnpaidAbsenceType/urlaubsabgeltung (shift-metrics-resolve) übereinstimmen;
// bewusst lokal dupliziert, damit dieses Modul DB-/Express-frei bleibt.
const INFO_ONLY_SHIFT_TYPES = new Set(["kind_krank", "abgesagt_an", "urlaubsabgeltung"]);

/** Schicht-Felder, die in die Auswertung einfließen. */
export interface BalanceShift {
  type: string;
  startTime: Date | string;
  endTime: Date | string;
  valuedHours?: number | null;
  nightHours?: number | null;
  sundayHours?: number | null;
  holidayHours?: number | null;
  /** Team der Schicht — bestimmt, wessen Zuschlags-Prozente gelten (Team-Eigentümer). */
  teamId?: number | null;
  // Vergütung (Geld) des zugrundeliegenden Dienstmodells — für die
  // Premium-Lohnauswertung im SOLL-Modus. compensationPercent nur bei
  // "percentage", compensationFlatCents (Cent, dauerunabhängig) nur bei "flat".
  compensationType?: CompensationType | null;
  compensationPercent?: number | null;
  compensationFlatCents?: number | null;
  /**
   * Name des zugrundeliegenden Schichtmodells — dient der Erkennung von
   * Bereitschafts-Diensten (Modellname "Bereitschaft") für die vorbereiteten
   * Abrechnungskategorien der Auswertung.
   */
  modelName?: string | null;
  /** Vertretungs-Markierung (Info-Kennzahl; Stunden zählen normal). */
  isVertretung?: boolean | null;
  /** Unbezahlte Pausenminuten (Info-Kennzahl; reduziert NICHT die Stunden). */
  pauseMinutes?: number | null;
}

/** Abrechnungsart: SOLL = nach Plan, IST = nach erfassten Ist-Zeiten. */
export type BillingMethod = "SOLL" | "IST";

/** Vergütungstyp des zugrundeliegenden Dienstes (Geld-Berechnung, Point 4). */
export type CompensationType = "regular" | "percentage" | "flat";

/**
 * Berechnungs-Weiche für die Abrechnungsart: Ist die Zeiterfassung des
 * Team-Eigentümers DEAKTIVIERT (Konto-Schalter, Standard AUS), existieren
 * keine (neuen) IST-Zeiten — die gesamte Lohnberechnung (Grundvergütung UND
 * Zuschläge) muss dann aus den geplanten FIX-Schichten erfolgen. Der
 * konfigurierte SOLL/IST-Toggle bleibt gespeichert, wird bei AUS aber
 * effektiv SOLL. Bei aktivierter Zeiterfassung gilt der konfigurierte Wert
 * unverändert (Default SOLL = Bestandsschutz).
 */
export function resolveEffectiveBillingMethod(
  configured: BillingMethod | null | undefined,
  timeTrackingEnabled: boolean,
): BillingMethod {
  if (!timeTrackingEnabled) return "SOLL";
  return configured ?? "SOLL";
}

/** Bestätigter Zeiterfassungs-Eintrag inkl. Typ der verknüpften Schicht. */
export interface BalanceTimeEntry {
  actualHours?: number | null;
  shiftType?: string | null;
  // IST-Modus: aus den tatsächlich erfassten Zeiten (actualStart/actualEnd)
  // berechnete Kennzahlen. Werden nur bei billingMethod === "IST" verwendet.
  valuedHours?: number | null;
  nightHours?: number | null;
  sundayHours?: number | null;
  holidayHours?: number | null;
  /** Team des Eintrags — bestimmt die anzuwendenden Zuschlags-Prozente. */
  teamId?: number | null;
  /** Unbezahlte Pausenminuten des Ist-Eintrags (Abzug nur bei aktivem Konto-Schalter). */
  pauseMinutes?: number | null;
  // Vergütung (Geld) des verknüpften Dienstmodells — für die Premium-
  // Lohnauswertung (Point 6). compensationPercent nur bei "percentage",
  // compensationFlatCents (Cent, dauerunabhängig) nur bei "flat".
  compensationType?: CompensationType | null;
  compensationPercent?: number | null;
  compensationFlatCents?: number | null;
}

export interface AllowancePercents {
  nightPercent: number;
  sundayPercent: number;
  holidayPercent: number;
}

export interface AssistantContractInfo {
  vacationDays?: number | null;
  /** Stundengenau verbrauchter Urlaub (maßgeblicher Zähler, Point 7). */
  vacationHoursUsed?: number | null;
  /** Vertragliche Wochenstunden — Basis für das monatliche Vertrags-Soll. */
  weeklyHours?: number | null;
  /** Vertragliche Arbeitstage/Woche — Basis der typischen Dienstlänge (Urlaubsstunden). */
  workdaysPerWeek?: number | null;
  /**
   * Vertragsbeginn — Basis der Wartezeit nach § 4 BUrlG (anteiliger Sockel in
   * den ersten 6 Beschäftigungsmonaten, siehe vacationPoolHours). Ohne Angabe
   * bleibt es beim vollen Sockel (Bestandsschutz für ältere Aufrufer).
   */
  startDate?: string | null;
}

// Typische Dienstlänge (Wochenstunden ÷ Arbeitstage/Woche) — identisch zu
// typicalShiftHours in vacation-hours.ts, hier bewusst lokal dupliziert, damit
// dieses Modul DB-/Express-frei bleibt (siehe Dateikopf-Kommentar).
function typicalShiftHoursLocal(
  contract: { weeklyHours?: number | null; workdaysPerWeek?: number | null } | null,
  fallbackPerDay: number,
): number {
  if (contract && (contract.weeklyHours ?? 0) > 0 && (contract.workdaysPerWeek ?? 0) > 0) {
    return Math.round(((contract.weeklyHours as number) / (contract.workdaysPerWeek as number)) * 100) / 100;
  }
  return fallbackPerDay;
}

/** Wochen-zu-Monats-Umrechnung: fester Durchschnittsfaktor (52 / 12), für jeden Monat gleich. */
const WEEKLY_TO_MONTHLY_FACTOR = 52 / 12;

export interface HoursBalanceRow {
  userId: number;
  userName: string;
  plannedHours: number;
  actualHours: number;
  balance: number;
  /**
   * Monatliches Vertrags-Soll (Bedarfsseite der Planung): vertragliche
   * Wochenstunden × 52/12 (fester Monats-Durchschnitt, für jeden Monat
   * gleich — keine Prorierung bei unterjährigem Vertragsbeginn/-ende,
   * analog zur contractForMonth-Regel: ein den Monat überlappender Vertrag
   * zählt voll). 0 ohne (passenden) Vertrag oder ohne hinterlegte
   * Wochenstunden. Dient dem Dienstplan-Stundenkonto als Planungs-Check
   * (Vertrag vs. bereits geplante Schichten) — unabhängig von `balance`
   * (das den Ist-Zeiten-Vergleich für die Lohnauswertung abbildet).
   */
  contractMonthlyTargetHours: number;
  workedHours: number;
  sickHours: number;
  vacationDaysTaken: number;
  vacationDaysUsed: number;
  vacationDaysRemaining: number;
  /** Stundengenau verbrauchter Urlaub (Point 7, AP 1) — spiegelt contract.vacationHoursUsed. */
  vacationHoursUsed: number;
  /** Verbleibender Urlaub in Stunden: vacationDays × vacationDailyHours − vacationHoursUsed. */
  vacationHoursRemaining: number;
  /** Typische Dienstlänge (Std/Urlaubstag) dieser Bilanz-Zeile — Vertrag oder Konto-Standardwert. */
  vacationDailyHours: number;
  valuedHours: number;
  vacationFulfilledHours: number;
  totalFulfilledHours: number;
  nightHours: number;
  nightSurchargeHours: number;
  sundayHours: number;
  sundaySurchargeHours: number;
  holidayHours: number;
  holidaySurchargeHours: number;
  nightPercent: number;
  sundayPercent: number;
  holidayPercent: number;
  /** Angewandte Abrechnungsart dieser Zeile. */
  billingMethod: BillingMethod;
  // --- Zukünftige Abrechnungskategorien (contract-first vorbereitet) ---
  // Optionale Felder; solange keine Erfassung existiert, liefert der Server 0.
  // Sie fließen NICHT in totalPay ein. Nur die Bereitschaften sind bereits
  // real befüllt (FIX-Schichten mit Schichtmodell "Bereitschaft").
  pausenzeitStunden: number;
  teamsitzungStunden: number;
  teamsitzungEuro: number;
  bereitschaftenAnzahl: number;
  bereitschaftsStunden: number;
  vertretungenAnzahl: number;
  vertretungsStunden: number;
  urlaubsabgeltungEuro: number;
  kindKrankTage: number;
  freistellungTage: number;
  freistellungStunden: number;
  abgesagtArbeitgeberStunden: number;
  abgesagtArbeitnehmerStunden: number;
  // Premium-Lohnauswertung. null, wenn kein Stundenlohn hinterlegt ist (dann
  // keine Geldwerte). Geldwerte folgen der Abrechnungsart (billingMethod) —
  // dieselbe Basis wie die Stunden-Spalten — plus Lohnfortzahlung (Urlaub/Krank
  // im Grundlohn, Abwesenheits-Zuschläge fortgezahlt).
  hourlyWage: number | null;
  basePay: number | null;
  nightSurchargePay: number | null;
  sundaySurchargePay: number | null;
  holidaySurchargePay: number | null;
  totalPay: number | null;
  // Abwesenheits-Anteile der Zuschläge (SV-pflichtig nach § 11 BUrlG / § 2 EFZG).
  // Stunden auf Urlaubs-/Kranktagen sind sozialversicherungspflichtig und
  // müssen separat von den § 3b EStG steuerfreien Arbeitstag-Zuschlägen
  // ausgewiesen werden.
  absenceNightHours: number;
  absenceNightSurchargeHours: number;
  absenceSundayHours: number;
  absenceSundaySurchargeHours: number;
  absenceHolidayHours: number;
  absenceHolidaySurchargeHours: number;
  absenceNightSurchargePay: number | null;
  absenceSundaySurchargePay: number | null;
  absenceHolidaySurchargePay: number | null;
}

function shiftHours(s: BalanceShift): number {
  return (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 3_600_000;
}

const isWorkShift = (s: BalanceShift) => !isAbsenceShiftType(s.type);

// Unterscheidet einen ganztägigen Abwesenheitseintrag (00:00–23:59, kein
// zugrundeliegender Dienst) von einer Abwesenheit, die einen konkret geplanten
// Dienst ersetzt (echte Schichtzeiten). Nur letztere zählt zum Soll (Plan) und
// trägt Zuschläge. Spiegelt isPlainFullDay der Engine (shift-metrics-resolve).
function isPlainFullDay(startTime: Date | string, endTime: Date | string): boolean {
  const s = new Date(startTime);
  const e = new Date(endTime);
  return (
    s.getUTCHours() === 0 &&
    s.getUTCMinutes() === 0 &&
    e.getUTCHours() === 23 &&
    e.getUTCMinutes() === 59
  );
}

/**
 * Berechnet die Soll/Ist-Auswertung eines Assistenten für einen Monat.
 *
 * - Geplante Stunden (`plannedHours`) zählen nur echte Arbeitsschichten
 *   (nicht Urlaub/Krank), aus Start-/Endzeit.
 * - Zuschlagsstunden ergeben sich aus den Roh-Stunden der Schicht mal den
 *   aktuellen Prozentsätzen (rückwirkend angewandt, daher hier statt beim
 *   Speichern).
 * - Erfüllte Stunden (`totalFulfilledHours`/`actualHours`) summieren gewertete
 *   Arbeits-, Urlaubs- und Krank-Stunden.
 * - `vacationDaysTaken` = Anzahl der Urlaubs-Schichten dieses Monats
 *   (eine Schicht = ein Tag), nicht der Jahreszähler aus dem Vertrag.
 * - `workedHours` = tatsächlich erfasste (bestätigte) Arbeits-Ist-Zeiten;
 *   Urlaub/Krank zählen plan-basiert und sind hier ausgenommen.
 */
export function computeHoursBalanceRow(params: {
  userId: number;
  userName: string;
  shifts: BalanceShift[];
  timeEntries: BalanceTimeEntry[];
  allowance: AllowancePercents;
  /**
   * Optionale Prozentsätze je Team (Schlüssel = teamId). Zuschläge sind pro
   * Konto (Team-Eigentümer) konfiguriert; enthält der Scope Teams
   * unterschiedlicher Eigentümer, gelten je Schicht die Prozente ihres Teams.
   * Ohne Eintrag (oder ohne teamId an der Schicht) gilt `allowance` als Fallback.
   */
  allowanceByTeam?: Map<number, AllowancePercents>;
  contract: AssistantContractInfo | null;
  /** Abrechnungsart dieses Assistenten; ohne Angabe SOLL (Bestandsschutz). */
  billingMethod?: BillingMethod;
  /**
   * Bruttostundenlohn (Premium-Lohnauswertung). null/undefined ⇒ keine
   * Geldwerte (alle *Pay-Felder null). Die Geldrechnung folgt der
   * Abrechnungsart (billingMethod) — gleiche Basis wie die Stunden-Spalten.
   */
  hourlyWage?: number | null;
  /**
   * Umrechnungsfaktor Stunden je Urlaubstag (vacationHoursPerDay des
   * Team-Kontos); ohne Angabe 8. Tage sind IMMER aus der Stunden-Buchhaltung
   * abgeleitet (vacationHoursUsed / hoursPerDay) — der Alt-Zähler
   * vacation_days_used existiert nicht mehr.
   */
  vacationHoursPerDay?: number | null;
  /**
   * Referenz-Arbeitstage/Woche bei Vollzeit (AP 2, fulltimeWorkdaysPerWeek des
   * Team-Kontos); ohne Angabe 5. Bestimmt zusammen mit den vertraglichen
   * Wochenstunden den Urlaubstopf in Stunden (vacationPoolHours).
   */
  fulltimeWorkdaysPerWeek?: number | null;
  /**
   * Bereits im laufenden Kalenderjahr tatsächlich erworbener Zusatzurlaub aus
   * monatlicher Mehrarbeit. Der Aufrufer aggregiert bestätigte work-Istzeiten
   * über das Jahr; eine Prognose darf hier ausdrücklich nicht einfließen.
   */
  vacationAufbauHours?: number;
  /**
   * Teamsitzungs-Gutschrift (Anzahl Team-Tage der Teams der Assistenzkraft ×
   * konfigurierte teamMeetingHours des jeweiligen Konto-Eigentümers). Wird vom
   * Aufrufer team-weise ermittelt (ein Team-Eintrag gilt für ALLE Mitglieder,
   * nicht nur den zugewiesenen Nutzer). Zählt als Arbeitszeit: Soll UND
   * Erfüllt (bilanz-neutral) sowie Grundlohn × Stundenlohn in BEIDEN
   * Abrechnungsarten (wie Lohnfortzahlung). Keine Zuschläge.
   */
  teamsitzungStunden?: number;
  /**
   * Konto-Schalter „Pausen von bezahlten Stunden abziehen" je Team
   * (Konto-Zeile des Team-Eigentümers, KONTO-GLOBAL — kein Team-Override).
   * Bei AN reduzieren die unbezahlten Pausenminuten die gewerteten Stunden
   * und den Grundlohn der Arbeitsdienste — in BEIDEN Abrechnungsarten
   * (SOLL: shifts.pauseMinutes, IST: time_tracking.pauseMinutes). Zur
   * Lesezeit angewandt (rückwirkend schaltbar). Zuschlagsstunden bleiben
   * unberührt (die zeitliche Lage der Pause ist unbekannt). Abwesenheiten
   * und Info-Kategorien tragen keine Pausen. Ohne Eintrag/teamId gilt
   * `deductPausesFallback` (Default false = Bestandsschutz).
   */
  deductPausesByTeam?: Map<number, boolean>;
  deductPausesFallback?: boolean;
  /**
   * Stichtag für die Wartezeit-Proration des Urlaubssockels (§ 4 BUrlG,
   * siehe vacationPoolHours). Ohne Angabe der aktuelle Zeitpunkt — pure
   * Funktion, daher vom Aufrufer explizit übergeben statt intern `new Date()`
   * zu bilden (Determinismus für Tests).
   */
  vacationRefDate?: Date;
}): HoursBalanceRow {
  const { userId, userName, timeEntries, allowance, allowanceByTeam, contract } = params;
  // Team-Einträge (Teamsitzungen) selbst tragen keine Stunden — die Gutschrift
  // kommt ausschließlich über params.teamsitzungStunden. Sie werden hier
  // komplett herausgefiltert, damit ein ganztägiger Team-Eintrag (00:00–23:59)
  // weder als Arbeitsschicht (24h Soll) noch als Abwesenheit zählt.
  // Rein informative Kategorien (Kind-krank, vom AN abgesagt, Urlaubsabgeltung)
  // werden VOR der Soll/Erfüllt-Rechnung in eigene Zähl-Spalten abgezweigt —
  // sie dürfen weder Soll noch Erfüllung noch Zuschläge/Lohn beeinflussen.
  const infoShifts = params.shifts.filter((s) => INFO_ONLY_SHIFT_TYPES.has(s.type));
  const shifts = params.shifts.filter(
    (s) => s.type !== "team" && !INFO_ONLY_SHIFT_TYPES.has(s.type)
  );
  const teamsitzungStunden = params.teamsitzungStunden ?? 0;
  const { nightPercent, sundayPercent, holidayPercent } = allowance;
  // Default SOLL = Bestandsschutz: ohne explizite Abrechnungsart bleibt alles planbasiert.
  const billingMethod: BillingMethod = params.billingMethod ?? "SOLL";

  const percentsForTeam = (teamId?: number | null): AllowancePercents =>
    (teamId != null ? allowanceByTeam?.get(teamId) : undefined) ?? allowance;
  const percentsFor = (s: BalanceShift): AllowancePercents => percentsForTeam(s.teamId);

  // Pausen-Abzug (Konto-Schalter je Team-Eigentümer): gewertete Stunden eines
  // Arbeitsdienstes/-eintrags abzüglich seiner Pausenminuten, nie unter 0.
  const deductPausesFor = (teamId?: number | null): boolean =>
    (teamId != null ? params.deductPausesByTeam?.get(teamId) : undefined) ??
    params.deductPausesFallback ??
    false;
  const effectiveValuedHours = (e: {
    valuedHours?: number | null;
    pauseMinutes?: number | null;
    teamId?: number | null;
  }): number => {
    const raw = e.valuedHours ?? 0;
    if (!deductPausesFor(e.teamId)) return raw;
    return Math.max(0, raw - (e.pauseMinutes ?? 0) / 60);
  };

  const workShifts = shifts.filter(isWorkShift);

  // Soll-Stunden (Plan) sind IMMER planbasiert, unabhängig von der Abrechnungsart.
  let plannedHours = workShifts.reduce((acc, s) => acc + shiftHours(s), 0);

  // Quelle der gewerteten Arbeits- und Zuschlagsstunden hängt an der Abrechnungsart:
  // SOLL = geplante FIX-Schichten, IST = tatsächlich erfasste (bestätigte) Ist-Zeiten.
  // Info-Kategorien haben ggf. Abwesenheits-Buchungen in der Zeiterfassung —
  // sie sind weder Arbeit noch Lohnfortzahlung und bleiben komplett außen vor.
  const isWorkEntry = (e: BalanceTimeEntry) =>
    !isAbsenceShiftType(e.shiftType ?? "") && !INFO_ONLY_SHIFT_TYPES.has(e.shiftType ?? "");
  const workEntries = timeEntries.filter(isWorkEntry);

  let valuedHours: number;
  let nightHours: number;
  let sundayHours: number;
  let holidayHours: number;
  let nightSurchargeHours: number;
  let sundaySurchargeHours: number;
  let holidaySurchargeHours: number;

  if (billingMethod === "IST") {
    valuedHours = workEntries.reduce((acc, e) => acc + effectiveValuedHours(e), 0);
    nightHours = workEntries.reduce((acc, e) => acc + (e.nightHours ?? 0), 0);
    sundayHours = workEntries.reduce((acc, e) => acc + (e.sundayHours ?? 0), 0);
    holidayHours = workEntries.reduce((acc, e) => acc + (e.holidayHours ?? 0), 0);
    nightSurchargeHours = workEntries.reduce(
      (acc, e) => acc + ((e.nightHours ?? 0) * percentsForTeam(e.teamId).nightPercent) / 100,
      0
    );
    sundaySurchargeHours = workEntries.reduce(
      (acc, e) => acc + ((e.sundayHours ?? 0) * percentsForTeam(e.teamId).sundayPercent) / 100,
      0
    );
    holidaySurchargeHours = workEntries.reduce(
      (acc, e) => acc + ((e.holidayHours ?? 0) * percentsForTeam(e.teamId).holidayPercent) / 100,
      0
    );
  } else {
    valuedHours = workShifts.reduce((acc, s) => acc + effectiveValuedHours(s), 0);
    nightHours = workShifts.reduce((acc, s) => acc + (s.nightHours ?? 0), 0);
    sundayHours = workShifts.reduce((acc, s) => acc + (s.sundayHours ?? 0), 0);
    holidayHours = workShifts.reduce((acc, s) => acc + (s.holidayHours ?? 0), 0);
    nightSurchargeHours = workShifts.reduce(
      (acc, s) => acc + ((s.nightHours ?? 0) * percentsFor(s).nightPercent) / 100,
      0
    );
    sundaySurchargeHours = workShifts.reduce(
      (acc, s) => acc + ((s.sundayHours ?? 0) * percentsFor(s).sundayPercent) / 100,
      0
    );
    holidaySurchargeHours = workShifts.reduce(
      (acc, s) => acc + ((s.holidayHours ?? 0) * percentsFor(s).holidayPercent) / 100,
      0
    );
  }

  // Zuschlagsfortzahlung bei Abwesenheit (Punkt 3): Deckt eine geplante Urlaubs-/
  // Krank-Schicht Zuschlags-relevante Stunden ab (z. B. ein 24h-Dienst mit
  // Nacht-/Feiertagsanteil), werden diese Zuschläge fortgezahlt — plan-basiert
  // und unabhängig von der Abrechnungsart, da für die Abwesenheit keine Ist-Zeit
  // existiert. Die Roh-Zuschlagsstunden liegen an der Abwesenheits-Schicht
  // gespeichert (resolveShiftMetrics erkennt 24h-Dienste).
  const absenceShifts = shifts.filter((s) => !isWorkShift(s));
  const absenceNightHours = absenceShifts.reduce((a, s) => a + (s.nightHours ?? 0), 0);
  const absenceSundayHours = absenceShifts.reduce((a, s) => a + (s.sundayHours ?? 0), 0);
  const absenceHolidayHours = absenceShifts.reduce((a, s) => a + (s.holidayHours ?? 0), 0);
  const absenceNightSurchargeHours = absenceShifts.reduce(
    (a, s) => a + ((s.nightHours ?? 0) * percentsFor(s).nightPercent) / 100,
    0
  );
  const absenceSundaySurchargeHours = absenceShifts.reduce(
    (a, s) => a + ((s.sundayHours ?? 0) * percentsFor(s).sundayPercent) / 100,
    0
  );
  const absenceHolidaySurchargeHours = absenceShifts.reduce(
    (a, s) => a + ((s.holidayHours ?? 0) * percentsFor(s).holidayPercent) / 100,
    0
  );

  nightHours += absenceNightHours;
  sundayHours += absenceSundayHours;
  holidayHours += absenceHolidayHours;
  nightSurchargeHours += absenceNightSurchargeHours;
  sundaySurchargeHours += absenceSundaySurchargeHours;
  holidaySurchargeHours += absenceHolidaySurchargeHours;

  // Punkt 2 (Lohnausfallprinzip): Eine Abwesenheit, die einen konkret geplanten
  // Dienst ersetzt (Primary-Lookup — echte Schichtzeiten statt ganztägig), zählt
  // wie der ersetzte Dienst zum Soll (Plan). Die Lohnfortzahlung erfüllt dieses
  // Soll (valuedHours der Abwesenheit), sodass die Bilanz neutral bleibt: ein 24h-
  // Dienst, der zu Krankheit wird, ergibt Soll 24 + Ist 24 = 0. Ein rein
  // ganztägiger Urlaubs-/Krank-Tag (00:00–23:59) zählt NICHT zum Soll
  // (Bestandsverhalten unverändert).
  const inheritedAbsenceHours = absenceShifts
    .filter((s) => !isPlainFullDay(s.startTime, s.endTime))
    .reduce((acc, s) => acc + shiftHours(s), 0);
  plannedHours += inheritedAbsenceHours;

  // Teamsitzungs-Gutschrift: zählt als Arbeitszeit zum Soll UND zu den
  // erfüllten Stunden (bilanz-neutral, wie ein geplanter und geleisteter
  // Dienst) — in beiden Abrechnungsarten, da für Teamsitzungen keine
  // Ist-Zeiten erfasst werden.
  plannedHours += teamsitzungStunden;

  const vacationShifts = shifts.filter((s) => s.type === "vacation");
  const vacationFulfilledHours = vacationShifts.reduce((acc, s) => acc + (s.valuedHours ?? 0), 0);
  const vacationDaysTaken = vacationShifts.length;
  const sickFulfilledHours = shifts
    .filter((s) => s.type === "sick")
    .reduce((acc, s) => acc + (s.valuedHours ?? 0), 0);
  // Bezahlte neue Kategorien: Freistellung + vom Arbeitgeber abgesagte Stunden
  // zählen wie Krankheit als Lohnfortzahlung in Erfüllt und Grundlohn.
  const freistellungShifts = shifts.filter((s) => s.type === "freistellung");
  const freistellungTage = freistellungShifts.length;
  const freistellungStunden = freistellungShifts.reduce(
    (acc, s) => acc + (s.valuedHours ?? 0),
    0
  );
  const abgesagtAgStunden = shifts
    .filter((s) => s.type === "abgesagt_ag")
    .reduce((acc, s) => acc + (s.valuedHours ?? 0), 0);
  const paidExtraFulfilledHours = freistellungStunden + abgesagtAgStunden;
  const totalFulfilledHours =
    valuedHours +
    vacationFulfilledHours +
    sickFulfilledHours +
    paidExtraFulfilledHours +
    teamsitzungStunden;

  let trackedHours = 0;
  for (const entry of timeEntries) {
    const hours = entry.actualHours ?? 0;
    if (isWorkEntry(entry)) {
      trackedHours += hours;
    }
  }

  // --- Informative Kategorien (kein Soll/Erfüllt/Lohn) ---
  const kindKrankTage = infoShifts.filter((s) => s.type === "kind_krank").length;
  // Gewertete Stunden (valuedHours) statt Roh-Dauer, damit ganztägige
  // Einträge (00:00–23:59) nicht als 24 h erscheinen — gleiche Basis wie
  // die bezahlten Abwesenheits-Kategorien.
  const abgesagtAnStunden = infoShifts
    .filter((s) => s.type === "abgesagt_an")
    .reduce((acc, s) => acc + (s.valuedHours ?? 0), 0);
  // Urlaubsabgeltung: Euro-Wert = Stundenlohn × gewertete Stunden der Einträge
  // (valuedHours = vertragliche Tages-Soll-Stunden bzw. geerbte Dienstzeiten).
  const urlaubsabgeltungStunden = infoShifts
    .filter((s) => s.type === "urlaubsabgeltung")
    .reduce((acc, s) => acc + (s.valuedHours ?? 0), 0);
  // Vertretungen: markierte Arbeitsdienste (Info; Stunden zählen zusätzlich normal).
  const vertretungsShifts = workShifts.filter((s) => s.isVertretung === true);
  const vertretungenAnzahl = vertretungsShifts.length;
  const vertretungsStunden = vertretungsShifts.reduce((acc, s) => acc + shiftHours(s), 0);
  // Unbezahlte Pausen (Info): Summe der Pausenminuten der Arbeitsdienste.
  const pausenzeitStunden =
    workShifts.reduce((acc, s) => acc + (s.pauseMinutes ?? 0), 0) / 60;

  // Bereitschaften sind eindeutig über das Schichtmodell "Bereitschaft"
  // (seeded Standard-Dienst) identifizierbar: Anzahl und Roh-Stunden der
  // geplanten FIX-Bereitschafts-Dienste dieses Monats — rein plan-strukturelle
  // Kennzahlen, unabhängig von der Abrechnungsart.
  const bereitschaftsShifts = workShifts.filter((s) => s.modelName === "Bereitschaft");
  const bereitschaftenAnzahl = bereitschaftsShifts.length;
  const bereitschaftsStunden = bereitschaftsShifts.reduce((acc, s) => acc + shiftHours(s), 0);

  const sickHours = sickFulfilledHours;
  const vacationDays = contract?.vacationDays ?? DEFAULT_VACATION_DAYS;
  // Urlaubstage IMMER aus der stundengenauen Buchhaltung ableiten (gerundet
  // auf 0,1 Tage, identisch zur Resturlaub-Bilanz in contracts.ts). Die
  // Stunden/Tag-Umrechnung nutzt die typische Dienstlänge aus dem Vertrag
  // (Wochenstunden ÷ Arbeitstage/Woche), sonst den Konto-Standardwert.
  const hoursPerDay = typicalShiftHoursLocal(contract ?? null, params.vacationHoursPerDay ?? 8);
  const vacationDaysUsed =
    Math.round(((contract?.vacationHoursUsed ?? 0) / hoursPerDay) * 10) / 10;
  // Urlaubstopf (AP 2): Urlaubswochen (aus dem Vollzeit-Anspruch) × TATSÄCHLICHE
  // Wochenstunden — ersetzt vacationDays × hoursPerDay, das Teilzeit über die
  // typische Dienstlänge indirekt schon berücksichtigte, aber nicht konsistent
  // mit der direkten Wochen-Umrechnung war.
  const vacationSockelHours =
    contract && (contract.weeklyHours ?? 0) > 0
      ? vacationPoolHours(
          {
            vacationDays,
            weeklyHours: contract.weeklyHours as number,
            startDate: contract.startDate ?? undefined,
          },
          { fulltimeWorkdaysPerWeek: params.fulltimeWorkdaysPerWeek ?? 5 },
          undefined,
          params.vacationRefDate ?? new Date(),
        )
      : round2(vacationDays * hoursPerDay);
  const vacationHoursTotal = round2(
    vacationSockelHours + Math.max(0, params.vacationAufbauHours ?? 0),
  );
  const vacationHoursUsedTotal = round2(contract?.vacationHoursUsed ?? 0);

  // Premium-Lohnauswertung: Geldwerte folgen der Abrechnungsart (billingMethod)
  // — dieselbe Basis wie die Stunden-Spalten, damit Stunden und Geld auf einer
  // Seite nie widersprüchlich sind. SOLL: geplante FIX-Arbeitsdienste (Vergütungs-
  // typ aus dem Schichtmodell der Schicht); IST: bestätigte Ist-Zeiten. Zusätzlich
  // Lohnfortzahlung: Urlaub/Krank fließen mit Stundenlohn × valuedHours in den
  // Grundlohn ein (Grundlohn deckt „Erfüllt gesamt" ab). Die Zuschlags-Vergütung
  // nutzt die bereits nach Abrechnungsart berechneten Zuschlagsstunden inklusive
  // der Abwesenheits-Zuschlagsfortzahlung. Ohne hinterlegten Stundenlohn (null)
  // gibt es keine Geldwerte.
  const wage = params.hourlyWage ?? null;
  let basePay: number | null = null;
  let nightSurchargePay: number | null = null;
  let sundaySurchargePay: number | null = null;
  let holidaySurchargePay: number | null = null;
  let totalPay: number | null = null;
  if (wage != null) {
    let base = 0;
    const addBase = (entry: {
      hours: number;
      compensationType?: CompensationType | null;
      compensationPercent?: number | null;
      compensationFlatCents?: number | null;
    }) => {
      const compType = entry.compensationType ?? "regular";
      if (compType === "flat") {
        // Festbetrag pro Schicht (dauerunabhängig).
        base += (entry.compensationFlatCents ?? 0) / 100;
      } else if (compType === "percentage") {
        base += wage * entry.hours * ((entry.compensationPercent ?? 100) / 100);
      } else {
        base += wage * entry.hours;
      }
    };
    if (billingMethod === "IST") {
      for (const e of workEntries) {
        // Pausen-Abzug auch im Grundlohn (gleiche Basis wie die Stunden-Spalte).
        const hours =
          e.valuedHours != null ? effectiveValuedHours(e) : (e.actualHours ?? 0);
        addBase({ ...e, hours });
      }
    } else {
      for (const s of workShifts) {
        addBase({ ...s, hours: effectiveValuedHours(s) });
      }
    }
    // Lohnfortzahlung: Urlaub/Krank sowie bezahlte Freistellung und vom
    // Arbeitgeber abgesagte Stunden zählen zum Grundlohn (immer regulär).
    base += wage * (vacationFulfilledHours + sickFulfilledHours + paidExtraFulfilledHours);
    // Teamsitzungs-Vergütung: Stundenlohn × gutgeschriebene Team-Stunden
    // (beide Abrechnungsarten, wie Lohnfortzahlung; keine Zuschläge).
    base += wage * teamsitzungStunden;
    basePay = round2(base);
    // Zuschlags-Vergütung = Zuschlagsstunden (nach Abrechnungsart, inkl.
    // Abwesenheits-Fortzahlung) × Stundenlohn.
    nightSurchargePay = round2(nightSurchargeHours * wage);
    sundaySurchargePay = round2(sundaySurchargeHours * wage);
    holidaySurchargePay = round2(holidaySurchargeHours * wage);
    totalPay = round2(basePay + nightSurchargePay + sundaySurchargePay + holidaySurchargePay);
  }

  const contractMonthlyTargetHours = round2(
    (contract?.weeklyHours ?? 0) * WEEKLY_TO_MONTHLY_FACTOR,
  );

  return {
    userId,
    userName,
    plannedHours: round2(plannedHours),
    actualHours: round2(totalFulfilledHours),
    balance: round2(totalFulfilledHours - plannedHours),
    contractMonthlyTargetHours,
    workedHours: round2(trackedHours),
    sickHours: round2(sickHours),
    vacationDaysTaken,
    vacationDaysUsed,
    vacationDaysRemaining:
      Math.round(((vacationHoursTotal - vacationHoursUsedTotal) / hoursPerDay) * 10) / 10,
    vacationHoursUsed: vacationHoursUsedTotal,
    vacationHoursRemaining: round2(vacationHoursTotal - vacationHoursUsedTotal),
    vacationDailyHours: hoursPerDay,
    valuedHours: round2(valuedHours),
    vacationFulfilledHours: round2(vacationFulfilledHours),
    totalFulfilledHours: round2(totalFulfilledHours),
    nightHours: round2(nightHours),
    nightSurchargeHours: round2(nightSurchargeHours),
    sundayHours: round2(sundayHours),
    sundaySurchargeHours: round2(sundaySurchargeHours),
    holidayHours: round2(holidayHours),
    holidaySurchargeHours: round2(holidaySurchargeHours),
    nightPercent,
    sundayPercent,
    holidayPercent,
    billingMethod,
    // Weitere Abrechnungskategorien (informativ; bezahlte Anteile stecken
    // bereits in basePay, urlaubsabgeltungEuro fließt NICHT in totalPay ein).
    pausenzeitStunden: round2(pausenzeitStunden),
    teamsitzungStunden: round2(teamsitzungStunden),
    teamsitzungEuro: wage != null ? round2(wage * teamsitzungStunden) : 0,
    bereitschaftenAnzahl,
    bereitschaftsStunden: round2(bereitschaftsStunden),
    vertretungenAnzahl,
    vertretungsStunden: round2(vertretungsStunden),
    urlaubsabgeltungEuro: wage != null ? round2(wage * urlaubsabgeltungStunden) : 0,
    kindKrankTage,
    freistellungTage,
    freistellungStunden: round2(freistellungStunden),
    abgesagtArbeitgeberStunden: round2(abgesagtAgStunden),
    abgesagtArbeitnehmerStunden: round2(abgesagtAnStunden),
    hourlyWage: wage,
    basePay,
    nightSurchargePay,
    sundaySurchargePay,
    holidaySurchargePay,
    totalPay,
    // Abwesenheits-Anteile der Zuschläge (§ 11 BUrlG / § 2 EFZG):
    // Diese Stunden entstehen auf Urlaubs-/Krankheitstagen und sind
    // SV-pflichtig (im Gegensatz zu § 3b EStG steuerfreien Arbeitstag-
    // Zuschlägen). Separat ausgewiesen, damit das PDF den Unterschied
    // für die Lohnbuchhaltung sichtbar macht.
    absenceNightHours: round2(absenceNightHours),
    absenceNightSurchargeHours: round2(absenceNightSurchargeHours),
    absenceSundayHours: round2(absenceSundayHours),
    absenceSundaySurchargeHours: round2(absenceSundaySurchargeHours),
    absenceHolidayHours: round2(absenceHolidayHours),
    absenceHolidaySurchargeHours: round2(absenceHolidaySurchargeHours),
    absenceNightSurchargePay: wage != null ? round2(absenceNightSurchargeHours * wage) : null,
    absenceSundaySurchargePay: wage != null ? round2(absenceSundaySurchargeHours * wage) : null,
    absenceHolidaySurchargePay: wage != null ? round2(absenceHolidaySurchargeHours * wage) : null,
  };
}
