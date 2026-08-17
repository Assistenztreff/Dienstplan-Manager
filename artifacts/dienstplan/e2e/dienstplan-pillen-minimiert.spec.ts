import { test, expect, type Page } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";
import {
  registerFreeAccount,
  deleteFreeAccount,
  FREE_ACCOUNT_PASSWORD,
  type FreeAccount,
} from "./helpers/teams";

/**
 * E2E-Test für den globalen Minimiert-Umschalter der Monatsraster-Pillen
 * (Arbeitsanweisung 17.08.2026 Punkt 1, Task #836).
 *
 * Desktop/Tablet (1280 px), nur Monatsansicht:
 * - Der Umschalter (testid `toggle-pill-minimiert`) existiert NUR im
 *   Monatsraster, nicht in der Tabellenansicht.
 * - Minimiert reduziert jede Pille auf eine Zeile: die Uhrzeitzeile (Uhr-Icon)
 *   entfällt, die Zeit wandert als „von–bis" in Zeile 1, das Status-Icon
 *   bleibt sichtbar.
 * - Zurückschalten stellt die zweizeilige Darstellung wieder her.
 *
 * Die Smartphone-Dauerzustand-Prüfungen liegen in
 * dienstplan-smartphone-aufklappen.spec.ts.
 *
 * Aufbau: frisches Free-Konto mit einer Assistenzkraft und einem bestätigten
 * Dienst in der Monatsmitte. Cleanup über deleteFreeAccount (SQL).
 */

test.use({ viewport: { width: 1280, height: 800 } });

const now = new Date();
const pad2 = (n: number) => String(n).padStart(2, "0");
// Fester Tag in der Monatsmitte: immer im aktuellen Monat, keine Monatsrolle.
const DAY_A = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-12`;

let acc: FreeAccount;
let shiftIdFix: number;

async function login(page: Page): Promise<void> {
  await loginViaUi(page, acc.email, FREE_ACCOUNT_PASSWORD);
}

test.beforeAll(async () => {
  acc = await registerFreeAccount("privat", "pillenmin");

  const user = await acc.ctx.post("/api/users", {
    data: {
      name: "E2E Minimiert Assistentin",
      email: `e2e.pillenmin.assist.${Date.now()}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(user.status(), `Assistenzkraft anlegen (${user.status()})`).toBe(201);
  const assistantId = ((await user.json()) as { id: number }).id;

  const res = await acc.ctx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "active",
      startTime: `${DAY_A}T06:00:00.000Z`,
      endTime: `${DAY_A}T12:00:00.000Z`,
      planningStatus: "FIX",
    },
  });
  expect(res.status(), `Dienst anlegen (${res.status()})`).toBe(201);
  shiftIdFix = ((await res.json()) as { id: number }).id;
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

test("Minimiert-Umschalter reduziert jede Pille auf eine Zeile und zurück", async ({
  page,
}) => {
  await login(page);
  await page.goto("./dienstplan");
  const desktop = page.getByTestId("dienstplan-desktop");

  // In der Tabellenansicht (Standard) gibt es den Umschalter nicht — er
  // gehört nur zum Monatsraster.
  await expect(page.getByTestId("toggle-pill-minimiert")).toHaveCount(0);
  await page.getByTestId("view-toggles-desktop").getByTestId("view-toggle-grid").click();

  // Standard: zweizeilige Pille mit Uhr-Icon in Zeile 2.
  const pill = desktop.getByTestId(`day-chip-${shiftIdFix}`);
  await expect(pill).toBeVisible({ timeout: 15_000 });
  await expect(pill.locator('[data-status-badge="clock"]')).toBeVisible();

  const toggle = page.getByTestId("toggle-pill-minimiert");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  // Minimiert: Zeile 2 (Uhr-Icon) verschwindet, die Uhrzeit wandert in die
  // eine verbliebene Zeile („von–bis", solange beide Zeiten passen — bei
  // Desktop-Spaltenbreite sicher der Fall). Kein exakter Zeit-String, damit
  // der Test unabhängig von Zeitzone und Kurz-/Vollformat bleibt.
  await expect(
    pill.locator('[data-status-badge="clock"]'),
    "Minimiert gibt es keine Uhrzeitzeile mehr",
  ).toHaveCount(0);
  await expect(pill, "Minimiert zeigt die Pille von-bis in Zeile 1").toContainText(
    /\d{1,2}(:\d{2})?–\d{1,2}(:\d{2})?/,
  );
  await expect(
    pill.locator('[data-status-badge="confirmed"]'),
    "Das Status-Icon bleibt in der minimierten Pille sichtbar",
  ).toBeVisible();

  // Zurückschalten stellt die zweizeilige Darstellung wieder her.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(pill.locator('[data-status-badge="clock"]')).toBeVisible();
});
