import "./lib/normalize-db-url";
import {
  countSchemaTables,
  findMissingSchemaObjects,
} from "@workspace/db/verify-schema";

/**
 * CLI-Wrapper um den gemeinsamen Schema-Check in
 * `@workspace/db/verify-schema` (Vergleich information_schema vs. Drizzle).
 *
 * Zweck (Task #499): Der Schema-Hash-Marker in der Playwright-Config beweist
 * nur "setup-test-db lief mit diesen Quelldateien" — NICHT, dass die Test-DB
 * tatsächlich auf dem Stand ist. Die Playwright-Config ruft die Kernfunktion
 * inzwischen direkt in-process auf (kein pnpm-Kindprozess mehr beim
 * Config-Load); dieses Skript bleibt für manuelle Prüfungen erhalten.
 *
 * Exit 0: alle erwarteten Tabellen/Spalten vorhanden.
 * Exit 1: Abweichung gefunden ODER DB nicht erreichbar/nicht vorhanden —
 *         der Aufrufer soll dann setup-test-db (mit Selbstheilung) ausführen.
 */

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL muss gesetzt sein (erwartet: die _test-DB).");
  }

  const problems = await findMissingSchemaObjects(url);
  if (problems.length > 0) {
    console.error(
      `Test-DB-Schema veraltet (${problems.length} Abweichung(en) gegenüber dem Drizzle-Schema):`,
    );
    for (const p of problems) console.error(`  - ${p}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Test-DB-Schema aktuell: ${countSchemaTables()} Tabellen, alle erwarteten Spalten vorhanden.`,
  );
}

main().catch((err) => {
  // Auch "DB nicht erreichbar / existiert nicht" ist für den Aufrufer ein
  // "bitte provisionieren"-Signal, kein harter Infrastrukturfehler.
  console.error("Test-DB-Schema-Check fehlgeschlagen:", err);
  process.exit(1);
});
