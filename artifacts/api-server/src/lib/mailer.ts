// ---------------------------------------------------------------------------
// Transaktionale E-Mails: Passwort-Reset und E-Mail-Verifizierung.
// Versand über Resend-API. Wenn kein RESEND_API_KEY hinterlegt ist, wird
// der Versand still übersprungen (false zurückgegeben) — kein Absturz.
// Absender: EMAIL_FROM (Env) oder Resend-Testabsender onboarding@resend.dev.
//   → Für echten Versand an beliebige Empfänger muss die Absenderdomain bei
//     Resend verifiziert sein und EMAIL_FROM auf diese Domain zeigen.
// ---------------------------------------------------------------------------

import { logger } from "./logger";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const FALLBACK_FROM = "Dienstplan-App <onboarding@resend.dev>";

function getFrom(): string {
  return process.env.EMAIL_FROM?.trim() || FALLBACK_FROM;
}

/** Gibt true zurück, wenn ein RESEND_API_KEY hinterlegt ist. */
export function isEmailEnabled(): boolean {
  return !!(process.env.RESEND_API_KEY?.trim());
}

/** E-Mail-Domains, an die niemals echte Mails geschickt werden.
 *  @dienstplan.test: wegwerfbare Konten der E2E-Suite. */
const TEST_EMAIL_DOMAINS = ["dienstplan.test"];

function isTestEmail(address: string): boolean {
  const lower = address.toLowerCase();
  return TEST_EMAIL_DOMAINS.some((d) => lower.endsWith(`@${d}`));
}

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (isTestEmail(to)) {
    logger.info({ to, subject }, "E-Mail-Versand übersprungen (Testdomäne)");
    return true;
  }
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    logger.warn("Transaktionale E-Mail übersprungen: kein RESEND_API_KEY hinterlegt");
    return false;
  }
  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: getFrom(), to: [to], subject, html }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      logger.error({ status: response.status, body: body.slice(0, 500), to }, "E-Mail-Versand fehlgeschlagen");
      return false;
    }
    logger.info({ to, subject }, "Transaktionale E-Mail gesendet");
    return true;
  } catch (err) {
    logger.error({ err, to }, "E-Mail-Versand fehlgeschlagen (Netzwerkfehler)");
    return false;
  }
}

function emailLayout(content: string): string {
  return `<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:#0d3050;padding:28px 40px;">
            <p style="margin:0;color:#f5c842;font-size:20px;font-weight:bold;letter-spacing:0.5px;">Dienstplan-App</p>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 40px 40px;">
            ${content}
          </td>
        </tr>
        <tr>
          <td style="padding:20px 40px;background:#f8f9fa;border-top:1px solid #e9ecef;">
            <p style="margin:0;font-size:12px;color:#6c757d;">
              Diese E-Mail wurde automatisch verschickt. Bitte antworten Sie nicht darauf.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function linkButton(url: string, label: string): string {
  return `<a href="${url}" style="display:inline-block;padding:14px 28px;background:#0d3050;color:#f5c842;text-decoration:none;border-radius:8px;font-weight:bold;font-size:15px;margin:20px 0;">${label}</a>`;
}

/** Sendet eine Passwort-Reset-E-Mail. Gibt true zurück wenn gesendet. */
export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<boolean> {
  const html = emailLayout(`
    <h2 style="margin:0 0 16px;color:#0d3050;font-size:22px;">Passwort zurücksetzen</h2>
    <p style="margin:0 0 12px;color:#333;line-height:1.6;">
      wir haben eine Anfrage erhalten, das Passwort für Ihr Dienstplan-Konto zurückzusetzen.
    </p>
    <p style="margin:0 0 24px;color:#333;line-height:1.6;">
      Klicken Sie auf den Button, um ein neues Passwort zu vergeben:
    </p>
    ${linkButton(resetUrl, "Passwort zurücksetzen")}
    <p style="margin:24px 0 0;color:#555;font-size:13px;line-height:1.6;">
      Dieser Link ist <strong>24 Stunden</strong> gültig. Falls Sie kein neues Passwort angefordert haben,
      können Sie diese E-Mail ignorieren — Ihr aktuelles Passwort bleibt unverändert.
    </p>
    <p style="margin:12px 0 0;color:#888;font-size:12px;word-break:break-all;">
      Falls der Button nicht funktioniert, kopieren Sie diesen Link in Ihren Browser:<br>${resetUrl}
    </p>
  `);
  return sendEmail(to, "Passwort zurücksetzen – Dienstplan", html);
}

/** Sendet eine E-Mail-Verifizierungs-E-Mail. Gibt true zurück wenn gesendet. */
export async function sendVerificationEmail(to: string, verifyUrl: string): Promise<boolean> {
  const html = emailLayout(`
    <h2 style="margin:0 0 16px;color:#0d3050;font-size:22px;">Willkommen bei der Dienstplan-App!</h2>
    <p style="margin:0 0 12px;color:#333;line-height:1.6;">
      Ihr Konto wurde erfolgreich angelegt. Bitte bestätigen Sie Ihre E-Mail-Adresse,
      um sich anmelden zu können:
    </p>
    ${linkButton(verifyUrl, "E-Mail-Adresse bestätigen")}
    <p style="margin:24px 0 0;color:#555;font-size:13px;line-height:1.6;">
      Dieser Link ist <strong>48 Stunden</strong> gültig. Falls Sie sich nicht registriert haben,
      können Sie diese E-Mail ignorieren.
    </p>
    <p style="margin:12px 0 0;color:#888;font-size:12px;word-break:break-all;">
      Falls der Button nicht funktioniert, kopieren Sie diesen Link in Ihren Browser:<br>${verifyUrl}
    </p>
  `);
  return sendEmail(to, "E-Mail-Adresse bestätigen – Dienstplan", html);
}
