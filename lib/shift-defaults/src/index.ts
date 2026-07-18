// ---------------------------------------------------------------------------
// Standard-Dienste (Single Source of Truth)
// ---------------------------------------------------------------------------
// Die 5 Standard-Dienste, die jedem frisch angelegten Team vorinstalliert
// werden (Registrierung, erster Dev-Login, POST /teams) UND die der Backfill
// nachzieht (bestehende Teams ohne ein einziges Schichtmodell).
//
// Diese Liste lag frueher DOPPELT vor: im API-Server
// (artifacts/api-server/src/lib/default-shift-models.ts, genutzt beim Seeding)
// und im Backfill-Skript (scripts/src/backfill-team-shift-models.ts). Aenderte
// jemand nur eine Liste, liefen Seeding und Backfill still auseinander. Deshalb
// gibt es jetzt genau EINE Quelle hier — ohne DB-/Drizzle-Abhaengigkeit, damit
// sowohl der API-Server (Drizzle-Insert) als auch das Backfill-Skript (rohes
// pg-SQL) sie importieren koennen.
//
// Bewusst NICHT enthalten: Urlaub und Krankheit. Diese werden im System als
// Abwesenheiten (ganztaegig, ohne Arbeitszeiten, als durchgehende Balken
// dargestellt) ueber den Schicht-Typ gefuehrt — nicht als Schichtmodelle. Ein
// Seeding als regulaere Dienste wuerde dieses Abwesenheits-System duplizieren.

export type DefaultShiftModel = {
  readonly name: string;
  readonly color: string;
  readonly valuationPercent: number;
  readonly sortOrder: number;
  readonly defaultStartTime: string;
  readonly defaultEndTime: string;
  readonly defaultWeekdays: readonly number[];
  readonly compensationType: "regular";
};

export const DEFAULT_SHIFT_MODELS: readonly DefaultShiftModel[] = [
  {
    name: "Frühdienst",
    color: "amber",
    valuationPercent: 100,
    sortOrder: 0,
    defaultStartTime: "08:00",
    defaultEndTime: "16:00",
    defaultWeekdays: [1, 2, 3, 4, 5],
    compensationType: "regular",
  },
  {
    name: "Spätdienst",
    color: "indigo",
    valuationPercent: 100,
    sortOrder: 1,
    defaultStartTime: "16:00",
    defaultEndTime: "23:00",
    defaultWeekdays: [1, 2, 3, 4, 5],
    compensationType: "regular",
  },
  {
    name: "Nachtdienst",
    color: "slate",
    valuationPercent: 100,
    sortOrder: 2,
    defaultStartTime: "23:00",
    defaultEndTime: "08:00",
    defaultWeekdays: [1, 2, 3, 4, 5],
    compensationType: "regular",
  },
  {
    name: "Bereitschaft",
    color: "teal",
    valuationPercent: 100,
    sortOrder: 3,
    defaultStartTime: "08:00",
    defaultEndTime: "14:00",
    defaultWeekdays: [6, 7],
    compensationType: "regular",
  },
  {
    name: "24h Dienst",
    color: "purple",
    valuationPercent: 100,
    sortOrder: 4,
    defaultStartTime: "09:00",
    defaultEndTime: "09:00",
    defaultWeekdays: [1, 2, 3, 4, 5, 6, 7],
    compensationType: "regular",
  },
] as const;
