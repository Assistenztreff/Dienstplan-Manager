// ---------------------------------------------------------------------------
// Wiederverwendbare Lohnauswertungs-Berechnung (Soll/Ist-Stundenbilanz).
// ---------------------------------------------------------------------------
// Extrahiert aus GET /dashboard/hours-balance, damit der Monatsabschluss
// (POST /month-closings) und die Nachberechnung (GET /month-closings/diff)
// EXAKT dieselben Zahlen einfrieren bzw. vergleichen, die die Auswertung
// anzeigt — keine zweite, driftende Implementierung.
// ---------------------------------------------------------------------------

import { db } from "@workspace/db";
import {
  usersTable,
  shiftsTable,
  timeTrackingTable,
  contractsTable,
  allowanceSettingsTable,
  teamMembersTable,
  teamsTable,
  shiftModelsTable,
} from "@workspace/db";
import { computeShiftMetrics, type GermanState } from "@workspace/db";
import { eq, and, sql, or, isNull, inArray, gte, lt } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { resolveAllowanceOps, type ResolvedAllowanceOps } from "./allowance-resolve";
import { resolveReadTeamScope } from "./teams";
import {
  computeHoursBalanceRow,
  resolveEffectiveBillingMethod,
  DEFAULT_NIGHT_PERCENT,
  DEFAULT_SUNDAY_PERCENT,
  DEFAULT_HOLIDAY_PERCENT,
  type HoursBalanceRow,
} from "./dashboard-hours-balance";
import { getTimeTrackingEnabledTeamIds } from "./time-tracking-enabled";

/**
 * Berechnet die Stundenbilanz-Zeilen (inkl. Geldwerten) fuer den Team-Scope
 * des anfragenden Admins. Liefert `null`, wenn das angefragte Team nicht im
 * erlaubten Scope liegt (Aufrufer antwortet mit 403).
 */
export async function computeHoursBalances(
  callerUserId: number,
  month: number,
  year: number,
  requestedTeamId?: number,
): Promise<HoursBalanceRow[] | null> {
  const teamScope = await resolveReadTeamScope(callerUserId, requestedTeamId);
  if (teamScope === null) return null;

  // Rein team-gescoped: gezählt werden ausschließlich Mitglieder und
  // Schichten/Ist-Zeiten der Teams im aktuellen Scope (Team-Filter bzw. alle
  // erlaubten Teams).
  // Sargable Monatsgrenzen: Date-Objekte für Timestamp-Spalten (start_time,
  // actual_start), Strings für Date-Spalten (start_date, end_date in contracts).
  const monthStartDate = new Date(Date.UTC(year, month - 1, 1));
  const monthEndDate = new Date(Date.UTC(year, month, 1));
  const monthStart = monthStartDate.toISOString().split("T")[0]!;
  const monthEnd = new Date(Date.UTC(year, month, 0)).toISOString().split("T")[0]!;

  const overrideSettings = alias(allowanceSettingsTable, "override_settings");

  // Diese fünf Abfragen sind voneinander unabhängig (jede hängt nur von
  // teamScope/callerUserId/Monatsgrenzen ab, keine von einer anderen
  // Ergebnismenge) — parallel statt seriell ausführen, statt fünf
  // Roundtrips nacheinander abzuwarten.
  const [membershipRows, timeTrackingEnabledTeamIds, teamAllowanceRows, teamMeetingDayRows, ownAllowanceRows] =
    await Promise.all([
      // Rein team-gescoped: gezählt werden ausschließlich Mitglieder und
      // Schichten/Ist-Zeiten der Teams im aktuellen Scope (Team-Filter bzw.
      // alle erlaubten Teams).
      teamScope.length
        ? db
            .select({ userId: teamMembersTable.userId, teamId: teamMembersTable.teamId })
            .from(teamMembersTable)
            .where(inArray(teamMembersTable.teamId, teamScope))
        : Promise.resolve([]),

      // Konto-Schalter „Zeiterfassung aktivieren" je Team (Eigentümer-Konto,
      // Standard AUS): Ist die Zeiterfassung des maßgeblichen Teams
      // deaktiviert, wird die Abrechnungsart effektiv SOLL — die gesamte
      // Geldrechnung (Grundvergütung + Zuschläge) läuft dann aus den
      // geplanten FIX-Schichten, da keine IST-Zeiten entstehen können.
      getTimeTrackingEnabledTeamIds(teamScope),

      // Aktuelle Zuschlags-Prozentsätze: werden erst hier (nicht beim
      // Speichern der Schicht) angewandt, damit Änderungen rückwirkend
      // greifen. Fallback-Kette je Team im Scope: TEAM-OVERRIDE (team_id
      // gesetzt) → Konto-Zeile des Team-EIGENTÜMERS (team_id NULL) →
      // Defaults. Nie die Prozente eines fremden Kontos.
      teamScope.length
        ? db
            .select({
              teamId: teamsTable.id,
              overrideNightPercent: overrideSettings.nightPercent,
              overrideSundayPercent: overrideSettings.sundayPercent,
              overrideHolidayPercent: overrideSettings.holidayPercent,
              overrideNightStart: overrideSettings.nightStart,
              overrideNightEnd: overrideSettings.nightEnd,
              overrideState: overrideSettings.state,
              overrideBillingMethod: overrideSettings.billingMethod,
              nightPercent: allowanceSettingsTable.nightPercent,
              sundayPercent: allowanceSettingsTable.sundayPercent,
              holidayPercent: allowanceSettingsTable.holidayPercent,
              nightStart: allowanceSettingsTable.nightStart,
              nightEnd: allowanceSettingsTable.nightEnd,
              state: allowanceSettingsTable.state,
              billingMethod: allowanceSettingsTable.billingMethod,
              // KONTO-GLOBAL (nur Konto-Zeile des Team-Eigentümers, nie
              // Override): Stundenzahl der Teamsitzungs-Gutschrift je Team-Tag.
              teamMeetingHours: allowanceSettingsTable.teamMeetingHours,
              // KONTO-GLOBAL: Pausen von den bezahlten Stunden abziehen.
              deductPausesEnabled: allowanceSettingsTable.deductPausesEnabled,
            })
            .from(teamsTable)
            // LEFT JOINs: Hat ein Team weder Override noch der Eigentümer
            // eine Settings-Zeile (lazy angelegt), gelten die Defaults —
            // NIEMALS die Prozente des anfragenden Admins (sonst
            // Fremdeinfluss über Konto-Grenzen).
            .leftJoin(overrideSettings, eq(overrideSettings.teamId, teamsTable.id))
            .leftJoin(
              allowanceSettingsTable,
              and(
                eq(allowanceSettingsTable.ownerId, teamsTable.ownerId),
                isNull(allowanceSettingsTable.teamId)
              )
            )
            .where(inArray(teamsTable.id, teamScope))
        : Promise.resolve([]),

      // Team-Einträge (Teamsitzungen) des Monats je Team: EIN FIX-Eintrag
      // pro Tag schreibt ALLEN Mitgliedern des Teams die konfigurierten
      // Stunden gut. Gezählt werden DISTINCT Kalendertage (defensiv gegen
      // Alt-Duplikate).
      teamScope.length
        ? db
            .select({
              teamId: shiftsTable.teamId,
              days: sql<number>`COUNT(DISTINCT DATE(${shiftsTable.startTime}))`.mapWith(Number),
            })
            .from(shiftsTable)
            .where(
              and(
                inArray(shiftsTable.teamId, teamScope),
                eq(shiftsTable.type, "team"),
                eq(shiftsTable.planningStatus, "FIX"),
                // Sargable Bereichsprädikat aktiviert den (team_id, start_time)-Index.
                gte(shiftsTable.startTime, monthStartDate),
                lt(shiftsTable.startTime, monthEndDate),
              )
            )
            .groupBy(shiftsTable.teamId)
        : Promise.resolve([]),

      // Fallback/Anzeige-Prozente der Zeile: eigene Einstellungen des
      // anfragenden Admins (identisch mit dem Team-Eigentümer im Normalfall,
      // dass ein Admin seine eigenen Teams auswertet); ohne eigene Zeile die
      // Defaults.
      db
        .select()
        .from(allowanceSettingsTable)
        .where(
          and(
            eq(allowanceSettingsTable.ownerId, callerUserId),
            isNull(allowanceSettingsTable.teamId)
          )
        ),
    ]);

  const teamMemberIds = [...new Set(membershipRows.map((m) => m.userId))];
  // Mitgliedschaften je Nutzer — die Teamsitzungs-Gutschrift gilt für ALLE
  // Mitglieder des Teams eines Team-Eintrags, nicht nur für den zugewiesenen
  // Nutzer.
  const teamsByUser = new Map<number, number[]>();
  for (const m of membershipRows) {
    const list = teamsByUser.get(m.userId) ?? [];
    list.push(m.teamId);
    teamsByUser.set(m.userId, list);
  }

  // Braucht teamMemberIds (aus membershipRows oben) — kann daher nicht in
  // dieselbe Promise.all-Gruppe wie die fünf unabhängigen Abfragen.
  const assistants = teamMemberIds.length
    ? await db
        .select()
        .from(usersTable)
        .where(
          and(
            eq(usersTable.role, "assistant"),
            eq(usersTable.isActive, true),
            inArray(usersTable.id, teamMemberIds),
          )
        )
    : [];

  const timeTrackingEnabledTeams = new Set(timeTrackingEnabledTeamIds);
  const [ownAllowance] = ownAllowanceRows;
  const allowanceByTeam = new Map(
    teamAllowanceRows.map((r) => [
      r.teamId,
      {
        nightPercent: r.overrideNightPercent ?? r.nightPercent ?? DEFAULT_NIGHT_PERCENT,
        sundayPercent: r.overrideSundayPercent ?? r.sundayPercent ?? DEFAULT_SUNDAY_PERCENT,
        holidayPercent: r.overrideHolidayPercent ?? r.holidayPercent ?? DEFAULT_HOLIDAY_PERCENT,
      },
    ])
  );
  // Teamsitzungs-Stundenzahl je Team (Konto-Zeile des Team-Eigentümers,
  // Default 1.0) — angewandt wird IMMER der aktuell konfigurierte Wert
  // (rückwirkend, wie die Zuschlags-Prozente).
  const teamMeetingHoursByTeam = new Map(
    teamAllowanceRows.map((r) => [r.teamId, r.teamMeetingHours ?? 1])
  );
  // Pausen-Abzug je Team (Konto-Zeile des Team-Eigentümers, Default AUS =
  // Bestandsschutz: Pausen bleiben reine Info-Kennzahl).
  const deductPausesByTeam = new Map(
    teamAllowanceRows.map((r) => [r.teamId, r.deductPausesEnabled ?? false])
  );

  // teamMeetingDayRows kommt bereits aus der Promise.all-Gruppe oben.
  const teamMeetingDaysByTeam = new Map(
    teamMeetingDayRows.map((r) => [r.teamId, r.days])
  );

  // Nachtfenster, Bundesland und Abrechnungsart je Team — nötig, um im IST-Modus
  // die Zuschlagsstunden aus den erfassten Ist-Zeiten neu zu berechnen. Fallback
  // je Feld: Team-Override → Konto des Team-Eigentümers → Default.
  const DEFAULT_NIGHT_START = "23:00";
  const DEFAULT_NIGHT_END = "06:00";
  const teamMetaByTeam = new Map(
    teamAllowanceRows.map((r) => [
      r.teamId,
      {
        nightStart: r.overrideNightStart ?? r.nightStart ?? DEFAULT_NIGHT_START,
        nightEnd: r.overrideNightEnd ?? r.nightEnd ?? DEFAULT_NIGHT_END,
        state: (r.overrideState ?? r.state ?? null) as GermanState | null,
        billingMethod: (r.overrideBillingMethod ?? r.billingMethod ?? null) as
          | "SOLL"
          | "IST"
          | null,
      },
    ])
  );
  // ownAllowance kommt bereits aus der Promise.all-Gruppe oben (Fallback/
  // Anzeige-Prozente der Zeile: eigene Einstellungen des anfragenden Admins).
  // Ist ein KONKRETES Team angefragt, zeigen die Zeilen-Prozente die für dieses
  // Team tatsächlich angewandte Kette (Override → Eigentümer → Default) — sonst
  // stünde im PDF/der Tabelle z. B. "Sonntag (50%)", obwohl mit dem
  // Team-Override von 77% gerechnet wurde.
  const allowancePercents = (requestedTeamId != null
    ? allowanceByTeam.get(requestedTeamId)
    : undefined) ?? {
    nightPercent: ownAllowance?.nightPercent ?? DEFAULT_NIGHT_PERCENT,
    sundayPercent: ownAllowance?.sundayPercent ?? DEFAULT_SUNDAY_PERCENT,
    holidayPercent: ownAllowance?.holidayPercent ?? DEFAULT_HOLIDAY_PERCENT,
  };

  // Umrechnungsfaktor Stunden je Urlaubstag (vacationHoursPerDay) je
  // Vertrags-Team — die Urlaubstage-Spalten der Auswertung sind aus der
  // stundengenauen Buchhaltung abgeleitet (vacation_days_used existiert
  // nicht mehr). Cache je Team, um N+1-Lookups zu vermeiden.
  // Cache speichert das PROMISE selbst (nicht den aufgelösten Wert): die
  // Assistenzkräfte werden weiter unten parallel verarbeitet
  // (Promise.all), daher würde ein erst nach dem await gesetzter Cache-Wert
  // mehrere gleichzeitige Aufrufe für dasselbe Team alle als "Miss" sehen und
  // dieselbe Abfrage mehrfach auslösen (Race). Das Promise wird SOFORT
  // (synchron) im Cache abgelegt, sodass spätere Aufrufe für dasselbe Team —
  // auch während die erste Abfrage noch läuft — dasselbe Promise wiederverwenden.
  const vacationOpsByTeam = new Map<number, Promise<ResolvedAllowanceOps>>();
  const vacationOpsForTeam = (teamId: number): Promise<ResolvedAllowanceOps> => {
    let opsPromise = vacationOpsByTeam.get(teamId);
    if (!opsPromise) {
      opsPromise = resolveAllowanceOps(teamId);
      vacationOpsByTeam.set(teamId, opsPromise);
    }
    return opsPromise;
  };

  // ── Batch-Reads: ein Query je Datenquelle für alle Assistenzkräfte ─────────
  // Ersetzt N×3 Einzel-Queries (shifts + timeEntries + contractForMonth je
  // Assistenzkraft) durch 3 gebündelte IN(userIds)-Abfragen. Skaliert linear
  // statt quadratisch mit der Teamgröße.
  const assistantIds = assistants.map((a) => a.id);

  // Die drei Batch-Reads sind voneinander unabhängig (unterschiedliche
  // Tabellen, keine der drei Abfragen nutzt das Ergebnis einer anderen) —
  // parallel statt seriell abfragen. Der Helper hält den Element-Typ des
  // leeren Skip-Falls exakt am Typ der jeweiligen Query fest (ein direktes
  // `Promise.resolve([])` im Ternary wird sonst zu `never[]` verengt).
  const orEmpty = async <T,>(cond: boolean, run: () => Promise<T[]>): Promise<T[]> =>
    cond ? run() : [];

  const [allShifts, allTimeEntries, allContractsRaw] = await Promise.all([
    // Batch-Schichten: alle FIX-Schichten aller Assistenzkräfte in einem Query.
    // Sargable Bereichsprädikat aktiviert den (user_id, start_time)-Index.
    orEmpty(!!(assistantIds.length && teamScope.length), () =>
      db
        .select({
          userId: shiftsTable.userId,
          type: shiftsTable.type,
          startTime: shiftsTable.startTime,
          endTime: shiftsTable.endTime,
          valuedHours: shiftsTable.valuedHours,
          nightHours: shiftsTable.nightHours,
          sundayHours: shiftsTable.sundayHours,
          holidayHours: shiftsTable.holidayHours,
          teamId: shiftsTable.teamId,
          isVertretung: shiftsTable.isVertretung,
          pauseMinutes: shiftsTable.pauseMinutes,
          compensationType: shiftModelsTable.compensationType,
          compensationPercent: shiftModelsTable.compensationPercent,
          compensationFlatCents: shiftModelsTable.compensationFlatCents,
          // Modellname zur Erkennung von Bereitschafts-Diensten.
          modelName: shiftModelsTable.name,
        })
        .from(shiftsTable)
        .leftJoin(shiftModelsTable, eq(shiftsTable.shiftModelId, shiftModelsTable.id))
        .where(
          and(
            inArray(shiftsTable.userId, assistantIds),
            inArray(shiftsTable.teamId, teamScope),
            eq(shiftsTable.planningStatus, "FIX"),
            gte(shiftsTable.startTime, monthStartDate),
            lt(shiftsTable.startTime, monthEndDate),
          )
        )
    ),

    // Batch-Zeiteinträge: alle bestätigten Einträge aller Assistenzkräfte in einem Query.
    // Sargable Bereichsprädikat aktiviert den (team_id, actual_start)-Index.
    orEmpty(!!(assistantIds.length && teamScope.length), () =>
      db
        .select({
          userId: timeTrackingTable.userId,
          actualHours: timeTrackingTable.actualHours,
          actualStart: timeTrackingTable.actualStart,
          actualEnd: timeTrackingTable.actualEnd,
          pauseMinutes: timeTrackingTable.pauseMinutes,
          teamId: timeTrackingTable.teamId,
          shiftType: shiftsTable.type,
          compensationType: shiftModelsTable.compensationType,
          compensationPercent: shiftModelsTable.compensationPercent,
          compensationFlatCents: shiftModelsTable.compensationFlatCents,
        })
        .from(timeTrackingTable)
        .leftJoin(shiftsTable, eq(timeTrackingTable.shiftId, shiftsTable.id))
        .leftJoin(shiftModelsTable, eq(shiftsTable.shiftModelId, shiftModelsTable.id))
        .where(
          and(
            inArray(timeTrackingTable.userId, assistantIds),
            inArray(timeTrackingTable.teamId, teamScope),
            gte(timeTrackingTable.actualStart, monthStartDate),
            lt(timeTrackingTable.actualStart, monthEndDate),
            eq(timeTrackingTable.status, "confirmed"),
          )
        )
    ),

    // Batch-Verträge: ein Query für alle Assistenzkräfte statt N contractForMonth()-Aufrufe.
    // Gleiche Prioritäts-Logik: Scope-Verträge bevorzugen, dann neuester Beginn.
    orEmpty(!!assistantIds.length, () =>
      db
        .select()
        .from(contractsTable)
        .where(
          and(
            inArray(contractsTable.userId, assistantIds),
            sql`${contractsTable.startDate} <= ${monthEnd}`,
            or(
              isNull(contractsTable.endDate),
              sql`${contractsTable.endDate} >= ${monthStart}`
            )
          )
        )
    ),
  ]);
  const shiftsByUser = new Map<number, typeof allShifts>();
  for (const s of allShifts) {
    const list = shiftsByUser.get(s.userId) ?? [];
    list.push(s);
    shiftsByUser.set(s.userId, list);
  }
  const timeEntriesByUser = new Map<number, typeof allTimeEntries>();
  for (const e of allTimeEntries) {
    const list = timeEntriesByUser.get(e.userId) ?? [];
    list.push(e);
    timeEntriesByUser.set(e.userId, list);
  }
  const contractByUser = new Map<number, (typeof allContractsRaw)[number]>();
  {
    const scopeSet = new Set(teamScope);
    for (const userId of assistantIds) {
      const userContracts = allContractsRaw.filter((c) => c.userId === userId);
      if (!userContracts.length) continue;
      const byNewestStart = (
        a: (typeof userContracts)[number],
        b: (typeof userContracts)[number],
      ) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime();
      const inScope = userContracts.filter((c) => scopeSet.has(c.teamId));
      const candidates = inScope.length ? inScope : userContracts;
      contractByUser.set(userId, candidates.sort(byNewestStart)[0]!);
    }
  }

  const result = await Promise.all(
    assistants.map(async (assistant) => {
      // Batch-Lookup statt Einzel-Queries je Assistenzkraft (N+1-Vermeidung).
      const shifts = shiftsByUser.get(assistant.id) ?? [];
      const timeEntriesWithShift = timeEntriesByUser.get(assistant.id) ?? [];
      const contract = contractByUser.get(assistant.id) ?? null;

      // Abrechnungsart-Kette: Team-Override/Konto des Team-Eigentümers → SOLL
      // (Bestandsschutz-Default). Der frühere Vertrags-Override wurde bewusst
      // entfernt — die Abrechnungsart gilt einheitlich für ALLE Assistenzkräfte
      // eines Teams/Kontos. teamMetaByTeam faltet Override und
      // Team-Eigentümer-Konto bereits zusammen.
      // Für die Team-Ebene brauchen wir ein Team IM aktuellen Scope: bevorzugt
      // das Vertrags-Team (contractForMonth bevorzugt bereits Scope-Verträge,
      // kann aber — wenn NUR teamfremde Verträge existieren — noch ein fremdes
      // Team liefern), sonst das explizit angefragte Team, sonst — wenn der
      // Scope eindeutig ein einziges Team umfasst — dieses. Ohne eindeutiges
      // Team greift der SOLL-Default (auch wenn gar kein Vertrag existiert).
      const contractTeamId =
        contract?.teamId != null && teamMetaByTeam.has(contract.teamId)
          ? contract.teamId
          : undefined;
      const fallbackTeamId =
        contractTeamId ?? requestedTeamId ?? (teamScope.length === 1 ? teamScope[0] : undefined);
      const teamBilling =
        fallbackTeamId != null ? teamMetaByTeam.get(fallbackTeamId)?.billingMethod : null;
      const configuredBillingMethod: "SOLL" | "IST" = teamBilling ?? "SOLL";
      // Zeiterfassung deaktiviert (Konto-Schalter des Team-Eigentümers)?
      // Dann effektiv SOLL: komplette Geldrechnung aus den FIX-Schichten.
      // Ohne eindeutiges Team gilt der Schalter, wenn mindestens ein Team im
      // Scope die Zeiterfassung aktiviert hat.
      const timeTrackingEnabled =
        fallbackTeamId != null
          ? timeTrackingEnabledTeams.has(fallbackTeamId)
          : timeTrackingEnabledTeams.size > 0;
      const billingMethod = resolveEffectiveBillingMethod(
        configuredBillingMethod,
        timeTrackingEnabled,
      );

      // Im IST-Modus werden gewertete Stunden UND Zuschläge aus den tatsächlich
      // erfassten Zeiten je Eintrag berechnet (Nachtfenster/Bundesland des
      // jeweiligen Team-Kontos). Im SOLL-Modus bleiben die Roh-Kennzahlen der
      // Schicht maßgeblich — die Ist-Metriken werden dann nicht angesetzt.
      // Ist-Metriken je Eintrag werden IMMER berechnet: Stunden-Spalten UND
      // Geldrechnung nutzen sie im IST-Modus (im SOLL-Modus sind stattdessen
      // die Roh-Kennzahlen der Schichten maßgeblich — auch fürs Geld). Ohne
      // erfasste Ist-Zeiten bleibt es bei actualHours.
      const timeEntries = timeEntriesWithShift.map((e) => {
        const comp = {
          compensationType: e.compensationType,
          compensationPercent: e.compensationPercent,
          compensationFlatCents: e.compensationFlatCents,
        };
        if (!e.actualStart || !e.actualEnd) {
          return {
            actualHours: e.actualHours,
            shiftType: e.shiftType,
            teamId: e.teamId,
            pauseMinutes: e.pauseMinutes,
            ...comp,
          };
        }
        const meta = e.teamId != null ? teamMetaByTeam.get(e.teamId) : undefined;
        const metrics = computeShiftMetrics(
          {
            startTime: new Date(e.actualStart),
            endTime: new Date(e.actualEnd),
            isAbsence: false,
            valuationPercent: 100,
          },
          {
            nightStart: meta?.nightStart ?? DEFAULT_NIGHT_START,
            nightEnd: meta?.nightEnd ?? DEFAULT_NIGHT_END,
          },
          meta?.state ?? null,
        );
        return {
          actualHours: e.actualHours,
          shiftType: e.shiftType,
          teamId: e.teamId,
          pauseMinutes: e.pauseMinutes,
          valuedHours: metrics.valuedHours,
          nightHours: metrics.nightHours,
          sundayHours: metrics.sundayHours,
          holidayHours: metrics.holidayHours,
          ...comp,
        };
      });

      const vacationOps = contract ? await vacationOpsForTeam(contract.teamId) : null;

      // Teamsitzungs-Gutschrift: Summe über alle Teams, in denen die
      // Assistenzkraft Mitglied ist — Team-Tage × teamMeetingHours des
      // jeweiligen Team-Eigentümer-Kontos.
      const teamsitzungStunden = (teamsByUser.get(assistant.id) ?? []).reduce(
        (acc, tId) =>
          acc + (teamMeetingDaysByTeam.get(tId) ?? 0) * (teamMeetingHoursByTeam.get(tId) ?? 1),
        0
      );

      return computeHoursBalanceRow({
        userId: assistant.id,
        userName: assistant.name,
        shifts,
        timeEntries,
        allowance: allowancePercents,
        allowanceByTeam,
        contract,
        billingMethod,
        hourlyWage: assistant.hourlyWage,
        vacationHoursPerDay: vacationOps?.vacationHoursPerDay,
        fulltimeWorkdaysPerWeek: vacationOps?.fulltimeWorkdaysPerWeek,
        teamsitzungStunden,
        deductPausesByTeam,
      });
    })
  );

  return result;
}
