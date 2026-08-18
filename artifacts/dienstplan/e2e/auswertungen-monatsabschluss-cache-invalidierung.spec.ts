import {
  test,
  expect,
} from "@playwright/test";
import {
  registerFreeAccount,
  setAccountPlan,
  deleteFreeAccount,
  FREE_ACCOUNT_PASSWORD,
  type FreeAccount,
} from "./helpers/teams";

/**
 * Regressionstest: Nach einem Monatsabschluss (und nach "Erneut abschließen")
 * zeigt die Auswertungsseite OHNE manuellen Reload den aktuellen Stundenstand.
 *
 * Bug-Szenario (behoben in MonthClosingCard.doClose()):
 *   doClose() invalidierte nur getGetMonthClosingsQueryKey /
 *   getGetMonthClosingDiffQueryKey, NICHT getGetHoursBalanceQueryKey.
 *   Dadurch blieb der React-Query-Cache der Auswertungen unverändert — selbst
 *   wenn die DB inzwischen andere Daten hatte.
 *
 * Testmethode: "Staler Cache vs. Realität"
 *   Schritt 1: Seite lädt; Cache zeigt aktuellen DB-Stand (Ausgangswert A).
 *   Schritt 2: DB wird via API geändert, OHNE Seiten-Reload → Cache veraltet.
 *   Schritt 3: Monatsabschluss über UI → doClose() → Invalidierung.
 *   Mit Fix:    Cache wird invalidiert, Refetch → UI zeigt neuen Stand B.
 *   Ohne Fix:   Cache bleibt stale → UI zeigt weiterhin veralteten Stand A.
 *
 * Konkret (Matrix-Ansicht, Zelle data-testid="matrix-cell-worked-{userId}"):
 *   Test 1 – Erstabschluss:
 *     A = "0 / 0 h" (kein Shift), Shift hinzufügen (stale), abschließen →
 *     UI zeigt ≠ "0 / 0 h" (tatsächliche Stunden).
 *   Test 2 – Erneuter Abschluss:
 *     A = tatsächliche Stunden aus Test 1, Shift löschen (stale), erneut
 *     abschließen → UI zeigt "0 / 0 h" (Schicht nicht mehr im DB).
 *
 * Wichtig: Kein Vertrag angelegt.  computeHoursBalances() gibt für jeden
 * aktiven Assistenten (team member, role=assistant) immer eine Zeile zurück —
 * auch mit 0 Stunden.  Die GesamtAuswertungMatrix rendert data-testid=
 * "matrix-cell-worked-{userId}" mit "{valuedHours} / {plannedHours} h".
 */

// Vormonat: liegt immer in der Vergangenheit → abschließbar.
const NOW = new Date();
const TARGET = new Date(NOW.getFullYear(), NOW.getMonth() - 1, 1);
const TARGET_YEAR = TARGET.getFullYear();
const TARGET_MONTH = TARGET.getMonth() + 1;
// 10. des Vormonats: kein bundesweiter Feiertag, kein Sonntag im Regelfall.
const SHIFT_DAY = `${TARGET_YEAR}-${String(TARGET_MONTH).padStart(2, "0")}-10`;

// Desktop-Viewport: MonthClosingCard + Matrix-Ansicht stets sichtbar.
test.use({ viewport: { width: 1280, height: 800 } });
// Seriell: Test 2 baut auf dem Zustand von Test 1 auf (Schicht + Erstabschluss).
test.describe.configure({ mode: "serial" });
test.setTimeout(60_000);

let acc: FreeAccount;
let assistantId: number;
// Wird in Test 1 gesetzt, in Test 2 per API gelöscht.
let shiftId: number | null = null;

test.beforeAll(async () => {
  // Frisches Premium-Konto — hours-balance und Monatsabschluss sind
  // advancedAnalytics-gegated (Premium-only).
  acc = await registerFreeAccount("privat", "close-cache");
  await setAccountPlan(acc.email, "premium");

  // Assistent ohne Vertrag, ohne Schicht anlegen: computeHoursBalances()
  // gibt ihn mit valuedHours=0, plannedHours=0 zurück (team member, active).
  // In der Matrix-Zelle "matrix-cell-worked-{id}" erscheint "0 / 0 h".
  const unique = Date.now();
  const userRes = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E CloseCache ${unique}`,
      email: `e2e.closecache.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(userRes.ok(), `Assistent anlegen fehlgeschlagen (${userRes.status()})`).toBe(true);
  assistantId = ((await userRes.json()) as { id: number }).id;
});

test.afterAll(async () => {
  // shiftId kann in Test 2 bereits gelöscht worden sein → ignorieren.
  if (shiftId) await acc.ctx.delete(`/api/shifts/${shiftId}`).catch(() => {});
  if (assistantId) await acc.ctx.delete(`/api/users/${assistantId}`).catch(() => {});
  await deleteFreeAccount(acc);
});

test("Erstabschluss: gecachte 0-Stunden werden durch Invalidierung sofort auf tatsaechliche Stunden aktualisiert", async ({
  page,
}) => {
  // 1. Einloggen (page.request teilt den Cookie-Jar mit dem Browser).
  const loginRes = await page.request.post("/api/auth/login", {
    data: { email: acc.email, password: FREE_ACCOUNT_PASSWORD },
  });
  expect(loginRes.ok(), `Login fehlgeschlagen (${loginRes.status()})`).toBe(true);

  await page.goto("/auswertungen");
  await expect(page.getByRole("heading", { name: "Auswertungen", exact: true })).toBeVisible();

  // 2. In Zielmonat (Vormonat) navigieren.
  await page.getByTestId("month-prev").click();

  // 3. Ausgangswert prüfen: Assistent hat noch keinen Shift → "0 / 0 h".
  //    computeHoursBalances() gibt die Zeile zurück, weil der Assistent team
  //    member ist (auch ohne Vertrag / Schicht). Matrix-Zelle ist sofort da.
  //    "worked"-Zeile: data-testid="matrix-cell-worked-{userId}"
  //    render: `${b.valuedHours} / ${b.plannedHours} h`
  const cell = page.getByTestId(`matrix-cell-worked-${assistantId}`);
  await expect(cell).toBeVisible({ timeout: 10_000 });
  await expect(cell).toHaveText("0 / 0 h");

  // 4. FIX-Schicht NACHTRÄGLICH via API anlegen — KEIN Seiten-Reload.
  //    Der React-Query-Cache weiß noch nichts davon (Ausgangswert bleibt stale).
  const shiftRes = await page.request.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "active",
      planningStatus: "FIX",
      force: true,
      startTime: new Date(`${SHIFT_DAY}T08:00:00`).toISOString(),
      endTime: new Date(`${SHIFT_DAY}T16:00:00`).toISOString(),
    },
  });
  expect(shiftRes.status(), `Schicht anlegen fehlgeschlagen (${shiftRes.status()})`).toBe(201);
  shiftId = ((await shiftRes.json()) as { id: number }).id;

  // 5. Vor dem Abschluss: Cache ist stale — Zelle zeigt immer noch "0 / 0 h".
  //    Beweist: die Änderung kann danach NUR durch Invalidierung sichtbar werden.
  await expect(cell).toHaveText("0 / 0 h");

  // 6. Monatsabschluss über UI: Knopf → Bestätigungs-Dialog → Abschließen.
  await expect(page.getByTestId("month-closing-card")).toBeVisible();
  await page.getByTestId("month-closing-button").click();
  await expect(page.getByTestId("month-closing-confirm")).toBeVisible();
  await page.getByTestId("month-closing-confirm").click();

  // 7. Kernassertion: Zelle zeigt NICHT mehr "0 / 0 h" — der Cache wurde durch
  //    getGetHoursBalanceQueryKey-Invalidierung sofort erneuert und zeigt die
  //    tatsächlichen Stunden der neuen Schicht (valuedHours > 0).
  //    Ohne den Fix: Zelle zeigt weiter "0 / 0 h" (staler Cache).
  await expect(cell).not.toHaveText("0 / 0 h", { timeout: 10_000 });

  // 8. Abschlussstatus prüfen.
  await expect(page.getByTestId("month-closing-status")).toContainText("Monat abgeschlossen");
});

test("Erneuter Abschluss: gecachte Stunden werden durch Invalidierung sofort auf 0 zurueckgesetzt", async ({
  page,
}) => {
  // Voraussetzung: Schicht + Erstabschluss aus Test 1.
  expect(shiftId, "Schicht-ID aus Test 1 fehlt — Serienmodus prüfen").toBeTruthy();

  const loginRes = await page.request.post("/api/auth/login", {
    data: { email: acc.email, password: FREE_ACCOUNT_PASSWORD },
  });
  expect(loginRes.ok(), `Login fehlgeschlagen (${loginRes.status()})`).toBe(true);

  await page.goto("/auswertungen");
  await expect(page.getByRole("heading", { name: "Auswertungen", exact: true })).toBeVisible();
  await page.getByTestId("month-prev").click();

  // 1. Ausgangswert: Schicht aus Test 1 → tatsächliche Stunden sichtbar (≠ "0 / 0 h").
  const cell = page.getByTestId(`matrix-cell-worked-${assistantId}`);
  await expect(cell).toBeVisible({ timeout: 10_000 });
  await expect(cell).not.toHaveText("0 / 0 h");
  // Button lautet "Erneut abschließen" (Monat ist bereits abgeschlossen).
  await expect(page.getByTestId("month-closing-button")).toContainText("Erneut abschließen");

  // 2. Schicht NACHTRÄGLICH per API löschen — KEIN Seiten-Reload.
  //    Cache ist stale: zeigt weiterhin die Stunden aus Test 1.
  const delRes = await page.request.delete(`/api/shifts/${shiftId!}`);
  expect(delRes.ok(), `Schicht löschen fehlgeschlagen (${delRes.status()})`).toBe(true);
  shiftId = null;

  // 3. Vor dem erneuten Abschluss: Cache ist stale — Zelle zeigt noch alte Stunden.
  await expect(cell).not.toHaveText("0 / 0 h");

  // 4. Erneut abschließen: Warnmeldung + Bestätigung.
  await page.getByTestId("month-closing-button").click();
  await expect(page.getByTestId("month-closing-reclose-warning")).toBeVisible();
  await page.getByTestId("month-closing-confirm").click();

  // 5. Kernassertion: Zelle zeigt "0 / 0 h" — der Cache wurde durch
  //    getGetHoursBalanceQueryKey-Invalidierung sofort erneuert.
  //    Die gelöschte Schicht ist aus der Auswertung verschwunden.
  //    Ohne den Fix: Zelle zeigt weiter die alten Stunden (staler Cache).
  await expect(cell).toHaveText("0 / 0 h", { timeout: 10_000 });

  // 6. Abschlussstatus bleibt "abgeschlossen".
  await expect(page.getByTestId("month-closing-status")).toContainText("Monat abgeschlossen");
});
