import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { openAbwesenheitsKalender } from "./helpers/header";

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
  // all=true: Aufräumen muss ALLE Jahre/Monate treffen (der Kalender selbst
  // testet Jahreswechsel), nicht nur den serverseitigen Default-Zeitraum.
  const res = await page.request.get(`/api/shifts?userId=${userId}&all=true`);
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

// ── Smartphone (Task #714): Akkordeon-Pfad der Mehrfachauswahl ──────────────
// Am Handy rendert der Kalender als Akkordeon (ein Monat pro Zeile, nur einer
// offen). Die Auswahl lebt auf Komponentenebene und muss den Wechsel des
// aufgeklappten Monats überleben; „Abwesenheit eintragen" legt den Zeitraum
// auch über die Monatsgrenze hinweg an.
test.describe("Smartphone-Akkordeon", () => {
  test.use({ viewport: { width: 400, height: 800 } });

  test("Mehrfachauswahl über die Monatsgrenze: Auswahl überlebt den Akkordeon-Wechsel, Zeitraum wird angelegt", async ({
    page,
  }) => {
    test.setTimeout(120_000); // Urlaubs-POSTs brauchen im Test-Stack ~5 s pro Tag.
    await loginAsAdmin(page);
    const assistant = await createAssistant(page);

    // Monatspaar A→B: normal aktueller + nächster Monat; im Dezember stattdessen
    // November→Dezember, damit beide Monate im angezeigten Jahr liegen.
    const base = new Date().getMonth() === 11 ? -1 : 0;
    const lastOfA = dateKey(0, base + 1); // Tag 0 des Folgemonats = letzter Tag von Monat A
    const firstOfB = dateKey(1, base + 1);
    const monthKeyA = lastOfA.slice(0, 7);
    const monthKeyB = firstOfB.slice(0, 7);

    try {
      await page.goto("/abwesenheiten");
      await page.getByTestId("toggle-abwesenheits-kalender").click();
      const kalender = page.getByTestId("abwesenheits-kalender");
      await expect(kalender).toBeVisible();

      // Am Handy gibt es das Akkordeon statt des 6-spaltigen Jahresrasters.
      const accordion = kalender.getByTestId("abwkal-accordion");
      await expect(accordion).toBeVisible();
      await expect(kalender.getByTestId("abwkal-grid")).toBeHidden();

      await kalender.getByTestId("abwkal-person-filter").click();
      await page.getByRole("option", { name: assistant.name }).click();

      // Mehrfachauswahl aktivieren.
      await kalender.getByTestId("abwkal-toggle-selection").click();
      const selectionBar = kalender.getByTestId("abwkal-selection-bar");
      await expect(selectionBar).toContainText("Mehrfachauswahl aktiv");

      // Monat A aufklappen (der aktuelle Monat startet offen — nicht zuklappen).
      const toggleA = accordion.getByTestId(`abwkal-acc-toggle-${monthKeyA}`);
      if ((await toggleA.getAttribute("aria-expanded")) !== "true") {
        await toggleA.click();
      }
      const dayA = accordion.getByTestId(`abwkal-day-${lastOfA}`);
      // Togglen: wählen → abwählen → wieder wählen, ohne dass ein Dialog aufgeht.
      await dayA.click();
      await expect(selectionBar).toContainText("1 Tag ausgewählt");
      await dayA.click();
      // Leere Auswahl: Zähler verschwindet, Aktion ist deaktiviert.
      await expect(dayA).not.toHaveAttribute("data-selected", "true");
      await expect(
        selectionBar.getByTestId("abwkal-create-from-selection"),
      ).toBeDisabled();
      await dayA.click();
      await expect(dayA).toHaveAttribute("data-selected", "true");
      await expect(page.getByTestId("abwkal-create-dialog")).toHaveCount(0);

      // Monat B aufklappen (schließt Monat A) und ersten Tag dazuwählen.
      await accordion.getByTestId(`abwkal-acc-toggle-${monthKeyB}`).click();
      const dayB = accordion.getByTestId(`abwkal-day-${firstOfB}`);
      await dayB.click();
      await expect(selectionBar).toContainText("2 Tage ausgewählt");

      // Zurück zu Monat A: die dortige Auswahl hat den Wechsel überlebt.
      await toggleA.click();
      await expect(accordion.getByTestId(`abwkal-day-${lastOfA}`)).toHaveAttribute(
        "data-selected",
        "true",
      );
      await expect(selectionBar).toContainText("2 Tage ausgewählt");

      // Zeitraum über die Auswahl anlegen (2 Tage über die Monatsgrenze).
      const createDialog = page.getByTestId("abwkal-create-dialog");
      await selectionBar.getByTestId("abwkal-create-from-selection").click();
      await expect(createDialog).toBeVisible();
      await createDialog.getByTestId("abwkal-create-save").click();
      await expect(createDialog).toHaveCount(0, { timeout: 30_000 });
      await expect(selectionBar).toHaveCount(0);

      // Beide Tage sind gefärbt — Monat A ist noch offen, für B umschalten.
      await expect(accordion.getByTestId(`abwkal-day-${lastOfA}`)).toHaveAttribute(
        "data-category",
        "geplant",
      );
      await accordion.getByTestId(`abwkal-acc-toggle-${monthKeyB}`).click();
      await expect(accordion.getByTestId(`abwkal-day-${firstOfB}`)).toHaveAttribute(
        "data-category",
        "geplant",
      );
    } finally {
      await deleteShiftsOf(page, assistant.id);
      await page.request.delete(`/api/users/${assistant.id}`);
    }
  });
});

test("Dienstplan-Popup: Abwesenheitskalender aus Kalender- und Tabellenansicht (Desktop + Tablet)", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await loginAsAdmin(page);
  await page.goto("/dienstplan");
  await expect(page.getByTestId("header-overflow")).toBeVisible();

  // Kalenderansicht (Desktop): Button öffnet den Jahreskalender als Popup.
  await page.getByTestId("view-toggles-desktop").getByTestId("view-toggle-grid").click();
  await openAbwesenheitsKalender(page);
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
  await openAbwesenheitsKalender(page);
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
  await openAbwesenheitsKalender(page);
  await expect(popup).toBeVisible();
  await expect(popup.getByTestId("abwesenheits-kalender")).toBeVisible();
  await page.screenshot({
    path: path.join(SHOT_DIR, "popup-tabellenansicht-tablet.png"),
    fullPage: false,
  });
  await page.keyboard.press("Escape");
  await expect(popup).toHaveCount(0);
});

// ── Zeitumstellungs-Regressionstests (Task #770) ─────────────────────────────
// Der Kalender gruppiert Abwesenheiten über startTime.substring(0,10) — der
// reine UTC-Datums-Schlüssel. Kehrt jemand zu lokaler Zeitinterpretation zurück
// (z.B. new Date(startTime).toLocaleDateString()), würden Einträge mit
// T00:00:00.000Z in deutschen Zeitzonen auf den Vortag fallen. Diese Specs
// fangen genau diese Rendering-Regression auf Browser-Ebene ab.
//
// Beide DST-Daten liegen in 2026 (Winterzeit: 25. Oktober, Sommerzeit: 29. März).
// Der Kalender zeigt standardmäßig das laufende Jahr; die Tests navigieren
// falls nötig zum richtigen Jahr.

const DST_YEAR = 2026;

async function navigateToYear(page: import("@playwright/test").Page, kalender: import("@playwright/test").Locator, targetYear: number): Promise<void> {
  const yearLabel = kalender.getByTestId("abwkal-year-label");
  let current = Number((await yearLabel.textContent())?.trim() ?? "0");
  while (current < targetYear) {
    await kalender.getByTestId("abwkal-next-year").click();
    current = Number((await yearLabel.textContent())?.trim() ?? "0");
  }
  while (current > targetYear) {
    await kalender.getByTestId("abwkal-prev-year").click();
    current = Number((await yearLabel.textContent())?.trim() ?? "0");
  }
}

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
      endTime:   `${isoDay}T23:59:59.000Z`,
    },
  });
  expect(res.ok(), `Seed-Abwesenheit ${isoDay} fehlgeschlagen (${res.status()})`).toBe(true);
  return ((await res.json()) as { id: number }).id;
}

test("Winterzeit-Umstellungstag (25. Oktober): Abwesenheit erscheint auf dem 25., nicht dem 24.", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await loginAsAdmin(page);

  const unique = Date.now();
  const userRes = await page.request.post("/api/users", {
    data: {
      name: `E2E DST Winter ${unique}`,
      email: `e2e.dst.winter.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(userRes.ok(), `Anlegen fehlgeschlagen (${userRes.status()})`).toBe(true);
  const assistant = (await userRes.json()) as { id: number; name: string };

  try {
    // UTC-Konvention: T00:00:00.000Z–T23:59:59.000Z. Am Winterzeit-Umstellungstag
    // dauert der Berliner Tag 25 Stunden; UTC beträgt trotzdem ~23:59:59, kein
    // Überlauf auf den nächsten Tag.
    await seedSickAbsence(page, assistant.id, `${DST_YEAR}-10-25`);

    await page.goto("/abwesenheiten");
    await page.getByTestId("toggle-abwesenheits-kalender").click();
    const kalender = page.getByTestId("abwesenheits-kalender");
    await expect(kalender).toBeVisible();

    await navigateToYear(page, kalender, DST_YEAR);

    await kalender.getByTestId("abwkal-person-filter").click();
    await page.getByRole("option", { name: assistant.name }).click();

    const grid = kalender.getByTestId("abwkal-grid");

    // 25. Oktober muss die Abwesenheit tragen.
    await expect(grid.getByTestId(`abwkal-day-${DST_YEAR}-10-25`)).toHaveAttribute(
      "data-category",
      "ausfall",
    );
    // Vortag (24.) und Folgetag (26.) dürfen keine Abwesenheit dieses
    // Assistenten zeigen — eine lokale-Zeit-Regression würde den 25. auf den 24. schieben.
    await expect(grid.getByTestId(`abwkal-day-${DST_YEAR}-10-24`)).not.toHaveAttribute(
      "data-category",
    );
    await expect(grid.getByTestId(`abwkal-day-${DST_YEAR}-10-26`)).not.toHaveAttribute(
      "data-category",
    );
  } finally {
    await deleteShiftsOf(page, assistant.id);
    await page.request.delete(`/api/users/${assistant.id}`);
  }
});

test("Sommerzeit-Umstellungstag (29. März): Abwesenheit erscheint auf dem 29., nicht dem 28.", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await loginAsAdmin(page);

  const unique = Date.now();
  const userRes = await page.request.post("/api/users", {
    data: {
      name: `E2E DST Sommer ${unique}`,
      email: `e2e.dst.sommer.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(userRes.ok(), `Anlegen fehlgeschlagen (${userRes.status()})`).toBe(true);
  const assistant = (await userRes.json()) as { id: number; name: string };

  try {
    // UTC-Konvention: T00:00:00.000Z–T23:59:59.000Z. Am Sommerzeit-Umstellungstag
    // dauert der Berliner Tag 23 Stunden; die UTC-Zeitspanne bleibt ~23:59:59,
    // kein Kurztagfehler.
    await seedSickAbsence(page, assistant.id, `${DST_YEAR}-03-29`);

    await page.goto("/abwesenheiten");
    await page.getByTestId("toggle-abwesenheits-kalender").click();
    const kalender = page.getByTestId("abwesenheits-kalender");
    await expect(kalender).toBeVisible();

    await navigateToYear(page, kalender, DST_YEAR);

    await kalender.getByTestId("abwkal-person-filter").click();
    await page.getByRole("option", { name: assistant.name }).click();

    const grid = kalender.getByTestId("abwkal-grid");

    // 29. März muss die Abwesenheit tragen.
    await expect(grid.getByTestId(`abwkal-day-${DST_YEAR}-03-29`)).toHaveAttribute(
      "data-category",
      "ausfall",
    );
    // Benachbarte Tage ohne Abwesenheit.
    await expect(grid.getByTestId(`abwkal-day-${DST_YEAR}-03-28`)).not.toHaveAttribute(
      "data-category",
    );
    await expect(grid.getByTestId(`abwkal-day-${DST_YEAR}-03-30`)).not.toHaveAttribute(
      "data-category",
    );
  } finally {
    await deleteShiftsOf(page, assistant.id);
    await page.request.delete(`/api/users/${assistant.id}`);
  }
});

// ── Mobile-Akkordeon DST-Regressionstests (Task #795) ────────────────────────
// Dieselben UTC-Datums-Schlüssel-Checks wie oben, aber bei 400 px Viewport:
// Das 6-Spalten-Grid ist dort ausgeblendet; stattdessen rendert der Kalender
// ein Akkordeon (abwkal-accordion). Ein Rückfall auf lokale Zeitinterpretation
// wäre auf europäischen Smartphones nicht sichtbar gewesen, bis dieser Spec
// existierte.

test("Mobil-Akkordeon – Winterzeit-Umstellungstag (25. Oktober): Abwesenheit erscheint auf dem 25., nicht dem 24.", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 400, height: 900 });
  await loginAsAdmin(page);

  const unique = Date.now();
  const userRes = await page.request.post("/api/users", {
    data: {
      name: `E2E DST Mob Winter ${unique}`,
      email: `e2e.dst.mob.winter.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(userRes.ok(), `Anlegen fehlgeschlagen (${userRes.status()})`).toBe(true);
  const assistant = (await userRes.json()) as { id: number; name: string };

  try {
    await seedSickAbsence(page, assistant.id, `${DST_YEAR}-10-25`);

    await page.goto("/abwesenheiten");
    await page.getByTestId("toggle-abwesenheits-kalender").click();
    const kalender = page.getByTestId("abwesenheits-kalender");
    await expect(kalender).toBeVisible();

    await navigateToYear(page, kalender, DST_YEAR);

    await kalender.getByTestId("abwkal-person-filter").click();
    await page.getByRole("option", { name: assistant.name }).click();

    // Akkordeon ist bei 400 px sichtbar; das Grid bleibt versteckt.
    const accordion = kalender.getByTestId("abwkal-accordion");
    await expect(accordion).toBeVisible();

    // Oktober-Zeile aufklappen.
    await accordion.getByTestId(`abwkal-acc-toggle-${DST_YEAR}-10`).click();

    // 25. Oktober muss die Abwesenheit tragen.
    await expect(accordion.getByTestId(`abwkal-day-${DST_YEAR}-10-25`)).toHaveAttribute(
      "data-category",
      "ausfall",
    );
    // Vortag und Folgetag dürfen leer bleiben.
    await expect(accordion.getByTestId(`abwkal-day-${DST_YEAR}-10-24`)).not.toHaveAttribute(
      "data-category",
    );
    await expect(accordion.getByTestId(`abwkal-day-${DST_YEAR}-10-26`)).not.toHaveAttribute(
      "data-category",
    );
  } finally {
    await deleteShiftsOf(page, assistant.id);
    await page.request.delete(`/api/users/${assistant.id}`);
  }
});

test("Mobil-Akkordeon – Sommerzeit-Umstellungstag (29. März): Abwesenheit erscheint auf dem 29., nicht dem 28.", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 400, height: 900 });
  await loginAsAdmin(page);

  const unique = Date.now();
  const userRes = await page.request.post("/api/users", {
    data: {
      name: `E2E DST Mob Sommer ${unique}`,
      email: `e2e.dst.mob.sommer.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(userRes.ok(), `Anlegen fehlgeschlagen (${userRes.status()})`).toBe(true);
  const assistant = (await userRes.json()) as { id: number; name: string };

  try {
    await seedSickAbsence(page, assistant.id, `${DST_YEAR}-03-29`);

    await page.goto("/abwesenheiten");
    await page.getByTestId("toggle-abwesenheits-kalender").click();
    const kalender = page.getByTestId("abwesenheits-kalender");
    await expect(kalender).toBeVisible();

    await navigateToYear(page, kalender, DST_YEAR);

    await kalender.getByTestId("abwkal-person-filter").click();
    await page.getByRole("option", { name: assistant.name }).click();

    // Akkordeon ist bei 400 px sichtbar; das Grid bleibt versteckt.
    const accordion = kalender.getByTestId("abwkal-accordion");
    await expect(accordion).toBeVisible();

    // März-Zeile aufklappen.
    await accordion.getByTestId(`abwkal-acc-toggle-${DST_YEAR}-03`).click();

    // 29. März muss die Abwesenheit tragen.
    await expect(accordion.getByTestId(`abwkal-day-${DST_YEAR}-03-29`)).toHaveAttribute(
      "data-category",
      "ausfall",
    );
    // Benachbarte Tage ohne Abwesenheit.
    await expect(accordion.getByTestId(`abwkal-day-${DST_YEAR}-03-28`)).not.toHaveAttribute(
      "data-category",
    );
    await expect(accordion.getByTestId(`abwkal-day-${DST_YEAR}-03-30`)).not.toHaveAttribute(
      "data-category",
    );
  } finally {
    await deleteShiftsOf(page, assistant.id);
    await page.request.delete(`/api/users/${assistant.id}`);
  }
});
