import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";
import {
  dbSeedSuperadmin,
  dbDeleteAccountByEmail,
  dbInsertPlatformError,
  dbDeletePlatformErrorsByContextPrefix,
} from "./helpers/db";

/**
 * E2E-Test: Schnellauswahl-Presets (Dieser Monat / Letzter Monat / Letzte 30
 * Tage) in der Operator-Fehlerliste (Task #436, analog zu den Presets im
 * Plan-Änderungsprotokoll, dienstplan-operator-plan-preset-*.spec.ts).
 *
 * Abgesichert wird, dass die Preset-Buttons über den von/bis-Eingaben der
 * Fehlerliste beide Felder in einem Klick befüllen und die Liste danach
 * serverseitig nach dem LETZTEN Auftreten (lastSeenAt) filtert:
 *
 * "Dieser Monat":
 *   - Eintrag am ERSTEN Tag des aktuellen Monats, 00:00 Uhr -> muss erscheinen
 *   - Eintrag "jetzt" (heute)                               -> muss erscheinen
 *   - Eintrag am LETZTEN Tag des Vormonats, 23:59 Uhr       -> darf NICHT erscheinen
 *
 * "Letzte 30 Tage" (heute = Tag 1, heute-29 = Tag 30 eingeschlossen,
 * heute-30 = Tag 31 ausgeschlossen):
 *   - Eintrag am Tag heute-29, 00:00 Uhr -> muss erscheinen (unterer Rand)
 *   - Eintrag "jetzt" (heute)            -> muss erscheinen (oberer Rand)
 *   - Eintrag am Tag heute-30, 23:59 Uhr -> darf NICHT erscheinen
 *
 * Die Fehler-Einträge werden mit definierten lastSeenAt-Zeitstempeln direkt in
 * die Test-DB geseedet (dbInsertPlatformError). Der Browser-Kontext läuft mit
 * timezoneId "UTC", damit die lokalen Tagesgrenzen der Preset-Berechnung
 * deterministisch den geseedeten UTC-Zeitstempeln entsprechen.
 *
 * Läuft gegen den isolierten Test-Stack (eigener API + Vite auf der `_test`-DB).
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

const pad = (n: number) => String(n).padStart(2, "0");

test.describe("Schnellauswahl-Presets in der Operator-Fehlerliste", () => {
  test.setTimeout(120_000);

  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const superEmail = `e2e.superadmin.fehlerpreset.${stamp}@dienstplan.test`;
  const superPassword = "superadmin1234";
  const superName = `E2E Fehlerpreset ${stamp}`;

  // Eindeutiger Kontext-Präfix für gezielten Cleanup + Suche nach den
  // geseedeten Zeilen im UI.
  const contextPrefix = `e2e-fehlerpreset-${stamp}`;

  // Zeitstempel in UTC — der Browser-Kontext läuft mit timezoneId "UTC".
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();

  const tsMonatErster = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
  const tsMonatVormonat = new Date(Date.UTC(y, m, 0, 23, 59, 0, 0));
  const ts30Tag30 = new Date(Date.UTC(y, m, d - 29, 0, 0, 0, 0));
  const ts30Tag31 = new Date(Date.UTC(y, m, d - 30, 23, 59, 0, 0));
  const tsHeute = new Date(Date.UTC(y, m, d, 0, 0, 30, 0));

  // "Dieser Monat"-Trio.
  const msgMonatErster = `PRESET Monatserster ${stamp}`;
  const msgMonatHeute = `PRESET Monat heute ${stamp}`;
  const msgMonatVormonat = `PRESET Vormonat letzter ${stamp}`;
  // "Letzte 30 Tage"-Trio.
  const msg30Tag30 = `PRESET 30 Tag30 ${stamp}`;
  const msg30Heute = `PRESET 30 heute ${stamp}`;
  const msg30Tag31 = `PRESET 30 Tag31 ${stamp}`;

  let superCtx: APIRequestContext;
  let idMonatErster: number;
  let idMonatHeute: number;
  let idMonatVormonat: number;
  let id30Tag30: number;
  let id30Heute: number;
  let id30Tag31: number;

  test.beforeAll(async () => {
    await dbSeedSuperadmin(superEmail, superPassword, superName);
    superCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    const loginRes = await superCtx.post("/api/auth/login", {
      data: { email: superEmail, password: superPassword },
    });
    expect(
      loginRes.ok(),
      `Superadmin-Login fehlgeschlagen (${loginRes.status()})`,
    ).toBe(true);

    idMonatErster = await dbInsertPlatformError({
      message: msgMonatErster,
      context: `${contextPrefix}/monat-erster`,
      lastSeenAt: tsMonatErster,
    });
    idMonatHeute = await dbInsertPlatformError({
      message: msgMonatHeute,
      context: `${contextPrefix}/monat-heute`,
      lastSeenAt: tsHeute,
    });
    idMonatVormonat = await dbInsertPlatformError({
      message: msgMonatVormonat,
      context: `${contextPrefix}/monat-vormonat`,
      lastSeenAt: tsMonatVormonat,
    });
    id30Tag30 = await dbInsertPlatformError({
      message: msg30Tag30,
      context: `${contextPrefix}/tag30`,
      lastSeenAt: ts30Tag30,
    });
    id30Heute = await dbInsertPlatformError({
      message: msg30Heute,
      context: `${contextPrefix}/tag30-heute`,
      lastSeenAt: tsHeute,
    });
    id30Tag31 = await dbInsertPlatformError({
      message: msg30Tag31,
      context: `${contextPrefix}/tag31`,
      lastSeenAt: ts30Tag31,
    });
  });

  test.afterAll(async () => {
    try {
      await dbDeletePlatformErrorsByContextPrefix(contextPrefix);
    } catch {
      /* Best effort */
    }
    try {
      await dbDeleteAccountByEmail(superEmail);
    } catch {
      /* Best effort */
    }
    try {
      await superCtx?.dispose();
    } catch {
      /* ignore */
    }
  });

  test("UI: 'Dieser Monat' befüllt beide Felder und zeigt nur Einträge des Monats", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      baseURL: BASE_URL,
      timezoneId: "UTC",
    });
    try {
      const page = await context.newPage();
      const loginRes = await page.request.post("/api/auth/login", {
        data: { email: superEmail, password: superPassword },
      });
      expect(loginRes.ok(), "UI-Login als superadmin fehlgeschlagen").toBe(true);

      await page.goto("/operator-dashboard");

      // Per Suche auf die sechs stamp-Belege einschränken (isoliert gegen
      // parallel laufende Specs), dann per Preset auf den Monat eingrenzen.
      await page.getByTestId("input-error-search").fill(`${stamp}`);

      await page.getByTestId("button-error-preset-this-month").click();

      const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      await expect(page.getByTestId("input-error-range-from")).toHaveAttribute("data-value", 
        `${y}-${pad(m + 1)}-01`,
      );
      await expect(page.getByTestId("input-error-range-to")).toHaveAttribute("data-value", 
        `${y}-${pad(m + 1)}-${pad(lastDay)}`,
      );

      // Monatserster + Heute-Einträge sichtbar, Vormonats-Nachbar nicht.
      await expect(
        page.getByTestId(`row-operator-error-${idMonatErster}`),
      ).toBeVisible();
      await expect(
        page.getByTestId(`row-operator-error-${idMonatHeute}`),
      ).toBeVisible();
      await expect(
        page.getByTestId(`row-operator-error-${idMonatVormonat}`),
      ).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("UI: 'Letzte 30 Tage' zeigt Tag 30, aber nicht Tag 31", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      baseURL: BASE_URL,
      timezoneId: "UTC",
    });
    try {
      const page = await context.newPage();
      const loginRes = await page.request.post("/api/auth/login", {
        data: { email: superEmail, password: superPassword },
      });
      expect(loginRes.ok(), "UI-Login als superadmin fehlgeschlagen").toBe(true);

      await page.goto("/operator-dashboard");
      await page.getByTestId("input-error-search").fill(`${stamp}`);

      await page.getByTestId("button-error-preset-last-30-days").click();

      await expect(page.getByTestId("input-error-range-from")).toHaveAttribute("data-value", 
        `${ts30Tag30.getUTCFullYear()}-${pad(ts30Tag30.getUTCMonth() + 1)}-${pad(ts30Tag30.getUTCDate())}`,
      );
      await expect(page.getByTestId("input-error-range-to")).toHaveAttribute("data-value", 
        `${y}-${pad(m + 1)}-${pad(d)}`,
      );

      await expect(
        page.getByTestId(`row-operator-error-${id30Tag30}`),
      ).toBeVisible();
      await expect(
        page.getByTestId(`row-operator-error-${id30Heute}`),
      ).toBeVisible();
      await expect(
        page.getByTestId(`row-operator-error-${id30Tag31}`),
      ).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("UI: 'Letzter Monat' befüllt beide Felder korrekt", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      baseURL: BASE_URL,
      timezoneId: "UTC",
    });
    try {
      const page = await context.newPage();
      const loginRes = await page.request.post("/api/auth/login", {
        data: { email: superEmail, password: superPassword },
      });
      expect(loginRes.ok(), "UI-Login als superadmin fehlgeschlagen").toBe(true);

      await page.goto("/operator-dashboard");
      await expect(page.getByTestId("input-error-range-from")).toBeVisible();

      await page.getByTestId("button-error-preset-last-month").click();

      const firstPrevMonth = new Date(Date.UTC(y, m - 1, 1));
      const lastPrevMonth = new Date(Date.UTC(y, m, 0));
      await expect(page.getByTestId("input-error-range-from")).toHaveAttribute("data-value", 
        `${firstPrevMonth.getUTCFullYear()}-${pad(firstPrevMonth.getUTCMonth() + 1)}-01`,
      );
      await expect(page.getByTestId("input-error-range-to")).toHaveAttribute("data-value", 
        `${lastPrevMonth.getUTCFullYear()}-${pad(lastPrevMonth.getUTCMonth() + 1)}-${pad(lastPrevMonth.getUTCDate())}`,
      );
    } finally {
      await context.close();
    }
  });
});
