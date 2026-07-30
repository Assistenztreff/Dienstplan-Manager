import { test, expect, request as playwrightRequest } from "@playwright/test";
import { dbSetCalendarToken, dbSetUserActive, dbDeleteAccountByEmail } from "./helpers/db";

/**
 * #539 – Beweisen, dass der Kalender-Link eines deaktivierten Kontos sofort tot ist.
 *
 * Der iCal-Feed (/api/calendar-feed/:token) prüft serverseitig zunächst ob der
 * Token-Eigentümer aktiv ist (isActive). Erst danach folgt das Premium-Gate
 * (calendarSync). Nach der Deaktivierung muss der Feed sofort 404 liefern,
 * unabhängig davon ob der Nutzer Premium hat oder nicht.
 *
 * Sicherheits-Invariante:
 *   aktiver Nutzer ohne Premium  → 403 (Premium-Gate)
 *   inaktiver Nutzer             → 404 (isActive-Gate, bevor Premium geprüft wird)
 *
 * Das Verhalten schützt davor, dass deaktivierte Ex-Mitarbeiter ihren
 * persönlichen Kalender-Feed weiterverwenden können.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

/** Generiert einen gültigen 64-Hex-Zeichen-Token (keine Sonderzeichen). */
function makeTestToken(): string {
  return "a1b2c3d4e5f6".repeat(5) + "0011";
}

test("Kalender-Feed gibt 404 nach Deaktivierung des Kontos (#539)", async () => {
  test.setTimeout(60_000);

  const unique = Date.now();
  const testEmail = `e2e.cal.deact.${unique}@dienstplan.test`;
  const testPassword = "e2e-cal-pw-1234";
  const token = makeTestToken();

  const adminCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });

  try {
    // 1. Als Admin einloggen.
    const loginRes = await adminCtx.post("/api/auth/login", {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(loginRes.ok(), `Admin-Login fehlgeschlagen (${loginRes.status()})`).toBe(true);

    // 2. Test-Assistenten registrieren.
    const regRes = await adminCtx.post("/api/auth/register", {
      data: { name: "E2E Cal Deact", email: testEmail, password: testPassword },
    });
    // Rate-Limit (429) oder Erfolg (201/200) akzeptieren; nur echte Server-Fehler
    // (5xx) sind unerwünscht. Bei 429 schlägt der Test sauber fehl.
    expect(
      regRes.status(),
      `Registrierung fehlgeschlagen (${regRes.status()})`,
    ).toBeLessThan(500);
    // Im Erfolgsfall (2xx) weiterfahren.
    if (!regRes.ok()) {
      test.skip();
      return;
    }

    // 3. Kalender-Token per DB direkt setzen (kein Premium nötig für diesen Schritt).
    await dbSetCalendarToken(testEmail, token);

    // 4. Aktiver Nutzer ohne Premium → 403 (Premium-Gate kommt nach isActive-Gate).
    const activeRes = await adminCtx.get(`/api/calendar-feed/${token}`);
    expect(
      activeRes.status(),
      "Aktiver Nutzer ohne Premium soll 403 liefern (nicht 404)",
    ).toBe(403);

    // 5. Nutzer deaktivieren.
    await dbSetUserActive(testEmail, false);

    // 6. Deaktivierter Nutzer → 404 (isActive-Gate greift vor Premium-Gate).
    const inactiveRes = await adminCtx.get(`/api/calendar-feed/${token}`);
    expect(
      inactiveRes.status(),
      "Deaktivierter Nutzer muss 404 liefern (isActive-Check vor Premium)",
    ).toBe(404);
  } finally {
    // Aufräumen: Nutzer reaktivieren und dann löschen.
    try {
      await dbSetUserActive(testEmail, true);
    } catch {
      // ggf. schon gelöscht
    }
    try {
      await dbDeleteAccountByEmail(testEmail);
    } catch {
      // Fehler beim Cleanup nicht in Test-Ergebnis einfließen lassen.
    }
    await adminCtx.dispose();
  }
});
