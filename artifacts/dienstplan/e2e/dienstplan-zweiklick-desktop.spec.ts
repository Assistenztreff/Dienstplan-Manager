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
 * Tageszellen-Klicklogik in der DESKTOP-Monatsgitter-Ansicht (Arbeitsanweisung 3.4).
 *
 * Seit der Arbeitsanweisung 06.08.2026 (Punkt 3.4) wählt der Klick auf Zelle
 * oder Datum den Tag nur aus; der Schicht-Dialog öffnet ausschließlich über
 * das Plus in der Zellen-Kopfzeile (day-add-<iso>). Die frühere
 * Zwei-Stufen-Logik (2. Klick öffnet den Dialog) entfällt. Die mobile
 * Monatsgitter-Ansicht ist in dienstplan-zweiklick-mobil.spec.ts abgedeckt.
 *
 * Deckt ab (Desktop 1280x800):
 * - Admin: Zellenklick markiert nur (1. UND 2. Klick — kein Dialog).
 * - Admin: Plus in der Kopfzeile öffnet den shift-dialog.
 * - Admin: Klick auf einen ANDEREN Tag ist wieder reine Auswahl.
 * - Assistent: Klicks markieren, öffnen NICHTS (kein Dialog).
 *
 * Setup wie in dienstplan-einklick-rollen-desktop.spec.ts: frisches Free-Konto;
 * Assistenten-Login über den Einladungsflow (Owner kurz auf Premium heben,
 * Token ziehen, zurück auf Free — Bestandsschutz hält den Login gültig).
 */

const DESKTOP_VIEWPORT = { width: 1280, height: 800 };

let acc: FreeAccount;
let assistantId: number;
let assistantCtx: APIRequestContext | undefined;

test.beforeAll(async () => {
  // Registrierung + Einladungsflow (2x Plan-Flip) sprengen beim Cold-Start
  // die Standard-Hook-Zeit.
  test.setTimeout(180_000);

  acc = await registerFreeAccount("privat", "zweiklickdesktop");

  const assistantRes = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E Zweiklick Desktop Assistent ${Date.now()}`,
      email: `e2e.zweiklickdesktop.assistent.${Date.now()}@dienstplan.test`,
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
 * Öffnet den Dienstplan im Desktop-Viewport in einem frischen Kontext mit
 * der übergebenen Session und aktiviert das Monatsgitter im DESKTOP-Zweig
 * (Toggle in der Sticky-Kopfzeile, Container dienstplan-desktop).
 */
async function openDesktopCalendar(
  browser: Browser,
  sessionCtx: APIRequestContext,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({
    storageState: await sessionCtx.storageState(),
    viewport: DESKTOP_VIEWPORT,
  });
  const page = await context.newPage();
  await page.goto("/dienstplan");
  await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();

  // Monatsgitter erzwingen (explizit gegen localStorage-Drift aus
  // Nachbar-Specs; Standard ist zwar "grid", aber sessionübergreifend
  // gespeicherte Listenansicht würde den Spec sonst leerlaufen lassen).
  const gridToggle = page.getByTestId("view-toggles-desktop").getByTestId("view-toggle-grid");
  await gridToggle.click();
  await expect(gridToggle).toHaveAttribute("data-active", "true");
  await expect(page.getByTestId("dienstplan-desktop").getByTestId("month-grid")).toBeVisible();

  return { page, close: () => context.close() };
}

test("Desktop-Monatsgitter (Admin): Zellenklick markiert nur, Plus öffnet den Schicht-Dialog", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { year, month1, dayA, dayB } = pickTargetDays();
  const { page, close } = await openDesktopCalendar(browser, acc.ctx);
  try {
    const desktop = page.getByTestId("dienstplan-desktop");
    const dialog = page.getByTestId("shift-dialog");

    // --- Klick auf Zelle/Datum: Tag wird markiert, KEIN Dialog (3.4). ---
    const cellA = desktop.getByTestId(dayCellId(year, month1, dayA));
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
    await desktop
      .getByTestId(dayCellId(year, month1, dayA).replace("day-cell-", "day-add-"))
      .click();
    await expect(dialog, "Das Plus muss den Schicht-Dialog öffnen").toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    // --- Gegenprobe: Klick auf einen ANDEREN Tag ist wieder Stufe 1. ---
    const cellB = desktop.getByTestId(dayCellId(year, month1, dayB));
    await cellB.click();
    await expect(cellB).toHaveAttribute("data-selected", "true");
    await expect(cellA).toHaveAttribute("data-selected", "false");
    await expect(dialog, "Wechsel auf einen anderen Tag ist Stufe 1 — kein Dialog").toHaveCount(0);
  } finally {
    await close();
  }
});

test("Desktop-Monatsgitter (Assistent): 1. Klick markiert, 2. Klick öffnet NICHTS", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  if (!assistantCtx) throw new Error("Assistenten-Kontext nicht initialisiert");
  const { year, month1, dayA } = pickTargetDays();
  const { page, close } = await openDesktopCalendar(browser, assistantCtx);
  try {
    const desktop = page.getByTestId("dienstplan-desktop");
    const dialog = page.getByTestId("shift-dialog");

    // --- 1. Klick: Auswahl funktioniert auch für Assistenten. ---
    const cell = desktop.getByTestId(dayCellId(year, month1, dayA));
    await cell.click();
    await expect(cell).toHaveAttribute("data-selected", "true");
    // Seit der UI-Vereinheitlichung (26.08.2026) engt die Zellenauswahl die
    // Wochen-Liste NICHT mehr ein (Standard-Zeitraum bleibt „Dieser Monat") —
    // die Zeile des gewählten Tages bekommt stattdessen den Anker-Rahmen.
    // Anker-Zeile in der Wochen-Liste wird hier bewusst NICHT geprueft
    // (korrigiert 01.09.2026): Fuer Assistenzkraefte blendet die Liste leere
    // Tage aus (hideEmptyDays in schedule-list.tsx haengt an canEdit), und
    // dieser Tag traegt absichtlich keine Schicht. Die Zeile kann es also
    // gar nicht geben. Der Anker ist durch die beiden Tests weiter unten
    // abgedeckt, die vorher eine Schicht anlegen.
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

/** Legt eine Mittags-Schicht (UTC, zeitzonensicher) für den Assistenten an. */
async function seedShiftOn(day: { year: number; month1: number; dayA: number }): Promise<number> {
  const mm = String(day.month1).padStart(2, "0");
  const dd = String(day.dayA).padStart(2, "0");
  const shiftRes = await acc.ctx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "active",
      startTime: `${day.year}-${mm}-${dd}T10:00:00.000Z`,
      endTime: `${day.year}-${mm}-${dd}T16:00:00.000Z`,
    },
  });
  expect(shiftRes.ok(), "Seed-Schicht anlegen fehlgeschlagen").toBe(true);
  return ((await shiftRes.json()) as { id: number }).id;
}

test("Desktop-Tagesleiste (Admin): Zeile ist per Tastatur erreichbar und öffnet mit Enter den Dialog", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const target = pickTargetDays();
  const shiftId = await seedShiftOn(target);
  const { page, close } = await openDesktopCalendar(browser, acc.ctx);
  try {
    const desktop = page.getByTestId("dienstplan-desktop");
    // Klick oben links aufs Datum — die Pillen dürfen den Klick nicht abfangen.
    await desktop.getByTestId(dayCellId(target.year, target.month1, target.dayA)).click({
      position: { x: 8, y: 8 },
    });
    // Wochen-Liste ist seit der UI-Vereinheitlichung (26.08.2026) ein
    // globaler Singleton (nicht mehr desktop-gescopt).
    const row = page.getByTestId(`shift-badge-${shiftId}`);
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute("role", "button");
    await row.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByTestId("shift-dialog"),
      "Enter auf der Zeile muss den Schicht-Dialog öffnen",
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("shift-dialog")).toHaveCount(0);
  } finally {
    await close();
    await acc.ctx.delete(`/api/shifts/${shiftId}`);
  }
});

test("Desktop-Tagesleiste (Assistent): Name sichtbar, Zeile ohne Bearbeitungsrecht nicht klickbar", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  if (!assistantCtx) throw new Error("Assistenten-Kontext nicht initialisiert");
  const actx = assistantCtx;
  const target = pickTargetDays();
  const shiftId = await seedShiftOn(target);
  const { page, close } = await openDesktopCalendar(browser, actx);
  try {
    const desktop = page.getByTestId("dienstplan-desktop");
    await desktop.getByTestId(dayCellId(target.year, target.month1, target.dayA)).click({
      position: { x: 8, y: 8 },
    });
    // Wochen-Liste ist seit der UI-Vereinheitlichung (26.08.2026) ein
    // globaler Singleton (nicht mehr desktop-gescopt).
    const row = page.getByTestId(`shift-badge-${shiftId}`);
    await expect(row).toBeVisible();
    // Der Name gehört zum Zeilen-Layout — auch ohne Bearbeitungsrecht.
    await expect(row).toContainText("Zweiklick Desktop Assistent");
    // Aber ohne Bearbeitungsrecht ist die Zeile kein interaktives Element.
    await expect(row).not.toHaveAttribute("role", "button");
  } finally {
    await close();
    await acc.ctx.delete(`/api/shifts/${shiftId}`);
  }
});
