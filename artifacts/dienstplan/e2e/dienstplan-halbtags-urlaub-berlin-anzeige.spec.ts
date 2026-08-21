import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";
import { clearUserShiftsAroundDay, selectDayCell } from "./helpers/shifts";

/**
 * UI-Gegenprobe zu Task #862 (halbtägiger Urlaub) im Code-Review-Kontext
 * "Zeitzone der Anzeige": das Speichern läuft immer über Browser-Lokalzeit
 * (buildIso() in shift-dialog.tsx, identisch zu normalen Dienstzeiten), aber
 * formatAbsenceTimeSpan() las die Uhrzeit früher mit getUTCHours() zurück.
 * In Europe/Berlin (UTC+1/+2) hätte das die angezeigte Uhrzeit verschoben
 * (13:00–17:00 wäre im Winter als 12:00–16:00 erschienen). Diese Spec erzwingt
 * einen Europe/Berlin-Browserkontext (die API-Spec-Suite läuft in UTC und kann
 * das nicht abdecken) und prüft:
 *
 *  1. Ein mit 13:00–17:00 angelegter halbtägiger Urlaub erscheint in der
 *     Team-Abwesenheiten-Übersicht exakt als "13:00–17:00 Uhr" (Lokalzeit).
 *  2. Eine sehr frühe Startzeit, die nach der Lokal→UTC-Umrechnung auf den
 *     Vortag fallen würde (00:30 Uhr), wird client-seitig mit einer
 *     Validierungsmeldung abgelehnt statt den Eintrag auf den falschen
 *     Kalendertag zu buchen.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

const MONTHS_DE = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

function parseMonthLabel(text: string): { year: number; month: number } {
  const parts = text.trim().split(/\s+/);
  const monthIndex = MONTHS_DE.indexOf(parts[0]);
  const year = Number(parts[1]);
  expect(monthIndex, `Unbekannter Monatsname in "${text}"`).toBeGreaterThanOrEqual(0);
  expect(Number.isFinite(year), `Ungültiges Jahr in "${text}"`).toBe(true);
  return { year, month: monthIndex + 1 };
}

function dayCellId(year: number, month: number, dayOfMonth: number): string {
  const mm = String(month).padStart(2, "0");
  const dd = String(dayOfMonth).padStart(2, "0");
  return `day-cell-${year}-${mm}-${dd}`;
}

type CreatedUser = { id: number; name: string };
type Contract = { id: number; userId: number };

let adminCtx: APIRequestContext;
let assistant: CreatedUser;
let contractId: number;

test.beforeAll(async () => {
  const unique = Date.now();
  adminCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const loginRes = await adminCtx.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(loginRes.ok(), "Admin-Login für Setup fehlgeschlagen").toBe(true);

  const createRes = await adminCtx.post("/api/users", {
    data: {
      name: `E2E HalbtagBerlin ${unique}`,
      email: `e2e.halbtagberlin.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(createRes.ok(), "Anlegen des Test-Assistenten fehlgeschlagen").toBe(true);
  assistant = (await createRes.json()) as CreatedUser;

  const year = new Date().getFullYear();
  const contractRes = await adminCtx.post("/api/contracts", {
    data: { userId: assistant.id, startDate: `${year}-01-01`, weeklyHours: 40, vacationDays: 30 },
  });
  expect(contractRes.ok(), "Anlegen des Vertrags fehlgeschlagen").toBe(true);
  const contract = (await contractRes.json()) as Contract;
  contractId = contract.id;
});

test.afterAll(async () => {
  for (const type of ["vacation"]) {
    const shiftRes = await adminCtx.get(`/api/shifts?type=${type}&userId=${assistant.id}`);
    if (shiftRes.ok()) {
      const shifts = (await shiftRes.json()) as { id: number; userId: number }[];
      for (const s of shifts.filter((s) => s.userId === assistant.id)) {
        await adminCtx.delete(`/api/shifts/${s.id}`);
      }
    }
  }
  if (contractId) await adminCtx.delete(`/api/contracts/${contractId}`);
  if (assistant?.id) await adminCtx.delete(`/api/users/${assistant.id}`);
  await adminCtx.dispose();
});

test("Halbtägiger Urlaub in Europe/Berlin: Anzeige bleibt in Lokalzeit, sehr frühe Startzeit wird abgelehnt", async ({
  browser,
}) => {
  const context = await browser.newContext({ baseURL: BASE_URL, timezoneId: "Europe/Berlin" });
  try {
    const page = await context.newPage();
    await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto("/dienstplan");
    await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();
    const mobile = page.getByTestId("dienstplan-mobile");
    await expect(mobile).toBeVisible();

    // Weit in der Zukunft, um Kollisionen mit Bestandsdaten zu vermeiden.
    for (let i = 0; i < 9; i++) {
      await page.getByTestId("next-month").click();
    }
    const { year, month } = parseMonthLabel(await page.getByTestId("month-label").innerText());
    await clearUserShiftsAroundDay(page, year, month, 12, assistant.id);

    const day = 12;
    const cell = mobile.getByTestId(dayCellId(year, month, day));
    await selectDayCell(page, cell);

    // --- 1) Halbtägiger Urlaub 13:00–17:00 anlegen -------------------------
    await mobile.getByTestId("add-shift").click();
    const dialog = page.getByTestId("shift-dialog");
    await expect(dialog).toBeVisible();

    await dialog.getByTestId("shift-dialog-user").click();
    await page.getByRole("option", { name: assistant.name }).first().click();

    await dialog.getByTestId("shift-dialog-type").click();
    await page.getByRole("option", { name: "Urlaub", exact: true }).click();

    await dialog.getByTestId("shift-dialog-absence-range").click();
    await page.getByRole("option", { name: "Von – bis" }).click();

    await dialog.getByTestId("shift-dialog-absence-from").fill("13:00");
    await dialog.getByTestId("shift-dialog-absence-to").fill("17:00");

    await dialog.getByTestId("shift-dialog-save").click();
    await expect(dialog).toHaveCount(0);

    // Team-Abwesenheiten-Übersicht öffnen und die Lokalzeit prüfen: MUSS
    // "13:00–17:00 Uhr" zeigen, nicht die UTC-verschobene Zeit.
    const overview = page.getByTestId("team-absence-overview");
    await expect(overview).toBeVisible();
    await overview.getByTestId("team-absence-toggle").click();
    const row = overview.getByTestId("team-absence-row").filter({ hasText: assistant.name });
    await expect(row).toHaveCount(1, { timeout: 15000 });
    await expect(row).toContainText("13:00–17:00 Uhr");

    // --- Aufräumen des ersten Eintrags vor dem zweiten Teil ---------------
    const listRes = await page.request.get(`/api/shifts?type=vacation&userId=${assistant.id}`);
    expect(listRes.ok()).toBe(true);
    const created = (await listRes.json()) as { id: number; userId: number }[];
    for (const s of created.filter((s) => s.userId === assistant.id)) {
      await page.request.delete(`/api/shifts/${s.id}`);
    }

    // --- 2) Sehr frühe Startzeit (00:30) wird abgelehnt --------------------
    await selectDayCell(page, mobile.getByTestId(dayCellId(year, month, day)));
    await mobile.getByTestId("add-shift").click();
    const dialog2 = page.getByTestId("shift-dialog");
    await expect(dialog2).toBeVisible();

    await dialog2.getByTestId("shift-dialog-user").click();
    await page.getByRole("option", { name: assistant.name }).first().click();

    await dialog2.getByTestId("shift-dialog-type").click();
    await page.getByRole("option", { name: "Urlaub", exact: true }).click();

    await dialog2.getByTestId("shift-dialog-absence-range").click();
    await page.getByRole("option", { name: "Von – bis" }).click();

    await dialog2.getByTestId("shift-dialog-absence-from").fill("00:30");
    await dialog2.getByTestId("shift-dialog-absence-to").fill("04:00");
    await dialog2.getByTestId("shift-dialog-save").click();

    // Dialog bleibt offen (Validierungsfehler statt falsch gebuchtem Tag).
    await expect(dialog2).toBeVisible();
    await expect(dialog2.getByText(/würde auf den Vortag fallen/)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("shift-dialog")).toHaveCount(0);
  } finally {
    await context.close();
  }
});
