import { test, expect } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";
import {
  registerFreeAccount,
  setAccountPlan,
  deleteFreeAccount,
  FREE_ACCOUNT_PASSWORD,
  type FreeAccount,
} from "./helpers/teams";

/**
 * Task #676 — Vormonat in der Stunden-Übersicht anzeigen.
 *
 * Die MeineStundenKarte hat Prev/Next-Pfeile, mit denen Assistenten
 * auch abgeschlossene Vormonate einsehen können.
 *
 *   1. Prev-Pfeil navigiert zum Vormonat (Label ändert sich).
 *   2. Next-Pfeil navigiert wieder zurück zum aktuellen Monat.
 *   3. Next-Pfeil ist im aktuellen Monat deaktiviert (disabled).
 *   4. Monat-Label zeigt Namen und Jahr.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

test.use({ viewport: { width: 1280, height: 800 } });

const NOW = new Date();
const YEAR = NOW.getFullYear();
const MONTH = NOW.getMonth() + 1;
const MM = String(MONTH).padStart(2, "0");
const SHIFT_DAY = `${YEAR}-${MM}-08`;

const MONTHS_DE = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

let acc: FreeAccount;
let assistantEmail: string;
const ASSISTANT_PASSWORD = "assistenz1234";

test.beforeAll(async () => {
  test.setTimeout(90_000);

  acc = await registerFreeAccount("dienstleister", "vormonatstunden");
  await setAccountPlan(acc.email, "premium");

  const unique = Date.now();
  assistantEmail = `e2e.vormonat.asst.${unique}@dienstplan.test`;

  const userRes = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E Assistent Vormonat ${unique}`,
      email: assistantEmail,
      role: "assistant",
    },
  });
  expect(userRes.status(), `Assistent anlegen (${userRes.status()})`).toBe(201);
  const assistantId = ((await userRes.json()) as { id: number }).id;

  // Vertrag ab Jahresbeginn
  const contractRes = await acc.ctx.post("/api/contracts", {
    data: {
      userId: assistantId,
      startDate: `${YEAR}-01-01`,
      weeklyHours: 40,
      vacationDays: 30,
    },
  });
  expect(contractRes.status(), `Vertrag anlegen (${contractRes.status()})`).toBe(201);

  // Schicht im aktuellen Monat damit die Karte nicht null zurückgibt
  const shiftRes = await acc.ctx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "work",
      planningStatus: "FIX",
      startTime: `${SHIFT_DAY}T08:00:00.000Z`,
      endTime: `${SHIFT_DAY}T16:00:00.000Z`,
    },
  });
  expect(shiftRes.status(), `Schicht anlegen (${shiftRes.status()})`).toBe(201);

  // Einladungstoken + Passwort
  const inviteRes = await acc.ctx.post(`/api/users/${assistantId}/invite`);
  expect(inviteRes.status(), `Einladung (${inviteRes.status()})`).toBe(200);
  const { token } = (await inviteRes.json()) as { token: string };
  const pwRes = await acc.ctx.post("/api/auth/set-password", {
    data: { token, password: ASSISTANT_PASSWORD },
  });
  expect(pwRes.status(), `Passwort setzen (${pwRes.status()})`).toBe(200);
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

test("Prev-Pfeil wechselt in den Vormonat (#676)", async ({ page }) => {
  test.setTimeout(45_000);

  await loginViaUi(page, assistantEmail, ASSISTANT_PASSWORD);
  await page.goto("/");

  const karte = page.getByTestId("meine-stunden-karte");
  await expect(karte).toBeVisible({ timeout: 25_000 });

  const labelEl = page.getByTestId("meine-stunden-monat-label");
  const labelBefore = (await labelEl.textContent()) ?? "";
  expect(labelBefore).toContain(String(YEAR));

  // Vormonat
  await page.getByTestId("meine-stunden-prev-month").click();
  const labelAfter = (await labelEl.textContent()) ?? "";
  expect(labelAfter).not.toBe(labelBefore);
  // Monatswechsel: entweder ein anderer Monatsname oder ein anderes Jahr
  const currentMonthDE = MONTHS_DE[NOW.getMonth()]!;
  expect(labelAfter).not.toContain(currentMonthDE);
});

test("Next-Pfeil kehrt zum aktuellen Monat zurück (#676)", async ({ page }) => {
  test.setTimeout(45_000);

  await loginViaUi(page, assistantEmail, ASSISTANT_PASSWORD);
  await page.goto("/");

  const karte = page.getByTestId("meine-stunden-karte");
  await expect(karte).toBeVisible({ timeout: 25_000 });

  const labelEl = page.getByTestId("meine-stunden-monat-label");
  const labelCurrent = (await labelEl.textContent()) ?? "";

  // Einen Monat zurück, dann wieder vor
  await page.getByTestId("meine-stunden-prev-month").click();
  await page.getByTestId("meine-stunden-next-month").click();

  const labelRestored = (await labelEl.textContent()) ?? "";
  expect(labelRestored.trim()).toBe(labelCurrent.trim());
});

test("Next-Pfeil ist im aktuellen Monat deaktiviert (#676)", async ({ page }) => {
  test.setTimeout(45_000);

  await loginViaUi(page, assistantEmail, ASSISTANT_PASSWORD);
  await page.goto("/");

  await expect(page.getByTestId("meine-stunden-karte")).toBeVisible({
    timeout: 25_000,
  });

  const nextBtn = page.getByTestId("meine-stunden-next-month");
  await expect(nextBtn).toBeDisabled();
});

test("Admin sieht weiterhin keine Meine-Stunden-Karte (#676)", async ({ page }) => {
  test.setTimeout(45_000);

  await loginViaUi(page, acc.email, FREE_ACCOUNT_PASSWORD);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId("meine-stunden-karte")).not.toBeVisible();
});
