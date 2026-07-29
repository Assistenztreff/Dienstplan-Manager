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
 * Gezielte E2E-Abdeckung der Gesamtübersichts-Matrix auf /auswertungen
 * (Filter "Alle", Ansicht "Übersicht") — Task: Free-vs-Premium-Zellen und
 * Zeilen-Sichtbarkeit je nach Stundenlohn/Prozent-Sätzen.
 *
 * Eigenes frisch registriertes Premium-Konto (keine geteilten Zustände mit
 * Nachbar-Specs): so lassen sich die Zuschlags-Sätze des Kontos gefahrlos
 * verstellen (Feiertag = 0% → Zeile verschwindet), ohne den Setup-Admin zu
 * beeinflussen.
 *
 * Deckt ab:
 * - Matrix erscheint bei "Alle" (gesamt-auswertung-matrix), eine Spalte pro
 *   Assistenzkraft (matrix-col-<userId>).
 * - Zell-Werte über matrix-cell-<row>-<userId> (Geleistete Stunden "8 / 8 h").
 * - Geldzeilen (Grundlohn/GESAMT) nur, weil mindestens EINE Kraft einen
 *   Stundenlohn hat; Kraft OHNE Lohn zeigt "—" in allen Geldzellen.
 * - 0%-Zuschlagsart (Feiertag) wird als Zeile komplett ausgeblendet;
 *   einheitliche Sätze stehen im Zeilen-Label ("Nacht (25%)").
 * - Umschalten Einzel ↔ Alle: Personen-Auswahl + Kartenansicht zeigt die
 *   Einzelkarte (Matrix weg), zurück auf "Alle" + Übersicht die Matrix.
 * - Mobil (390px): erste Spalte sticky, Tabelle horizontal scrollbar.
 */

const WAGE = 20;

// Zielmonat = Vormonat: Seite startet beim aktuellen Monat, ein Klick auf
// month-prev landet garantiert hier — unabhängig vom Testlauf-Datum.
const NOW = new Date();
const TARGET = new Date(NOW.getFullYear(), NOW.getMonth() - 1, 1);
const TARGET_YEAR = TARGET.getFullYear();
const TARGET_MM = String(TARGET.getMonth() + 1).padStart(2, "0");
const SHIFT_DAY = `${TARGET_YEAR}-${TARGET_MM}-15`;

let acc: FreeAccount;
let wageAssistantId: number;
let noWageAssistantId: number;
let wageShiftId: number;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  acc = await registerFreeAccount("privat", "matrixui");
  // Premium: hours-balance (advancedAnalytics) + Stundenlohn-Feld
  // (advancedPersonnelFile) sind Premium-Features.
  await setAccountPlan(acc.email, "premium");

  // Konto-Sätze: Nacht 25 / Sonntag 50 / Feiertag 0 — die 0%-Art darf in der
  // Matrix NICHT als Zeile erscheinen (gleiches Verhalten wie Einzelkarten).
  const allowanceRes = await acc.ctx.put("/api/allowance-settings", {
    data: {
      nightPercent: 25,
      nightStart: "23:00",
      nightEnd: "06:00",
      sundayPercent: 50,
      holidayPercent: 0,
    },
  });
  expect(
    allowanceRes.ok(),
    `Zuschlags-Sätze setzen fehlgeschlagen (${allowanceRes.status()})`,
  ).toBe(true);

  // Zwei Assistenzkräfte: EINE mit Stundenlohn (Premium-Personalakte), EINE
  // ohne — die Geldzellen der zweiten müssen "—" zeigen.
  const unique = Date.now();
  const createAssistant = async (
    suffix: string,
    hourlyWage?: number,
  ): Promise<number> => {
    const res = await acc.ctx.post("/api/users", {
      data: {
        name: `E2E Matrix ${suffix} ${unique}`,
        email: `e2e.matrixui.${suffix.toLowerCase()}.${unique}@dienstplan.test`,
        role: "assistant",
        ...(hourlyWage != null ? { hourlyWage } : {}),
      },
    });
    expect(res.status(), `Assistent ${suffix} anlegen fehlgeschlagen (${res.status()})`).toBe(201);
    return ((await res.json()) as { id: number }).id;
  };
  wageAssistantId = await createAssistant("Lohn", WAGE);
  noWageAssistantId = await createAssistant("Ohnelohn");

  // Je eine FIX-Schicht (8h) im Zielmonat — nur FIX zählt in der Auswertung.
  for (const userId of [wageAssistantId, noWageAssistantId]) {
    const res = await acc.ctx.post("/api/shifts", {
      data: {
        userId,
        startTime: `${SHIFT_DAY}T08:00:00.000Z`,
        endTime: `${SHIFT_DAY}T16:00:00.000Z`,
        type: "active",
        planningStatus: "FIX",
      },
    });
    expect(res.status(), `Schicht anlegen fehlgeschlagen (${res.status()})`).toBe(201);
    const created = (await res.json()) as { id: number };
    if (userId === wageAssistantId) wageShiftId = created.id;
  }
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

/** Login + Navigation in den Zielmonat mit Filter "Alle" und Ansicht Matrix. */
async function openMatrix(page: import("@playwright/test").Page): Promise<void> {
  await loginViaUi(page, acc.email, FREE_ACCOUNT_PASSWORD);
  await page.goto("/auswertungen");
  await expect(page.getByRole("heading", { name: "Auswertungen", exact: true })).toBeVisible();
  await page.getByTestId("assistant-select").click();
  await page.getByTestId("assistant-option-all").click();
  await page.getByTestId("view-toggle-matrix").click();
  await page.getByTestId("month-prev").click();
  await expect(page.getByTestId("gesamt-auswertung-matrix")).toBeVisible();
  await expect(page.getByTestId(`matrix-col-${wageAssistantId}`)).toBeVisible();
  await expect(page.getByTestId(`matrix-col-${noWageAssistantId}`)).toBeVisible();
}

test("Matrix bei Alle: Zell-Werte, Geldzeilen nur mit Stundenlohn, 0%-Zeile ausgeblendet, Einzel-Umschalten", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openMatrix(page);

  // Stunden-Zeile: beide Kräfte "8 / 8 h" (eine 8h-FIX-Schicht, kein Vertrag
  // nötig — Soll = geplante FIX-Stunden).
  await expect(page.getByTestId(`matrix-cell-worked-${wageAssistantId}`)).toHaveText("8 / 8 h");
  await expect(page.getByTestId(`matrix-cell-worked-${noWageAssistantId}`)).toHaveText("8 / 8 h");

  // Zuschlags-Zeilen: Nacht (25%) und Sonntag (50%) erscheinen mit dem
  // einheitlichen Satz im Label; die 0%-Art Feiertag fehlt KOMPLETT.
  await expect(page.getByTestId("matrix-row-nightHours")).toContainText("Nacht (25%)");
  await expect(page.getByTestId("matrix-row-sundayHours")).toContainText("Sonntag (50%)");
  await expect(page.getByTestId("matrix-row-holidayHours")).toHaveCount(0);
  await expect(page.getByTestId("matrix-row-holidayPay")).toHaveCount(0);

  // Geldzeilen sind da, WEIL eine Kraft einen Stundenlohn hat: Grundlohn der
  // Lohn-Kraft = 20 €/h × 8 h = 160,00 €; die Kraft ohne Lohn zeigt "—".
  await expect(page.getByTestId(`matrix-cell-basePay-${wageAssistantId}`)).toContainText("160,00");
  await expect(page.getByTestId(`matrix-cell-basePay-${noWageAssistantId}`)).toHaveText("—");
  await expect(page.getByTestId(`matrix-cell-total-${wageAssistantId}`)).toContainText("€");
  await expect(page.getByTestId(`matrix-cell-total-${noWageAssistantId}`)).toHaveText("—");
  // Zuschlags-Geldzeile der Kraft ohne Lohn ebenfalls "—".
  await expect(page.getByTestId(`matrix-cell-nightPay-${noWageAssistantId}`)).toHaveText("—");

  // Umschalten auf EINE Person + Kartenansicht: Einzelkarte statt Matrix.
  await page.getByTestId("assistant-select").click();
  await page.getByTestId(`assistant-option-${wageAssistantId}`).click();
  await page.getByTestId("view-toggle-cards").click();
  await expect(page.getByTestId(`balance-card-${wageAssistantId}`)).toBeVisible();
  await expect(page.getByTestId(`balance-card-${noWageAssistantId}`)).toHaveCount(0);
  await expect(page.getByTestId("gesamt-auswertung-matrix")).toHaveCount(0);

  // Zurück auf "Alle" + Übersicht: Matrix mit beiden Spalten, Karten weg.
  await page.getByTestId("assistant-select").click();
  await page.getByTestId("assistant-option-all").click();
  await page.getByTestId("view-toggle-matrix").click();
  await expect(page.getByTestId("gesamt-auswertung-matrix")).toBeVisible();
  await expect(page.getByTestId(`matrix-col-${wageAssistantId}`)).toBeVisible();
  await expect(page.getByTestId(`matrix-col-${noWageAssistantId}`)).toBeVisible();
  await expect(page.getByTestId(`balance-card-${wageAssistantId}`)).toHaveCount(0);

  // Klick auf den Spaltenkopf einer Assistenzkraft setzt den Auswahlfilter
  // (derselbe Mechanismus wie das Dropdown): Matrix zeigt nur noch diese
  // Person — kein neues Karten-Layout.
  await page.getByTestId(`matrix-select-${wageAssistantId}`).click();
  await expect(page.getByTestId(`matrix-col-${wageAssistantId}`)).toBeVisible();
  await expect(page.getByTestId(`matrix-col-${noWageAssistantId}`)).toHaveCount(0);
  await expect(page.getByTestId("gesamt-auswertung-matrix")).toBeVisible();
  // Das Dropdown spiegelt die Auswahl wider (Rückweg über "Alle" bleibt sichtbar).
  await expect(page.getByTestId("assistant-select")).toContainText("Lohn");

  // Rückweg: Filter "Alle" im bestehenden Dropdown stellt die Gesamtansicht wieder her.
  await page.getByTestId("assistant-select").click();
  await page.getByTestId("assistant-option-all").click();
  await expect(page.getByTestId(`matrix-col-${wageAssistantId}`)).toBeVisible();
  await expect(page.getByTestId(`matrix-col-${noWageAssistantId}`)).toBeVisible();
});

test("Nachberechnungs-Zeile: nach Abschluss des Vormonats + Aenderung erscheint sie im Folgemonat", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 800 });

  // 1) Vormonat (Zielmonat) einfrieren — Snapshot der aktuellen Lohnauswertung.
  const closeRes = await acc.ctx.post("/api/month-closings", {
    data: { month: TARGET.getMonth() + 1, year: TARGET_YEAR },
  });
  expect(closeRes.status(), `Monatsabschluss fehlgeschlagen (${closeRes.status()})`).toBe(201);

  // 2) NACH dem Abschluss die Schicht der Lohn-Kraft um 1h verlängern
  //    (16 → 17 Uhr): Differenz zum eingefrorenen Stand = Nachberechnung.
  const patchRes = await acc.ctx.patch(`/api/shifts/${wageShiftId}`, {
    data: {
      endTime: `${SHIFT_DAY}T17:00:00.000Z`,
      force: true,
    },
  });
  expect(patchRes.ok(), `Schicht verlängern fehlgeschlagen (${patchRes.status()})`).toBe(true);

  // 3) Matrix des FOLGEMONATS (= aktueller Monat, kein month-prev-Klick):
  //    dort weist die Zeile "Nachberechnung {Vormonat}" die Differenz aus.
  await loginViaUi(page, acc.email, FREE_ACCOUNT_PASSWORD);
  await page.goto("/auswertungen");
  await expect(page.getByRole("heading", { name: "Auswertungen", exact: true })).toBeVisible();
  await page.getByTestId("assistant-select").click();
  await page.getByTestId("assistant-option-all").click();
  await page.getByTestId("view-toggle-matrix").click();
  await expect(page.getByTestId("gesamt-auswertung-matrix")).toBeVisible();

  const recalcRow = page.getByTestId("matrix-row-recalc");
  await expect(recalcRow).toBeVisible();
  await expect(recalcRow).toContainText("Nachberechnung");

  // Lohn-Kraft: positive Differenz (mind. +20,00 € Grundlohn für die
  // Zusatzstunde; je nach Wochentag können Zuschläge dazukommen — daher nur
  // Vorzeichen + Euro prüfen, kein starrer Betrag).
  const wageCell = page.getByTestId(`matrix-cell-recalc-${wageAssistantId}`);
  await expect(wageCell).toContainText("+");
  await expect(wageCell).toContainText("€");
  // Kraft ohne Lohn: keine Geld-Differenz → "—".
  await expect(page.getByTestId(`matrix-cell-recalc-${noWageAssistantId}`)).toHaveText("—");

  // GESAMT-Zeile weist die Einrechnung explizit aus.
  await expect(page.getByTestId("matrix-row-total")).toContainText("inkl. Nachberechnung");
});

test("Mobil: erste Matrix-Spalte sticky, Tabelle horizontal scrollbar", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 800 });
  await openMatrix(page);

  const matrix = page.getByTestId("gesamt-auswertung-matrix");

  // Horizontal scrollbar: der Tabellen-Wrapper (overflow-x-auto) ist auf
  // 390px schmaler als die Tabelle (Kategorie-Spalte + 2×140px-Spalten).
  const scrollable = await matrix
    .locator("div.overflow-x-auto")
    .evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  expect(scrollable, "Matrix-Tabelle muss mobil horizontal scrollbar sein").toBe(true);

  // Erste Spalte sticky: Kopf- UND Zeilen-Header kleben links.
  const headerSticky = await matrix
    .locator("thead th")
    .first()
    .evaluate((el) => getComputedStyle(el).position);
  expect(headerSticky).toBe("sticky");
  const rowHeaderSticky = await page
    .getByTestId("matrix-row-worked")
    .locator("th")
    .evaluate((el) => ({
      position: getComputedStyle(el).position,
      left: getComputedStyle(el).left,
    }));
  expect(rowHeaderSticky.position).toBe("sticky");
  expect(rowHeaderSticky.left).toBe("0px");

  // Sticky wirkt: nach rechts scrollen — der Zeilen-Header bleibt am linken
  // Rand des Wrappers, die Zellen wandern darunter durch.
  await matrix.locator("div.overflow-x-auto").evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  const headerBox = await page.getByTestId("matrix-row-worked").locator("th").boundingBox();
  const wrapperBox = await matrix.locator("div.overflow-x-auto").boundingBox();
  expect(headerBox, "Zeilen-Header muss sichtbar bleiben").toBeTruthy();
  expect(wrapperBox).toBeTruthy();
  expect(Math.abs((headerBox!.x ?? 0) - (wrapperBox!.x ?? 0))).toBeLessThanOrEqual(2);
});
