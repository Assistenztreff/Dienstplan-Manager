import { db } from "@workspace/db";
import { allowanceSettingsTable, teamsTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";

// Globale db-Instanz ODER eine offene Drizzle-Transaktion.
type AllowanceDbx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

// Aufgelöste Konto-/Team-Einstellungen für Auto-Genehmigung und Urlaubsberechnung.
// Fallback-Kette überall: Team-Override (team_id gesetzt) → Konto-Zeile des
// Team-Eigentümers (team_id NULL) → Defaults. Nie die Einstellungen eines
// fremden Kontos.
export interface ResolvedAllowanceOps {
  autoApproveTimesheets: boolean;
  vacationMethod: "bwavg" | "factor";
  vacationHoursPerDay: number;
  vacationFactor: number;
  // Referenz für die anteilige Urlaubsberechnung (AP 2): "30 Tage Urlaub"
  // im Arbeitsvertrag meint immer eine Vollzeitstelle, Teilzeit wird daraus
  // abgeleitet.
  fulltimeWorkdaysPerWeek: number;
  fulltimeWeeklyHours: number;
  // Vorbelegung des Feldes "Urlaubsanspruch bei Vollzeit" bei neuen Verträgen.
  defaultVacationDays: number;
  // Bundesland für die Feiertagserkennung (z. B. Ersatzruhetag-Konto). null =
  // nur bundesweite Feiertage.
  state: string | null;
  // Ersatzruhetag-Konto (§ 11 Abs. 3 ArbZG) aktiv? false = keine Gutschrift für
  // Feiertagsarbeit.
  ersatzruhetagEnabled: boolean;
}

export const DEFAULT_ALLOWANCE_OPS: ResolvedAllowanceOps = {
  autoApproveTimesheets: false,
  vacationMethod: "bwavg",
  vacationHoursPerDay: 8,
  vacationFactor: 0.0941,
  fulltimeWorkdaysPerWeek: 5,
  fulltimeWeeklyHours: 39,
  defaultVacationDays: 30,
  state: null,
  ersatzruhetagEnabled: true,
};

const opsColumns = {
  autoApproveTimesheets: allowanceSettingsTable.autoApproveTimesheets,
  vacationMethod: allowanceSettingsTable.vacationMethod,
  vacationHoursPerDay: allowanceSettingsTable.vacationHoursPerDay,
  vacationFactor: allowanceSettingsTable.vacationFactor,
  fulltimeWorkdaysPerWeek: allowanceSettingsTable.fulltimeWorkdaysPerWeek,
  fulltimeWeeklyHours: allowanceSettingsTable.fulltimeWeeklyHours,
  defaultVacationDays: allowanceSettingsTable.defaultVacationDays,
  state: allowanceSettingsTable.state,
  ersatzruhetagEnabled: allowanceSettingsTable.ersatzruhetagEnabled,
};

// Löst die betrieblichen Einstellungen (Auto-Genehmigung, Urlaub) für ein Team
// auf. Ohne Team gelten die Defaults.
//
// `dbx` erlaubt das Lesen INNERHALB einer offenen Transaktion: Sammelaufträge
// berechnen aus diesen Einstellungen Stunden, die sie in derselben Transaktion
// schreiben — eine Einstellungsänderung darf nicht dazwischenfallen.
export async function resolveAllowanceOps(
  teamId: number | null,
  dbx: AllowanceDbx = db
): Promise<ResolvedAllowanceOps> {
  if (teamId == null) return { ...DEFAULT_ALLOWANCE_OPS };

  const [override] = await dbx
    .select(opsColumns)
    .from(allowanceSettingsTable)
    .where(eq(allowanceSettingsTable.teamId, teamId))
    .limit(1);
  if (override) return override;

  const [ownerRow] = await dbx
    .select(opsColumns)
    .from(teamsTable)
    .innerJoin(
      allowanceSettingsTable,
      and(
        eq(allowanceSettingsTable.ownerId, teamsTable.ownerId),
        isNull(allowanceSettingsTable.teamId)
      )
    )
    .where(eq(teamsTable.id, teamId))
    .limit(1);
  if (ownerRow) return ownerRow;

  return { ...DEFAULT_ALLOWANCE_OPS };
}
