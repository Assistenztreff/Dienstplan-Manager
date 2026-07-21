// Reine Berechnungslogik für die Soll/Ist-Auswertung (Admin-Zweig von
// /dashboard/hours-balance). Bewusst frei von DB- und Express-Abhängigkeiten,
// damit die komplexe Zuschlags- und Urlaubsrechnung (Nacht-/Sonntags-/
// Feiertagsprozente werden rückwirkend angewandt, Trennung Arbeit vs.
// Urlaub/Krank, Zählung der Urlaubstage pro Monat) isoliert per Unit-Test
// abgesichert werden kann.

export const DEFAULT_NIGHT_PERCENT = 25;
export const DEFAULT_SUNDAY_PERCENT = 50;
export const DEFAULT_HOLIDAY_PERCENT = 100;
export const DEFAULT_VACATION_DAYS = 30;

export const round2 = (n: number) => Math.round(n * 100) / 100;

// Abwesenheits-Schichtarten: Urlaub, Krankheit UND "freizeitausgleich"
// (Ersatzruhetag nach § 11 Abs. 3 ArbZG — ein bezahlter freier Tag, KEINE
// Arbeitszeit). Muss mit isAbsenceType (shift-metrics-resolve) übereinstimmen;
// bewusst lokal dupliziert, damit dieses Modul DB-/Express-frei bleibt.
const ABSENCE_SHIFT_TYPES = new Set(["vacation", "sick", "freizeitausgleich"]);
const isAbsenceShiftType = (type: string): boolean => ABSENCE_SHIFT_TYPES.has(type);

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
}

export interface HoursBalanceRow {
  userId: number;
  userName: string;
  plannedHours: number;
  actualHours: number;
  balance: number;
  workedHours: number;
  sickHours: number;
  vacationDaysTaken: number;
  vacationDaysUsed: number;
  vacationDaysRemaining: number;
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
    s.getHours() === 0 &&
    s.getMinutes() === 0 &&
    e.getHours() === 23 &&
    e.getMinutes() === 59
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
}): HoursBalanceRow {
  const { userId, userName, shifts, timeEntries, allowance, allowanceByTeam, contract } = params;
  const { nightPercent, sundayPercent, holidayPercent } = allowance;
  // Default SOLL = Bestandsschutz: ohne explizite Abrechnungsart bleibt alles planbasiert.
  const billingMethod: BillingMethod = params.billingMethod ?? "SOLL";

  const percentsForTeam = (teamId?: number | null): AllowancePercents =>
    (teamId != null ? allowanceByTeam?.get(teamId) : undefined) ?? allowance;
  const percentsFor = (s: BalanceShift): AllowancePercents => percentsForTeam(s.teamId);

  const workShifts = shifts.filter(isWorkShift);

  // Soll-Stunden (Plan) sind IMMER planbasiert, unabhängig von der Abrechnungsart.
  let plannedHours = workShifts.reduce((acc, s) => acc + shiftHours(s), 0);

  // Quelle der gewerteten Arbeits- und Zuschlagsstunden hängt an der Abrechnungsart:
  // SOLL = geplante FIX-Schichten, IST = tatsächlich erfasste (bestätigte) Ist-Zeiten.
  const isWorkEntry = (e: BalanceTimeEntry) => !isAbsenceShiftType(e.shiftType ?? "");
  const workEntries = timeEntries.filter(isWorkEntry);

  let valuedHours: number;
  let nightHours: number;
  let sundayHours: number;
  let holidayHours: number;
  let nightSurchargeHours: number;
  let sundaySurchargeHours: number;
  let holidaySurchargeHours: number;

  if (billingMethod === "IST") {
    valuedHours = workEntries.reduce((acc, e) => acc + (e.valuedHours ?? 0), 0);
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
    valuedHours = workShifts.reduce((acc, s) => acc + (s.valuedHours ?? 0), 0);
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

  const vacationShifts = shifts.filter((s) => s.type === "vacation");
  const vacationFulfilledHours = vacationShifts.reduce((acc, s) => acc + (s.valuedHours ?? 0), 0);
  const vacationDaysTaken = vacationShifts.length;
  const sickFulfilledHours = shifts
    .filter((s) => s.type === "sick")
    .reduce((acc, s) => acc + (s.valuedHours ?? 0), 0);
  const totalFulfilledHours = valuedHours + vacationFulfilledHours + sickFulfilledHours;

  let trackedHours = 0;
  for (const entry of timeEntries) {
    const hours = entry.actualHours ?? 0;
    if (!isAbsenceShiftType(entry.shiftType ?? "")) {
      trackedHours += hours;
    }
  }

  // --- Zukünftige Abrechnungskategorien ---
  // Bereitschaften sind bereits eindeutig über das Schichtmodell "Bereitschaft"
  // (seeded Standard-Dienst) identifizierbar: Anzahl und Roh-Stunden der
  // geplanten FIX-Bereitschafts-Dienste dieses Monats — rein plan-strukturelle
  // Kennzahlen, unabhängig von der Abrechnungsart. Alle übrigen Kategorien
  // (Pausen, Teamsitzungen, Vertretungen, Urlaubsabgeltung, Kind-krank,
  // Freistellung, abgesagte Stunden) haben noch KEINE Datenquelle und bleiben
  // bewusst 0 — keine Fake-Berechnungen; spätere Erfassungs-Features müssen
  // nur noch Werte liefern.
  const bereitschaftsShifts = workShifts.filter((s) => s.modelName === "Bereitschaft");
  const bereitschaftenAnzahl = bereitschaftsShifts.length;
  const bereitschaftsStunden = bereitschaftsShifts.reduce((acc, s) => acc + shiftHours(s), 0);

  const sickHours = sickFulfilledHours;
  const vacationDays = contract?.vacationDays ?? DEFAULT_VACATION_DAYS;
  // Urlaubstage IMMER aus der stundengenauen Buchhaltung ableiten (gerundet
  // auf 0,1 Tage, identisch zur Resturlaub-Bilanz in contracts.ts).
  const hoursPerDay = params.vacationHoursPerDay ?? 8;
  const vacationDaysUsed =
    Math.round(((contract?.vacationHoursUsed ?? 0) / hoursPerDay) * 10) / 10;

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
        addBase({ ...e, hours: e.valuedHours ?? e.actualHours ?? 0 });
      }
    } else {
      for (const s of workShifts) {
        addBase({ ...s, hours: s.valuedHours ?? 0 });
      }
    }
    // Lohnfortzahlung: Urlaub/Krank zählen zum Grundlohn (immer regulär).
    base += wage * (vacationFulfilledHours + sickFulfilledHours);
    basePay = round2(base);
    // Zuschlags-Vergütung = Zuschlagsstunden (nach Abrechnungsart, inkl.
    // Abwesenheits-Fortzahlung) × Stundenlohn.
    nightSurchargePay = round2(nightSurchargeHours * wage);
    sundaySurchargePay = round2(sundaySurchargeHours * wage);
    holidaySurchargePay = round2(holidaySurchargeHours * wage);
    totalPay = round2(basePay + nightSurchargePay + sundaySurchargePay + holidaySurchargePay);
  }

  return {
    userId,
    userName,
    plannedHours: round2(plannedHours),
    actualHours: round2(totalFulfilledHours),
    balance: round2(totalFulfilledHours - plannedHours),
    workedHours: round2(trackedHours),
    sickHours: round2(sickHours),
    vacationDaysTaken,
    vacationDaysUsed,
    vacationDaysRemaining: Math.round((vacationDays - vacationDaysUsed) * 10) / 10,
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
    // Zukünftige Abrechnungskategorien: Bereitschaften real, Rest 0 (s. o.).
    pausenzeitStunden: 0,
    teamsitzungStunden: 0,
    teamsitzungEuro: 0,
    bereitschaftenAnzahl,
    bereitschaftsStunden: round2(bereitschaftsStunden),
    vertretungenAnzahl: 0,
    vertretungsStunden: 0,
    urlaubsabgeltungEuro: 0,
    kindKrankTage: 0,
    freistellungTage: 0,
    freistellungStunden: 0,
    abgesagtArbeitgeberStunden: 0,
    abgesagtArbeitnehmerStunden: 0,
    hourlyWage: wage,
    basePay,
    nightSurchargePay,
    sundaySurchargePay,
    holidaySurchargePay,
    totalPay,
  };
}
