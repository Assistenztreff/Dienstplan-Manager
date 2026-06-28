import { db, shiftModelsTable } from "@workspace/db";

// Standard-Dienste, die jedem neu registrierten Nutzer (genauer: dessen erstem,
// automatisch angelegten "Standard-Team") vorinstalliert werden. Damit startet
// der Dienstplan nicht mit leerer Dienste-Liste.
//
// Bewusst NICHT enthalten: Urlaub und Krankheit. Diese werden im System als
// Abwesenheiten (ganztägig, ohne Arbeitszeiten, als durchgehende Balken
// dargestellt) über den Schicht-Typ geführt — nicht als Schichtmodelle. Ein
// Seeding als reguläre Dienste würde dieses Abwesenheits-System duplizieren.
export const DEFAULT_SHIFT_MODELS = [
  { name: "Frühdienst", color: "amber", valuationPercent: 100, sortOrder: 0 },
  { name: "Spätdienst", color: "indigo", valuationPercent: 100, sortOrder: 1 },
  { name: "24h Dienst", color: "purple", valuationPercent: 100, sortOrder: 2 },
  { name: "Bereitschaft", color: "teal", valuationPercent: 100, sortOrder: 3 },
] as const;

// Legt die Standard-Dienste für ein frisch erstelltes Team an. Wird beim
// Registrieren und beim ersten Dev-Login (Anlage des Standard-Teams) aufgerufen.
export async function seedDefaultShiftModels(teamId: number): Promise<void> {
  await db
    .insert(shiftModelsTable)
    .values(DEFAULT_SHIFT_MODELS.map((m) => ({ ...m, teamId })));
}
