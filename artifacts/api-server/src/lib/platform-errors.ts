// ---------------------------------------------------------------------------
// Zentrale Erfassung von Plattform-Fehlern (Fehler-Tracking im
// Operator-Dashboard) + gedrosselte Warn-E-Mail an den Betreiber.
// ---------------------------------------------------------------------------
// recordPlatformError ist der EINE Helfer fuer alle Stellen:
//   - zentraler Express-Error-Handler (app.ts) fuer unbehandelte 5xx
//   - gezielte Meldungen aus try/catch-Bloecken (level "error" | "warning")
// Er persistiert in platform_errors, begrenzt die Aufbewahrung und stoesst
// bei Level "error" eine Warn-E-Mail an — gedrosselt, damit derselbe Fehler
// nicht im Minutentakt neue Mails ausloest. Die Funktion wirft NIE; ein
// kaputtes Fehler-Tracking darf den eigentlichen Request nicht verschlimmern.
// ---------------------------------------------------------------------------

import { db, platformErrorsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";
import { sendOperatorAlertEmail } from "./alert-mailer";

// Aufbewahrung: maximal so viele Eintraege behalten (aelteste fliegen raus).
const MAX_STORED_ERRORS = 500;

// Drosselung der Warn-Mails: derselbe Fehler (Kontext + Meldung) loest
// hoechstens alle 15 Minuten eine neue Mail aus.
export const ALERT_THROTTLE_MS = 15 * 60 * 1000;

/**
 * Reine Drossel-Logik, getrennt fuer Unit-Tests: merkt sich pro Schluessel
 * den letzten Sendezeitpunkt und erlaubt eine neue Mail erst nach Ablauf des
 * Fensters. Begrenzt die Map-Groesse, damit sie nicht unbegrenzt waechst.
 */
export class AlertThrottle {
  private lastSentAt = new Map<string, number>();

  constructor(
    private readonly windowMs: number = ALERT_THROTTLE_MS,
    private readonly maxKeys: number = 1000,
  ) {}

  shouldSend(key: string, now: number = Date.now()): boolean {
    const last = this.lastSentAt.get(key);
    if (last !== undefined && now - last < this.windowMs) {
      return false;
    }
    if (this.lastSentAt.size >= this.maxKeys && !this.lastSentAt.has(key)) {
      // Aeltesten Eintrag verdraengen (Map ist insertion-ordered).
      const oldest = this.lastSentAt.keys().next().value;
      if (oldest !== undefined) this.lastSentAt.delete(oldest);
    }
    this.lastSentAt.delete(key);
    this.lastSentAt.set(key, now);
    return true;
  }
}

const alertThrottle = new AlertThrottle();

export type PlatformErrorLevel = "error" | "warning";

export interface RecordPlatformErrorInput {
  level: PlatformErrorLevel;
  message: string;
  /** Route/Stelle, z. B. "GET /api/shifts" oder "billing/createDraft" */
  context: string;
}

/**
 * Persistiert einen Plattform-Fehler und sendet bei Level "error" eine
 * gedrosselte Warn-E-Mail an den Betreiber. Wirft NIE.
 */
export async function recordPlatformError(
  input: RecordPlatformErrorInput,
): Promise<void> {
  const message = input.message.slice(0, 2000) || "Unbekannter Fehler";
  const context = input.context.slice(0, 500) || "unbekannt";
  try {
    await db.insert(platformErrorsTable).values({
      level: input.level,
      message,
      context,
    });

    // Aufbewahrung begrenzen: alles ausserhalb der neuesten N Eintraege
    // loeschen (guenstig genug, um es bei jedem Insert mitzumachen).
    await db.execute(sql`
      DELETE FROM platform_errors
      WHERE id NOT IN (
        SELECT id FROM platform_errors ORDER BY id DESC LIMIT ${MAX_STORED_ERRORS}
      )
    `);
  } catch (err) {
    // Fehler-Tracking darf den Request nie verschlimmern.
    logger.error({ err }, "Plattform-Fehler konnte nicht gespeichert werden");
    return;
  }

  if (input.level === "error") {
    const throttleKey = `${context}|${message}`;
    if (alertThrottle.shouldSend(throttleKey)) {
      const timestamp = new Date().toLocaleString("de-DE", {
        timeZone: "Europe/Berlin",
        dateStyle: "medium",
        timeStyle: "medium",
      });
      // Fire-and-forget: Versand blockiert den Request nicht.
      void sendOperatorAlertEmail(
        "Dienstplan-App: Schwerer Serverfehler aufgetreten",
        [
          "In der Dienstplan-App ist ein schwerer Serverfehler aufgetreten.",
          "",
          `Meldung:    ${message}`,
          `Kontext:    ${context}`,
          `Zeitpunkt:  ${timestamp} Uhr`,
          "",
          "Details im Operator-Dashboard unter \u201EFehler-Tracking\u201C.",
          `Gleiche Fehler werden fuer ${Math.round(ALERT_THROTTLE_MS / 60000)} Minuten nicht erneut gemeldet.`,
        ].join("\n"),
      );
    }
  }
}
