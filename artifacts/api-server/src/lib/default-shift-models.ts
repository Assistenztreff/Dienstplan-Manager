import { db, shiftModelsTable } from "@workspace/db";
import { DEFAULT_SHIFT_MODELS } from "@workspace/shift-defaults";
import { eq } from "drizzle-orm";

// Die Standard-Dienste-Liste lebt jetzt zentral in `@workspace/shift-defaults`
// (Single Source of Truth), damit Seeding (hier) und Backfill-Skript
// (scripts/src/backfill-team-shift-models.ts) nie auseinanderlaufen. Re-Export
// fuer bestehende Importe.
export { DEFAULT_SHIFT_MODELS };

// Legt die Standard-Dienste für ein frisch erstelltes Team an. Wird beim
// Registrieren, beim ersten Dev-Login (Anlage des Standard-Teams) und beim
// Anlegen weiterer Teams (POST /teams) aufgerufen. Idempotent: Hat das Team
// bereits Schichtmodelle, wird nichts angelegt (kein Doppel-Seeding).
export async function seedDefaultShiftModels(teamId: number): Promise<void> {
  const [existing] = await db
    .select({ id: shiftModelsTable.id })
    .from(shiftModelsTable)
    .where(eq(shiftModelsTable.teamId, teamId))
    .limit(1);
  if (existing) return;
  await db
    .insert(shiftModelsTable)
    .values(DEFAULT_SHIFT_MODELS.map((m) => ({ ...m, defaultWeekdays: [...m.defaultWeekdays], teamId })));
}
