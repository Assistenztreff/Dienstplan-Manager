/**
 * #539 – Beweisen, dass der Kalender-Link eines deaktivierten Kontos sofort tot ist.
 *
 * GET /api/calendar-feed/:token prüft owner.isActive. Wird der Token-Inhaber
 * deaktiviert (isActive=false), muss der Feed 404 liefern — sofort, ohne Cache.
 * Reaktivierung durch den Admin stellt den Feed wieder her.
 *
 * Strategie:
 *   - Kalender-Token gehört dem ASSISTENTEN (nicht dem Admin). Damit bleibt die
 *     Admin-Session gültig und kann den Assistenten (de-)aktivieren.
 *   - Assistent-Session via Invite-Flow: acc.ctx.POST /users/:id/invite → Token →
 *     neuer APIRequestContext → POST /auth/set-password → eingeloggt.
 */
import { test, expect, request as playwrightRequest } from "@playwright/test";
import {
  registerFreeAccount,
  setAccountPlan,
  deleteFreeAccount,
  FREE_ACCOUNT_PASSWORD,
  type FreeAccount,
} from "./helpers/teams";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

let acc: FreeAccount;
let assistantId: number;
let assistantCalendarToken: string;

test.beforeAll(async () => {
  test.setTimeout(90_000);
  acc = await registerFreeAccount("dienstleister", "caldeakt");
  // Premium wird für den Invite-Endpunkt benötigt.
  await setAccountPlan(acc.email, "premium");

  // Assistent anlegen.
  const assistantEmail = `e2e.caldeakt.asst.${Date.now()}@dienstplan.test`;
  const userRes = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E CalDeakt Asst ${Date.now()}`,
      email: assistantEmail,
      role: "assistant",
    },
  });
  expect(userRes.status(), "Assistent anlegen").toBe(201);
  assistantId = ((await userRes.json()) as { id: number }).id;

  await acc.ctx.post("/api/contracts", {
    data: {
      userId: assistantId,
      startDate: `${new Date().getFullYear()}-01-01`,
      weeklyHours: 40,
      vacationDays: 30,
    },
  });

  // Invite-Flow: Einladungstoken für den Assistenten generieren.
  const inviteRes = await acc.ctx.post(`/api/users/${assistantId}/invite`, {});
  expect(inviteRes.status(), `Einladung generieren (${inviteRes.status()})`).toBe(200);
  const { token: inviteToken } = (await inviteRes.json()) as { token: string };

  // Assistent setzt Passwort und ist dadurch eingeloggt.
  const assistantCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const setPwRes = await assistantCtx.post("/api/auth/set-password", {
    data: { token: inviteToken, password: FREE_ACCOUNT_PASSWORD },
  });
  expect(setPwRes.status(), `set-password (${setPwRes.status()})`).toBe(200);

  // Kalender-Token für den Assistenten generieren (Assistent-Session).
  const tokenRes = await assistantCtx.post("/api/calendar-token", {});
  expect(tokenRes.status(), `Kalender-Token (${tokenRes.status()})`).toBe(200);
  assistantCalendarToken = ((await tokenRes.json()) as { token: string }).token;
  expect(assistantCalendarToken, "Token muss 64-Zeichen-Hex sein").toMatch(
    /^[0-9a-f]{64}$/,
  );

  await assistantCtx.dispose();
});

test.afterAll(async () => {
  // Assistent ggf. reaktivieren, damit deleteFreeAccount den Account sauber löscht.
  if (assistantId) {
    await acc.ctx.patch(`/api/users/${assistantId}`, { data: { isActive: true } });
  }
  await deleteFreeAccount(acc);
});

test("Aktiver Assistent: Kalender-Feed liefert 200 text/calendar (#539)", async () => {
  const res = await acc.ctx.get(`/api/calendar-feed/${assistantCalendarToken}`);
  expect(res.status(), "Aktiver Feed muss 200 sein").toBe(200);
  expect(res.headers()["content-type"], "Content-Type text/calendar").toContain(
    "text/calendar",
  );
});

test(
  "Nach Deaktivierung: Feed liefert sofort 404, nach Reaktivierung wieder 200 (#539)",
  async () => {
    expect(assistantCalendarToken, "Token muss im beforeAll gesetzt worden sein").toBeTruthy();

    // Assistent deaktivieren (Admin-Session bleibt unberührt).
    const deactivateRes = await acc.ctx.patch(`/api/users/${assistantId}`, {
      data: { isActive: false },
    });
    expect(
      deactivateRes.status(),
      `Deaktivieren (${deactivateRes.status()}): ${await deactivateRes.text()}`,
    ).toBe(200);

    // Feed muss sofort 404 liefern.
    const feedRes404 = await acc.ctx.get(`/api/calendar-feed/${assistantCalendarToken}`);
    expect(feedRes404.status(), "Deaktivierter Assistent: Feed muss 404 sein").toBe(404);

    // Reaktivieren.
    const reactivateRes = await acc.ctx.patch(`/api/users/${assistantId}`, {
      data: { isActive: true },
    });
    expect(reactivateRes.status(), "Reaktivieren muss 200 sein").toBe(200);

    // Feed muss wieder 200 liefern.
    const feedRes200 = await acc.ctx.get(`/api/calendar-feed/${assistantCalendarToken}`);
    expect(feedRes200.status(), "Reaktivierter Assistent: Feed muss wieder 200 sein").toBe(200);
  },
);

test("Unbekannter 64-Zeichen-Token liefert 404 (#539)", async () => {
  const fakeToken = "b".repeat(64);
  const res = await acc.ctx.get(`/api/calendar-feed/${fakeToken}`);
  expect(res.status(), "Unbekannter Token muss 404 sein").toBe(404);
});
