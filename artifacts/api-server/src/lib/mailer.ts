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

const PROPOSAL_SHIFT_TYPE_LABELS: Record<string, string> = {
  active: "Aktivdienst",
  standby: "Bereitschaft",
  night: "Nachtdienst",
  full_day: "Ganztägig",
  work: "Arbeitsdienst",
  team: "Teamdienst",
};

/** Sendet eine Vorschlags-E-Mail an eine Assistenzkraft mit all ihren vorgeschlagenen Diensten. */
export async function sendProposalEmail(
  to: string,
  name: string,
  shifts: Array<{ startTime: Date; endTime: Date; type: string }>,
  loginUrl: string,
): Promise<boolean> {
  if (shifts.length === 0) return false;
  const monthLabel = shifts[0]!.startTime.toLocaleDateString("de-DE", {
    month: "long",
    year: "numeric",
    timeZone: "Europe/Berlin",
  });
  const rows = shifts
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
    .map((s) => {
      const date = s.startTime.toLocaleDateString("de-DE", {
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: "Europe/Berlin",
      });
      const start = s.startTime.toLocaleTimeString("de-DE", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Berlin",
      });
      const end = s.endTime.toLocaleTimeString("de-DE", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Berlin",
      });
      const typeLabel = PROPOSAL_SHIFT_TYPE_LABELS[s.type] ?? s.type;
      return `<tr>
        <td style="padding:7px 12px 7px 0;border-bottom:1px solid #e9ecef;color:#333;font-size:14px;">${date}</td>
        <td style="padding:7px 12px;border-bottom:1px solid #e9ecef;color:#333;font-size:14px;">${typeLabel}</td>
        <td style="padding:7px 0;border-bottom:1px solid #e9ecef;color:#333;font-size:14px;white-space:nowrap;">${start}–${end} Uhr</td>
      </tr>`;
    })
    .join("");

  const html = emailLayout(`
    <h2 style="margin:0 0 16px;color:#0d3050;font-size:22px;">Dienstvorschlag für ${monthLabel}</h2>
    <p style="margin:0 0 20px;color:#333;line-height:1.6;">
      Hallo ${name},<br><br>
      für Sie liegen neue Dienstvorschläge vor. Bitte prüfen und bestätigen Sie Ihre Dienste im Dienstplan:
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:24px;">
      <thead>
        <tr>
          <th style="text-align:left;padding:8px 12px 8px 0;border-bottom:2px solid #0d3050;color:#0d3050;font-size:13px;font-weight:bold;">Datum</th>
          <th style="text-align:left;padding:8px 12px;border-bottom:2px solid #0d3050;color:#0d3050;font-size:13px;font-weight:bold;">Art</th>
          <th style="text-align:left;padding:8px 0;border-bottom:2px solid #0d3050;color:#0d3050;font-size:13px;font-weight:bold;">Zeit</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
    ${linkButton(loginUrl, "Dienste ansehen & bestätigen")}
    <p style="margin:24px 0 0;color:#555;font-size:13px;line-height:1.6;">
      Klicken Sie auf den Button, um sich anzumelden und Ihre Dienste mit einem Klick zu bestätigen.
      Bis zur Bestätigung gelten die Einträge als <em>Vorschlag</em>.
    </p>
  `);

  return sendEmail(to, `Dienstvorschlag für ${monthLabel} – Dienstplan`, html);
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

/**
 * Benachrichtigt den Team-Eigentümer, wenn sich eine Assistenzkraft selbst
 * krankmeldet. Gibt true zurück, wenn die Mail gesendet wurde.
 *
 * `status` unterscheidet zwei Aufrufkontexte (#887):
 * - "created": die Krankheitstage wurden bereits als Schichten angelegt
 *   (Legacy-Direktpfad POST /shifts für privilegierte Personen).
 * - "pending": es wurde nur ein Antrag eingereicht, der noch auf Bestätigung
 *   durch einen Planer wartet (POST /absence-requests) — die Fürsorgepflicht
 *   verlangt sofortige Benachrichtigung, unabhängig davon, wann bestätigt wird.
 */
export async function sendSickLeaveNotification(
  to: string,
  assistantName: string,
  dates: Date[],
  appUrl: string,
  status: "created" | "pending" = "created",
): Promise<boolean> {
  if (dates.length === 0) return false;
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;

  const fmt = (d: Date) =>
    d.toLocaleDateString("de-DE", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "Europe/Berlin",
    });

  const rangeLabel =
    sorted.length === 1 ? fmt(first) : `${fmt(first)} – ${fmt(last)}`;

  const closingText =
    status === "pending"
      ? "Die Krankmeldung wartet auf Bestätigung. Bitte prüfen und bestätigen Sie den Antrag im Dienstplan und planen Sie ggf. eine Vertretung."
      : "Die Krankmeldung wurde automatisch eingetragen. Bitte planen Sie ggf. eine Vertretung.";

  const html = emailLayout(`
    <h2 style="margin:0 0 16px;color:#0d3050;font-size:22px;">Neue Krankmeldung</h2>
    <p style="margin:0 0 20px;color:#333;line-height:1.6;">
      <strong>${assistantName}</strong> hat sich krank gemeldet.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:24px;">
      <tr>
        <td style="padding:12px 16px;background:#f8f9fa;border-radius:8px;font-size:15px;color:#0d3050;">
          <strong>Zeitraum:</strong>&nbsp;${rangeLabel}
          ${sorted.length > 1 ? `<br><span style="font-size:13px;color:#555;">(${sorted.length} Krankheitstage)</span>` : ""}
        </td>
      </tr>
    </table>
    ${linkButton(`${appUrl}/dienstplan`, "Zum Dienstplan")}
    <p style="margin:24px 0 0;color:#555;font-size:13px;line-height:1.6;">
      ${closingText}
    </p>
  `);

  return sendEmail(
    to,
    `Krankmeldung: ${assistantName} (${rangeLabel})`,
    html,
  );
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
