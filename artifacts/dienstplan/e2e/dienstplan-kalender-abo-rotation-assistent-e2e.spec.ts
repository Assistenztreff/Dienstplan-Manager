import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import {
  BASE_URL,
  deleteFreeAccount,
  registerFreeAccount,
  setAccountPlan,
  type FreeAccount,
} from "./helpers/teams";

/**
 * End-to-End-Beweis (Task #390): Das ERNEUERN (Rotieren) des Kalender-Abo-Links
 * macht die ALTE Feed-URL SOFORT ungültig — der Kern des Widerruf-Features.
 * Task #389 beweist bereits, dass Erstellen + Nutzen des Links funktioniert;
 * hier schließen wir die Lücke, dass eine geleakte URL nach dem Klick auf
 * Link erneuern (`calendar-feed-rotate`) wirklich tot ist.
 *
 * Ablauf (Assistent mit PREMIUM-Arbeitgeber, wie in der Aufgabe gefordert):
 * 1. Assistent erstellt den Abo-Link über die UI (`calendar-feed-create`).
 * 2. Ein unauthentifizierter Kontext (wie eine Kalender-App) ruft den Feed ab
 *    → 200, enthält die eigene FIX-Schicht.
 * 3. Assistent klickt „Link erneuern" (`calendar-feed-rotate`) — echter
 *    Frontend-Pfad (POST /api/calendar-token ersetzt den Token).
 * 4. Die ALTE URL liefert jetzt 404 (unbekannter Token) — sofortiger Widerruf.
 * 5. Die NEUE URL liefert 200 mit DERSELBEN Schicht (gleicher Inhalt, nur
 *    neuer Token).
 *
 * Läuft gegen den isolierten Test-Stack (eigener API + Vite auf der `_test`-DB).
 */

/** Liefert einen Tag des aktuellen Monats (robust gegen Monatslängen). */
function currentMonthDay(day: number): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}-${String(day).padStart(2, "0")}`;
}

let admin: FreeAccount;
let assistantCtx: APIRequestContext | undefined;
let assistantId = 0;
/** Unauthentifizierter Kontext — simuliert einen Kalender-Client ohne Cookies. */
let publicCtx: APIRequestContext;
/** ID der eigenen FIX-Schicht, die in beiden Feeds (alt/neu) stecken muss. */
let ownShiftId = 0;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  admin = await registerFreeAccount("privat", "kal-rotate");
  // Manuelle Premium-Freischaltung direkt in der Test-DB (wie im Operator-
  // Dashboard) — Einladen + Kalender-Token sind Premium-Features.
  setAccountPlan(admin.email, "premium");

  publicCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });

  const unique = Date.now();

  // --- Assistent (der Abonnent) mit einer FIX-Schicht -----------------------
  const assistantRes = await admin.ctx.post("/api/users", {
    data: {
      name: `E2E KalRotate Assistent ${unique}`,
      email: `e2e.kalrotate.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(assistantRes.status(), "Assistent anlegen sollte 201 liefern").toBe(201);
  assistantId = ((await assistantRes.json()) as { id: number }).id;

  // FIX-Schicht (Spalten-Default der API ist FIX; nur FIX landet im ICS).
  const shiftRes = await admin.ctx.post("/api/shifts", {
    data: {
      userId: assistantId,
      startTime: `${currentMonthDay(14)}T08:00:00.000Z`,
      endTime: `${currentMonthDay(14)}T16:00:00.000Z`,
      type: "active",
    },
  });
  expect(shiftRes.status(), "Schicht sollte 201 liefern").toBe(201);
  const shift = (await shiftRes.json()) as { id: number; planningStatus: string };
  expect(shift.planningStatus, "Schicht muss FIX sein").toBe("FIX");
  ownShiftId = shift.id;

  // --- Assistent per Einladungsflow einloggen (Invite ist Premium;
  // set-password meldet direkt an). Der Assistent selbst bleibt „free". ------
  const inviteRes = await admin.ctx.post(`/api/users/${assistantId}/invite`);
  expect(inviteRes.ok(), `Einladung sollte mit Premium klappen (${inviteRes.status()})`).toBe(true);
  const inviteToken = ((await inviteRes.json()) as { token: string }).token;
  expect(inviteToken, "Einladungs-Token muss geliefert werden").toBeTruthy();

  assistantCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const setPwRes = await assistantCtx.post("/api/auth/set-password", {
    data: { token: inviteToken, password: "assistent1234" },
  });
  expect(setPwRes.ok(), `set-password sollte 200 liefern (${setPwRes.status()})`).toBe(true);
  const me = await assistantCtx.get("/api/auth/me");
  expect(me.ok(), "Assistent muss nach set-password eingeloggt sein").toBe(true);
  const meBody = (await me.json()) as { id: number; role: string };
  expect(meBody.id).toBe(assistantId);
  expect(meBody.role, "Session muss die Assistenten-Rolle tragen").toBe("assistant");
});

test.afterAll(async () => {
  // deleteFreeAccount entfernt Konto + Standard-Team + team-gebundene Daten
  // inkl. der angelegten Assistenten (verwaiste Assistenten werden mitgelöscht).
  await deleteFreeAccount(admin);
  for (const ctx of [assistantCtx, publicCtx]) {
    try {
      await ctx?.dispose();
    } catch {
      /* ignore */
    }
  }
});

/**
 * Übernimmt die Session-Cookies des per Einladung eingeloggten Assistenten in
 * den Browser-Kontext, damit die App als DIESER Assistent bootstrappt und NICHT
 * das Dev-Auto-Login (Premium-Seed-Admin) auslöst.
 */
async function adoptAssistant(page: Page): Promise<void> {
  const state = await assistantCtx!.storageState();
  await page.context().addCookies(state.cookies);
}

/** Extrahiert den Feed-Pfad (/api/calendar-feed/<64-hex>) aus der Abo-URL. */
function feedPathFromUrl(feedUrl: string): string {
  const match = feedUrl.match(/\/api\/calendar-feed\/([0-9a-f]{64})$/);
  expect(match, `Abo-URL muss auf einen 64-Hex-Token enden (${feedUrl})`).not.toBeNull();
  return `/api/calendar-feed/${match![1]}`;
}

test("Link erneuern macht die alte Abo-URL sofort ungültig; neue URL liefert dieselben Schichten", async ({
  page,
}) => {
  test.setTimeout(90_000);
  // Arbeitgeber sicher auf Premium (unabhängig von der Reihenfolge der Tests).
  setAccountPlan(admin.email, "premium");
  await adoptAssistant(page);

  await page.goto("/einstellungen");

  // --- 1. Abo-Link über die UI erstellen ------------------------------------
  const createButton = page.getByTestId("calendar-feed-create");
  await expect(
    createButton,
    "Der Abo-Link-Bereich muss für den Assistenten nutzbar sein",
  ).toBeVisible();
  await createButton.click();

  const feedUrlInput = page.getByTestId("calendar-feed-url");
  await expect(
    feedUrlInput,
    "Nach dem Erstellen muss die Abo-URL erscheinen",
  ).toBeVisible();
  const oldFeedUrl = await feedUrlInput.inputValue();
  const oldFeedPath = feedPathFromUrl(oldFeedUrl);

  // --- 2. Alter Feed funktioniert (Kalender-Client ohne Session) ------------
  const oldFeed = await publicCtx.get(oldFeedPath);
  expect(oldFeed.status(), "Frisch erstellter Feed sollte 200 liefern").toBe(200);
  const oldIcs = await oldFeed.text();
  expect(oldIcs).toContain("BEGIN:VCALENDAR");
  expect(
    oldIcs,
    "Feed muss die eigene FIX-Schicht enthalten",
  ).toContain(`UID:shift-${ownShiftId}@dienstplan-app`);

  // --- 3. Link erneuern über die UI (echter Frontend-Pfad) -------------------
  // Task #407: Der Klick feuert NICHT mehr direkt, sondern öffnet erst einen
  // Bestätigungsdialog (destruktive Aktion — alte URL wird sofort ungültig).
  const rotateButton = page.getByTestId("calendar-feed-rotate");
  await expect(rotateButton, "Der Erneuern-Button muss sichtbar sein").toBeVisible();
  await rotateButton.click();

  // 3a. Erst ABBRECHEN: Der Token darf unangetastet bleiben.
  const cancelButton = page.getByTestId("calendar-feed-confirm-cancel");
  await expect(
    cancelButton,
    "Der Bestätigungsdialog muss nach dem Klick erscheinen",
  ).toBeVisible();
  await cancelButton.click();
  await expect(cancelButton).not.toBeVisible();
  expect(
    await feedUrlInput.inputValue(),
    "Abbrechen darf den Abo-Link NICHT verändern",
  ).toBe(oldFeedUrl);
  const oldFeedAfterCancel = await publicCtx.get(oldFeedPath);
  expect(
    oldFeedAfterCancel.status(),
    "Nach Abbrechen muss die alte URL weiterhin funktionieren",
  ).toBe(200);

  // 3b. Jetzt wirklich erneuern: Klick + Bestätigen.
  await rotateButton.click();
  const confirmButton = page.getByTestId("calendar-feed-confirm-action");
  await expect(
    confirmButton,
    "Der Bestätigungsdialog muss erneut erscheinen",
  ).toBeVisible();
  await confirmButton.click();

  // Warten, bis die UI die NEUE URL zeigt (der Token muss sich ändern).
  await expect
    .poll(async () => feedUrlInput.inputValue(), {
      message: "Nach dem Erneuern muss eine NEUE Abo-URL erscheinen",
      timeout: 15_000,
    })
    .not.toBe(oldFeedUrl);
  const newFeedUrl = await feedUrlInput.inputValue();
  const newFeedPath = feedPathFromUrl(newFeedUrl);
  expect(newFeedPath, "Der neue Token muss sich vom alten unterscheiden").not.toBe(
    oldFeedPath,
  );

  // --- 4. SICHERHEIT: Die ALTE URL ist sofort tot (404, unbekannter Token) ---
  const oldFeedAfterRotate = await publicCtx.get(oldFeedPath);
  expect(
    oldFeedAfterRotate.status(),
    "SICHERHEIT: Die alte Abo-URL muss nach dem Erneuern sofort 404 liefern",
  ).toBe(404);

  // --- 5. Die NEUE URL liefert 200 mit denselben Schichten -------------------
  const newFeed = await publicCtx.get(newFeedPath);
  expect(newFeed.status(), "Die neue Abo-URL muss 200 liefern").toBe(200);
  expect(newFeed.headers()["content-type"]).toContain("text/calendar");
  const newIcs = await newFeed.text();
  expect(newIcs).toContain("BEGIN:VCALENDAR");
  expect(
    newIcs,
    "Der neue Feed muss dieselbe FIX-Schicht enthalten",
  ).toContain(`UID:shift-${ownShiftId}@dienstplan-app`);
});
