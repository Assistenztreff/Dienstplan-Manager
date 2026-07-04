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
  {
    name: "Frühdienst",
    color: "amber",
    valuationPercent: 100,
    sortOrder: 0,
    defaultStartTime: "08:00",
    defaultEndTime: "16:00",
    defaultWeekdays: [1, 2, 3, 4, 5],
    compensationType: "regular" as const,
  },
  {
    name: "Spätdienst",
    color: "indigo",
    valuationPercent: 100,
    sortOrder: 1,
    defaultStartTime: "16:00",
    defaultEndTime: "23:00",
    defaultWeekdays: [1, 2, 3, 4, 5],
    compensationType: "regular" as const,
  },
  {
    name: "Nachtdienst",
    color: "slate",
    valuationPercent: 100,
    sortOrder: 2,
    defaultStartTime: "23:00",
    defaultEndTime: "08:00",
    defaultWeekdays: [1, 2, 3, 4, 5],
    compensationType: "regular" as const,
  },
  {
    name: "Bereitschaft",
    color: "teal",
    valuationPercent: 100,
    sortOrder: 3,
    defaultStartTime: "08:00",
    defaultEndTime: "14:00",
    defaultWeekdays: [6, 7],
    compensationType: "regular" as const,
  },
  {
    name: "24h Dienst",
    color: "purple",
    valuationPercent: 100,
    sortOrder: 4,
    defaultStartTime: "09:00",
    defaultEndTime: "09:00",
    defaultWeekdays: [1, 2, 3, 4, 5, 6, 7],
    compensationType: "regular" as const,
  },
] as const;

// Legt die Standard-Dienste für ein frisch erstelltes Team an. Wird beim
// Registrieren und beim ersten Dev-Login (Anlage des Standard-Teams) aufgerufen.
export async function seedDefaultShiftModels(teamId: number): Promise<void> {
  await db
    .insert(shiftModelsTable)
    .values(DEFAULT_SHIFT_MODELS.map((m) => ({ ...m, defaultWeekdays: [...m.defaultWeekdays], teamId })));
}
