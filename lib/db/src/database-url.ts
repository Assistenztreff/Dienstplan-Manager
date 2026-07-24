const URL_SCHEME_PATTERN = /^(postgres(?:ql)?:\/\/)(.+)@([^@]+)$/;

function isParseableUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalisiert eine Postgres-Verbindungs-URL, deren Passwort nicht
 * URL-kodierte Sonderzeichen enthaelt (z. B. `#`, `?`, `{`).
 * Solche URLs lassen `new URL()` und damit pg-connection-string scheitern.
 * Gibt die Original-URL zurueck, wenn sie bereits parsebar ist oder
 * nicht repariert werden kann.
 */
export function normalizeDatabaseUrl(raw: string): string {
  let url = raw;
  if (!isParseableUrl(url)) {
    const match = URL_SCHEME_PATTERN.exec(url);
    if (!match) {
      return raw;
    }
    const [, scheme, credentials, rest] = match;
    const separatorIndex = credentials.indexOf(":");
    if (separatorIndex === -1) {
      return raw;
    }
    const user = credentials.slice(0, separatorIndex);
    const password = credentials.slice(separatorIndex + 1);
    const candidate = `${scheme}${encodeURIComponent(user)}:${encodeURIComponent(password)}@${rest}`;
    if (!isParseableUrl(candidate)) {
      return raw;
    }
    url = candidate;
  }
  // Expliziter Opt-in (kein stiller Downgrade): node-postgres prueft bei
  // sslmode=require das Zertifikat (anders als libpq/psql). Managed-DBs mit
  // selbstsigniertem Zertifikat (z. B. Scaleway) brauchen no-verify —
  // aktiviert NUR ueber DATABASE_SSL_NO_VERIFY=1 (verschluesselt bleibt die
  // Verbindung; nur die Zertifikatspruefung entfaellt, libpq-Semantik).
  if (process.env.DATABASE_SSL_NO_VERIFY === "1") {
    const parsed = new URL(url);
    if (parsed.searchParams.get("sslmode") === "require") {
      parsed.searchParams.set("sslmode", "no-verify");
      url = parsed.toString();
    }
  }
  return url;
}

/**
 * Liefert die effektive Datenbank-URL: `APP_DATABASE_URL` hat Vorrang vor
 * `DATABASE_URL` (letztere wird auf Replit von der eingebauten Datenbank
 * verwaltet und kann nicht ueberschrieben werden). So kann die
 * Entwicklungsumgebung auf Staging und die veroeffentlichte App auf die
 * Produktions-DB zeigen. Ergebnis ist bereits normalisiert.
 */
export function resolveDatabaseUrl(): string | undefined {
  const fromApp = process.env.APP_DATABASE_URL;
  const raw = fromApp ?? process.env.DATABASE_URL;
  if (!raw) return undefined;
  let url = normalizeDatabaseUrl(raw);
  // Rotiertes DB-Passwort: SCALEWAY_DB_PASSWORD (Secret) hat Vorrang vor dem
  // in APP_DATABASE_URL eingebetteten Passwort. So bricht eine Passwort-
  // Rotation nicht alle hinterlegten URLs (Secrets sind fuer den Agenten
  // nicht loeschbar und koennen umgebungsspezifische Werte ueberschatten).
  const rotated = process.env.SCALEWAY_DB_PASSWORD;
  if (fromApp && rotated && isParseableUrl(url)) {
    const parsed = new URL(url);
    parsed.password = encodeURIComponent(rotated);
    url = parsed.toString();
  }
  return url;
}
