import { db } from "@workspace/db";
import { teamsTable, teamMembersTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";

/**
 * Liefert das Standard-Team-Kontext eines Nutzers für neu erstellte Datensätze.
 * Bevorzugt ein vom Nutzer besessenes Team (Admin), sonst die erste
 * Mitgliedschaft. In Stufe 1 existiert pro Account genau ein Team.
 */
export async function resolveTeamId(userId: number): Promise<number | null> {
  const [owned] = await db
    .select({ id: teamsTable.id })
    .from(teamsTable)
    .where(eq(teamsTable.ownerId, userId))
    .orderBy(asc(teamsTable.id))
    .limit(1);
  if (owned) return owned.id;

  const [member] = await db
    .select({ id: teamMembersTable.teamId })
    .from(teamMembersTable)
    .where(eq(teamMembersTable.userId, userId))
    .orderBy(asc(teamMembersTable.teamId))
    .limit(1);
  return member?.id ?? null;
}
