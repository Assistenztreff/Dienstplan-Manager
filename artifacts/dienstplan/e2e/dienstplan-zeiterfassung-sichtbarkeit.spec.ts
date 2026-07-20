import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from "@playwright/test";
import {
  BASE_URL,
  deleteFreeAccount,
  registerFreeAccount,
  setAccountPlan,
  type FreeAccount,
} from "./helpers/teams";

/**
 * UI-Test für das Ausblenden der Zeiterfassung bei ausgeschaltetem
 * Konto-Schalter (allowance_settings.time_tracking_enabled, Standard AUS).
 *
 * Deckt ab (Done-Kriterien der Aufgabe):
 * 1. AUS (Admin): Menüpunkt "Zeiterfassung" fehlt in der Navigation; die
 *    KPI-Kachel "Offene Zeiteinträge" fehlt auf dem Dashboard; Direktaufruf
 *    von /zeiterfassung zeigt den Hinweis MIT Einstellungs-Verweis.
 * 2. AUS (Assistenzkraft): Menüpunkt fehlt ebenfalls; Direktaufruf zeigt den
 *    Hinweis OHNE Einstellungs-Verweis.
 * 3. Einschalten über die Einstellungen (Schalter + Bestätigungs-Dialog):
 *    Menüpunkt erscheint OHNE Neuladen der Seite (React-Query-Invalidierung).
 * 4. AN: Menüpunkt sichtbar (Admin + Assistenzkraft), /zeiterfassung rendert
 *    die echte Seite statt des Hinweises.
 *
 * Login der Browser-Teile: Session per API aufbauen und via storageState in
 * den Browser übernehmen (Memory e2e-dev-auto-login: das Login-Formular
 * rendert im Vite-DEV nie, weil der Auto-Dev-Login bei 401 feuert).
 */

test.describe.configure({ mode: "serial" });

let acc: FreeAccount;
let assistantCtx: APIRequestContext | undefined;

/** Öffnet eine Browser-Seite mit der Session des übergebenen API-Kontexts. */
async function openPageAs(
  browser: import("@playwright/test").Browser,
  ctx: APIRequestContext,
): Promise<{ page: Page; close: () => Promise<void> }> {
  // Desktop-Viewport erzwingen: die Pillen-Navigation (app-subnav-desktop)
  // ist unterhalb des md-Breakpoints ausgeblendet (Standard-Viewport mobil).
  const context = await browser.newContext({
    storageState: await ctx.storageState(),
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  return { page, close: () => context.close() };
}

/** Der Navigations-Link "Zeiterfassung" in der Desktop-Pillen-Navigation. */
function navLink(page: Page) {
  return page
    .getByTestId("app-subnav-desktop")
    .getByRole("link", { name: "Zeiterfassung", exact: true });
}

/**
 * Öffnet eine Browser-Seite mit MOBILEM Viewport (Memory-Note
 * e2e-mobile-viewport-selectors: 400px versteckt die Desktop-Nav; das
 * App-Menü liegt im Off-Canvas-Drawer hinter dem "App-Menü öffnen"-Button).
 */
async function openMobilePageAs(
  browser: import("@playwright/test").Browser,
  ctx: APIRequestContext,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({
    storageState: await ctx.storageState(),
    viewport: { width: 400, height: 874 },
  });
  const page = await context.newPage();
  return { page, close: () => context.close() };
}

/** Der Navigations-Link "Zeiterfassung" im mobilen App-Menü-Drawer. */
function drawerNavLink(page: Page) {
  return page
    .getByTestId("app-menu-drawer")
    .getByRole("link", { name: "Zeiterfassung", exact: true });
}

/** Öffnet den mobilen Drawer und wartet, bis er gerendert ist (Anker: Dashboard-Link). */
async function openDrawer(page: Page): Promise<void> {
  await page.getByRole("button", { name: "App-Menü öffnen" }).click();
  await expect(
    page.getByTestId("app-menu-drawer").getByRole("link", { name: "Dashboard", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
}

/** Wartet, bis die Navigation gerendert ist (Anker: Dashboard-Link). */
async function waitForNav(page: Page): Promise<void> {
  await expect(
    page.getByTestId("app-subnav-desktop").getByRole("link", { name: "Dashboard", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  acc = await registerFreeAccount("privat", "ttsichtbar");

  // Assistenzkraft im Standard-Team anlegen und über den echten
  // Einladungsflow einloggen (Einladen ist Premium-gegated).
  const userRes = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E TT-Sichtbar Assistent ${Date.now()}`,
      email: `e2e.ttsichtbar.${Date.now()}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(userRes.status(), "Assistent sollte 201 liefern").toBe(201);
  const assistantId = ((await userRes.json()) as { id: number }).id;

  await setAccountPlan(acc.email, "premium");
  const inviteRes = await acc.ctx.post(`/api/users/${assistantId}/invite`);
  expect(inviteRes.ok(), `Einladung sollte klappen (${inviteRes.status()})`).toBe(true);
  const token = ((await inviteRes.json()) as { token: string }).token;
  assistantCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const setPwRes = await assistantCtx.post("/api/auth/set-password", {
    data: { token, password: "assistent1234" },
  });
  expect(setPwRes.ok(), `set-password sollte 200 liefern (${setPwRes.status()})`).toBe(true);
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
  try {
    await assistantCtx?.dispose();
  } catch {
    /* ignore */
  }
});

test("AUS (Admin): Menüpunkt und KPI-Kachel fehlen, Direktaufruf zeigt Hinweis mit Einstellungs-Verweis", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { page, close } = await openPageAs(browser, acc.ctx);
  try {
    await page.goto("/");
    await waitForNav(page);
    await expect(navLink(page), "Menüpunkt darf bei AUS nicht existieren").toHaveCount(0);

    // Dashboard geladen: bei AUS ersetzt "Geplante Stunden (Monat)" die
    // Ist/Soll-Bilanz; beide Zeiterfassungs-Kacheln fehlen.
    await expect(page.getByTestId("kpi-planned-hours")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("kpi-pending-time-entries")).toHaveCount(0);
    await expect(page.getByTestId("kpi-hours-balance")).toHaveCount(0);

    // Direktaufruf der URL: freundlicher Hinweis statt Seite, mit
    // Einstellungs-Verweis für Admins.
    await page.goto("/zeiterfassung");
    const notice = page.getByTestId("time-tracking-disabled-notice");
    await expect(notice).toBeVisible({ timeout: 30_000 });
    await expect(notice).toContainText("Zeiterfassung ist deaktiviert");
    await expect(notice, "Admin-Hinweis muss auf die Einstellungen verweisen").toContainText(
      "Einstellungen",
    );
  } finally {
    await close();
  }
});

test("AUS (Assistenzkraft): Menüpunkt fehlt, Hinweis ohne Einstellungs-Verweis", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { page, close } = await openPageAs(browser, assistantCtx!);
  try {
    await page.goto("/");
    await waitForNav(page);
    await expect(navLink(page), "Menüpunkt darf bei AUS nicht existieren").toHaveCount(0);

    await page.goto("/zeiterfassung");
    const notice = page.getByTestId("time-tracking-disabled-notice");
    await expect(notice).toBeVisible({ timeout: 30_000 });
    await expect(notice).toContainText("Zeiterfassung ist deaktiviert");
    await expect(
      notice,
      "Assistenz-Hinweis darf NICHT auf die Einstellungen verweisen",
    ).not.toContainText("Einstellungen");
  } finally {
    await close();
  }
});

test("AUS (mobil): Menüpunkt fehlt im geöffneten App-Menü-Drawer (Admin + Assistenzkraft)", async ({
  browser,
}) => {
  test.setTimeout(120_000);

  const admin = await openMobilePageAs(browser, acc.ctx);
  try {
    await admin.page.goto("/");
    await openDrawer(admin.page);
    await expect(
      drawerNavLink(admin.page),
      "Menüpunkt darf bei AUS auch mobil nicht existieren (Admin)",
    ).toHaveCount(0);
  } finally {
    await admin.close();
  }

  const assistant = await openMobilePageAs(browser, assistantCtx!);
  try {
    await assistant.page.goto("/");
    await openDrawer(assistant.page);
    await expect(
      drawerNavLink(assistant.page),
      "Menüpunkt darf bei AUS auch mobil nicht existieren (Assistenzkraft)",
    ).toHaveCount(0);
  } finally {
    await assistant.close();
  }
});

test("Einschalten in den Einstellungen wirkt ohne Neuladen: Menüpunkt erscheint sofort", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { page, close } = await openPageAs(browser, acc.ctx);
  try {
    await page.goto("/einstellungen");
    const toggle = page.getByTestId("allowance-time-tracking-switch");
    await expect(toggle).toBeVisible({ timeout: 30_000 });
    await expect(navLink(page), "Vorher: Menüpunkt fehlt").toHaveCount(0);

    // Einschalten erfordert den Bestätigungs-Dialog; speichert direkt.
    await toggle.click();
    await page.getByTestId("time-tracking-confirm-accept").click();

    // OHNE page.reload(): Menüpunkt muss durch die Query-Invalidierung erscheinen.
    await expect(
      navLink(page),
      "Menüpunkt muss ohne Neuladen erscheinen",
    ).toBeVisible({ timeout: 30_000 });
  } finally {
    await close();
  }
});

test("AN: Menüpunkt sichtbar (Admin + Assistenzkraft), Seite rendert statt Hinweis", async ({
  browser,
}) => {
  test.setTimeout(120_000);

  const admin = await openPageAs(browser, acc.ctx);
  try {
    await admin.page.goto("/zeiterfassung");
    await expect(
      admin.page.getByRole("heading", { name: "Zeiterfassung", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(admin.page.getByTestId("time-tracking-disabled-notice")).toHaveCount(0);
    await expect(navLink(admin.page)).toBeVisible();
  } finally {
    await admin.close();
  }

  const assistant = await openPageAs(browser, assistantCtx!);
  try {
    await assistant.page.goto("/");
    await waitForNav(assistant.page);
    await expect(
      navLink(assistant.page),
      "Assistenzkraft sieht den Menüpunkt, sobald der Arbeitgeber einschaltet",
    ).toBeVisible({ timeout: 30_000 });
  } finally {
    await assistant.close();
  }
});

test("AN (mobil): Menüpunkt sichtbar im geöffneten App-Menü-Drawer (Admin + Assistenzkraft)", async ({
  browser,
}) => {
  test.setTimeout(120_000);

  const admin = await openMobilePageAs(browser, acc.ctx);
  try {
    await admin.page.goto("/");
    await openDrawer(admin.page);
    await expect(
      drawerNavLink(admin.page),
      "Menüpunkt muss bei AN auch mobil sichtbar sein (Admin)",
    ).toBeVisible({ timeout: 30_000 });
  } finally {
    await admin.close();
  }

  const assistant = await openMobilePageAs(browser, assistantCtx!);
  try {
    await assistant.page.goto("/");
    await openDrawer(assistant.page);
    await expect(
      drawerNavLink(assistant.page),
      "Menüpunkt muss bei AN auch mobil sichtbar sein (Assistenzkraft)",
    ).toBeVisible({ timeout: 30_000 });
  } finally {
    await assistant.close();
  }
});
