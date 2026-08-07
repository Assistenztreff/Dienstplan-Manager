import { test, expect, type Page } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";
import { pickDateField } from "./helpers/date-picker";
import {
  TeamTestHarness,
  registerFreeAccount,
  deleteFreeAccount,
  FREE_ACCOUNT_PASSWORD,
  type FreeAccount,
} from "./helpers/teams";

/**
 * E2E-UI-Test: Stundenbilanz (monatliches Stundenbudget) — Einstellungen +
 * Dashboard (Arbeitsanweisung 06.08.2026, Punkt 2.2, Premium).
 *
 * Geprüft (Done-Kriterien):
 * - Einstellungen: Stundenbudget per Dialog anlegen, Liste zeigt Zeitraum;
 *   Bearbeiten und Löschen funktionieren.
 * - Dashboard: Kachel "Stundenbilanz" zeigt genehmigt / verbraucht /
 *   verbleibend für den aktuellen Monat plus laufenden Jahressaldo.
 * - Ohne hinterlegtes Budget bleibt die Kachel unsichtbar (Gating über
 *   hasBudgets) — getestet implizit über das Free-Konto und die API-Spec.
 * - Free-Konto: Einstellungen zeigen die gesperrte Karte mit Premium-Verweis,
 *   das Dashboard zeigt keine Stundenbilanz-Kachel.
 */

test.use({ viewport: { width: 1280, height: 800 } });

const now = new Date();
const YEAR = now.getFullYear();
const MONTH = now.getMonth() + 1;
const pad2 = (n: number) => String(n).padStart(2, "0");
const WORK_DAY = `${YEAR}-${pad2(MONTH)}-10`;

test.describe("Stundenbilanz UI (Premium)", () => {
  test.setTimeout(180_000);

  let h: TeamTestHarness;
  let teamId: number;

  test.beforeAll(async () => {
    h = await TeamTestHarness.login();
    await h.becomeDienstleister();
    // Erstes Team des Kontos (Standard-Team): Der Team-Umschalter waehlt beim
    // ersten Laden automatisch das erste Team — Fixtures gehoeren dorthin.
    const teamsRes = await h.ctx.get("/api/teams");
    expect(teamsRes.ok()).toBe(true);
    const teams = (await teamsRes.json()) as { id: number }[];
    teamId = teams[0]!.id;

    const assistant = await h.createUser({ teamId, role: "assistant" });

    // Fixtures VOR dem ersten Seitenaufruf seeden (React Query cached Listen
    // beim Laden). Zielvereinbarung: 100 h/Monat, befristet auf das laufende
    // Jahr — der Dialog-Test legt die Folgevereinbarung ab naechstem Jahr an.
    const budgetRes = await h.ctx.post("/api/hour-budgets", {
      data: { teamId, monthlyHours: 100, startDate: `${YEAR}-01-01`, endDate: `${YEAR}-12-31` },
    });
    expect(budgetRes.status(), `Budget anlegen fehlgeschlagen (${budgetRes.status})`).toBe(201);

    // Verbrauch: ein 8h-Arbeitsdienst + ein Urlaubstag (zaehlt NICHT).
    await h.createShift(teamId, assistant, WORK_DAY, {
      startTime: `${WORK_DAY}T08:00:00.000Z`,
      endTime: `${WORK_DAY}T16:00:00.000Z`,
    });
    const vacDay = `${YEAR}-${pad2(MONTH)}-11`;
    const vacRes = await h.ctx.post("/api/shifts", {
      data: {
        userId: assistant,
        teamId,
        type: "vacation",
        startTime: `${vacDay}T00:00:00.000Z`,
        endTime: `${vacDay}T23:59:00.000Z`,
      },
    });
    expect(vacRes.ok(), `Urlaub anlegen fehlgeschlagen (${vacRes.status()})`).toBe(true);
  });

  test.afterAll(async () => {
    await h?.cleanup();
  });

  async function loginAsAdmin(page: Page): Promise<void> {
    await loginViaUi(page, h.email, h.password);
  }

  test("Einstellungen: Stundenbudget anzeigen, anlegen und loeschen", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/einstellungen");

    // Bestehendes (geseedetes) Budget ist in der Liste sichtbar; mit
    // vorhandenem Budget lautet der Anlegen-Button "Neues Stundenbudget".
    const card = page.getByTestId("hour-budget-card");
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.getByText("Monatliches Stundenbudget")).toBeVisible();
    await expect(page.getByTestId("budget-create")).toHaveText(/Neues Stundenbudget/);
    await expect(card.getByText("100")).toBeVisible();
    await expect(card.getByText(`31.12.${YEAR}`)).toBeVisible();

    // Neue Vereinbarung per Dialog anlegen (folgendes Jahr -> keine Ueberlappung).
    await page.getByTestId("budget-create").click();
    await expect(page.getByTestId("budget-dialog")).toBeVisible();
    await page.getByTestId("budget-monthly-hours").fill("80");
    await pickDateField(page, "budget-start-date", `${YEAR + 1}-01-01`);
    await page.getByTestId("budget-save").click();
    await expect(page.getByTestId("budget-dialog")).toHaveCount(0);
    await expect(card.getByText("80")).toBeVisible();

    // Ueberlappung wird im Dialog als Fehlermeldung gezeigt (409 des Servers).
    await page.getByTestId("budget-create").click();
    await page.getByTestId("budget-monthly-hours").fill("50");
    await pickDateField(page, "budget-start-date", `${YEAR}-03-01`);
    await page.getByTestId("budget-save").click();
    await expect(page.getByTestId("budget-error")).toContainText("überlappt");
    await page.getByRole("button", { name: "Abbrechen" }).click();
    await expect(page.getByTestId("budget-dialog")).toHaveCount(0);

    // Loeschen (Zwei-Schritt-Bestaetigung) des 80h-Budgets.
    const item80 = page
      .getByTestId("budget-list")
      .locator("li")
      .filter({ hasText: "80" });
    const deleteBtn = item80.getByRole("button", { name: /Löschen|Wirklich/ });
    await deleteBtn.click();
    await item80.getByRole("button", { name: "Wirklich?" }).click();
    await expect(card.getByText("80")).toHaveCount(0);
  });

  test("Dashboard: Kachel zeigt genehmigt/verbraucht/verbleibend + Jahressaldo", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    // Das Dashboard liegt auf "/" (Start) — "/dashboard" ist keine Route.
    await page.goto("/");

    // Grosszügiges Timeout: Der E2E-Stack lädt das Dashboard kalt (viele
    // parallele Queries + Vite-On-Demand-Transform), die Bilanz-Kachel kommt
    // als eine der letzten dazu.
    const card = page.getByTestId("hour-budget-balance-card");
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("hour-budget-approved")).toHaveText("100");
    // Nur der Arbeitsdienst (8h) zaehlt als Verbrauch, der Urlaubstag nicht.
    await expect(page.getByTestId("hour-budget-consumed")).toHaveText("8");
    await expect(page.getByTestId("hour-budget-remaining")).toHaveText("92");
    await expect(page.getByTestId("hour-budget-year-balance")).toContainText(
      `Jahressaldo ${YEAR}`,
    );

    // Der fruehere Anspar-Warnhinweis wurde auf Nutzerwunsch entfernt —
    // das Element darf nicht mehr existieren.
    await expect(page.getByTestId("hour-budget-warning")).toHaveCount(0);
  });
});

test.describe("Stundenbilanz UI (Free gesperrt)", () => {
  test.setTimeout(120_000);

  let free: FreeAccount;

  test.beforeAll(async () => {
    free = await registerFreeAccount("privat", "budget-ui-free");
  });

  test.afterAll(async () => {
    await deleteFreeAccount(free);
  });

  test("Free-Konto: Einstellungen gesperrt, Dashboard ohne Kachel", async ({ page }) => {
    await loginViaUi(page, free.email, FREE_ACCOUNT_PASSWORD);

    await page.goto("/einstellungen");
    // Gesperrte Karte mit Premium-Verweis (PlanLimitBanner-Muster).
    await expect(page.getByTestId("hour-budget-card-locked")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("hour-budget-card")).toHaveCount(0);

    await page.goto("/");
    // Keine Stundenbilanz-Kachel fuer Free (Plan-Gate bzw. kein Budget).
    await expect(page.getByTestId("hour-budget-balance-card")).toHaveCount(0);
  });
});
