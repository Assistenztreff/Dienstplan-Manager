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
}

/** Abrechnungsart: SOLL = nach Plan, IST = nach erfassten Ist-Zeiten. */
export type BillingMethod = "SOLL" | "IST";

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
}

export interface AllowancePercents {
  nightPercent: number;
  sundayPercent: number;
  holidayPercent: number;
}

export interface AssistantContractInfo {
  vacationDays?: number | null;
  vacationDaysUsed?: number | null;
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
}

function shiftHours(s: BalanceShift): number {
  return (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 3_600_000;
}

const isWorkShift = (s: BalanceShift) => s.type !== "vacation" && s.type !== "sick";

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
  const plannedHours = workShifts.reduce((acc, s) => acc + shiftHours(s), 0);

  // Quelle der gewerteten Arbeits- und Zuschlagsstunden hängt an der Abrechnungsart:
  // SOLL = geplante FIX-Schichten, IST = tatsächlich erfasste (bestätigte) Ist-Zeiten.
  const isWorkEntry = (e: BalanceTimeEntry) =>
    e.shiftType !== "sick" && e.shiftType !== "vacation";
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
    if (entry.shiftType !== "sick" && entry.shiftType !== "vacation") {
      trackedHours += hours;
    }
  }

  const sickHours = sickFulfilledHours;
  const vacationDays = contract?.vacationDays ?? DEFAULT_VACATION_DAYS;
  const vacationDaysUsed = contract?.vacationDaysUsed ?? 0;

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
    vacationDaysRemaining: vacationDays - vacationDaysUsed,
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
  };
}
