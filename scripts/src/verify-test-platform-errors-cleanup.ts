import "./lib/normalize-db-url";
import {
  CheckError,
  runPlatformErrorsCleanupCheck,
} from "@workspace/test-fixtures/verify-checks";

/**
 * Duenner CLI-Wrapper fuer manuelle Laeufe des Fehlerzeilen-Cleanup-Checks
 * (platform_errors: Test-Kontexte weg, echte Fehler bleiben, idempotent).
 * Die Kernlogik lebt in `@workspace/test-fixtures/verify-checks` und wird von
 * `artifacts/dienstplan/playwright.config.ts` in-process (ohne pnpm/tsx-
 * Kindprozess) beim Config-Load ausgefuehrt — Dokumentation des Ablaufs dort.
 *
 * Exit 0 = bewiesen korrekt, Exit 1 = Regression (Fehlermeldung nennt die
 * Ursache).
 */
runPlatformErrorsCleanupCheck().catch((err) => {
  if (err instanceof CheckError) {
    console.error(`\n${err.message}`);
  } else {
    console.error("Fehler beim Fehlerzeilen-Cleanup-Check:", err);
  }
  process.exit(1);
});
