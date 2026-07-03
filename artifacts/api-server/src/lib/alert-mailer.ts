// ---------------------------------------------------------------------------
// Warn-E-Mails an den Betreiber (superadmin) bei schweren Plattform-Fehlern.
// ---------------------------------------------------------------------------
// Versand ueber die Resend-API (transaktionaler E-Mail-Dienst). Der
// API-Schluessel kommt aus dem Secret RESEND_API_KEY; ist keiner hinterlegt,
// wird der Versand still uebersprungen (Warnung im Log) — das Fehler-Tracking
// selbst funktioniert unabhaengig davon. Versandfehler duerfen den laufenden
// Request NIE beeintraechtigen: diese Funktion wirft niemals.
//
// Empfaenger-Aufloesung: ERROR_ALERT_EMAIL (Env) hat Vorrang; sonst die
// E-Mail-Adresse des (aeltesten) superadmin-Kontos aus der DB.
// Absender: ERROR_ALERT_FROM (Env) oder Resend-Testabsender.
// ---------------------------------------------------------------------------

import { db, usersTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { logger } from "./logger";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** Empfaenger-Adresse fuer Warn-Mails: Env-Override oder superadmin aus DB. */
export async function resolveAlertRecipient(): Promise<string | null> {
  const fromEnv = process.env.ERROR_ALERT_EMAIL?.trim();
  if (fromEnv) return fromEnv;
  const [superadmin] = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.role, "superadmin"))
    .orderBy(asc(usersTable.id))
    .limit(1);
  return superadmin?.email ?? null;
}

/**
 * Sendet eine Warn-E-Mail an den Betreiber. Wirft NIE — Fehler werden nur
 * geloggt. Gibt true zurueck, wenn der Versand angestossen wurde (fuer
 * Tests/Diagnose), sonst false.
 */
export async function sendOperatorAlertEmail(
  subject: string,
  text: string,
): Promise<boolean> {
  try {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    if (!apiKey) {
      logger.warn(
        "Warn-E-Mail uebersprungen: kein RESEND_API_KEY hinterlegt (Fehler ist im Operator-Dashboard trotzdem sichtbar)",
      );
      return false;
    }
    const to = await resolveAlertRecipient();
    if (!to) {
      logger.warn(
        "Warn-E-Mail uebersprungen: kein Empfaenger (weder ERROR_ALERT_EMAIL noch superadmin-Konto vorhanden)",
      );
      return false;
    }
    const from =
      process.env.ERROR_ALERT_FROM?.trim() ||
      "Dienstplan-App <onboarding@resend.dev>";

    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, text }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      logger.error(
        { status: response.status, body: body.slice(0, 500) },
        "Warn-E-Mail-Versand fehlgeschlagen (Resend-API)",
      );
      return false;
    }
    logger.info({ to, subject }, "Warn-E-Mail an Betreiber gesendet");
    return true;
  } catch (err) {
    // NIEMALS werfen — der ausloesende Request darf nicht beeintraechtigt werden.
    logger.error({ err }, "Warn-E-Mail-Versand fehlgeschlagen");
    return false;
  }
}
