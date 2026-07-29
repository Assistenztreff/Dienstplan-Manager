import { test, expect, type Page, type Browser } from "@playwright/test";
import {
  dbSeedSuperadmin,
  dbDeleteAccountByEmail,
  dbInsertPlatformError,
  dbDeletePlatformErrorsByContextPrefix,
} from "./helpers/db";

/**
 * E2E-Test: Schnellauswahl (Dieser Monat / Letzter Monat / Letzte 30 Tage)
 * im Zeitraum-Filter der Operator-Fehlerliste (Task #436, analog zu den
 * Plan-Protokoll-Specs dienstplan-operator-plan-preset-*.spec.ts).
 *
 * Der von/bis-Filter der Fehlerliste existiert seit Task #414
 * (dienstplan-operator-fehler-zeitraum.spec.ts); dieser Spec sichert die
 * NEUEN Preset-Buttons ab:
 *   1. Klick auf ein Preset befuellt BEIDE Datumsfelder in einem Schritt
 *      (Berechnung lokal, wie applyPlanRangePreset im Plan-Protokoll).
 *   2. Die Liste filtert danach serverseitig nach dem LETZTEN Auftreten
 *      (platform_errors.last_seen_at) — bewiesen an den Randpunkten:
 *
 * "Dieser Monat":
 *   - Eintrag am ERSTEN Tag des aktuellen Monats, 00:00 Uhr -> erscheint
 *   - Eintrag "heute"                                        -> erscheint
 *   - Eintrag am LETZTEN Tag des Vormonats, 23:59 Uhr        -> erscheint NICHT
 *
 * "Letzte 30 Tage" (heute = Tag 1, also heute-29 = Tag 30 eingeschlossen,
 * heute-30 = Tag 31 ausgeschlossen):
 *   - Eintrag am Tag heute-29, 00:00 Uhr -> erscheint (unterer Rand)
 *   - Eintrag "heute"                    -> erscheint (oberer Rand)
 *   - Eintrag am Tag heute-30, 23:59 Uhr -> erscheint NICHT
 *
 * Seeding: platform_errors-Zeilen mit kontrolliertem lastSeenAt werden
 * direkt in der Test-DB angelegt (dbInsertPlatformError) — der zentrale
 * Error-Handler setzt lastSeenAt sonst immer auf "jetzt". Eindeutige
 * Kontext-Praefixe pro Preset erlauben die Isolation per Textsuche
 * (input-error-search filtert serverseitig ueber Meldung UND Kontext),
 * robust gegen parallel laufende Specs, die eigene Fehler erzeugen.
 *
 * Superadmin-Konten werden pro Test FRISCH geseedet und sofort angemeldet:
 * auf der geteilten Staging-`_test`-DB kann der Teardown eines FREMDEN
 * Laufs e2e.*-Konten jederzeit wegputzen — ein in beforeAll angelegtes
 * Konto ueberlebt die Wartezeit bis zum Test sonst nicht zuverlaessig.
 * Die geseedeten platform_errors-Zeilen sind davon NICHT betroffen (der
 * Konten-Cleanup fasst platform_errors nicht an; der Fehler-Cleanup
 * loescht nur die festen Test-Kontexte aus @workspace/test-fixtures).
 *
 * Der Browser-Kontext laeuft mit timezoneId "UTC", damit die LOKALE
 * Preset-Berechnung deterministisch den geseedeten UTC-Zeitstempeln
 * entspricht. Bekannte (bewusst akzeptierte) Rest-Unschaerfe: rollt der
 * UTC-Tag GENAU zwischen Seeding und Preset-Klick um Mitternacht um,
 * verschieben sich die Grenzen um einen Tag (extrem kleines Zeitfenster,
 * wie bei den Plan-Protokoll-Specs).
 *
 * Laeuft gegen den isolierten Test-Stack (eigener API + Vite auf der
 * `_test`-DB).
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

const pad = (n: number) => String(n).padStart(2, "0");

test.describe("Schnellauswahl-Presets filtern die Operator-Fehlerliste", () => {
  // Setup (Fehler-Inserts) und Kontext-Aufbau koennen unter Suiten-Volllast
  // dauern.
  test.setTimeout(120_000);

  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const superPassword = "superadmin1234";
  const seededEmails: string[] = [];

  /**
   * Seedet pro Aufruf einen FRISCHEN superadmin, oeffnet einen UTC-Kontext
   * und meldet sich programmatisch an (Cookie-Jar geteilt mit dem Browser —
   * der Dev-Auto-Login greift dadurch nie). Frisches Konto direkt vor dem
   * Login, damit fremde Konten-Cleanups (geteilte `_test`-DB) das Konto
   * nicht schon vor Testbeginn geloescht haben.
   */
  async function openSuperadminPage(
    browser: Browser,
    slug: string,
  ): Promise<{ page: Page; close: () => Promise<void> }> {
    const email = `e2e.superadmin.fehlerpreset.${slug}.${stamp}@dienstplan.test`;
    seededEmails.push(email);
    await dbSeedSuperadmin(email, superPassword, `E2E Fehlerpreset ${slug} ${stamp}`);
    const context = await browser.newContext({
      baseURL: BASE_URL,
      timezoneId: "UTC",
    });
    const page = await context.newPage();
    const loginRes = await page.request.post("/api/auth/login", {
      data: { email, password: superPassword },
    });
    expect(loginRes.ok(), "UI-Login als superadmin fehlgeschlagen").toBe(true);
    return { page, close: () => context.close() };
  }

  // Zwei DISJUNKTE Kontext-Praefixe (eines je Preset), damit die Assertions
  // je Preset unabhaengig voneinander und von fremden Fehlerzeilen sind.
  const prefixMonat = `E2E-FEHLERPRESET-MONAT-${stamp}`;
  const prefix30 = `E2E-FEHLERPRESET-30TAGE-${stamp}`;

  // Zeitstempel in UTC — der Browser-Kontext laeuft mit timezoneId "UTC",
  // sodass die "lokale" Preset-Berechnung exakt diese Grenzen ergibt.
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();

  // "Dieser Monat": unterer Rand einschliesslich, Vormonat knapp ausserhalb.
  const tsMonatErster = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
  const tsMonatVormonat = new Date(Date.UTC(y, m, 0, 23, 59, 0, 0));

  // "Letzte 30 Tage": heute = Tag 1 -> heute-29 (Tag 30) einschliesslich,
  // heute-30 (Tag 31) knapp ausserhalb.
  const ts30Tag30 = new Date(Date.UTC(y, m, d - 29, 0, 0, 0, 0));
  const ts30Tag31 = new Date(Date.UTC(y, m, d - 30, 23, 59, 0, 0));

  // "Heute"-Eintraege beider Presets: oberer Rand (liegt vor dem jeweiligen
  // Tages-/Monatsende, muss also erscheinen). Fester Zeitpunkt statt
  // "jetzt", damit die Assertions deterministisch bleiben.
  const tsHeute = new Date(Date.UTC(y, m, d, 0, 0, 30, 0));

  // Zeilen-IDs der geseedeten Fehler (fuer gezielte row-Assertions).
  let idMonatErster: number;
  let idMonatHeute: number;
  let idMonatVormonat: number;
  let id30Tag30: number;
  let id30Heute: number;
  let id30Tag31: number;

  test.beforeAll(async () => {
    // Sechs Fehlerzeilen mit kontrolliertem lastSeenAt seeden — jeweils
    // eindeutiger Kontext, damit die Suche exakt drei Zeilen pro Preset
    // isoliert.
    idMonatErster = await dbInsertPlatformError({
      message: "E2E Preset-Testfehler: Monatserster",
      context: `${prefixMonat}-MONATSERSTER`,
      lastSeenAt: tsMonatErster,
    });
    idMonatHeute = await dbInsertPlatformError({
      message: "E2E Preset-Testfehler: Heute (Monat)",
      context: `${prefixMonat}-HEUTE`,
      lastSeenAt: tsHeute,
    });
    idMonatVormonat = await dbInsertPlatformError({
      message: "E2E Preset-Testfehler: Vormonat-Letzter",
      context: `${prefixMonat}-VORMONAT-LETZTER`,
      lastSeenAt: tsMonatVormonat,
    });
    id30Tag30 = await dbInsertPlatformError({
      message: "E2E Preset-Testfehler: Tag 30 eingeschlossen",
      context: `${prefix30}-TAG30-EINGESCHLOSSEN`,
      lastSeenAt: ts30Tag30,
    });
    id30Heute = await dbInsertPlatformError({
      message: "E2E Preset-Testfehler: Heute (30 Tage)",
      context: `${prefix30}-HEUTE`,
      lastSeenAt: tsHeute,
    });
    id30Tag31 = await dbInsertPlatformError({
      message: "E2E Preset-Testfehler: Tag 31 ausgeschlossen",
      context: `${prefix30}-TAG31-AUSGESCHLOSSEN`,
      lastSeenAt: ts30Tag31,
    });
  });

  test.afterAll(async () => {
    try {
      await dbDeletePlatformErrorsByContextPrefix(`E2E-FEHLERPRESET-`);
    } catch {
      /* Best effort — Cleanup darf den Lauf nicht kippen. */
    }
    for (const email of seededEmails) {
      try {
        await dbDeleteAccountByEmail(email);
      } catch {
        /* ignore */
      }
    }
  });

  test("UI: 'Dieser Monat' befuellt beide Felder und filtert an den Raendern", async ({
    browser,
  }) => {
    const { page, close } = await openSuperadminPage(browser, "monat");
    try {
      await page.goto("/operator-dashboard");

      // Erst per Suche auf die drei eindeutigen Kontexte einschraenken.
      // Ohne Zeitraum muessen alle DREI erscheinen (Kontrolle, dass die
      // Testdaten wirklich da sind — sonst wuerde der Preset-Test nichts
      // beweisen).
      await page.getByTestId("input-error-search").fill(prefixMonat);
      await expect(
        page.getByTestId(`row-operator-error-${idMonatErster}`),
      ).toBeVisible();
      await expect(
        page.getByTestId(`row-operator-error-${idMonatHeute}`),
      ).toBeVisible();
      await expect(
        page.getByTestId(`row-operator-error-${idMonatVormonat}`),
      ).toBeVisible();

      // Schnellauswahl "Dieser Monat" klicken -> BEIDE Felder werden in
      // einem Schritt befuellt, der Server filtert neu.
      await page.getByTestId("button-error-preset-this-month").click();

      const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      await expect(page.getByTestId("input-error-range-from")).toHaveAttribute("data-value", 
        `${y}-${pad(m + 1)}-01`,
      );
      await expect(page.getByTestId("input-error-range-to")).toHaveAttribute("data-value", 
        `${y}-${pad(m + 1)}-${pad(lastDay)}`,
      );

      // Ergebnis: GENAU Monatserster + Heute — der Vormonats-Nachbar
      // (letzter Tag Vormonat 23:59) darf NICHT erscheinen.
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
      await close();
    }
  });

  test("UI: 'Letzte 30 Tage' schliesst Tag 30 ein, Tag 31 aus", async ({
    browser,
  }) => {
    const { page, close } = await openSuperadminPage(browser, "dreissig");
    try {
      await page.goto("/operator-dashboard");

      // Kontrolle: alle DREI Kontexte ohne Zeitraum sichtbar.
      await page.getByTestId("input-error-search").fill(prefix30);
      await expect(
        page.getByTestId(`row-operator-error-${id30Tag30}`),
      ).toBeVisible();
      await expect(
        page.getByTestId(`row-operator-error-${id30Heute}`),
      ).toBeVisible();
      await expect(
        page.getByTestId(`row-operator-error-${id30Tag31}`),
      ).toBeVisible();

      // Schnellauswahl "Letzte 30 Tage" klicken.
      await page.getByTestId("button-error-preset-last-30-days").click();

      // Felder muessen heute-29 bis heute zeigen (Sanity-Check). Datum via
      // UTC-Getter aus dem geseedeten Tag-30-Zeitstempel abgeleitet.
      await expect(page.getByTestId("input-error-range-from")).toHaveAttribute("data-value", 
        `${ts30Tag30.getUTCFullYear()}-${pad(ts30Tag30.getUTCMonth() + 1)}-${pad(ts30Tag30.getUTCDate())}`,
      );
      await expect(page.getByTestId("input-error-range-to")).toHaveAttribute("data-value", 
        `${y}-${pad(m + 1)}-${pad(d)}`,
      );

      // Ergebnis: GENAU Tag 30 + Heute — Tag 31 (heute-30, 23:59) darf
      // NICHT erscheinen.
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
      await close();
    }
  });

  test("UI: 'Letzter Monat' befuellt beide Felder mit den Vormonats-Grenzen", async ({
    browser,
  }) => {
    // Filterwirkung an den Raendern ist oben fuer zwei Presets bewiesen
    // (gleiche Server-Logik); hier genuegt der Feld-Befuellungs-Nachweis
    // fuer das dritte Preset.
    const { page, close } = await openSuperadminPage(browser, "vormonat");
    try {
      await page.goto("/operator-dashboard");
      await expect(
        page.getByTestId("button-error-preset-last-month"),
      ).toBeVisible();

      await page.getByTestId("button-error-preset-last-month").click();

      const prevFirst = new Date(Date.UTC(y, m - 1, 1));
      const prevLast = new Date(Date.UTC(y, m, 0));
      await expect(page.getByTestId("input-error-range-from")).toHaveAttribute("data-value", 
        `${prevFirst.getUTCFullYear()}-${pad(prevFirst.getUTCMonth() + 1)}-01`,
      );
      await expect(page.getByTestId("input-error-range-to")).toHaveAttribute("data-value", 
        `${prevLast.getUTCFullYear()}-${pad(prevLast.getUTCMonth() + 1)}-${pad(prevLast.getUTCDate())}`,
      );
    } finally {
      await close();
    }
  });
});
