import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import {
  BASE_URL,
  deleteFreeAccount,
  registerFreeAccount,
  setAccountPlan,
  type FreeAccount,
} from "./helpers/teams";

/**
 * Menü-Neustrukturierung (5 aufgabenbasierte Hauptpunkte):
 *
 * 1. Desktop: Hauptpunkte Start · Planen · Auswerten · Verwalten (Erfassen
 *    nur bei eingeschalteter Zeiterfassung).
 * 2. §7: Direktaufruf einer Kind-Route (z. B. /abwesenheiten) markiert die
 *    richtige Gruppe aktiv und zeigt die Tab-Zeile der Gruppe.
 * 3. Rollen-Matrix: Assistenzkraft sieht kein "Auswerten"; unter "Verwalten"
 *    nur Einstellungen; Abwesenheiten ist als Kind von "Planen" erreichbar.
 * 4. §9 Mobil: Gruppen als Akkordeon im Vollbild-Menü.
 *
 * Login via API-Session + storageState (Memory e2e-dev-auto-login).
 */

test.describe.configure({ mode: "serial" });

let acc: FreeAccount;
let assistantCtx: APIRequestContext;

async function openPageAs(
  browser: import("@playwright/test").Browser,
  ctx: APIRequestContext,
  viewport: { width: number; height: number } = { width: 1280, height: 720 },
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({
    storageState: await ctx.storageState(),
    viewport,
  });
  const page = await context.newPage();
  return { page, close: () => context.close() };
}

function desktopNav(page: Page) {
  return page.getByTestId("app-subnav-desktop");
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  acc = await registerFreeAccount("privat", "menustruktur");

  // Assistenzkraft über den echten Einladungsflow einloggen.
  const userRes = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E MenuStruktur Assistent ${Date.now()}`,
      email: `e2e.menustruktur.${Date.now()}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(userRes.status()).toBe(201);
  const assistantId = ((await userRes.json()) as { id: number }).id;
  await setAccountPlan(acc.email, "premium");
  const inviteRes = await acc.ctx.post(`/api/users/${assistantId}/invite`);
  expect(inviteRes.ok()).toBe(true);
  const token = ((await inviteRes.json()) as { token: string }).token;
  assistantCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const setPwRes = await assistantCtx.post("/api/auth/set-password", {
    data: { token, password: "assistent1234" },
  });
  expect(setPwRes.ok()).toBe(true);
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
  try {
    await assistantCtx?.dispose();
  } catch {
    /* ignore */
  }
});

test("Admin (Desktop): 5 Hauptpunkte, Erfassen folgt dem Zeiterfassungs-Schalter", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { page, close } = await openPageAs(browser, acc.ctx);
  try {
    await page.goto("/");
    const nav = desktopNav(page);
    await expect(nav.getByRole("link", { name: "Start", exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(nav.getByTestId("nav-group-planen")).toBeVisible();
    await expect(nav.getByRole("link", { name: "Auswerten", exact: true })).toBeVisible();
    await expect(nav.getByTestId("nav-group-verwalten")).toBeVisible();
    // Zeiterfassung ist bei frischen Konten AUS → "Erfassen" fehlt.
    await expect(nav.getByRole("link", { name: "Erfassen", exact: true })).toHaveCount(0);
    // Alte Flach-Punkte existieren in der Hauptleiste nicht mehr.
    await expect(nav.getByRole("link", { name: "Dashboard", exact: true })).toHaveCount(0);
  } finally {
    await close();
  }
});

test("§7 Direktaufruf /abwesenheiten: Gruppe 'Planen' aktiv + Tab-Zeile sichtbar", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { page, close } = await openPageAs(browser, acc.ctx);
  try {
    await page.goto("/abwesenheiten");
    const group = desktopNav(page).getByTestId("nav-group-planen");
    await expect(group).toBeVisible({ timeout: 30_000 });
    await expect(group, "Gruppe muss bei Kind-Route aktiv markiert sein").toHaveAttribute(
      "aria-current",
      "page",
    );
    const tabs = page.getByTestId("app-subnav-tabs");
    await expect(tabs).toBeVisible();
    await expect(tabs.getByRole("link", { name: "Dienstplan", exact: true })).toBeVisible();
    const absencesTab = tabs.getByRole("link", { name: "Abwesenheiten", exact: true });
    await expect(absencesTab.locator("span")).toHaveAttribute("aria-current", "page");

    // Tab-Wechsel innerhalb der Gruppe funktioniert.
    await tabs.getByRole("link", { name: "Dienstplan", exact: true }).click();
    await expect(page).toHaveURL(/\/dienstplan$/);
    await expect(group).toHaveAttribute("aria-current", "page");
  } finally {
    await close();
  }
});

test("Klick auf Gruppe 'Verwalten' führt zum ersten sichtbaren Kind", async ({ browser }) => {
  test.setTimeout(120_000);
  const { page, close } = await openPageAs(browser, acc.ctx);
  try {
    await page.goto("/");
    const group = desktopNav(page).getByTestId("nav-group-verwalten");
    await expect(group).toBeVisible({ timeout: 30_000 });
    await group.click();
    // Admin: erstes sichtbares Kind ist "Team-Verwaltung" (/team-verwaltung).
    await expect(page).toHaveURL(/\/team-verwaltung$/);
    const tabs = page.getByTestId("app-subnav-tabs");
    // Team-Verwaltung ist für Admins und Teamleitungen sichtbar — auch bei
    // Privat-Konten; reine Assistenzkräfte sehen den Punkt weiterhin nicht.
    await expect(tabs.getByRole("link", { name: "Team-Verwaltung", exact: true })).toBeVisible();
    await expect(tabs.getByRole("link", { name: "Einstellungen", exact: true })).toBeVisible();
  } finally {
    await close();
  }
});

test("Team-Verwaltung ist bei Dienstleister-Konten im Menü sichtbar", async ({ browser }) => {
  test.setTimeout(120_000);
  // Positiv-Probe: Dienstleister-Konten sehen den Menüpunkt ebenfalls
  // (Privat-Admins werden im vorherigen Test abgedeckt).
  const dl = await registerFreeAccount("dienstleister", "menustruktur.dl");
  try {
    const { page, close } = await openPageAs(browser, dl.ctx);
    try {
      await page.goto("/");
      const group = desktopNav(page).getByTestId("nav-group-verwalten");
      await expect(group).toBeVisible({ timeout: 30_000 });
      await group.click();
      const tabs = page.getByTestId("app-subnav-tabs");
      await expect(
        tabs.getByRole("link", { name: "Team-Verwaltung", exact: true }),
      ).toBeVisible();
    } finally {
      await close();
    }
  } finally {
    await deleteFreeAccount(dl);
  }
});

test("Rollen-Matrix Assistenzkraft: kein Auswerten, Verwalten nur Einstellungen, Abwesenheiten erreichbar", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { page, close } = await openPageAs(browser, assistantCtx);
  try {
    await page.goto("/");
    const nav = desktopNav(page);
    await expect(nav.getByRole("link", { name: "Start", exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(nav.getByRole("link", { name: "Auswerten", exact: true })).toHaveCount(0);
    await expect(nav.getByTestId("nav-group-planen")).toBeVisible();

    // "Verwalten" enthält für Assistenzkräfte nur Einstellungen → Klick landet dort.
    await nav.getByTestId("nav-group-verwalten").click();
    await expect(page).toHaveURL(/\/einstellungen$/);
    const tabs = page.getByTestId("app-subnav-tabs");
    await expect(tabs.getByRole("link", { name: "Einstellungen", exact: true })).toBeVisible();
    await expect(tabs.getByRole("link", { name: "Assistenzkräfte", exact: true })).toHaveCount(0);
    await expect(tabs.getByRole("link", { name: "Team-Verwaltung", exact: true })).toHaveCount(0);

    // Abwesenheiten (§3): Kind von "Planen", Seite rendert im Selbst-Modus.
    await page.goto("/abwesenheiten");
    await expect(page.getByTestId("absence-user-self")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("absence-user")).toHaveCount(0);
    await expect(page.getByTestId("absence-save")).toBeVisible();
  } finally {
    await close();
  }
});

test("§9 Mobil: Gruppen als Akkordeon im Vollbild-Menü", async ({ browser }) => {
  test.setTimeout(120_000);
  const { page, close } = await openPageAs(browser, acc.ctx, { width: 400, height: 874 });
  try {
    await page.goto("/");
    await page.getByTestId("platform-header-hamburger").click();
    const menu = page.getByTestId("mobile-full-menu");
    await expect(menu.getByRole("link", { name: "Start", exact: true })).toBeVisible({
      timeout: 30_000,
    });

    // Gruppe zu: Kinder unsichtbar. Aufklappen zeigt die Kind-Links.
    const groupButton = menu.getByTestId("mobile-nav-group-planen");
    await expect(groupButton).toBeVisible();
    await expect(menu.getByRole("link", { name: "Abwesenheiten", exact: true })).toHaveCount(0);
    await groupButton.click();
    const childLink = menu.getByRole("link", { name: "Abwesenheiten", exact: true });
    await expect(childLink).toBeVisible();

    // Navigation über den Kind-Link schließt das Menü und wechselt die Route.
    await childLink.click();
    await expect(page).toHaveURL(/\/abwesenheiten$/);
    await expect(menu).not.toBeVisible();
  } finally {
    await close();
  }
});
