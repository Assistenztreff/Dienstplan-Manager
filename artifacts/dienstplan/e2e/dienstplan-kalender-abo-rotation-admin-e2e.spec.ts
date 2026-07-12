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
 * End-to-End-Beweis (Task #408): Das ERNEUERN (Rotieren) des Kalender-Abo-Links
 * macht die ALTE Feed-URL auch für den ADMIN-Fall SOFORT ungültig.
 *
 * Warum ein eigener Test zusätzlich zur Assistenten-Variante (Task #390)?
 * Der Admin-Feed hat einen BREITEREN Scope: er enthält ALLE FIX-Schichten aller
 * erlaubten Teams (inkl. Namen der Assistenten = PII), nicht nur die eigenen.
 * Eine geleakte Admin-URL wäre damit deutlich sensibler — die Rotation muss
 * auch hier sofort greifen.
 *
 * Ablauf (Premium-Admin, KEIN Einladungsflow nötig):
 * 1. Frisch registrierter privat-Admin wird auf Premium gehoben; er legt einen
 *    Assistenten mit einer FIX-Schicht an (Team-Schicht, NICHT die eigene).
 * 2. Admin erstellt den Abo-Link über die UI (`calendar-feed-create`).
 * 3. Ein unauthentifizierter Kontext (wie eine Kalender-App) ruft den Feed ab
 *    → 200, enthält die Team-Schicht des Assistenten (Admin-Scope).
 * 4. Admin klickt „Link erneuern" (`calendar-feed-rotate`) + bestätigt den
 *    Dialog — echter Frontend-Pfad (POST /api/calendar-token ersetzt Token).
 * 5. Die ALTE URL liefert jetzt 404 (unbekannter Token) — sofortiger Widerruf.
 * 6. Die NEUE URL liefert 200 mit DERSELBEN Team-Schicht.
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
/** Unauthentifizierter Kontext — simuliert einen Kalender-Client ohne Cookies. */
let publicCtx: APIRequestContext;
/** ID der FIX-Team-Schicht des Assistenten (muss in beiden Feeds stecken). */
let teamShiftId = 0;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  admin = await registerFreeAccount("privat", "kal-rotate-admin");
  // Manuelle Premium-Freischaltung direkt in der Test-DB (wie im Operator-
  // Dashboard) — der Kalender-Abo-Link ist ein Premium-Feature.
  await setAccountPlan(admin.email, "premium");

  publicCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });

  const unique = Date.now();

  // --- Assistent mit einer FIX-Schicht: Beweis, dass der Admin-Feed den
  // TEAM-Scope exportiert (fremde Schicht, nicht die eigene). -----------------
  const assistantRes = await admin.ctx.post("/api/users", {
    data: {
      name: `E2E KalRotateAdmin Assistent ${unique}`,
      email: `e2e.kalrotateadmin.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(assistantRes.status(), "Assistent anlegen sollte 201 liefern").toBe(201);
  const assistantId = ((await assistantRes.json()) as { id: number }).id;

  // FIX-Schicht (Spalten-Default der API ist FIX; nur FIX landet im ICS).
  const shiftRes = await admin.ctx.post("/api/shifts", {
    data: {
      userId: assistantId,
      startTime: `${currentMonthDay(15)}T08:00:00.000Z`,
      endTime: `${currentMonthDay(15)}T16:00:00.000Z`,
      type: "active",
    },
  });
  expect(shiftRes.status(), "Schicht sollte 201 liefern").toBe(201);
  const shift = (await shiftRes.json()) as { id: number; planningStatus: string };
  expect(shift.planningStatus, "Schicht muss FIX sein").toBe("FIX");
  teamShiftId = shift.id;
});

test.afterAll(async () => {
  // deleteFreeAccount entfernt Konto + Standard-Team + team-gebundene Daten
  // inkl. der angelegten Assistenten (verwaiste Assistenten werden mitgelöscht).
  await deleteFreeAccount(admin);
  try {
    await publicCtx?.dispose();
  } catch {
    /* ignore */
  }
});

/**
 * Übernimmt die Session-Cookies des per API registrierten Premium-Admins in
 * den Browser-Kontext, damit die App als DIESER Admin bootstrappt und NICHT
 * das Dev-Auto-Login (Premium-Seed-Admin) auslöst.
 */
async function adoptAdmin(page: Page): Promise<void> {
  const state = await admin.ctx.storageState();
  await page.context().addCookies(state.cookies);
}

/** Extrahiert den Feed-Pfad (/api/calendar-feed/<64-hex>) aus der Abo-URL. */
function feedPathFromUrl(feedUrl: string): string {
  const match = feedUrl.match(/\/api\/calendar-feed\/([0-9a-f]{64})$/);
  expect(match, `Abo-URL muss auf einen 64-Hex-Token enden (${feedUrl})`).not.toBeNull();
  return `/api/calendar-feed/${match![1]}`;
}

test("Admin: Link erneuern macht die alte Abo-URL sofort ungültig; neue URL liefert dieselben Team-Schichten", async ({
  page,
}) => {
  test.setTimeout(90_000);
  // Konto sicher auf Premium (unabhängig von der Reihenfolge der Tests).
  await setAccountPlan(admin.email, "premium");
  await adoptAdmin(page);

  await page.goto("/einstellungen");

  // --- 1. Abo-Link über die UI erstellen ------------------------------------
  const createButton = page.getByTestId("calendar-feed-create");
  await expect(
    createButton,
    "Der Abo-Link-Bereich muss für den Premium-Admin nutzbar sein",
  ).toBeVisible();
  await createButton.click();

  const feedUrlInput = page.getByTestId("calendar-feed-url");
  await expect(
    feedUrlInput,
    "Nach dem Erstellen muss die Abo-URL erscheinen",
  ).toBeVisible();
  const oldFeedUrl = await feedUrlInput.inputValue();
  const oldFeedPath = feedPathFromUrl(oldFeedUrl);

  // --- 2. Alter Feed funktioniert (Kalender-Client ohne Session) und enthält
  // die TEAM-Schicht des Assistenten (Admin-Scope, nicht nur eigene). ---------
  const oldFeed = await publicCtx.get(oldFeedPath);
  expect(oldFeed.status(), "Frisch erstellter Feed sollte 200 liefern").toBe(200);
  const oldIcs = await oldFeed.text();
  expect(oldIcs).toContain("BEGIN:VCALENDAR");
  expect(
    oldIcs,
    "Admin-Feed muss die FIX-Schicht des Assistenten enthalten (Team-Scope)",
  ).toContain(`UID:shift-${teamShiftId}@dienstplan-app`);

  // --- 3. Link erneuern über die UI (echter Frontend-Pfad) -------------------
  // Task #407: Der Klick öffnet erst einen Bestätigungsdialog (destruktive
  // Aktion — alte URL wird sofort ungültig).
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
    "SICHERHEIT: Die alte Admin-Abo-URL muss nach dem Erneuern sofort 404 liefern",
  ).toBe(404);

  // --- 5. Die NEUE URL liefert 200 mit denselben Team-Schichten --------------
  const newFeed = await publicCtx.get(newFeedPath);
  expect(newFeed.status(), "Die neue Abo-URL muss 200 liefern").toBe(200);
  expect(newFeed.headers()["content-type"]).toContain("text/calendar");
  const newIcs = await newFeed.text();
  expect(newIcs).toContain("BEGIN:VCALENDAR");
  expect(
    newIcs,
    "Der neue Feed muss dieselbe Team-Schicht enthalten",
  ).toContain(`UID:shift-${teamShiftId}@dienstplan-app`);
});
