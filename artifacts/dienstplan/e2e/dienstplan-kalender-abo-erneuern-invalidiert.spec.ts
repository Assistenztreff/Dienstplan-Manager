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
 * End-to-End (Task #390): Das Erneuern des Kalender-Abo-Links („Link erneuern")
 * ist das Widerruf-per-Rotation-Feature — es MUSS die ALTE Feed-URL sofort
 * ungültig machen. Task #389 beweist bereits, dass Erstellen + Nutzen
 * funktioniert; dieser Test schließt die Lücke, dass die Rotation eine
 * geleakte URL wirklich abschaltet. Eine Regression hier würde einen
 * kompromittierten Link still am Leben halten.
 *
 * Aufbau (Assistenten-Fall, Arbeitgeber Premium):
 * - Premium-Arbeitgeber mit einem Assistenten + einer eigenen FIX-Schicht.
 * - Assistent per Einladungsflow eingeloggt, Cookies in den Browser übernommen.
 * - In den Einstellungen: Abo-Link erstellen → ALTE URL merken und über einen
 *   FRISCHEN (cookie-losen) Kontext abrufen (200). Dann „Link erneuern" klicken.
 *
 * Geprüft (Done-Kriterien):
 * 1. Nach dem Erneuern liefert die ALTE Feed-URL 404 (unbekannter Token).
 * 2. Die NEUE Feed-URL liefert 200 mit derselben FIX-Schicht.
 *
 * Läuft gegen den isolierten Test-Stack (eigener API + Vite auf der `_test`-DB).
 */

function currentMonthDay(day: number): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}-${String(day).padStart(2, "0")}`;
}

const FEED_RE = /\/api\/calendar-feed\/([0-9a-f]{64})$/;

let admin: FreeAccount;
let assistantCtx: APIRequestContext | undefined;
let publicCtx: APIRequestContext;
let assistantId = 0;
let ownShiftId = 0;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  admin = await registerFreeAccount("privat", "kal-rotate");
  setAccountPlan(admin.email, "premium");

  publicCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });

  const unique = Date.now();
  const assistantRes = await admin.ctx.post("/api/users", {
    data: {
      name: `E2E KalRotate Assistent ${unique}`,
      email: `e2e.kalrotate.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(assistantRes.status(), "Assistent anlegen sollte 201 liefern").toBe(201);
  assistantId = ((await assistantRes.json()) as { id: number }).id;

  const shiftRes = await admin.ctx.post("/api/shifts", {
    data: {
      userId: assistantId,
      startTime: `${currentMonthDay(12)}T08:00:00.000Z`,
      endTime: `${currentMonthDay(12)}T16:00:00.000Z`,
      type: "active",
    },
  });
  expect(shiftRes.status(), "Schicht sollte 201 liefern").toBe(201);
  const shift = (await shiftRes.json()) as { id: number; planningStatus: string };
  expect(shift.planningStatus, "Schicht muss FIX sein").toBe("FIX");
  ownShiftId = shift.id;

  const inviteRes = await admin.ctx.post(`/api/users/${assistantId}/invite`);
  expect(inviteRes.ok(), `Einladung sollte klappen (${inviteRes.status()})`).toBe(true);
  const inviteToken = ((await inviteRes.json()) as { token: string }).token;

  assistantCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const setPwRes = await assistantCtx.post("/api/auth/set-password", {
    data: { token: inviteToken, password: "assistent1234" },
  });
  expect(setPwRes.ok(), `set-password sollte 200 liefern (${setPwRes.status()})`).toBe(true);
  const me = await assistantCtx.get("/api/auth/me");
  const meBody = (await me.json()) as { id: number; role: string };
  expect(meBody.id).toBe(assistantId);
  expect(meBody.role).toBe("assistant");
});

test.afterAll(async () => {
  await deleteFreeAccount(admin);
  for (const ctx of [assistantCtx, publicCtx]) {
    try {
      await ctx?.dispose();
    } catch {
      /* ignore */
    }
  }
});

async function adoptAssistant(page: Page): Promise<void> {
  const state = await assistantCtx!.storageState();
  await page.context().addCookies(state.cookies);
}

test("Link erneuern macht die alte Abo-URL ungueltig, die neue liefert dieselben Schichten", async ({
  page,
}) => {
  test.setTimeout(90_000);
  setAccountPlan(admin.email, "premium");
  await adoptAssistant(page);

  await page.goto("/einstellungen");

  // Abo-Link erstellen.
  const createButton = page.getByTestId("calendar-feed-create");
  await expect(createButton).toBeVisible();
  await createButton.click();

  const feedUrlInput = page.getByTestId("calendar-feed-url");
  await expect(feedUrlInput).toBeVisible();
  const oldUrl = await feedUrlInput.inputValue();
  const oldMatch = oldUrl.match(FEED_RE);
  expect(oldMatch, `Alte Abo-URL muss auf 64-Hex-Token enden (${oldUrl})`).not.toBeNull();
  const oldPath = `/api/calendar-feed/${oldMatch![1]}`;

  // Die alte URL funktioniert VOR der Rotation.
  const before = await publicCtx.get(oldPath);
  expect(before.status(), "Alte Feed-URL sollte vor dem Erneuern 200 liefern").toBe(200);
  const beforeIcs = await before.text();
  expect(beforeIcs).toContain(`UID:shift-${ownShiftId}@dienstplan-app`);

  // „Link erneuern" klicken, bestätigen (Task #407) und auf die neue URL warten.
  await page.getByTestId("calendar-feed-rotate").click();
  const confirmRotate = page.getByTestId("calendar-feed-confirm-action");
  await expect(
    confirmRotate,
    "Erneuern muss erst einen Bestätigungsdialog öffnen",
  ).toBeVisible();
  await confirmRotate.click();
  await expect
    .poll(async () => feedUrlInput.inputValue(), {
      message: "Nach dem Erneuern muss sich die Abo-URL ändern",
      timeout: 15_000,
    })
    .not.toBe(oldUrl);

  const newUrl = await feedUrlInput.inputValue();
  const newMatch = newUrl.match(FEED_RE);
  expect(newMatch, `Neue Abo-URL muss auf 64-Hex-Token enden (${newUrl})`).not.toBeNull();
  const newPath = `/api/calendar-feed/${newMatch![1]}`;
  expect(newPath, "Der neue Token muss sich vom alten unterscheiden").not.toBe(oldPath);

  // 1. Die ALTE URL ist jetzt ungültig (404).
  const oldAfter = await publicCtx.get(oldPath);
  expect(
    oldAfter.status(),
    "SICHERHEIT: Die alte Feed-URL muss nach dem Erneuern 404 liefern",
  ).toBe(404);

  // 2. Die NEUE URL liefert 200 mit derselben FIX-Schicht.
  const newAfter = await publicCtx.get(newPath);
  expect(newAfter.status(), "Neue Feed-URL sollte 200 liefern").toBe(200);
  const newIcs = await newAfter.text();
  expect(newIcs).toContain("BEGIN:VCALENDAR");
  expect(
    newIcs,
    "Der neue Feed muss dieselbe FIX-Schicht enthalten",
  ).toContain(`UID:shift-${ownShiftId}@dienstplan-app`);
});
