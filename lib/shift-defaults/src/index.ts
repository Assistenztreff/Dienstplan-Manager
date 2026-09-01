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

// ---------------------------------------------------------------------------
// Vorlagen-Pakete fuer den Schicht-Wizard (Baustein 4, Kay 01.09.2026)
// ---------------------------------------------------------------------------
// Fertige Dienst-Saetze fuer typische Assistenz-Konstellationen. Der Wizard
// in den Einstellungen legt sie NUR AN (niemals loeschen oder veraendern);
// jede Vorlage bringt sinnvolle Regelplan-Voreinstellungen mit, damit das
// Dienstgeruest im Monatsraster sofort offene Plaetze zeigt. Lebt bewusst
// hier bei den Standard-Diensten: eine Quelle fuer alles Vorinstallierte.

export type VorlagenDienst = {
  readonly name: string;
  readonly color: string;
  readonly defaultStartTime: string;
  readonly defaultEndTime: string;
  /** 1 (Montag) bis 7 (Sonntag); leer = alle Tage. */
  readonly defaultWeekdays: readonly number[];
  readonly imRegelplan: boolean;
  readonly standbySlot: boolean;
};

export type VorlagenPaket = {
  readonly key: string;
  readonly name: string;
  readonly beschreibung: string;
  readonly dienste: readonly VorlagenDienst[];
};

export const VORLAGEN_PAKETE: readonly VorlagenPaket[] = [
  {
    key: "rund-um-die-uhr",
    name: "24-Stunden-Assistenz",
    beschreibung:
      "Ein durchgehender 24h-Dienst mit Vertretungsplatz — der Klassiker der persoenlichen Assistenz.",
    dienste: [
      {
        name: "24h Assistenz",
        color: "purple",
        defaultStartTime: "09:00",
        defaultEndTime: "09:00",
        defaultWeekdays: [1, 2, 3, 4, 5, 6, 7],
        imRegelplan: true,
        standbySlot: true,
      },
    ],
  },
  {
    key: "drei-schicht",
    name: "Drei-Schicht-System",
    beschreibung: "Frueh, Spaet und Nacht zu je 8 Stunden, taeglich besetzt.",
    dienste: [
      {
        name: "Frühschicht",
        color: "amber",
        defaultStartTime: "06:00",
        defaultEndTime: "14:00",
        defaultWeekdays: [1, 2, 3, 4, 5, 6, 7],
        imRegelplan: true,
        standbySlot: false,
      },
      {
        name: "Spätschicht",
        color: "indigo",
        defaultStartTime: "14:00",
        defaultEndTime: "22:00",
        defaultWeekdays: [1, 2, 3, 4, 5, 6, 7],
        imRegelplan: true,
        standbySlot: false,
      },
      {
        name: "Nachtschicht",
        color: "slate",
        defaultStartTime: "22:00",
        defaultEndTime: "06:00",
        defaultWeekdays: [1, 2, 3, 4, 5, 6, 7],
        imRegelplan: true,
        standbySlot: false,
      },
    ],
  },
  {
    key: "zwei-schicht-12h",
    name: "Zwei-Schicht-System (12 h)",
    beschreibung: "Tag- und Nachtdienst zu je 12 Stunden, taeglich besetzt.",
    dienste: [
      {
        name: "Tagdienst 12h",
        color: "amber",
        defaultStartTime: "08:00",
        defaultEndTime: "20:00",
        defaultWeekdays: [1, 2, 3, 4, 5, 6, 7],
        imRegelplan: true,
        standbySlot: false,
      },
      {
        name: "Nachtdienst 12h",
        color: "slate",
        defaultStartTime: "20:00",
        defaultEndTime: "08:00",
        defaultWeekdays: [1, 2, 3, 4, 5, 6, 7],
        imRegelplan: true,
        standbySlot: false,
      },
    ],
  },
  {
    key: "werktags",
    name: "Werktags-Begleitung",
    beschreibung: "Ein 8-Stunden-Dienst Montag bis Freitag — z. B. Arbeits- oder Studienassistenz.",
    dienste: [
      {
        name: "Tagesbegleitung",
        color: "teal",
        defaultStartTime: "08:00",
        defaultEndTime: "16:00",
        defaultWeekdays: [1, 2, 3, 4, 5],
        imRegelplan: true,
        standbySlot: false,
      },
    ],
  },
] as const;
