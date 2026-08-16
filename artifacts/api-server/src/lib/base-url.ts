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
 *
 * APP_URL wird beim ersten Aufruf auf gültige URL-Syntax geprüft. Ein ungültiger
 * Wert (z. B. leerer Host oder keine URL) wird verworfen und durch den Fallback
 * ersetzt — mit Warn-Ausgabe, damit Betreiber die Fehlkonfiguration sofort sehen.
 * Trailing Slashes werden normalisiert (mit und ohne Slash → identische Links).
 */

/** Welche Quelle die aktive Basis-URL liefert. */
export type BaseUrlSource = "APP_URL" | "REPLIT_DOMAINS" | "localhost";

function resolveBaseUrl(): { url: string; source: BaseUrlSource } {
  const raw = process.env.APP_URL?.trim();
  if (raw) {
    try {
      const u = new URL(raw);
      if (!u.hostname) throw new Error("leerer Host");
      // Trailing Slash normalisieren: "https://example.com/" → "https://example.com"
      const normalized =
        u.origin + (u.pathname === "/" ? "" : u.pathname.replace(/\/$/, ""));
      return { url: normalized, source: "APP_URL" };
    } catch {
      console.warn(
        `[base-url] APP_URL "${raw}" ist keine gültige URL — ` +
          "Fallback auf REPLIT_DOMAINS / localhost. " +
          "Nach der Korrektur den API-Server neu starten.",
      );
    }
  }
  if (process.env.REPLIT_DOMAINS) {
    return {
      url: `https://${(process.env.REPLIT_DOMAINS as string).split(",")[0]}`,
      source: "REPLIT_DOMAINS",
    };
  }
  return { url: "http://localhost", source: "localhost" };
}

// Lazy singleton: URL wird einmalig aufgelöst und danach gecacht.
let _resolved: { url: string; source: BaseUrlSource } | undefined;

function getResolved(): { url: string; source: BaseUrlSource } {
  return (_resolved ??= resolveBaseUrl());
}

/** Aktive Basis-URL für E-Mail-Links. */
export function getBaseUrl(): string {
  return getResolved().url;
}

/** Aus welcher Quelle die aktive Basis-URL stammt (für Logs und /healthz). */
export function getBaseUrlSource(): BaseUrlSource {
  return getResolved().source;
}
