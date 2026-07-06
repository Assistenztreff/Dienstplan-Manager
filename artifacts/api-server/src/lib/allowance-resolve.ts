import { db } from "@workspace/db";
import { allowanceSettingsTable, teamsTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";

// Aufgelöste Konto-/Team-Einstellungen für Auto-Genehmigung und Urlaubsberechnung.
// Fallback-Kette überall: Team-Override (team_id gesetzt) → Konto-Zeile des
// Team-Eigentümers (team_id NULL) → Defaults. Nie die Einstellungen eines
// fremden Kontos.
export interface ResolvedAllowanceOps {
  autoApproveTimesheets: boolean;
  vacationMethod: "bwavg" | "factor";
  vacationHoursPerDay: number;
  vacationFactor: number;
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
  state: null,
  ersatzruhetagEnabled: true,
};

const opsColumns = {
  autoApproveTimesheets: allowanceSettingsTable.autoApproveTimesheets,
  vacationMethod: allowanceSettingsTable.vacationMethod,
  vacationHoursPerDay: allowanceSettingsTable.vacationHoursPerDay,
  vacationFactor: allowanceSettingsTable.vacationFactor,
  state: allowanceSettingsTable.state,
  ersatzruhetagEnabled: allowanceSettingsTable.ersatzruhetagEnabled,
};

// Löst die betrieblichen Einstellungen (Auto-Genehmigung, Urlaub) für ein Team
// auf. Ohne Team gelten die Defaults.
export async function resolveAllowanceOps(
  teamId: number | null
): Promise<ResolvedAllowanceOps> {
  if (teamId == null) return { ...DEFAULT_ALLOWANCE_OPS };

  const [override] = await db
    .select(opsColumns)
    .from(allowanceSettingsTable)
    .where(eq(allowanceSettingsTable.teamId, teamId))
    .limit(1);
  if (override) return override;

  const [ownerRow] = await db
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
