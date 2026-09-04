import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import {
  registerFreeAccount,
  deleteFreeAccount,
  setAccountPlan,
  setVertretungEnabled,
  FREE_ACCOUNT_PASSWORD,
  type FreeAccount,
} from "./helpers/teams";

/**
 * Kay-Rueckmeldung 03.09.2026: „In meinem Dienstleister-Account habe ich in den
 * Einstellungen die Vertretung eingeschaltet und eine Vertretungsvergütung
 * ausgewählt. Im Dienstplan werden aber keine Vertretungszeilen angezeigt."
 *
 * Der Schalter haengt seit dem 03.09.2026 am Team statt am einzelnen Dienst.
 * Ein Dienstleister liest ihn mit `teamId` — dieser Weg wird hier vom
 * Einschalten bis zur Zeile im Raster durchgespielt, einmal am Konto gesetzt
 * (das Team erbt) und einmal als Team-Regel.
 */

const ANKER = (() => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + 3);
  if (d.getDate() > 20) d.setMonth(d.getMonth() + 1, 5);
  return d;
})();
const ZIEL_ISO = [
  ANKER.getFullYear(),
  String(ANKER.getMonth() + 1).padStart(2, "0"),
  String(ANKER.getDate()).padStart(2, "0"),
].join("-");

let acc: FreeAccount | undefined;
let ctx: APIRequestContext;
let teamId = 0;
let dienstId = 0;
let schichtId = 0;

async function loginUi(page: Page): Promise<void> {
  const res = await page.request.post("/api/auth/login", {
    data: { email: acc!.email, password: FREE_ACCOUNT_PASSWORD },
  });
  expect(res.ok(), `Login fehlgeschlagen (${res.status()})`).toBe(true);
}

async function oeffneRaster(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/dienstplan");
  await page.evaluate(() => {
    localStorage.setItem("dienstplan.desktopView", "grid");
    // Die Vertretungszeile gehoert zur zweizeiligen Pille — im minimierten
    // Modus gibt es sie bewusst nicht.
    localStorage.setItem("dienstplan.pillMinimiert", "0");
  });
  await page.goto(`/dienstplan?date=${ZIEL_ISO}`);
  await expect(page.getByTestId("dienstplan-desktop").getByTestId("month-grid")).toBeVisible();
}

test.beforeAll(async () => {
  test.setTimeout(180_000);
  acc = await registerFreeAccount("dienstleister", "vertrdl");
  ctx = acc.ctx;
  await setAccountPlan(acc.email, "premium");

  const teams = (await (await ctx.get("/api/teams")).json()) as { id: number }[];
  teamId = teams[0]!.id;

  const models = (await (await ctx.get("/api/shift-models")).json()) as { id: number }[];
  dienstId = models[0]!.id;
  const patch = await ctx.patch(`/api/shift-models/${dienstId}`, {
    data: {
      name: "E2E Regeldienst",
      defaultStartTime: "08:00",
      defaultEndTime: "16:00",
      defaultWeekdays: [1, 2, 3, 4, 5, 6, 7],
      imRegelplan: true,
      isActive: true,
    },
  });
  expect(patch.ok(), await patch.text()).toBe(true);

  const person = await ctx.post("/api/users", {
    data: {
      name: "Dora Dienstleister",
      email: `e2e.vertrdl.${Date.now()}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(person.ok(), await person.text()).toBe(true);
  const userId = ((await person.json()) as { id: number }).id;

  const schicht = await ctx.post("/api/shifts", {
    data: {
      userId,
      shiftModelId: dienstId,
      type: "work",
      startTime: `${ZIEL_ISO}T08:00:00`,
      endTime: `${ZIEL_ISO}T16:00:00`,
    },
  });
  expect(schicht.ok(), await schicht.text()).toBe(true);
  schichtId = ((await schicht.json()) as { id: number }).id;
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

test("aus: keine Vertretungszeile", async ({ page }) => {
  test.setTimeout(120_000);
  await setVertretungEnabled(ctx, false);
  await loginUi(page);
  await oeffneRaster(page);
  // Bewusst im Desktop-Raster suchen: Die mobile Fassung haengt gleichzeitig
  // im DOM (nur unsichtbar) und traegt dieselben Kennungen.
  const desktop = page.getByTestId("dienstplan-desktop");
  await expect(desktop.getByTestId(`day-chip-${schichtId}`)).toBeVisible();
  await expect(desktop.getByTestId(`day-standby-${schichtId}`)).toHaveCount(0);
});

test("am Konto eingeschaltet: das Team erbt, die Zeile erscheint", async ({ page }) => {
  test.setTimeout(120_000);
  await setVertretungEnabled(ctx, true);
  // Gegenprobe auf der API-Ebene: Der Dienstplan liest MIT teamId — dort muss
  // der Konto-Wert ankommen, sonst sieht die Oberflaeche ihn nie.
  const imTeam = (await (
    await ctx.get(`/api/allowance-settings?teamId=${teamId}`)
  ).json()) as { vertretungEnabled: boolean };
  expect(imTeam.vertretungEnabled, "Das Team muss den Konto-Wert erben").toBe(true);

  await loginUi(page);
  await oeffneRaster(page);
  const zeile = page.getByTestId("dienstplan-desktop").getByTestId(`day-standby-${schichtId}`);
  await expect(zeile).toBeVisible();
  await expect(zeile).toContainText("Vertretung offen");
});

test("als Team-Regel eingeschaltet: die Zeile erscheint ebenso", async ({ page }) => {
  test.setTimeout(120_000);
  // Konto aus, Team an — der Fall eines Dienstleisters, der ein Team mit und
  // eines ohne Vertretungen fuehrt.
  await setVertretungEnabled(ctx, false);
  await setVertretungEnabled(ctx, true, teamId);

  await loginUi(page);
  await oeffneRaster(page);
  await expect(
    page.getByTestId("dienstplan-desktop").getByTestId(`day-standby-${schichtId}`),
  ).toBeVisible();
});

test("minimierte Ansicht: die Zeile fehlt — das ist die haeufigste Verwechslung", async ({
  page,
}) => {
  test.setTimeout(120_000);
  // Kay suchte die Zeile und fand sie nicht. Sie gehoert zur ZWEIZEILIGEN
  // Pille; der Minimiert-Umschalter in der Kopfzeile klappt sie auf eine Zeile
  // zusammen, und dabei entfaellt die Vertretungszeile (Kay-Entscheidung
  // 17.08.2026, Punkt 1). Hier festgehalten, damit der Zusammenhang nicht
  // wieder als Fehler gesucht wird.
  await setVertretungEnabled(ctx, true);
  await loginUi(page);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/dienstplan");
  await page.evaluate(() => {
    localStorage.setItem("dienstplan.desktopView", "grid");
    localStorage.setItem("dienstplan.pillMinimiert", "1");
  });
  await page.goto(`/dienstplan?date=${ZIEL_ISO}`);
  const desktop = page.getByTestId("dienstplan-desktop");
  await expect(desktop.getByTestId("month-grid")).toBeVisible();
  await expect(desktop.getByTestId(`day-chip-${schichtId}`)).toBeVisible();
  await expect(
    desktop.getByTestId(`day-standby-${schichtId}`),
    "Minimiert zeigt eine Zeile je Dienst — die Vertretungszeile entfaellt",
  ).toHaveCount(0);
});
