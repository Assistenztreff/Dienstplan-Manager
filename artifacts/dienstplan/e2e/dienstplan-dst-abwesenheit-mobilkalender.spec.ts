/**
 * Task #779 – DST-Regressions-Spec: Abwesenheiten im Dienstplan-Mobilkalender
 *
 * Bestätigt, dass Abwesenheiten am Winterzeit- (25. Oktober) und
 * Sommerzeit-Umstellungstag (29. März) im Dienstplan-MonthGrid bei 400 px
 * Viewport auf dem RICHTIGEN Datum erscheinen — nicht auf dem Vortag oder dem
 * Folgetag.
 *
 * Hintergrund: Der MonthGrid verwendet `isSameDay(new Date(s.startTime), day)`.
 * Da Abwesenheiten mit UTC-Konvention gespeichert werden (T00:00:00.000Z–
 * T23:59:59.000Z) und der Browser lokale Zeitzonen-Interpretation nutzt,
 * könnten am DST-Umstellungstag Datums-Verschiebungen auftreten. Dieser Spec
 * schützt dagegen und ergänzt die bestehenden AbwesenheitsKalender-DST-Specs
 * (abwesenheits-kalender.spec.ts) auf dem Dienstplan selbst.
 */

import { test, expect, request as playwrightRequest } from "@playwright/test";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

const DST_YEAR = 2026;

// Mobile Viewport – MonthGrid zeigt bei 400 px den Dauerzustand mit
// Abwesenheits-Gesamtzahl-Text ("1 Abw." bei genau einer Krankmeldung/sick,
// Arbeitsanweisung 17.08.2026 Punkt 7 — vormals Kategorie-Text "Ausfall").
test.use({ viewport: { width: 400, height: 900 } });

test.setTimeout(90_000);

type CreatedUser = { id: number; name: string };

/**
 * Navigiert zum Dienstplan eines bestimmten Monats (YYYY-MM).
 * Liest das monatliche Label und klickt prev/next-month, bis es stimmt.
 */
async function navigateToMonth(
  page: import("@playwright/test").Page,
  targetYearMonth: string,
): Promise<void> {
  const monthLabel = page.getByTestId("month-label");
  await expect(monthLabel).toBeVisible({ timeout: 15_000 });

  // Ziel: label enthält "Oktober 2026" / "März 2026" o. ä.
  const [y, m] = targetYearMonth.split("-").map(Number);
  const targetDate = new Date(y, (m as number) - 1, 1);

  // Versucht max 24 Klicks.
  for (let i = 0; i < 24; i++) {
    const raw = (await monthLabel.textContent())?.trim() ?? "";
    // Label enthält z.B. "August 2026" – parse erstes 4-stelliges Jahr
    const yearMatch = raw.match(/(\d{4})/);
    const monthMatch = raw.match(/^(\S+)/);
    if (!yearMatch || !monthMatch) break;

    const MONTHS: Record<string, number> = {
      Januar: 1, Februar: 2, März: 3, April: 4, Mai: 5, Juni: 6,
      Juli: 7, August: 8, September: 9, Oktober: 10, November: 11, Dezember: 12,
    };
    const curYear = Number(yearMatch[1]);
    const curMonth = MONTHS[monthMatch[1]] ?? 0;
    const curDate = new Date(curYear, curMonth - 1, 1);

    if (curDate.getTime() === targetDate.getTime()) break;
    if (curDate < targetDate) {
      await page.getByTestId("next-month").click();
    } else {
      await page.getByTestId("prev-month").click();
    }
    // Kurz warten, bis das Label aktualisiert wird.
    await page.waitForTimeout(200);
  }
}

/**
 * Legt via API eine ganztägige Krankmeldung (sick) für userId am isoDay an.
 * UTC-Konvention: T00:00:00.000Z–T23:59:59.000Z (entspricht dem Verhalten
 * der UI und des Backends).
 */
async function seedSickAbsence(
  page: import("@playwright/test").Page,
  userId: number,
  isoDay: string,
): Promise<number> {
  const res = await page.request.post("/api/shifts", {
    data: {
      userId,
      type: "sick",
      startTime: `${isoDay}T00:00:00.000Z`,
      endTime: `${isoDay}T23:59:59.000Z`,
    },
  });
  expect(res.ok(), `Seed-Abwesenheit ${isoDay} fehlgeschlagen (${res.status()})`).toBe(true);
  return ((await res.json()) as { id: number }).id;
}

async function deleteShiftsOf(
  page: import("@playwright/test").Page,
  userId: number,
): Promise<void> {
  // all=true: Aufräumen muss ALLE Monate treffen (DST-Seeds liegen im Okt/März),
  // nicht nur den serverseitigen Default-Zeitraum (aktueller Kalendermonat).
  const res = await page.request.get(`/api/shifts?userId=${userId}&all=true`);
  if (!res.ok()) return;
  const shifts = (await res.json()) as { id: number }[];
  await Promise.all(shifts.map((s) => page.request.delete(`/api/shifts/${s.id}`)));
}

// ── Hilfsfunktion: per Admin einloggen und MonthGrid öffnen ──────────────────

async function loginAsAdmin(page: import("@playwright/test").Page): Promise<void> {
  const res = await page.request.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(res.ok(), `Admin-Login fehlgeschlagen (${res.status()})`).toBe(true);
}

async function openDienstplanMonthGrid(
  page: import("@playwright/test").Page,
  targetYearMonth: string,
): Promise<void> {
  await page.goto("/dienstplan");
  await expect(
    page.getByRole("heading", { name: "Dienstplan", exact: true }),
  ).toBeVisible({ timeout: 20_000 });

  // Monatsnavigation: Zielmonat ansteuern.
  await navigateToMonth(page, targetYearMonth);
}

// ── Winterzeit-Umstellungstag (25. Oktober) ──────────────────────────────────

test("Dienstplan Mobil – Winterzeit-Umstellungstag (25. Oktober): Abwesenheit erscheint auf dem 25., nicht dem 24.", async ({
  page,
}) => {
  await loginAsAdmin(page);

  const unique = Date.now();
  const userRes = await page.request.post("/api/users", {
    data: {
      name: `E2E DST Dienstplan Mob Winter ${unique}`,
      email: `e2e.dst.dp.mob.winter.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(userRes.ok(), `Anlegen fehlgeschlagen (${userRes.status()})`).toBe(true);
  const assistant = (await userRes.json()) as CreatedUser;

  try {
    await seedSickAbsence(page, assistant.id, `${DST_YEAR}-10-25`);

    await openDienstplanMonthGrid(page, `${DST_YEAR}-10`);

    // MonthGrid bei 400 px zeigt den Dauerzustand mit Kategorie-Text.
    const monthGrid = page.getByTestId("month-grid");
    await expect(monthGrid).toBeVisible({ timeout: 10_000 });

    // 25. Oktober muss die Abwesenheit tragen (Gesamtzahl-Text "1 Abw." bei sick).
    const cell25 = page.getByTestId(`day-cell-${DST_YEAR}-10-25`);
    await expect(cell25).toBeVisible({ timeout: 10_000 });
    await expect(cell25).toContainText("1 Abw.", { timeout: 10_000 });

    // Vortag und Folgetag dürfen keine Abwesenheit dieser Kraft tragen.
    // (Beide Zellen können generell leer sein, da keine anderen Daten im
    // Test-Scope liegen.)
    const cell24 = page.getByTestId(`day-cell-${DST_YEAR}-10-24`);
    const cell26 = page.getByTestId(`day-cell-${DST_YEAR}-10-26`);
    await expect(cell24).not.toContainText("Abw.");
    await expect(cell26).not.toContainText("Abw.");
  } finally {
    await deleteShiftsOf(page, assistant.id);
    await page.request.delete(`/api/users/${assistant.id}`);
  }
});

// ── Sommerzeit-Umstellungstag (29. März) ─────────────────────────────────────

test("Dienstplan Mobil – Sommerzeit-Umstellungstag (29. März): Abwesenheit erscheint auf dem 29., nicht dem 28.", async ({
  page,
}) => {
  await loginAsAdmin(page);

  const unique = Date.now();
  const userRes = await page.request.post("/api/users", {
    data: {
      name: `E2E DST Dienstplan Mob Sommer ${unique}`,
      email: `e2e.dst.dp.mob.sommer.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(userRes.ok(), `Anlegen fehlgeschlagen (${userRes.status()})`).toBe(true);
  const assistant = (await userRes.json()) as CreatedUser;

  try {
    await seedSickAbsence(page, assistant.id, `${DST_YEAR}-03-29`);

    await openDienstplanMonthGrid(page, `${DST_YEAR}-03`);

    const monthGrid = page.getByTestId("month-grid");
    await expect(monthGrid).toBeVisible({ timeout: 10_000 });

    // 29. März muss die Abwesenheit tragen (Gesamtzahl-Text "1 Abw." bei sick).
    const cell29 = page.getByTestId(`day-cell-${DST_YEAR}-03-29`);
    await expect(cell29).toBeVisible({ timeout: 10_000 });
    await expect(cell29).toContainText("1 Abw.", { timeout: 10_000 });

    // Vortag und Folgetag ohne Abwesenheit.
    const cell28 = page.getByTestId(`day-cell-${DST_YEAR}-03-28`);
    const cell30 = page.getByTestId(`day-cell-${DST_YEAR}-03-30`);
    await expect(cell28).not.toContainText("Abw.");
    await expect(cell30).not.toContainText("Abw.");
  } finally {
    await deleteShiftsOf(page, assistant.id);
    await page.request.delete(`/api/users/${assistant.id}`);
  }
});
