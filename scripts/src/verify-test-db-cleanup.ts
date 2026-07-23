import "./lib/normalize-db-url";
import {
  CheckError,
  runTestDbCleanupCheck,
} from "@workspace/test-fixtures/verify-checks";

/**
 * Duenner CLI-Wrapper fuer manuelle Laeufe des Selbstheilungs-Checks
 * (Zombie-Konten nach abgebrochenem E2E-Lauf + FK-Waechter).
 * Die Kernlogik lebt in `@workspace/test-fixtures/verify-checks` und wird von
 * `artifacts/dienstplan/playwright.config.ts` in-process (ohne pnpm/tsx-
 * Kindprozess) beim Config-Load ausgefuehrt — Dokumentation des Ablaufs dort.
 *
 * Exit 0 = bewiesen sauber, Exit 1 = Regression (Fehlermeldung nennt die
 * Ursache).
 */
runTestDbCleanupCheck().catch((err) => {
  if (err instanceof CheckError) {
    console.error(`\n${err.message}`);
  } else {
    console.error("Fehler beim Selbstheilungs-Check:", err);
  }
  process.exit(1);
});
