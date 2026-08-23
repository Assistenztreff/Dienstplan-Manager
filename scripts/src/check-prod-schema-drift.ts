import { findMissingSchemaObjects } from "@workspace/db/verify-schema";
import { runProdDriftCheck } from "./lib/prod-drift-check.js";

/**
 * Publish-Guard: Schema-Drift-Erkennung gegen die Produktions-DB (read-only).
 *
 * Läuft automatisch im Deployment-postBuild (scripts/publish-preflight.sh)
 * und damit bei JEDER Veröffentlichung. Vergleicht das aktuelle Drizzle-Schema
 * (lib/db/src/schema) mit dem IST-Zustand der Produktions-DB
 * (PROD_DATABASE_URL, effektive Credentials wie zur Laufzeit inkl.
 * SCALEWAY_DB_PASSWORD-Rotation). Fehlen dort Tabellen oder Spalten, schlägt
 * der Build SICHTBAR fehl — genau der Fehlerfall, der zuletzt den
 * Produktions-Login gebrochen hat ("column … does not exist").
 *
 * Eigenschaften:
 * - Rein lesend (information_schema-Abfrage) — ändert NIE etwas an der Prod-DB.
 * - Fail-closed: fehlende PROD_DATABASE_URL oder eine nicht erreichbare
 *   Prod-DB gelten als Fehler (sonst würde der Guard genau dann schweigen,
 *   wenn er gebraucht wird).
 * - Notausstieg (bewusst laut): SKIP_PROD_SCHEMA_CHECK=1 überspringt den
 *   Check — nur für den Fall, dass die Prod-DB aus dem Build-Netz temporär
 *   nicht erreichbar ist und ein Publish OHNE Schemaänderungen ansteht.
 *
 * Kernlogik + Tests: scripts/src/lib/prod-drift-check.ts
 *
 * Manuell ausführbar:
 *   pnpm --filter @workspace/scripts run check-prod-schema-drift
 */

async function main(): Promise<void> {
  const result = await runProdDriftCheck(process.env, findMissingSchemaObjects);

  switch (result.kind) {
    case "skipped":
      console.warn(
        [
          "⚠️  SKIP_PROD_SCHEMA_CHECK=1 gesetzt — Prod-Schema-Drift-Check ÜBERSPRUNGEN.",
          "   Nur zulässig, wenn diese Veröffentlichung KEINE Schemaänderungen enthält.",
        ].join("\n"),
      );
      return;
    case "missing-url":
      console.error(
        [
          "FEHLER: PROD_DATABASE_URL ist nicht gesetzt — der Prod-Schema-Drift-Check",
          "kann nicht laufen. Der Check ist bewusst fail-closed: ohne bekannte",
          "Produktions-DB lässt sich Schema-Drift nicht ausschließen.",
          "",
          "Abhilfe: Secret PROD_DATABASE_URL (auch für Deployments) setzen.",
          "Notausstieg NUR ohne Schemaänderungen: SKIP_PROD_SCHEMA_CHECK=1",
        ].join("\n"),
      );
      process.exit(1);
      return;
    case "unparseable":
      console.error(
        "FEHLER: PROD_DATABASE_URL ist nicht parsebar (auch nach Normalisierung). Passwort URL-kodieren.",
      );
      process.exit(1);
      return;
    case "collision":
      console.error(
        `FEHLER: PROD_DATABASE_URL zeigt auf dieselbe DB wie ${result.envName} — ` +
          "das wäre ein Drift-Check gegen die Dev-/Staging-DB (still falsch-grün). " +
          "Konfiguration korrigieren.",
      );
      process.exit(1);
      return;
    case "connect-failed":
      console.error(
        [
          `FEHLER: Produktions-DB nicht erreichbar oder Abfrage fehlgeschlagen: ${result.message}`,
          "Der Check ist fail-closed — Veröffentlichung stoppen, Ursache klären.",
          "Notausstieg NUR ohne Schemaänderungen: SKIP_PROD_SCHEMA_CHECK=1",
        ].join("\n"),
      );
      process.exit(1);
      return;
    case "drift":
      console.log(`Prod-Schema-Drift-Check (read-only) gegen: ${result.target}`);
      console.error(
        [
          "",
          `❌ SCHEMA-DRIFT: In der Produktions-DB fehlen ${result.problems.length} Objekt(e)`,
          "   gegenüber dem aktuellen Drizzle-Schema:",
          ...result.problems.map((p) => `   - ${p}`),
          "",
          "So beheben (Schema zuerst, Code danach):",
          "  1) Dry-Run ansehen:  pnpm --filter @workspace/scripts run check-prod-schema",
          "  2) Anwenden:         pnpm --filter @workspace/scripts run migrate-prod --yes <dbname>",
          "  3) Danach erneut veröffentlichen.",
          "",
          "Es wurde NICHTS an der Produktions-DB geändert (Check ist rein lesend).",
        ].join("\n"),
      );
      process.exit(1);
      return;
    case "ok":
      console.log(`Prod-Schema-Drift-Check (read-only) gegen: ${result.target}`);
      console.log(
        "✅ Kein Schema-Drift: Produktions-DB enthält alle Tabellen/Spalten des Drizzle-Schemas.",
      );
  }
}

main().catch((err) => {
  console.error("Fehler bei check-prod-schema-drift:", err);
  process.exit(1);
});
