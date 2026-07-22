import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";
import { loginViaUi } from "./helpers/auth";

/**
 * E2E-Test für den Ansichts-Umschalter (Übersicht/Matrix vs. Karten) auf der
 * Auswertungen-Seite.
 *
 * Deckt ab:
 * - Bei Filter "Alle" + Ansicht "Karten" erscheint JEDE Assistenzkraft mit
 *   Auswertungsdaten als eigene Einzelkarte (mindestens die beiden hier
 *   angelegten); die Matrix ist dabei ausgeblendet.
 * - Umschalten auf "Übersicht" zeigt die Gesamtübersichts-Matrix (Karten weg).
 * - Ansicht (localStorage auswertungen.view) UND Dropdown-Auswahl
 *   (localStorage dienstplan.selectedAssistant) überleben einen Reload.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

// Desktop-Viewport hält den Sticky-Header (Dropdown + Ansichts-Umschalter) stabil.
test.use({ viewport: { width: 1280, height: 800 } });

// Zielmonat = der Vormonat: die Seite startet beim aktuellen Monat, ein Klick
// auf "month-prev" landet garantiert hier — unabhängig vom Testlauf-Datum.
const NOW = new Date();
const TARGET = new Date(NOW.getFullYear(), NOW.getMonth() - 1, 1);
const TARGET_YEAR = TARGET.getFullYear();
const TARGET_MM = String(TARGET.getMonth() + 1).padStart(2, "0");
const SHIFT_DAY = `${TARGET_YEAR}-${TARGET_MM}-15`;

type CreatedUser = { id: number; name: string; email: string };

let adminCtx: APIRequestContext;
// Zwei Assistenten, damit "alle als Einzelkarten" nachweislich MEHRERE Karten
// bedeutet und nicht nur den Ein-Personen-Fall abdeckt.
let assistantA: CreatedUser;
let assistantB: CreatedUser;
const contractIds: number[] = [];
const shiftIds: number[] = [];

test.beforeAll(async () => {
  const unique = Date.now();
  adminCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });

  const loginRes = await adminCtx.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(loginRes.ok(), "Admin-Login für Setup fehlgeschlagen").toBe(true);

  const created: CreatedUser[] = [];
  for (const suffix of ["A", "B"]) {
    const userRes = await adminCtx.post("/api/users", {
      data: {
        name: `E2E Karten ${suffix} ${unique}`,
        email: `e2e.karten.${suffix.toLowerCase()}.${unique}@dienstplan.test`,
        role: "assistant",
      },
    });
    expect(userRes.ok(), `Anlegen des Assistenten fehlgeschlagen (${userRes.status()})`).toBe(
      true
    );
    const user = (await userRes.json()) as CreatedUser;
    created.push(user);

    const contractRes = await adminCtx.post("/api/contracts", {
      data: {
        userId: user.id,
        startDate: `${TARGET_YEAR}-01-01`,
        weeklyHours: 40,
        vacationDays: 30,
      },
    });
    expect(contractRes.ok(), `Anlegen des Vertrags fehlgeschlagen (${contractRes.status()})`).toBe(
      true
    );
    contractIds.push(((await contractRes.json()) as { id: number }).id);

    // Eine FIX-Schicht im Zielmonat, damit die Person Auswertungsdaten hat.
    const shiftRes = await adminCtx.post("/api/shifts", {
      data: {
        userId: user.id,
        startTime: `${SHIFT_DAY}T08:00:00.000Z`,
        endTime: `${SHIFT_DAY}T16:00:00.000Z`,
        type: "active",
      },
    });
    expect(shiftRes.ok(), `Anlegen der Schicht fehlgeschlagen (${shiftRes.status()})`).toBe(true);
    shiftIds.push(((await shiftRes.json()) as { id: number }).id);
  }
  [assistantA, assistantB] = created;
});

test.afterAll(async () => {
  for (const id of shiftIds) await adminCtx.delete(`/api/shifts/${id}`);
  for (const id of contractIds) await adminCtx.delete(`/api/contracts/${id}`);
  for (const user of [assistantA, assistantB]) {
    if (user?.id) await adminCtx.delete(`/api/users/${user.id}`);
  }
  await adminCtx.dispose();
});

test("Kartenansicht zeigt bei Filter Alle jede Assistenzkraft als Karte; Ansicht und Auswahl überleben den Reload", async ({
  page,
}) => {
  await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.goto("/auswertungen");
  await expect(page.getByRole("heading", { name: "Auswertungen", exact: true })).toBeVisible();

  // Filter explizit auf "Alle" stellen (persistente Auswahl aus früheren
  // Läufen könnte auf einer Einzelperson stehen).
  await page.getByTestId("assistant-select").click();
  await page.getByTestId("assistant-option-all").click();

  // In den Zielmonat (Vormonat) navigieren, in dem die Belegdaten liegen.
  await page.getByTestId("month-prev").click();

  // Ansicht "Karten": ALLE Assistenzkräfte mit Daten erscheinen als
  // Einzelkarten — mindestens die beiden hier angelegten; die Matrix ist weg.
  await page.getByTestId("view-toggle-cards").click();
  await expect(page.getByTestId(`balance-card-${assistantA.id}`)).toBeVisible();
  await expect(page.getByTestId(`balance-card-${assistantB.id}`)).toBeVisible();
  await expect(page.getByTestId(`balance-card-${assistantA.id}`)).toContainText(assistantA.name);
  await expect(page.getByTestId(`balance-card-${assistantB.id}`)).toContainText(assistantB.name);
  await expect(page.getByTestId("gesamt-auswertung-matrix")).toHaveCount(0);

  // Kontrolle über dieselbe Datenquelle: jede Zeile aus hours-balance hat
  // ihre eigene Karte (Test-DB kann Assistenten aus Nachbar-Specs enthalten).
  const balanceRes = await adminCtx.get(
    `/api/dashboard/hours-balance?month=${TARGET.getMonth() + 1}&year=${TARGET_YEAR}`
  );
  expect(balanceRes.ok(), `hours-balance-Abfrage fehlgeschlagen (${balanceRes.status()})`).toBe(
    true
  );
  const balances = (await balanceRes.json()) as Array<{ userId: number }>;
  const expectedUserIds = [...new Set(balances.map((b) => b.userId))];
  for (const userId of expectedUserIds) {
    await expect(page.getByTestId(`balance-card-${userId}`)).toBeVisible();
  }

  // Zurück auf "Übersicht": Matrix erscheint, Karten verschwinden.
  await page.getByTestId("view-toggle-matrix").click();
  await expect(page.getByTestId("gesamt-auswertung-matrix")).toBeVisible();
  await expect(page.getByTestId(`matrix-col-${assistantA.id}`)).toBeVisible();
  await expect(page.getByTestId(`balance-card-${assistantA.id}`)).toHaveCount(0);

  // Für den Reload-Check: Kartenansicht + Einzelperson wählen — beides muss
  // aus localStorage (auswertungen.view / dienstplan.selectedAssistant)
  // wiederhergestellt werden.
  await page.getByTestId("view-toggle-cards").click();
  await page.getByTestId("assistant-select").click();
  await page.getByTestId(`assistant-option-${assistantA.id}`).click();
  await expect(page.getByTestId(`balance-card-${assistantA.id}`)).toBeVisible();
  await expect(page.getByTestId(`balance-card-${assistantB.id}`)).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Auswertungen", exact: true })).toBeVisible();

  // Seite startet nach Reload wieder beim aktuellen Monat → zurück in den
  // Zielmonat, dann greifen Ansicht + Auswahl aus dem localStorage.
  await page.getByTestId("month-prev").click();
  await expect(page.getByTestId(`balance-card-${assistantA.id}`)).toBeVisible();
  await expect(page.getByTestId(`balance-card-${assistantB.id}`)).toHaveCount(0);
  await expect(page.getByTestId("gesamt-auswertung-matrix")).toHaveCount(0);
  await expect(page.getByTestId("assistant-select")).toContainText(assistantA.name);
});
