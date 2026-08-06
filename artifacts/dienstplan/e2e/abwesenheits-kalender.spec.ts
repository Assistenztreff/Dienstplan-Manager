import { test, expect, type Page } from "@playwright/test";

/**
 * E2E-Test: Abwesenheitskalender (Jahresansicht, HANDOFF 05.08.2026).
 *
 * Deckt ab:
 * - Admin-Login über den echten Auth-Flow, Desktop-Viewport
 * - /abwesenheiten zeigt 12 Mini-Monatskalender (2 Zeilen à 6, quadratisch)
 * - Per API angelegte Urlaubstage erscheinen als gefärbte Tage (Kategorie
 *   „geplant" = Gelb, data-category-Attribut)
 * - Direktanlage: Klick auf Starttag, Klick auf Endtag → Dialog → Speichern,
 *   danach sind alle Tage des Zeitraums gefärbt
 * - Klick auf einen belegten Tag öffnet den Detail-Dialog mit Löschen
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";

// Desktop-Viewport: nur hier ist das 6-Spalten-Jahresraster sichtbar.
test.use({ viewport: { width: 1400, height: 900 } });

type ApiShift = { id: number; userId: number; type: string; startTime: string };

/** "YYYY-MM-DD" für einen Tag des laufenden Jahres/Monats. */
function dateKey(dayOfMonth: number, monthOffset = 0): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + monthOffset, dayOfMonth);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function localIso(dateStr: string, time: string): string {
  return new Date(`${dateStr}T${time}`).toISOString();
}

async function loginAsAdmin(page: Page): Promise<void> {
  const res = await page.request.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(res.ok(), `Admin-Login fehlgeschlagen (${res.status()})`).toBe(true);
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
}

async function createAssistant(page: Page): Promise<{ id: number; name: string }> {
  const unique = Date.now();
  const res = await page.request.post("/api/users", {
    data: {
      name: `E2E Abwkalender ${unique}`,
      email: `e2e.abwkal.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(res.ok(), `Anlegen des Test-Assistenten fehlgeschlagen (${res.status()})`).toBe(true);
  return (await res.json()) as { id: number; name: string };
}

/** Löscht alle Schichten des Assistenten (Aufräumen, FK-sicher vor User-Delete). */
async function deleteShiftsOf(page: Page, userId: number): Promise<void> {
  const res = await page.request.get(`/api/shifts?userId=${userId}`);
  if (!res.ok()) return;
  const shifts = (await res.json()) as ApiShift[];
  for (const s of shifts) {
    await page.request.delete(`/api/shifts/${s.id}`);
  }
}

test("Abwesenheitskalender: Jahresansicht, Direktanlage per Klick und Löschen im Detail-Dialog", async ({
  page,
}) => {
  await loginAsAdmin(page);
  const assistant = await createAssistant(page);

  try {
    // Zwei Urlaubstage im laufenden Monat vorbelegen (vor dem Seitenaufruf,
    // damit sie im ersten Render sichtbar sind).
    for (const d of [5, 6]) {
      const res = await page.request.post("/api/shifts", {
        data: {
          userId: assistant.id,
          startTime: localIso(dateKey(d), "00:00:00"),
          endTime: localIso(dateKey(d), "23:59:59"),
          type: "vacation",
          shiftModelId: null,
        },
      });
      expect(res.ok(), `Seed-Urlaub fehlgeschlagen: ${res.status()} ${await res.text()}`).toBe(true);
    }

    await page.goto("/abwesenheiten");
    const kalender = page.getByTestId("abwesenheits-kalender");
    // Tage-Testids kommen in Desktop-Grid und Mobile-Akkordeon doppelt vor
    // (aktueller Monat startet aufgeklappt) — auf das Grid scopen.
    const grid = kalender.getByTestId("abwkal-grid");
    await expect(kalender).toBeVisible();

    // 12 Mini-Monate im Jahresraster.
    await expect(kalender.getByTestId("abwkal-grid").locator('[data-testid^="abwkal-month-"]')).toHaveCount(12);

    // Vorbelegte Urlaubstage sind als „geplant" gefärbt.
    await expect(grid.getByTestId(`abwkal-day-${dateKey(5)}`)).toHaveAttribute("data-category", "geplant");
    await expect(grid.getByTestId(`abwkal-day-${dateKey(6)}`)).toHaveAttribute("data-category", "geplant");

    // Personenfilter auf den Test-Assistenten setzen (Klick-Auswahl betrachtet
    // danach nur noch dessen Abwesenheiten).
    await kalender.getByTestId("abwkal-person-filter").click();
    await page.getByRole("option", { name: assistant.name }).click();

    // --- Direktanlage: Starttag → Endtag → Dialog → Speichern --------------
    await grid.getByTestId(`abwkal-day-${dateKey(25)}`).click();
    await expect(kalender.getByTestId("abwkal-anchor-hint")).toBeVisible();
    await grid.getByTestId(`abwkal-day-${dateKey(26)}`).click();

    const createDialog = page.getByTestId("abwkal-create-dialog");
    await expect(createDialog).toBeVisible();
    await createDialog.getByTestId("abwkal-create-save").click();
    // Jeder Urlaubs-POST braucht im Test-Stack ~5 s (serverseitige
    // Urlaubskonto-Neuberechnung, sequentiell pro Tag) — großzügiges Timeout.
    await expect(createDialog).toHaveCount(0, { timeout: 30_000 });

    // Beide Tage des Zeitraums sind jetzt gefärbt.
    for (const d of [25, 26]) {
      await expect(grid.getByTestId(`abwkal-day-${dateKey(d)}`)).toHaveAttribute(
        "data-category",
        "geplant",
      );
    }

    // --- Löschen über den Detail-Dialog eines belegten Tages ----------------
    await grid.getByTestId(`abwkal-day-${dateKey(25)}`).click();
    const dayDialog = page.getByTestId("abwkal-day-dialog");
    await expect(dayDialog).toBeVisible();
    await expect(dayDialog.getByText(assistant.name)).toBeVisible();
    await dayDialog.locator('[data-testid^="abwkal-delete-"]').first().click();
    await expect(grid.getByTestId(`abwkal-day-${dateKey(25)}`)).not.toHaveAttribute(
      "data-category",
      "geplant",
    );
  } finally {
    await deleteShiftsOf(page, assistant.id);
    await page.request.delete(`/api/users/${assistant.id}`);
  }
});
