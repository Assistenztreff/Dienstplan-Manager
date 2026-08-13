/**
 * Gibt die öffentliche Basis-URL der Anwendung zurück.
 *
 * Auflösungsreihenfolge:
 *   1. APP_URL (explizit konfiguriert, z. B. https://dienstplan.assistenztreff.de)
 *   2. REPLIT_DOMAINS (erster Eintrag, Replit-Dev/-Deploy-Domain)
 *   3. http://localhost (lokale Entwicklung)
 *
 * Diese URL wird ausschließlich für E-Mail-Links (Einladung, Passwort-Reset,
 * E-Mail-Bestätigung) benötigt – der API-Server dient selbst kein Frontend aus.
 */
export function getBaseUrl(): string {
  return (
    process.env.APP_URL?.trim() ||
    (process.env.REPLIT_DOMAINS
      ? `https://${(process.env.REPLIT_DOMAINS as string).split(",")[0]}`
      : "http://localhost")
  );
}
