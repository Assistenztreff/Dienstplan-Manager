import path from "node:path";
import { test, expect, type Page } from "@playwright/test";

/**
 * E2E-Test: Abwesenheitskalender (Jahresansicht).
 *
 * Deckt ab:
 * - Admin-Login über den echten Auth-Flow, Desktop-Viewport
 * - /abwesenheiten zeigt 12 Mini-Monatskalender (2 Zeilen à 6, quadratisch)
 * - Per API angelegte Urlaubstage erscheinen als gefärbte Tage (Kategorie
 *   „geplant" = Gelb, data-category-Attribut)
 * - Zwei-Stufen-Klick wie im Dienstplan: 1. Klick wählt, Klick auf anderen
 *   Tag verschiebt die Auswahl, 2. Klick auf denselben Tag öffnet den Dialog
 * - Mehrfachauswahl: Umschalter neben der Legende, Tagesklicks togglen,
 *   „Abwesenheit eintragen" legt den Zeitraum über die Auswahl an
 * - Klick auf einen belegten Tag öffnet den Detail-Dialog mit Löschen
 * - Popup aus dem Dienstplan (5.1): Kalender- UND Tabellenansicht, Desktop
 *   + Tablet, mit Screenshot-Nachweis
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";

// Desktop-Viewport: nur hier ist das 6-Spalten-Jahresraster sichtbar.
test.use({ viewport: { width: 1400, height: 900 } });

const SHOT_DIR = path.join(process.cwd(), "..", "..", "screenshots", "abwesenheits-kalender");

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

test("Abwesenheitskalender: Zwei-Stufen-Klick, Mehrfachauswahl und Löschen im Detail-Dialog", async ({
  page,
}) => {
  test.setTimeout(120_000); // Urlaubs-POSTs brauchen im Test-Stack ~5 s pro Tag.
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
    // Der Kalender ist seit #706 standardmäßig eingeklappt → erst ausklappen.
    const toggle = page.getByTestId("toggle-abwesenheits-kalender");
    await expect(page.getByTestId("abwesenheits-kalender")).toHaveCount(0);
    await toggle.click();
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

    // --- Zwei-Stufen-Klick: wählen → verschieben → erst dann öffnen --------
    const createDialog = page.getByTestId("abwkal-create-dialog");

    // 1. Klick wählt den Tag nur aus — kein Dialog.
    await grid.getByTestId(`abwkal-day-${dateKey(25)}`).click();
    await expect(kalender.getByTestId("abwkal-selected-hint")).toBeVisible();
    await expect(grid.getByTestId(`abwkal-day-${dateKey(25)}`)).toHaveAttribute("data-selected", "true");
    await expect(createDialog).toHaveCount(0);

    // Klick auf einen anderen Tag verschiebt nur die Auswahl — kein Dialog.
    await grid.getByTestId(`abwkal-day-${dateKey(27)}`).click();
    await expect(grid.getByTestId(`abwkal-day-${dateKey(27)}`)).toHaveAttribute("data-selected", "true");
    await expect(grid.getByTestId(`abwkal-day-${dateKey(25)}`)).not.toHaveAttribute("data-selected", "true");
    await expect(createDialog).toHaveCount(0);

    // 2. Klick auf denselben Tag öffnet den Eintrags-Dialog (einzelner Tag).
    await grid.getByTestId(`abwkal-day-${dateKey(27)}`).click();
    await expect(createDialog).toBeVisible();
    await createDialog.getByTestId("abwkal-create-save").click();
    // Jeder Urlaubs-POST braucht im Test-Stack ~5 s (serverseitige
    // Urlaubskonto-Neuberechnung, sequentiell pro Tag) — großzügiges Timeout.
    await expect(createDialog).toHaveCount(0, { timeout: 30_000 });
    await expect(grid.getByTestId(`abwkal-day-${dateKey(27)}`)).toHaveAttribute("data-category", "geplant");
    // Der zuerst gewählte Tag 25 bleibt leer (Auswahl wurde verschoben).
    await expect(grid.getByTestId(`abwkal-day-${dateKey(25)}`)).not.toHaveAttribute("data-category", "geplant");

    // --- Mehrfachauswahl: togglen, Zeitraum über Auswahl anlegen -----------
    await kalender.getByTestId("abwkal-toggle-selection").click();
    const selectionBar = kalender.getByTestId("abwkal-selection-bar");
    await expect(selectionBar).toBeVisible();
    await expect(selectionBar).toContainText("Mehrfachauswahl aktiv");

    // Tage 10, 12, 14 anwählen — Klicks öffnen keinen Dialog.
    for (const d of [10, 12, 14]) {
      await grid.getByTestId(`abwkal-day-${dateKey(d)}`).click();
    }
    await expect(selectionBar).toContainText("3 Tage ausgewählt");
    await expect(createDialog).toHaveCount(0);

    // Tag 12 erneut antippen wählt ihn wieder ab.
    await grid.getByTestId(`abwkal-day-${dateKey(12)}`).click();
    await expect(selectionBar).toContainText("2 Tage ausgewählt");

    // Belegter Tag toggelt im Mehrfachmodus statt den Detail-Dialog zu öffnen.
    await grid.getByTestId(`abwkal-day-${dateKey(5)}`).click();
    await expect(page.getByTestId("abwkal-day-dialog")).toHaveCount(0);
    await expect(grid.getByTestId(`abwkal-day-${dateKey(5)}`)).toHaveAttribute("data-selected", "true");
    await grid.getByTestId(`abwkal-day-${dateKey(5)}`).click(); // wieder abwählen

    // Aktion öffnet den Dialog für den Zeitraum frühester → spätester Tag
    // (inklusive Zwischentage, wie die frühere Range-Anlage).
    await selectionBar.getByTestId("abwkal-create-from-selection").click();
    await expect(createDialog).toBeVisible();
    await createDialog.getByTestId("abwkal-create-save").click();
    await expect(createDialog).toHaveCount(0, { timeout: 30_000 });

    // Alle Tage des Zeitraums 10–14 sind gefärbt, Auswahlmodus ist beendet.
    for (const d of [10, 11, 12, 13, 14]) {
      await expect(grid.getByTestId(`abwkal-day-${dateKey(d)}`)).toHaveAttribute(
        "data-category",
        "geplant",
      );
    }
    await expect(selectionBar).toHaveCount(0);

    // Screenshot-Nachweis des Ist-Zustands (Mehrfach-Umschalter + Legende).
    await kalender.screenshot({ path: path.join(SHOT_DIR, "nachher-kalender.png") });

    // --- Löschen über den Detail-Dialog eines belegten Tages ----------------
    await grid.getByTestId(`abwkal-day-${dateKey(10)}`).click();
    const dayDialog = page.getByTestId("abwkal-day-dialog");
    await expect(dayDialog).toBeVisible();
    await expect(dayDialog.getByText(assistant.name)).toBeVisible();
    await dayDialog.locator('[data-testid^="abwkal-delete-"]').first().click();
    await expect(grid.getByTestId(`abwkal-day-${dateKey(10)}`)).not.toHaveAttribute(
      "data-category",
      "geplant",
    );
  } finally {
    await deleteShiftsOf(page, assistant.id);
    await page.request.delete(`/api/users/${assistant.id}`);
  }
});

test("Dienstplan-Popup: Abwesenheitskalender aus Kalender- und Tabellenansicht (Desktop + Tablet)", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await loginAsAdmin(page);
  await page.goto("/dienstplan");
  await expect(page.getByTestId("open-abwesenheits-kalender")).toBeVisible();

  // Kalenderansicht (Desktop): Button öffnet den Jahreskalender als Popup.
  await page.getByTestId("view-toggles-desktop").getByTestId("view-toggle-grid").click();
  await page.getByTestId("open-abwesenheits-kalender").click();
  const popup = page.getByTestId("abwesenheits-kalender-popup");
  await expect(popup).toBeVisible();
  await expect(popup.getByTestId("abwesenheits-kalender")).toBeVisible();
  await page.screenshot({
    path: path.join(SHOT_DIR, "popup-kalenderansicht-desktop.png"),
    fullPage: false,
  });
  await page.keyboard.press("Escape");
  await expect(popup).toHaveCount(0);

  // Tabellenansicht (Desktop): derselbe Button, gleiches Popup.
  await page.getByTestId("view-toggles-desktop").getByTestId("view-toggle-table").click();
  await expect(page.getByLabel(/Tabellenansicht/)).toBeVisible();
  await page.getByTestId("open-abwesenheits-kalender").click();
  await expect(popup).toBeVisible();
  await expect(popup.getByTestId("abwesenheits-kalender")).toBeVisible();
  await page.screenshot({
    path: path.join(SHOT_DIR, "popup-tabellenansicht-desktop.png"),
    fullPage: false,
  });
  await page.keyboard.press("Escape");
  await expect(popup).toHaveCount(0);

  // Tablet-Viewport: 3-spaltige Monatslogik, Popup weiterhin erreichbar.
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.getByTestId("open-abwesenheits-kalender").click();
  await expect(popup).toBeVisible();
  await expect(popup.getByTestId("abwesenheits-kalender")).toBeVisible();
  await page.screenshot({
    path: path.join(SHOT_DIR, "popup-tabellenansicht-tablet.png"),
    fullPage: false,
  });
  await page.keyboard.press("Escape");
  await expect(popup).toHaveCount(0);
});
