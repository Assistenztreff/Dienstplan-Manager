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
 * End-to-End (Task #391): Das Widerrufen des Kalender-Abo-Links („Widerrufen")
 * MUSS den Token sofort und dauerhaft abschalten. Anders als das Erneuern ist
 * das Widerrufen BEWUSST NICHT plan-gebunden (DELETE /api/calendar-token ohne
 * Gate) — ein Nutzer, der auf Free herabgestuft wurde, muss einen früher
 * geteilten Link trotzdem noch widerrufen können. Sonst bliebe ein geleakter
 * Link nach einem Downgrade unwiderruflich offen.
 *
 * Aufbau (Assistenten-Fall, Arbeitgeber Premium):
 * - Premium-Arbeitgeber mit einem eingeladenen Assistenten (Cookies übernommen).
 *
 * Geprüft (Done-Kriterien):
 * 1. UI: Abo-Link erstellen → „Widerrufen" → die Feed-URL liefert 404 und
 *    GET /api/calendar-token zeigt keinen Token mehr (feedPath null).
 * 2. API: Token erneut erstellen, Arbeitgeber auf Free herabstufen, dann
 *    DELETE /api/calendar-token → 204 (Widerruf trotz Downgrade möglich).
 *
 * Läuft gegen den isolierten Test-Stack (eigener API + Vite auf der `_test`-DB).
 */

const FEED_RE = /\/api\/calendar-feed\/([0-9a-f]{64})$/;

let admin: FreeAccount;
let assistantCtx: APIRequestContext | undefined;
let publicCtx: APIRequestContext;
let assistantId = 0;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  admin = await registerFreeAccount("privat", "kal-revoke");
  await setAccountPlan(admin.email, "premium");

  publicCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });

  const unique = Date.now();
  const assistantRes = await admin.ctx.post("/api/users", {
    data: {
      name: `E2E KalRevoke Assistent ${unique}`,
      email: `e2e.kalrevoke.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(assistantRes.status(), "Assistent anlegen sollte 201 liefern").toBe(201);
  assistantId = ((await assistantRes.json()) as { id: number }).id;

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

test("Widerrufen sperrt die Feed-URL sofort und löscht den Token", async ({ page }) => {
  test.setTimeout(90_000);
  await setAccountPlan(admin.email, "premium");
  await adoptAssistant(page);

  await page.goto("/einstellungen");

  const createButton = page.getByTestId("calendar-feed-create");
  await expect(createButton).toBeVisible();
  await createButton.click();

  const feedUrlInput = page.getByTestId("calendar-feed-url");
  await expect(feedUrlInput).toBeVisible();
  const url = await feedUrlInput.inputValue();
  const match = url.match(FEED_RE);
  expect(match, `Abo-URL muss auf 64-Hex-Token enden (${url})`).not.toBeNull();
  const feedPath = `/api/calendar-feed/${match![1]}`;

  // Der Feed funktioniert vor dem Widerruf.
  const before = await publicCtx.get(feedPath);
  expect(before.status(), "Feed sollte vor dem Widerruf 200 liefern").toBe(200);

  // „Widerrufen" klicken → Bestätigungsdialog (Task #407) → der Erstellen-
  // Button erscheint wieder (Token weg).
  await page.getByTestId("calendar-feed-revoke").click();
  const confirmRevoke = page.getByTestId("calendar-feed-confirm-action");
  await expect(
    confirmRevoke,
    "Widerrufen muss erst einen Bestätigungsdialog öffnen",
  ).toBeVisible();
  await confirmRevoke.click();
  await expect(
    page.getByTestId("calendar-feed-create"),
    "Nach dem Widerruf muss wieder der Erstellen-Button erscheinen",
  ).toBeVisible({ timeout: 15_000 });

  // 1a. Die Feed-URL ist jetzt gesperrt (404).
  const after = await publicCtx.get(feedPath);
  expect(after.status(), "SICHERHEIT: Feed-URL muss nach Widerruf 404 liefern").toBe(404);

  // 1b. GET /api/calendar-token zeigt keinen Token mehr.
  const tokenRes = await assistantCtx!.get("/api/calendar-token");
  expect(tokenRes.status()).toBe(200);
  const tokenBody = (await tokenRes.json()) as {
    token: string | null;
    feedPath: string | null;
  };
  expect(tokenBody.token, "Nach Widerruf darf kein Token mehr existieren").toBeNull();
  expect(tokenBody.feedPath, "Nach Widerruf darf kein Feed-Pfad mehr existieren").toBeNull();
});

test("Widerrufen bleibt nach Downgrade auf Free möglich (204, ohne Plan-Gate)", async () => {
  test.setTimeout(90_000);

  // Als Premium erneut einen Token erstellen (rotate/create).
  await setAccountPlan(admin.email, "premium");
  const create = await assistantCtx!.post("/api/calendar-token");
  expect(create.status(), "Token-Erstellung sollte 200 liefern").toBe(200);
  const created = (await create.json()) as { feedPath: string | null };
  expect(created.feedPath, "Nach Erstellen muss ein Feed-Pfad existieren").not.toBeNull();
  const feedPath = created.feedPath!;

  // Feed ist aktiv.
  const active = await publicCtx.get(feedPath);
  expect(active.status(), "Feed sollte nach Erstellen 200 liefern").toBe(200);

  // Arbeitgeber auf Free herabstufen: Erstellen wäre jetzt plan-gesperrt ...
  await setAccountPlan(admin.email, "free");
  const gatedCreate = await assistantCtx!.post("/api/calendar-token");
  expect(
    gatedCreate.status(),
    "Erstellen muss nach Downgrade plan-gesperrt sein (403)",
  ).toBe(403);

  // ... Widerrufen bleibt aber BEWUSST erlaubt (kein Plan-Gate).
  const revoke = await assistantCtx!.delete("/api/calendar-token");
  expect(
    revoke.status(),
    "SICHERHEIT/Bestandsschutz: Widerrufen muss auch als Free 204 liefern",
  ).toBe(204);

  // Der Feed ist danach gesperrt.
  const afterRevoke = await publicCtx.get(feedPath);
  expect(afterRevoke.status(), "Feed muss nach Widerruf 404 liefern").toBe(404);

  // Aufräumen: Arbeitgeber wieder auf Premium (afterAll löscht das Konto).
  await setAccountPlan(admin.email, "premium");
});
