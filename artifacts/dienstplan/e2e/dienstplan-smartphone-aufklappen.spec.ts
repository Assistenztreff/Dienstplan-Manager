import { test, expect, type Page } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";
import {
  registerFreeAccount,
  deleteFreeAccount,
  FREE_ACCOUNT_PASSWORD,
  type FreeAccount,
} from "./helpers/teams";

/**
 * E2E-Test für das Smartphone-Monatsraster (Arbeitsanweisung 06.08.2026,
 * Punkte 3.2–3.4, Task #709).
 *
 * Geprüft (mobil 400px):
 * 1. Eingeklappt (Standard): Mini-Balken je Dienst, Abwesenheitsstreifen und
 *    Zähler („2 Dienste" / „1 Abw."), keine Pillen. Tap auf einen Tag wählt
 *    ihn aus und zeigt die Tagesleiste (Scroll) — KEIN Dialog.
 * 2. Aufklappen über den Button oben rechts: kompakte Pillen mit INITIALEN
 *    und kompakten Variante-C-Badges; Klick auf eine Pille öffnet den
 *    Schichtdialog dieser Assistenzkraft. Zuklappen stellt den Farbcode wieder her.
 * 3. Zellen-Kopfzeile (3.4): Datum links, Plus rechts; der Zellenklick wählt
 *    nur, nur das Plus öffnet den Anlege-Dialog.
 *
 * Aufbau: frisches Free-Konto mit einer Assistenzkraft, zwei Diensten an Tag A
 * (FIX + VORLAEUFIG) und einem Urlaub an Tag B (feste Monatsmitte-Tage).
 * Cleanup über deleteFreeAccount (SQL).
 */

test.use({ viewport: { width: 400, height: 700 } });

const now = new Date();
const pad2 = (n: number) => String(n).padStart(2, "0");
// Feste Tage in der Monatsmitte: immer im aktuellen Monat, keine Monatsrolle.
const DAY_A = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-12`;
const DAY_B = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-13`;
// Tag C (Task #726): Dienst + Krank-Abwesenheit derselben Assistenzkraft am
// selben Tag → die Dienst-Pille muss das rote Ausfall-Warn-Icon zeigen.
const DAY_C = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-14`;

let acc: FreeAccount;
let shiftIdFix: number;
let shiftIdDraft: number;
let shiftIdAusfall: number;

async function login(page: Page): Promise<void> {
  await loginViaUi(page, acc.email, FREE_ACCOUNT_PASSWORD);
}

test.beforeAll(async () => {
  acc = await registerFreeAccount("privat", "aufklappen");

  const user = await acc.ctx.post("/api/users", {
    data: {
      name: "E2E Aufklapp Assistentin",
      email: `e2e.aufklappen.assist.${Date.now()}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(user.status(), `Assistenzkraft anlegen (${user.status()})`).toBe(201);
  const assistantId = ((await user.json()) as { id: number }).id;

  // Drei Dienste an Tag A: bestätigt + Entwurf (zugleich Vertretung — der
  // Kombinationsfall muss BEIDE Icons zeigen) + bestätigt. Die Smartphone-
  // Ansicht darf nur zwei Pillen und anschließend „+1 weitere“ zeigen.
  for (const [start, end, planningStatus] of [
    ["06:00", "12:00", "FIX"],
    ["13:00", "18:00", "VORLAEUFIG"],
    ["19:00", "23:00", "FIX"],
  ] as const) {
    const res = await acc.ctx.post("/api/shifts", {
      data: {
        userId: assistantId,
        type: "active",
        startTime: `${DAY_A}T${start}:00.000Z`,
        endTime: `${DAY_A}T${end}:00.000Z`,
        planningStatus,
        isVertretung: planningStatus === "VORLAEUFIG",
      },
    });
    expect(res.status(), `Dienst ${start} anlegen (${res.status()})`).toBe(201);
    if (planningStatus === "FIX") {
      // Nur die ERSTE FIX-Schicht merken: die dritte (19–23 Uhr) fällt durch
      // das Zwei-Pillen-Limit aus der Smartphone-Zelle heraus.
      shiftIdFix ||= ((await res.json()) as { id: number }).id;
    } else {
      shiftIdDraft = ((await res.json()) as { id: number }).id;
    }
  }

  // Urlaub an Tag B (Kategorie geplant → gelber Streifen).
  const vac = await acc.ctx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "vacation",
      startTime: `${DAY_B}T00:00:00.000Z`,
      endTime: `${DAY_B}T23:59:00.000Z`,
      planningStatus: "FIX",
    },
  });
  expect(vac.status(), `Urlaub anlegen (${vac.status()})`).toBe(201);

  // Tag C (Task #726): Krank-Abwesenheit ZUERST, danach wird ein Dienst auf
  // denselben Tag geplant. (Umgekehrt ginge es nicht: Eine neue Abwesenheit
  // "überschreibt" serverseitig alle an dem Tag bereits geplanten Dienste —
  // Primary-Lookup-Ersetzung in POST /shifts. Der Warnfall entsteht also genau
  // dann, wenn ein Dienst auf einen Tag mit bestehender Krankmeldung fällt.)
  const sick = await acc.ctx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "sick",
      startTime: `${DAY_C}T00:00:00.000Z`,
      endTime: `${DAY_C}T23:59:00.000Z`,
      planningStatus: "FIX",
    },
  });
  expect(sick.status(), `Krank-Abwesenheit an Tag C anlegen (${sick.status()})`).toBe(201);
  const ausfallShift = await acc.ctx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "active",
      startTime: `${DAY_C}T08:00:00.000Z`,
      endTime: `${DAY_C}T14:00:00.000Z`,
      planningStatus: "FIX",
    },
  });
  expect(ausfallShift.status(), `Dienst an Tag C anlegen (${ausfallShift.status()})`).toBe(201);
  shiftIdAusfall = ((await ausfallShift.json()) as { id: number }).id;
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

test("Eingeklappt: Mini-Balken + Zähler statt Pillen, Tap wählt nur und zeigt die Tagesleiste", async ({
  page,
}) => {
  await login(page);
  await page.goto("./dienstplan");
  const mobile = page.getByTestId("dienstplan-mobile");

  // Farbcode-Darstellung: zwei Mini-Balken + Zähler an Tag A, Abw.-Zähler an Tag B.
  await expect(mobile.getByTestId(`day-bars-${DAY_A}`)).toBeVisible();
  await expect(
    mobile.getByTestId(`day-bars-${DAY_A}`).locator("> span"),
    "Drei Dienste = drei Mini-Balken",
  ).toHaveCount(3);
  await expect(mobile.getByTestId(`day-count-${DAY_A}`)).toHaveText("3 Dienste");
  await expect(mobile.getByTestId(`day-count-${DAY_B}`)).toHaveText("1 Abw.");

  // Abwesenheitsstreifen (3.3): Urlaub = Kategorie „geplant" (gelb #e5b73b).
  const strip = mobile.getByTestId(`day-strip-${DAY_B}`);
  await expect(strip, "Ein Urlaub = ein Abwesenheitsstreifen").toHaveCount(1);
  await expect(strip, "Urlaub-Streifen muss geplant-gelb (#e5b73b) sein").toHaveCSS(
    "background-color",
    "rgb(229, 183, 59)",
  );
  await expect(
    mobile.locator('[data-testid^="day-chip-"]'),
    "Eingeklappt gibt es keine Pillen im Monatsraster",
  ).toHaveCount(0);

  // 3.4: Kopfzeile hat Datum links und Plus rechts; Zellenklick wählt nur.
  const cellA = mobile.getByTestId(`day-cell-${DAY_A}`);
  await expect(mobile.getByTestId(`day-add-${DAY_A}`)).toBeVisible();
  // Klickpunkt oben links: die Zelle ist seit Arbeitspaket 07.08.2026 (Punkt 4)
  // quadratisch (bei 400 px Viewport ~56 px hoch) — y=60 läge in der Zeile darunter.
  await cellA.click({ position: { x: 20, y: 20 } });
  await expect(cellA).toHaveAttribute("data-selected", "true");
  await expect(mobile.getByTestId("day-detail-header")).toContainText("12.");
  await expect(
    mobile.getByTestId("day-detail-panel"),
    "Der Tap auf eine eingeklappte Zelle muss zur Tagesleiste scrollen (3.3)",
  ).toBeInViewport();
  await expect(
    page.getByTestId("shift-dialog"),
    "Der Zellenklick darf keinen Dialog öffnen (3.4)",
  ).toHaveCount(0);

  // Nur das Plus öffnet den Anlege-Dialog.
  await mobile.getByTestId(`day-add-${DAY_A}`).click();
  await expect(page.getByTestId("shift-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("shift-dialog")).toHaveCount(0);
});

test("Aufklappen: einzeilige Kurz-Pillen mit Abweichungs-Icons, Pille öffnet den Schichtdialog", async ({
  page,
}) => {
  await login(page);
  await page.goto("./dienstplan");
  const mobile = page.getByTestId("dienstplan-mobile");

  // Standard ist eingeklappt — Button oben rechts (im Sticky-Header) klappt auf.
  const toggle = page.getByTestId("toggle-mobile-expand");
  await expect(toggle).toHaveAttribute("aria-label", "Monatsraster aufklappen");
  await toggle.click();

  // Kompakte Pillen mit Initialen statt vollem Nachnamen. Uhrzeit und
  // Bestätigt-Icon entfallen; Entwurf bleibt als 12-px-Abweichungs-Icon sichtbar.
  const pill = mobile.getByTestId(`day-chip-${shiftIdFix}`);
  await expect(pill).toBeVisible();
  await expect(pill, "Aufgeklappt zeigt die Pille die Initialen der Assistenzkraft").toContainText(
    "EA",
  );
  await expect(
    pill.locator('[data-status-badge="confirmed"]'),
    "Bestätigte Dienste erhalten in der Smartphone-Zelle kein Status-Icon",
  ).toHaveCount(0);
  await expect(
    pill.locator('[data-status-badge="clock"]'),
    "Die Uhrzeitzeile entfällt in der Smartphone-Zelle",
  ).toHaveCount(0);
  await expect(mobile.getByTestId(`day-chip-label-${shiftIdFix}`)).toHaveCSS("font-size", "11px");
  const draftPill = mobile.getByTestId(`day-chip-${shiftIdDraft}`);
  const draftBadge = draftPill.locator('[data-status-badge="draft"][aria-label="Entwurf"]');
  await expect(draftBadge, "Entwurf bleibt als Abweichung in der Smartphone-Zelle markiert").toBeVisible();
  await expect(draftBadge).toHaveCSS("width", "12px");
  await expect(draftBadge).toHaveCSS("height", "12px");
  await expect(
    draftPill.locator('[data-status-badge="vertretung"]'),
    "Vertretung + Entwurf zeigen BEIDE Icons in der Kompakt-Pille",
  ).toBeVisible();

  // Task #726: Dienst an Tag C, dessen Assistenzkraft am selben Tag krank ist,
  // zeigt das rote Ausfall-Warn-Icon; Dienste ohne Ausfall (Tag A) nicht.
  const ausfallPill = mobile.getByTestId(`day-chip-${shiftIdAusfall}`);
  const warnBadge = ausfallPill.locator(
    '[data-status-badge="warning"][aria-label="Ausfall: Assistenzkraft abwesend"]',
  );
  await expect(
    warnBadge,
    "Krank am Diensttag → Ausfall-Warn-Icon an der Dienst-Pille",
  ).toBeVisible();
  await expect(warnBadge).toHaveCSS("width", "12px");
  await expect(warnBadge).toHaveCSS("height", "12px");
  await expect(
    pill.locator('[data-status-badge="warning"]'),
    "Ohne Abwesenheit der eingeplanten Assistenzkraft gibt es kein Ausfall-Icon",
  ).toHaveCount(0);
  // Geometrieprüfung: Auch im Kombinationsfall (zwei Icons) darf das Kürzel
  // nicht abgeschnitten sein — DOM-Text allein würde eine Ellipse verdecken.
  for (const id of [shiftIdFix, shiftIdDraft]) {
    const label = mobile.getByTestId(`day-chip-label-${id}`);
    const geo = await label.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(
      geo.scrollWidth,
      `Kürzel der Pille ${id} muss vollständig sichtbar sein (kein truncate)`,
    ).toBeLessThanOrEqual(geo.clientWidth);
  }
  await expect(
    mobile
      .getByTestId(`day-cell-${DAY_A}`)
      .locator('[data-testid^="day-chip-"]:not([data-testid^="day-chip-label-"])'),
    "Aufgeklappt sind höchstens zwei Pillen sichtbar",
  ).toHaveCount(2);
  await expect(mobile.getByTestId(`day-more-${DAY_A}`)).toHaveText("+1");
  await expect(
    mobile.getByTestId(`day-bars-${DAY_A}`),
    "Aufgeklappt gibt es keine Mini-Balken mehr",
  ).toHaveCount(0);

  // Klick auf die Pille öffnet den Schichtdialog genau dieser Assistenzkraft
  // (Edit-Modus: das Nutzerfeld ist ein deaktiviertes Input mit dem Namen).
  await pill.click();
  const dialog = page.getByTestId("shift-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Schicht bearbeiten" })).toBeVisible();
  await expect(dialog.locator('[data-testid="shift-dialog-user"]')).toHaveValue(
    "E2E Aufklapp Assistentin",
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // Zuklappen stellt die Farbcode-Anzeige wieder her.
  await page.getByTestId("toggle-mobile-expand").click();
  await expect(mobile.getByTestId(`day-bars-${DAY_A}`)).toBeVisible();
  await expect(mobile.getByTestId(`day-count-${DAY_A}`)).toHaveText("3 Dienste");
});
