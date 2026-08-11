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
 * Liefert die effektive Datenbank-URL:
 * - In Produktion (NODE_ENV=production) hat `PROD_DATABASE_URL` hoechste
 *   Prioritaet, damit das Deploy auf eine eigene Produktions-DB zeigt.
 * - Danach folgt `APP_DATABASE_URL` (ueberschreibt die von Replit verwaltete
 *   `DATABASE_URL`, die vom eingebauten Replit-DB-Service gesetzt wird).
 * - Zuletzt `DATABASE_URL` als Fallback.
 * Ergebnis ist bereits normalisiert.
 */
export function resolveDatabaseUrl(): string | undefined {
  const isProduction = process.env.NODE_ENV === "production";
  // In Produktion: PROD_DATABASE_URL bevorzugen (eigene Prod-DB).
  // In Entwicklung: APP_DATABASE_URL bevorzugen (Staging-DB).
  const fromProd = isProduction ? process.env.PROD_DATABASE_URL : undefined;
  const fromApp = process.env.APP_DATABASE_URL;
  const overrideUrl = fromProd ?? fromApp;
  const raw = overrideUrl ?? process.env.DATABASE_URL;
  if (!raw) return undefined;
  let url = normalizeDatabaseUrl(raw);
  // Rotiertes DB-Passwort: SCALEWAY_DB_PASSWORD (Secret) hat Vorrang vor dem
  // in der URL eingebetteten Passwort. Gilt fuer APP_DATABASE_URL und
  // PROD_DATABASE_URL (beide zeigen auf denselben Scaleway-Server).
  const rotated = process.env.SCALEWAY_DB_PASSWORD;
  if (overrideUrl && rotated && isParseableUrl(url)) {
    const parsed = new URL(url);
    parsed.password = encodeURIComponent(rotated);
    url = parsed.toString();
  }
  return url;
}
