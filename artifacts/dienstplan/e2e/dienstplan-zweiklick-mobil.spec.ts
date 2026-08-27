import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type Browser,
  type Page,
} from "@playwright/test";
import {
  registerFreeAccount,
  deleteFreeAccount,
  setAccountPlan,
  BASE_URL,
  type FreeAccount,
} from "./helpers/teams";

/**
 * Tageszellen-Klicklogik in der MOBILEN Monatsgitter-Ansicht (Arbeitsanweisung 3.4).
 *
 * Seit der Arbeitsanweisung 06.08.2026 (Punkt 3.4) wählt der Klick auf Zelle
 * oder Datum den Tag nur aus; der Schicht-Dialog öffnet ausschließlich über
 * das Plus in der Zellen-Kopfzeile (day-add-<iso>). Die frühere
 * Zwei-Stufen-Logik (2. Klick öffnet den Dialog) entfällt. Die Desktop-
 * Monatsgitter-Ansicht ist in dienstplan-zweiklick-desktop.spec.ts abgedeckt.
 * Mobil startet das Monatsraster eingeklappt (Mini-Balken, Punkt 3.3) — die
 * Kopfzeile mit Datum links und Plus rechts gilt dort genauso.
 *
 * Deckt ab (mobil 400px):
 * - Admin: Zellenklick markiert nur (1. UND 2. Klick — kein Dialog).
 * - Admin: Plus in der Kopfzeile öffnet den shift-dialog.
 * - Admin: Klick auf einen ANDEREN Tag ist wieder reine Auswahl.
 * - Assistent: Klicks markieren, öffnen NICHTS (kein Dialog).
 *
 * Setup wie in dienstplan-zweiklick-desktop.spec.ts: frisches Free-Konto;
 * Assistenten-Login über den Einladungsflow (Owner kurz auf Premium heben,
 * Token ziehen, zurück auf Free — Bestandsschutz hält den Login gültig).
 */

const MOBILE_VIEWPORT = { width: 400, height: 700 };

let acc: FreeAccount;
let assistantId: number;
let assistantCtx: APIRequestContext | undefined;

test.beforeAll(async () => {
  // Registrierung + Einladungsflow (2x Plan-Flip) sprengen beim Cold-Start
  // die Standard-Hook-Zeit.
  test.setTimeout(180_000);

  acc = await registerFreeAccount("privat", "zweiklickmobil");

  const assistantRes = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E Zweiklick Mobil Assistent ${Date.now()}`,
      email: `e2e.zweiklickmobil.assistent.${Date.now()}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(assistantRes.ok(), "Anlegen des Assistenten fehlgeschlagen").toBe(true);
  assistantId = ((await assistantRes.json()) as { id: number }).id;

  // Assistenten-Login über den Einladungsflow (siehe Spec-Kopf).
  await setAccountPlan(acc.email, "premium");
  let token = "";
  try {
    const inviteRes = await acc.ctx.post(`/api/users/${assistantId}/invite`);
    expect(inviteRes.ok(), `Einladung sollte mit Premium klappen (${inviteRes.status()})`).toBe(true);
    token = ((await inviteRes.json()) as { token: string }).token;
    expect(token, "Einladungs-Token muss geliefert werden").toBeTruthy();
  } finally {
    await setAccountPlan(acc.email, "free");
  }

  assistantCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const setPwRes = await assistantCtx.post("/api/auth/set-password", {
    data: { token, password: "assistent1234" },
  });
  expect(setPwRes.ok(), `set-password sollte 200 liefern (${setPwRes.status()})`).toBe(true);
  const me = await assistantCtx.get("/api/auth/me");
  expect(me.ok(), "Assistent muss nach set-password eingeloggt sein").toBe(true);
  const meBody = (await me.json()) as { id: number; role: string };
  expect(meBody.id).toBe(assistantId);
  expect(meBody.role, "Session muss die Assistenten-Rolle tragen").toBe("assistant");
});

test.afterAll(async () => {
  await assistantCtx?.dispose();
  await deleteFreeAccount(acc);
});

/** data-testid der Tageszelle des angezeigten Monats. */
function dayCellId(year: number, month1: number, day: number): string {
  return `day-cell-${year}-${String(month1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Zwei Zieltage im aktuellen Monat, die garantiert NICHT "heute" sind —
 * die Tagesauswahl startet auf dem heutigen Tag, ein erster Klick darauf
 * wäre also bereits der "2. Klick".
 */
function pickTargetDays(): { year: number; month1: number; dayA: number; dayB: number } {
  const now = new Date();
  const today = now.getDate();
  const candidates = [10, 15, 20, 5, 25].filter((d) => d !== today);
  return {
    year: now.getFullYear(),
    month1: now.getMonth() + 1,
    dayA: candidates[0],
    dayB: candidates[1],
  };
}

/**
 * Öffnet den Dienstplan in einem frischen mobilen Kontext mit der übergebenen
 * Session und stellt sicher, dass die mobile Monatsgitter-Ansicht steht.
 */
async function openMobileCalendar(
  browser: Browser,
  sessionCtx: APIRequestContext,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({
    storageState: await sessionCtx.storageState(),
    viewport: MOBILE_VIEWPORT,
  });
  const page = await context.newPage();
  await page.goto("/dienstplan");
  await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();

  // Monatsgitter erzwingen (explizit gegen localStorage-Drift aus
  // Nachbar-Specs; Standard ist zwar "grid", aber sessionübergreifend
  // gespeicherte Listenansicht würde den Spec sonst leerlaufen lassen).
  const gridToggle = page.getByTestId("view-toggles-mobile").getByTestId("view-toggle-grid");
  await gridToggle.click();
  await expect(gridToggle).toHaveAttribute("data-active", "true");
  await expect(page.getByTestId("dienstplan-mobile").getByTestId("month-grid")).toBeVisible();

  return { page, close: () => context.close() };
}

test("Mobil (Admin): Zellenklick markiert nur, Plus öffnet den Schicht-Dialog", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { year, month1, dayA, dayB } = pickTargetDays();
  const { page, close } = await openMobileCalendar(browser, acc.ctx);
  try {
    const mobile = page.getByTestId("dienstplan-mobile");
    const dialog = page.getByTestId("shift-dialog");

    // --- Klick auf Zelle/Datum: Tag wird markiert, KEIN Dialog (3.4). ---
    const cellA = mobile.getByTestId(dayCellId(year, month1, dayA));
    await cellA.click();
    await expect(cellA).toHaveAttribute("data-selected", "true");
    // Seit der UI-Vereinheitlichung (26.08.2026) engt die Zellenauswahl die
    // Wochen-Liste NICHT mehr ein (Standard-Zeitraum bleibt „Dieser Monat") —
    // die Zeile des gewählten Tages bekommt stattdessen den Anker-Rahmen.
    await expect(page.getByTestId(dayCellId(year, month1, dayA).replace("day-cell-", "agenda-day-"))).toHaveAttribute("data-anchor", "true");
    await expect(dialog, "Der Zellenklick darf keinen Dialog öffnen (3.4)").toHaveCount(0);

    // --- Auch der 2. Klick auf den markierten Tag bleibt reine Auswahl. ---
    await cellA.click();
    await expect(dialog, "Nur das Plus legt an — kein Dialog beim 2. Klick").toHaveCount(0);

    // --- Plus in der Zellen-Kopfzeile öffnet den Schicht-Dialog. ---
    await mobile
      .getByTestId(dayCellId(year, month1, dayA).replace("day-cell-", "day-add-"))
      .click();
    await expect(dialog, "Das Plus muss den Schicht-Dialog öffnen").toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    // --- Gegenprobe: Klick auf einen ANDEREN Tag ist wieder Stufe 1. ---
    const cellB = mobile.getByTestId(dayCellId(year, month1, dayB));
    await cellB.click();
    await expect(cellB).toHaveAttribute("data-selected", "true");
    await expect(cellA).toHaveAttribute("data-selected", "false");
    await expect(dialog, "Wechsel auf einen anderen Tag ist Stufe 1 — kein Dialog").toHaveCount(0);
  } finally {
    await close();
  }
});

test("Mobil (Assistent): 1. Klick markiert, 2. Klick öffnet NICHTS", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  if (!assistantCtx) throw new Error("Assistenten-Kontext nicht initialisiert");
  const { year, month1, dayA } = pickTargetDays();
  const { page, close } = await openMobileCalendar(browser, assistantCtx);
  try {
    const mobile = page.getByTestId("dienstplan-mobile");
    const dialog = page.getByTestId("shift-dialog");

    // --- 1. Klick: Auswahl funktioniert auch für Assistenten. ---
    const cell = mobile.getByTestId(dayCellId(year, month1, dayA));
    await cell.click();
    await expect(cell).toHaveAttribute("data-selected", "true");
    // Seit der UI-Vereinheitlichung (26.08.2026) engt die Zellenauswahl die
    // Wochen-Liste NICHT mehr ein (Standard-Zeitraum bleibt „Dieser Monat") —
    // die Zeile des gewählten Tages bekommt stattdessen den Anker-Rahmen.
    await expect(page.getByTestId(dayCellId(year, month1, dayA).replace("day-cell-", "agenda-day-"))).toHaveAttribute("data-anchor", "true");
    await expect(dialog).toHaveCount(0);

    // --- 2. Klick: darf für Assistenten KEINEN Dialog öffnen. ---
    await cell.click();
    // Kurz warten, damit ein fälschlich geöffneter Dialog sicher auffiele
    // (der Dialog erscheint bei Admins unmittelbar nach dem Klick).
    await page.waitForTimeout(750);
    await expect(
      dialog,
      "Der 2. Klick darf für Assistenten keinen Schicht-Dialog öffnen",
    ).toHaveCount(0);
    // Auswahl bleibt bestehen — der Klick "verpufft" folgenlos.
    await expect(cell).toHaveAttribute("data-selected", "true");
  } finally {
    await close();
  }
});
