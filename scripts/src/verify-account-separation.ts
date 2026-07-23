import "./lib/normalize-db-url";
import {
  CheckError,
  runAccountSeparationCheck,
} from "@workspace/test-fixtures/verify-checks";

/**
 * Duenner CLI-Wrapper fuer manuelle Laeufe des Testkonten-Trennungs-Checks.
 * Die Kernlogik lebt in `@workspace/test-fixtures/verify-checks` und wird von
 * `artifacts/dienstplan/playwright.config.ts` in-process (ohne pnpm/tsx-
 * Kindprozess) beim Config-Load ausgefuehrt — Dokumentation des Ablaufs dort.
 *
 * Exit 0 = Trennung bewiesen stabil, Exit 1 = Regression (Fehlermeldung
 * nennt die Ursache).
 */
runAccountSeparationCheck().catch((err) => {
  if (err instanceof CheckError) {
    console.error(`\n${err.message}`);
  } else {
    console.error("Fehler beim Testkonten-Trennungs-Check:", err);
  }
  process.exit(1);
});
