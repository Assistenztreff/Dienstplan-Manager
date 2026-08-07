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

let acc: FreeAccount;
let shiftIdFix: number;

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

  // Zwei Dienste an Tag A: bestätigt + Entwurf (überlappungsfrei).
  for (const [start, end, planningStatus] of [
    ["06:00", "12:00", "FIX"],
    ["13:00", "18:00", "VORLAEUFIG"],
  ] as const) {
    const res = await acc.ctx.post("/api/shifts", {
      data: {
        userId: assistantId,
        type: "active",
        startTime: `${DAY_A}T${start}:00.000Z`,
        endTime: `${DAY_A}T${end}:00.000Z`,
        planningStatus,
      },
    });
    expect(res.status(), `Dienst ${start} anlegen (${res.status()})`).toBe(201);
    if (planningStatus === "FIX") {
      shiftIdFix = ((await res.json()) as { id: number }).id;
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
    "Zwei Dienste = zwei Mini-Balken",
  ).toHaveCount(2);
  await expect(mobile.getByTestId(`day-count-${DAY_A}`)).toHaveText("2 Dienste");
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
  await cellA.click({ position: { x: 20, y: 60 } });
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

test("Aufklappen: kompakte Pillen mit Initialen, Pille öffnet den Schichtdialog", async ({
  page,
}) => {
  await login(page);
  await page.goto("./dienstplan");
  const mobile = page.getByTestId("dienstplan-mobile");

  // Standard ist eingeklappt — Button oben rechts (im Sticky-Header) klappt auf.
  const toggle = page.getByTestId("toggle-mobile-expand");
  await expect(toggle).toHaveAttribute("aria-label", "Monatsraster aufklappen");
  await toggle.click();

  // Kompakte Pillen mit Initialen statt vollem Nachnamen.
  const pill = mobile.getByTestId(`day-chip-${shiftIdFix}`);
  await expect(pill).toBeVisible();
  await expect(pill, "Aufgeklappt zeigt die Pille die Initialen der Assistenzkraft").toContainText(
    "EA",
  );
  await expect(
    pill.locator('[data-status-badge="confirmed"][aria-label="Bestätigt"]'),
    "Kompaktes Bestätigt-Badge (Variante C) in der Pille",
  ).toBeVisible();
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
  await expect(mobile.getByTestId(`day-count-${DAY_A}`)).toHaveText("2 Dienste");
});
