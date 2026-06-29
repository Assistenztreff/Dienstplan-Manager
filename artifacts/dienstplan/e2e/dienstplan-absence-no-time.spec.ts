import { test, expect, type Page, type Locator } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";

/**
 * E2E-Test: Abwesenheiten (Urlaub/Krank) erscheinen im Kalender als
 * ganztägige Blöcke OHNE Uhrzeit, reguläre Schichten dagegen MIT Uhrzeit.
 *
 * Sichert die ShiftBadge-Darstellung gegen Regressionen ab: Würde eine
 * künftige Änderung an der Komponente versehentlich wieder Start-/Endzeiten
 * (z. B. "00:00") für Urlaub/Krank einblenden, schlägt dieser Test fehl.
 *
 * Deckt ab:
 * - Admin-Login über den echten Auth-Flow und Öffnen von /dienstplan
 * - Dedizierter Test-Assistent (kollisionsfrei für die reguläre Schicht)
 * - Urlaubs-, Krank- und reguläre Schicht (jeweils auf eigenem Tag des
 *   aktuell angezeigten Monats) via API angelegt
 * - Urlaubs-Badge zeigt nur "Urlaub", KEINE Uhrzeit (insb. kein "00:00")
 * - Krank-Badge zeigt nur "Krank", KEINE Uhrzeit
 * - Gegenprobe: reguläre Schicht zeigt weiterhin ihre Uhrzeiten (HH:mm–HH:mm)
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";

const MONTHS_DE = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

type ApiShift = {
  id: number;
  userId: number;
  startTime: string;
  endTime: string;
  type: string;
};

/** Parst das Label "MMMM yyyy" (z. B. "Juni 2026") in Jahr und 1-basierten Monat. */
function parseMonthLabel(text: string): { year: number; month: number } {
  const parts = text.trim().split(/\s+/);
  const monthIndex = MONTHS_DE.indexOf(parts[0]);
  const year = Number(parts[1]);
  expect(monthIndex, `Unbekannter Monatsname in "${text}"`).toBeGreaterThanOrEqual(0);
  expect(Number.isFinite(year), `Ungültiges Jahr in "${text}"`).toBe(true);
  return { year, month: monthIndex + 1 };
}

/** data-testid einer Tageszelle für den n-ten Tag des angezeigten Monats. */
function dayCellId(year: number, month: number, dayOfMonth: number): string {
  const mm = String(month).padStart(2, "0");
  const dd = String(dayOfMonth).padStart(2, "0");
  return `day-cell-${year}-${mm}-${dd}`;
}

/** "YYYY-MM-DD" für den n-ten Tag des angezeigten Monats. */
function dateKey(year: number, month: number, dayOfMonth: number): string {
  const mm = String(month).padStart(2, "0");
  const dd = String(dayOfMonth).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/**
 * Erzeugt eine ISO-Zeit aus Datum + Ortszeit. Spiegelt die Speicherweise der
 * App (lokale Zeit → toISOString), damit isSameDay im Browser exakt greift.
 */
function localIso(dateStr: string, time: string): string {
  return new Date(`${dateStr}T${time}`).toISOString();
}

async function loginAsAdmin(page: Page): Promise<void> {
  // Delegiert an den gemeinsamen Helper, der den Vite-Dev-Auto-Login
  // toleriert (kein Login-Formular) und im Prod-Build das Formular ausfüllt.
  await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
}

/** Legt einen dedizierten Test-Assistenten an (kollisionsfrei). */
async function createAssistant(page: Page): Promise<{ id: number; name: string }> {
  const unique = Date.now();
  const res = await page.request.post("/api/users", {
    data: {
      name: `E2E Abwesenheit ${unique}`,
      email: `e2e.absence.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(res.ok(), `Anlegen des Test-Assistenten fehlgeschlagen (${res.status()})`).toBe(true);
  return (await res.json()) as { id: number; name: string };
}

/** Legt eine Schicht via API an und gibt sie zurück. */
async function createShift(
  page: Page,
  data: { userId: number; startTime: string; endTime: string; type: string },
): Promise<ApiShift> {
  const res = await page.request.post("/api/shifts", {
    data: { ...data, shiftModelId: null },
  });
  expect(
    res.ok(),
    `POST /api/shifts (${data.type}) fehlgeschlagen: ${res.status()} ${await res.text()}`,
  ).toBe(true);
  return (await res.json()) as ApiShift;
}

async function openCalendar(page: Page): Promise<Locator> {
  await page.goto("/dienstplan");
  await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();
  const mobile = page.getByTestId("dienstplan-mobile");
  await expect(mobile).toBeVisible();
  return mobile;
}

test("Urlaub/Krank zeigen nur den Typ, reguläre Schicht zeigt Uhrzeiten", async ({ page }) => {
  await loginAsAdmin(page);
  const assistant = await createAssistant(page);
  const createdShiftIds: number[] = [];

  try {
    const mobile = await openCalendar(page);

    // Aktuell angezeigten Monat verwenden — keine langsame Monatsnavigation.
    const { year, month } = parseMonthLabel(
      await page.getByTestId("month-label").innerText(),
    );

    // Jeweils ein eigener Tag pro Schicht-Art, sauber getrennt.
    const vacationDay = 10;
    const sickDay = 12;
    const workDay = 14;

    // Abwesenheiten ganztägig ab Mitternacht (00:00) — exakt der Fall, in dem
    // eine Regression "00:00" einblenden würde.
    const vacation = await createShift(page, {
      userId: assistant.id,
      startTime: localIso(dateKey(year, month, vacationDay), "00:00:00"),
      endTime: localIso(dateKey(year, month, vacationDay), "23:59:59"),
      type: "vacation",
    });
    createdShiftIds.push(vacation.id);

    const sick = await createShift(page, {
      userId: assistant.id,
      startTime: localIso(dateKey(year, month, sickDay), "00:00:00"),
      endTime: localIso(dateKey(year, month, sickDay), "23:59:59"),
      type: "sick",
    });
    createdShiftIds.push(sick.id);

    // Reguläre Schicht mit klaren Uhrzeiten als Gegenprobe.
    const work = await createShift(page, {
      userId: assistant.id,
      startTime: localIso(dateKey(year, month, workDay), "09:00:00"),
      endTime: localIso(dateKey(year, month, workDay), "17:00:00"),
      type: "active",
    });
    createdShiftIds.push(work.id);

    // Neu laden, damit die frisch angelegten Schichten im Kalender erscheinen.
    await page.reload();
    await expect(mobile).toBeVisible();

    // --- Urlaub: nur "Urlaub", keine Uhrzeit -------------------------------
    await mobile.getByTestId(dayCellId(year, month, vacationDay)).click();
    const vacationBadge = mobile.getByTestId(`shift-badge-${vacation.id}`);
    await expect(vacationBadge).toBeVisible();
    await expect(vacationBadge).toContainText("Urlaub");
    await expect(vacationBadge).not.toContainText("00:00");
    // Keinerlei Uhrzeit (HH:mm) im Badge.
    expect(await vacationBadge.innerText()).not.toMatch(/\d{1,2}:\d{2}/);

    // --- Krank: nur "Krank", keine Uhrzeit ---------------------------------
    await mobile.getByTestId(dayCellId(year, month, sickDay)).click();
    const sickBadge = mobile.getByTestId(`shift-badge-${sick.id}`);
    await expect(sickBadge).toBeVisible();
    await expect(sickBadge).toContainText("Krank");
    await expect(sickBadge).not.toContainText("00:00");
    expect(await sickBadge.innerText()).not.toMatch(/\d{1,2}:\d{2}/);

    // --- Gegenprobe: reguläre Schicht zeigt ihre Uhrzeiten -----------------
    await mobile.getByTestId(dayCellId(year, month, workDay)).click();
    const workBadge = mobile.getByTestId(`shift-badge-${work.id}`);
    await expect(workBadge).toBeVisible();
    await expect(workBadge).toContainText("09:00–17:00");
    expect(await workBadge.innerText()).toMatch(/\d{1,2}:\d{2}/);
  } finally {
    // Aufräumen: Testschichten und -assistent entfernen.
    for (const id of createdShiftIds) {
      await page.request.delete(`/api/shifts/${id}`);
    }
    await page.request.delete(`/api/users/${assistant.id}`);
  }
});
