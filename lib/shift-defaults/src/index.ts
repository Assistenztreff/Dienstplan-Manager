// ---------------------------------------------------------------------------
// Standard-Dienste (Single Source of Truth)
// ---------------------------------------------------------------------------
// Der EINE Standard-Dienst, den jedes frisch angelegte Team vorinstalliert
// bekommt (Registrierung, erster Dev-Login, POST /teams) UND den der Backfill
// nachzieht (bestehende Teams ohne ein einziges Schichtmodell).
//
// KAY-ENTSCHEIDUNG 30.08.2026: Frueher waren es fuenf (Frueh-, Spaet-,
// Nachtdienst, Bereitschaft, 24h). Das ist eine Annahme ueber den Alltag, die
// fast nie stimmt: jedes Assistenz-Team schneidet seine Dienste anders zu.
// Wer die fuenf nicht braucht, muss sie erst wegraeumen — mehr Arbeit als sie
// anzulegen. Geblieben ist die Teamsitzung, weil die praktisch jedes Team hat
// und ihre Zeiten selten abweichen. Alles andere legt das Team selbst an,
// ueber eine Vorlage oder den Dialog "Schicht anlegen".
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
    name: "Teamsitzung",
    color: "teal",
    valuationPercent: 100,
    sortOrder: 0,
    defaultStartTime: "15:00",
    defaultEndTime: "16:00",
    // Wochentag: Montag als Vorauswahl. Eine Teamsitzung ist in aller Regel
    // woechentlich, nicht taeglich — Mo-Fr wuerde beim Sammel-Anlegen und
    // spaeter bei der automatischen Planung ein Meeting pro Werktag erzeugen.
    // Das Team verschiebt den Tag im Dienst selbst, wenn es anders sitzt.
    defaultWeekdays: [1],
    compensationType: "regular",
  },
] as const;
