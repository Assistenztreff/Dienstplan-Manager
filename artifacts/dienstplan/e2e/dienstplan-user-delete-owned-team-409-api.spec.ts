import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";

/**
 * API-Test (#279): DELETE /api/users/:id auf ein Konto, das noch ein Team
 * besitzt (teams.owner_id), darf NICHT mehr als unbehandelter Drizzle-/FK-
 * Fehler (500) enden, sondern muss — analog zum Team-DELETE — sauber mit
 * 409 und deutscher Fehlermeldung antworten.
 *
 * Ablauf: frisches Konto registrieren (bekommt automatisch ein "Standard-Team"
 * als Owner) → Selbst-Loeschung versuchen → 409 + Meldung, Konto existiert
 * weiter. Danach Team-Daten FK-sicher abraeumen → Loeschung liefert 204.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

type AuthUser = { id: number };

let ctx: APIRequestContext;
let user: AuthUser;

test.beforeAll(async () => {
  const unique = Date.now();
  ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });

  const res = await ctx.post("/api/auth/register", {
    data: {
      name: `E2E Delete Owner ${unique}`,
      email: `e2e.delete.owner.${unique}@dienstplan.test`,
      password: "deleteowner1234",
      // Team-CRUD (Abraeumen in Schritt 2) verlangt requireDienstleister.
      accountType: "dienstleister",
    },
  });
  expect(res.status(), "Registrierung sollte 201 liefern").toBe(201);
  user = (await res.json()) as AuthUser;
});

test.afterAll(async () => {
  await ctx.dispose();
});

test("Konto mit eigenem Team liefert beim Loeschen 409 statt 500; nach Team-Abbau klappt 204", async () => {
  // --- 1) Loeschversuch, solange das Standard-Team dem Konto gehoert ---
  const blocked = await ctx.delete(`/api/users/${user.id}`);
  expect(
    blocked.status(),
    "Loeschen eines Kontos mit eigenem Team muss 409 liefern (kein 500)",
  ).toBe(409);
  const body = (await blocked.json()) as { error?: string };
  expect(body.error, "409 sollte eine deutsche Fehlermeldung tragen").toContain("Teams");

  // Konto existiert weiterhin (Session noch gueltig).
  const me = await ctx.get("/api/auth/me");
  expect(me.ok(), "Konto darf durch den abgelehnten Versuch nicht geloescht sein").toBe(true);

  // --- 2) Team-Daten FK-sicher abraeumen: Dienste → Mitglieder → Team ---
  const modelsRes = await ctx.get("/api/shift-models");
  expect(modelsRes.ok()).toBe(true);
  const models = (await modelsRes.json()) as { id: number }[];
  for (const m of models) {
    await ctx.delete(`/api/shift-models/${m.id}`);
  }
  const teamsRes = await ctx.get("/api/teams");
  expect(teamsRes.ok()).toBe(true);
  const teams = (await teamsRes.json()) as { id: number }[];
  for (const t of teams) {
    const membersRes = await ctx.get(`/api/teams/${t.id}/members`);
    if (membersRes.ok()) {
      const members = (await membersRes.json()) as { userId: number }[];
      for (const m of members) {
        await ctx.delete(`/api/teams/${t.id}/members/${m.userId}`);
      }
    }
    const delTeam = await ctx.delete(`/api/teams/${t.id}`);
    expect(delTeam.status(), `Team ${t.id} sollte nach Abbau loeschbar sein`).toBe(204);
  }

  // --- 3) Ohne eigene Teams klappt die Loeschung ---
  const ok = await ctx.delete(`/api/users/${user.id}`);
  expect(ok.status(), "Ohne eigene Teams sollte das Loeschen 204 liefern").toBe(204);
});
