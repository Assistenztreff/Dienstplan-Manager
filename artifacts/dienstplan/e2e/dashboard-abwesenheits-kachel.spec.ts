import { test, expect, type Page } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";
import {
  registerFreeAccount,
  setAccountPlan,
  deleteFreeAccount,
  FREE_ACCOUNT_PASSWORD,
  type FreeAccount,
} from "./helpers/teams";

/**
 * E2E-Test für die Krankmeldungs-Kachel (Dashboard) und die Status-Badges
 * „Variante C" (Arbeitsanweisung 06.08.2026, Punkte 2.1 + 3.1, Task #708).
 *
 * Geprüft:
 * 1. Free-Konto: Die Kachel bleibt trotz laufender Krankmeldung unsichtbar
 *    (Premium-Gate).
 * 2. Premium-Konto (manuelles Upgrade): Die Kachel erscheint mit dem
 *    Warn-Badge (data-status-badge="warning") und navigiert zu /abwesenheiten.
 * 3. Dienstplan-Pillen: Ein bestätigter Dienst trägt data-status-badge
 *    „confirmed" mit aria-label „Bestätigt", ein Entwurf „draft" mit
 *    aria-label „Entwurf".
 *
 * Aufbau: frisch registriertes Free-Konto (garantiert Free-Plan), eine
 * ganztägige Krankmeldung für heute plus zwei Dienste (FIX + VORLAEUFIG)
 * auf feste Monatsmitte-Tage. Cleanup über deleteFreeAccount (SQL).
 */

test.use({ viewport: { width: 1280, height: 800 } });

const now = new Date();
const pad2 = (n: number) => String(n).padStart(2, "0");
const TODAY = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
// Feste Tage in der Monatsmitte: immer im aktuellen Monat, keine Monatsrolle.
const DAY_FIX = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-12`;
const DAY_DRAFT = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-13`;

let acc: FreeAccount;
let assistantId: number;

async function login(page: Page): Promise<void> {
  await loginViaUi(page, acc.email, FREE_ACCOUNT_PASSWORD);
}

test.beforeAll(async () => {
  acc = await registerFreeAccount("privat", "warnkachel");

  // Eigene Assistenzkraft, damit die Pillen im Monatsraster eine Zeile bekommen.
  const user = await acc.ctx.post("/api/users", {
    data: {
      name: "E2E Warnkachel Assistentin",
      email: `e2e.warnkachel.assist.${Date.now()}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(user.status(), `Assistenzkraft anlegen (${user.status()})`).toBe(201);
  assistantId = ((await user.json()) as { id: number }).id;

  // Krankmeldung, die den heutigen Tag einschließt (macht die Kachel sichtbar).
  const sick = await acc.ctx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "sick",
      startTime: `${TODAY}T00:00:00.000Z`,
      endTime: `${TODAY}T23:59:00.000Z`,
      planningStatus: "FIX",
    },
  });
  expect(sick.status(), `Krankmeldung anlegen (${sick.status()})`).toBe(201);

  // Zwei Dienste für die Pillen-Badges: bestätigt + Entwurf.
  for (const [date, planningStatus] of [
    [DAY_FIX, "FIX"],
    [DAY_DRAFT, "VORLAEUFIG"],
  ] as const) {
    const res = await acc.ctx.post("/api/shifts", {
      data: {
        userId: assistantId,
        type: "active",
        startTime: `${date}T08:00:00.000Z`,
        endTime: `${date}T16:00:00.000Z`,
        planningStatus,
      },
    });
    expect(res.status(), `Dienst ${date} anlegen (${res.status()})`).toBe(201);
  }
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

test("Free: Krankmeldungs-Kachel bleibt trotz laufender Abwesenheit unsichtbar", async ({
  page,
}) => {
  await login(page);
  await page.goto("./");
  await expect(
    page.getByTestId("absence-reminder"),
    "Free-Konto darf die Premium-Kachel nicht sehen",
  ).toHaveCount(0);
});

test("Premium: Kachel erscheint mit Warn-Badge und navigiert zum Abwesenheitskalender", async ({
  page,
}) => {
  await setAccountPlan(acc.email, "premium");
  await login(page);
  await page.goto("./");

  const kachel = page.getByTestId("absence-reminder");
  await expect(kachel).toBeVisible();
  await expect(
    kachel.locator('[data-status-badge="warning"]'),
    "Die Kachel zeigt das Warn-Badge (Variante C)",
  ).toBeVisible();
  await expect(kachel).toContainText("laufende Abwesenheit");

  await kachel.click();
  await expect(page).toHaveURL(/\/abwesenheiten/);
});

test("Pillen: Status-Badges Variante C mit unveränderten aria-labels", async ({
  page,
}) => {
  await setAccountPlan(acc.email, "premium");
  await login(page);
  await page.goto("./dienstplan");

  // Desktop startet je nach Kontostand in der Tabellenansicht — erst auf das
  // Monatsraster umschalten, dort leben die Pillen.
  await page
    .getByTestId("view-toggles-desktop")
    .getByRole("button", { name: "Monat" })
    .click();

  await expect(
    page.locator('[data-status-badge="confirmed"][aria-label="Bestätigt"]:visible').first(),
    "FIX-Dienst trägt das Bestätigt-Badge",
  ).toBeVisible();
  await expect(
    page.locator('[data-status-badge="draft"][aria-label="Entwurf"]:visible').first(),
    "VORLAEUFIG-Dienst trägt das Entwurf-Badge",
  ).toBeVisible();
  await expect(
    page.locator('[data-status-badge="clock"]:visible').first(),
    "Jede Pille trägt das Uhr-Badge in der Zeitzeile",
  ).toBeVisible();
});
