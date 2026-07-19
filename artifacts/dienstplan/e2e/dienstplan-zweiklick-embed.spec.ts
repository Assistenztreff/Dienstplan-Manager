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
 * Zwei-Stufen-Klick im EMBED-MODUS (?embed=1, iframe-Einbettung in die
 * AssistenzTreff-Plattform).
 *
 * Der Zwei-Stufen-Klick (1. Klick markiert den Tag, 2. Klick auf den bereits
 * markierten Tag öffnet als Admin den Schicht-Dialog) ist in den normalen
 * UI-Specs abgedeckt — aber NICHT im Embed-Modus, in dem das Layout anders
 * aufgebaut ist (kein Plattform-Header/-Footer, deutlich weniger Höhe) und in
 * dem echte eingebettete Nutzer landen.
 *
 * Deckt ab (mobil 400px, Embed-typisch nur 460px Höhe — siehe
 * dienstplan-sticky-kopfzeile-embed.spec.ts):
 * - Admin: 1. Klick markiert nur (kein Dialog), 2. Klick öffnet shift-dialog.
 * - Assistent: 1. Klick markiert, 2. Klick öffnet NICHTS (kein Dialog).
 * - Beides mit aktivem Embed-Modus (platform-header fehlt im DOM).
 *
 * Setup wie in dienstplan-einklick-rollen-desktop.spec.ts: frisches
 * Free-Konto; Assistenten-Login über den Einladungsflow (Owner kurz auf
 * Premium heben, Token ziehen, zurück auf Free — Bestandsschutz hält den
 * Login gültig).
 */

// Embed-typischer, knapper Mobil-Viewport (Plattform-Header + Browser-Chrome
// nehmen dem iframe erheblich Höhe weg). Playwright scrollt Zellen bei Bedarf
// selbst in den Sichtbereich.
const EMBED_MOBILE_VIEWPORT = { width: 400, height: 460 };

let acc: FreeAccount;
let assistantId: number;
let assistantCtx: APIRequestContext | undefined;

test.beforeAll(async () => {
  // Registrierung + Einladungsflow (2x Plan-Flip) sprengen beim Cold-Start
  // die Standard-Hook-Zeit.
  test.setTimeout(180_000);

  acc = await registerFreeAccount("privat", "zweiklickembed");

  const assistantRes = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E Zweiklick Embed Assistent ${Date.now()}`,
      email: `e2e.zweiklickembed.assistent.${Date.now()}@dienstplan.test`,
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
 * Öffnet den Dienstplan mit ?embed=1 in einem frischen Kontext mit der
 * übergebenen Session und stellt sicher, dass der Embed-Modus wirklich aktiv
 * ist (Plattform-Header-Platzhalter fehlt) und die mobile Monatsansicht steht.
 */
async function openEmbeddedCalendar(
  browser: Browser,
  sessionCtx: APIRequestContext,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({
    storageState: await sessionCtx.storageState(),
    viewport: EMBED_MOBILE_VIEWPORT,
  });
  const page = await context.newPage();
  await page.goto("/dienstplan?embed=1");
  await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();

  // Embed-Modus aktiv: Plattform-Header-Platzhalter ist NICHT im DOM.
  await expect(page.getByTestId("platform-header")).toHaveCount(0);

  // Monatsgitter erzwingen (explizit gegen localStorage-Drift aus
  // Nachbar-Specs; Standard ist zwar "grid", aber sessionübergreifend
  // gespeicherte Listenansicht würde den Spec sonst leerlaufen lassen).
  const gridToggle = page.getByTestId("view-toggles-mobile").getByTestId("view-toggle-grid");
  await gridToggle.click();
  await expect(gridToggle).toHaveAttribute("data-active", "true");
  await expect(page.getByTestId("dienstplan-mobile").getByTestId("month-grid")).toBeVisible();

  return { page, close: () => context.close() };
}

test("Embed-Modus (Admin, mobil): 1. Klick markiert nur, 2. Klick öffnet den Schicht-Dialog", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { year, month1, dayA, dayB } = pickTargetDays();
  const { page, close } = await openEmbeddedCalendar(browser, acc.ctx);
  try {
    const mobile = page.getByTestId("dienstplan-mobile");
    const dialog = page.getByTestId("shift-dialog");

    // --- 1. Klick: Tag wird markiert, KEIN Dialog. ---
    const cellA = mobile.getByTestId(dayCellId(year, month1, dayA));
    await cellA.click();
    await expect(cellA).toHaveAttribute("data-selected", "true");
    await expect(mobile.getByTestId("day-detail-header")).toContainText(`${dayA}.`);
    await expect(dialog, "Der 1. Klick darf noch keinen Dialog öffnen").toHaveCount(0);

    // --- 2. Klick auf den bereits markierten Tag: Dialog öffnet sich. ---
    await cellA.click();
    await expect(dialog, "Der 2. Klick muss als Admin den Schicht-Dialog öffnen").toBeVisible();
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

test("Embed-Modus (Assistent, mobil): 1. Klick markiert, 2. Klick öffnet NICHTS", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  if (!assistantCtx) throw new Error("Assistenten-Kontext nicht initialisiert");
  const { year, month1, dayA } = pickTargetDays();
  const { page, close } = await openEmbeddedCalendar(browser, assistantCtx);
  try {
    const mobile = page.getByTestId("dienstplan-mobile");
    const dialog = page.getByTestId("shift-dialog");

    // --- 1. Klick: Auswahl funktioniert auch für Assistenten. ---
    const cell = mobile.getByTestId(dayCellId(year, month1, dayA));
    await cell.click();
    await expect(cell).toHaveAttribute("data-selected", "true");
    await expect(mobile.getByTestId("day-detail-header")).toContainText(`${dayA}.`);
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
