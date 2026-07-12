import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import {
  BASE_URL,
  deleteFreeAccount,
  registerFreeAccount,
  setAccountPlan,
  type FreeAccount,
} from "./helpers/teams";

/**
 * API-Test: Der öffentliche Kalender-Abo-Feed (`GET /calendar-feed/:token`)
 * scoped nach der ROLLE des Token-Eigentümers. Assistenten dürfen über ihren
 * Abo-Link AUSSCHLIESSLICH die eigenen FIX-Schichten sehen — eine Regression
 * im Assistenten-Branch von `buildIcs` (Bedingung `eq(shifts.userId,
 * viewer.userId)`) würde einem Assistenten unauthentifiziert und dauerhaft die
 * Dienstpläne ALLER Kollegen offenlegen (inkl. Namen = PII-Leak).
 *
 * Ablauf:
 * 1. Premium-Admin legt zwei Assistenten im Standard-Team an, je eine
 *    FIX-Schicht pro Assistent.
 * 2. Assistent A wird per Einladungsflow eingeloggt (Invite ist Premium,
 *    set-password meldet direkt an — siehe Helper-Muster) und erzeugt nach
 *    manueller Premium-Freischaltung seinen eigenen Kalender-Token.
 * 3. Der Feed von Assistent A enthält die EIGENE Schicht, aber NICHT die
 *    Schicht (und nicht den Namen) von Assistent B.
 * 4. Gegenprobe: Der Admin-Feed enthält weiterhin BEIDE Schichten
 *    (voller Team-Scope).
 *
 * Läuft rein über die API gegen den isolierten Test-Stack. Die Feeds werden
 * über einen FRISCHEN Request-Kontext OHNE Session-Cookies abgerufen, um zu
 * beweisen, dass allein der Token authentifiziert und scoped.
 */

type TokenResponse = { token: string; feedPath: string };

/** Liefert einen Tag des aktuellen Monats (robust gegen Monatslängen). */
function currentMonthDay(day: number): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}-${String(day).padStart(2, "0")}`;
}

let admin: FreeAccount;
let assistantCtx: APIRequestContext | undefined;
let assistantEmail = "";
/** Unauthentifizierter Kontext — simuliert einen Kalender-Client ohne Cookies. */
let publicCtx: APIRequestContext;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  admin = await registerFreeAccount("privat", "kal-feed-scope");
  // Manuelle Premium-Freischaltung direkt in der Test-DB (wie im Operator-
  // Dashboard) — Einladen + Kalender-Token sind Premium-Features.
  await setAccountPlan(admin.email, "premium");

  publicCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
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

test("Assistenten-Feed enthält nur eigene FIX-Schichten, Admin-Feed alle im Team", async () => {
  test.setTimeout(120_000);
  const unique = Date.now();

  // --- Setup: zwei Assistenten mit je einer FIX-Schicht --------------------
  assistantEmail = `e2e.kalscope.a.${unique}@dienstplan.test`;
  const assistantARes = await admin.ctx.post("/api/users", {
    data: {
      name: `E2E KalScope Assistent A ${unique}`,
      email: assistantEmail,
      role: "assistant",
    },
  });
  expect(assistantARes.status(), "Assistent A anlegen sollte 201 liefern").toBe(201);
  const assistantAId = ((await assistantARes.json()) as { id: number }).id;

  const colleagueName = `E2E KalScope Kollege B ${unique}`;
  const assistantBRes = await admin.ctx.post("/api/users", {
    data: {
      name: colleagueName,
      email: `e2e.kalscope.b.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(assistantBRes.status(), "Assistent B anlegen sollte 201 liefern").toBe(201);
  const assistantBId = ((await assistantBRes.json()) as { id: number }).id;

  // FIX-Schichten (Spalten-Default der API ist FIX; nur FIX landet im ICS).
  const shiftARes = await admin.ctx.post("/api/shifts", {
    data: {
      userId: assistantAId,
      startTime: `${currentMonthDay(10)}T08:00:00.000Z`,
      endTime: `${currentMonthDay(10)}T16:00:00.000Z`,
      type: "active",
    },
  });
  expect(shiftARes.status(), "Schicht für A sollte 201 liefern").toBe(201);
  const shiftA = (await shiftARes.json()) as { id: number; planningStatus: string };
  expect(shiftA.planningStatus, "Schicht A muss FIX sein").toBe("FIX");

  const shiftBRes = await admin.ctx.post("/api/shifts", {
    data: {
      userId: assistantBId,
      startTime: `${currentMonthDay(11)}T08:00:00.000Z`,
      endTime: `${currentMonthDay(11)}T16:00:00.000Z`,
      type: "active",
    },
  });
  expect(shiftBRes.status(), "Schicht für B sollte 201 liefern").toBe(201);
  const shiftB = (await shiftBRes.json()) as { id: number; planningStatus: string };
  expect(shiftB.planningStatus, "Schicht B muss FIX sein").toBe("FIX");

  // --- Assistent A einloggen (Einladungsflow) ------------------------------
  const inviteRes = await admin.ctx.post(`/api/users/${assistantAId}/invite`);
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
  expect(meBody.id).toBe(assistantAId);
  expect(meBody.role, "Session muss die Assistenten-Rolle tragen").toBe("assistant");

  // Kalender-Token für Assistenten hängt am Plan des ARBEITGEBERS (Team-
  // Eigentümers), NICHT am eigenen Plan — Assistent A bleibt bewusst "free"
  // (der Admin ist Premium). Kein manuelles setAccountPlan für A nötig.

  // --- Assistenten-Feed: NUR die eigene Schicht -----------------------------
  const tokenRes = await assistantCtx.post("/api/calendar-token");
  expect(tokenRes.ok(), `Assistent sollte Token erzeugen können (${tokenRes.status()})`).toBe(true);
  const assistantToken = (await tokenRes.json()) as TokenResponse;
  expect(assistantToken.token).toMatch(/^[0-9a-f]{64}$/);

  const assistantFeed = await publicCtx.get(assistantToken.feedPath);
  expect(assistantFeed.status(), "Assistenten-Feed sollte 200 liefern").toBe(200);
  expect(assistantFeed.headers()["content-type"]).toContain("text/calendar");
  const assistantIcs = await assistantFeed.text();
  expect(assistantIcs).toContain("BEGIN:VCALENDAR");
  expect(
    assistantIcs,
    "Assistenten-Feed muss die EIGENE FIX-Schicht enthalten",
  ).toContain(`UID:shift-${shiftA.id}@dienstplan-app`);
  expect(
    assistantIcs,
    "SICHERHEIT: Assistenten-Feed darf die Schicht des Kollegen NICHT enthalten",
  ).not.toContain(`UID:shift-${shiftB.id}@dienstplan-app`);
  expect(
    assistantIcs,
    "SICHERHEIT: Assistenten-Feed darf den Namen des Kollegen NICHT enthalten (PII)",
  ).not.toContain(colleagueName);

  // --- Gegenprobe: Admin-Feed enthält BEIDE Schichten -----------------------
  const adminTokenRes = await admin.ctx.post("/api/calendar-token");
  expect(adminTokenRes.ok(), "Admin sollte einen Token erzeugen können").toBe(true);
  const adminToken = (await adminTokenRes.json()) as TokenResponse;

  const adminFeed = await publicCtx.get(adminToken.feedPath);
  expect(adminFeed.status(), "Admin-Feed sollte 200 liefern").toBe(200);
  const adminIcs = await adminFeed.text();
  expect(adminIcs, "Admin-Feed muss Schicht A enthalten").toContain(
    `UID:shift-${shiftA.id}@dienstplan-app`,
  );
  expect(adminIcs, "Admin-Feed muss Schicht B enthalten").toContain(
    `UID:shift-${shiftB.id}@dienstplan-app`,
  );

  // --- Downgrade des Arbeitgebers sperrt Assistenten-Feed UND -Token --------
  // Der Assistent selbst bleibt "free"; das calendarSync-Gate hängt am Plan
  // des Team-Eigentümers. Nach dessen Downgrade: reines Free-Umfeld → 403
  // plan_feature_required sowohl auf dem öffentlichen Feed (Token-Eigentümer-
  // Gate) als auch beim Erzeugen eines neuen Tokens (Session-Gate).
  await setAccountPlan(admin.email, "free");

  const feedAfterDowngrade = await publicCtx.get(assistantToken.feedPath);
  expect(
    feedAfterDowngrade.status(),
    "Nach Arbeitgeber-Downgrade muss der Assistenten-Feed 403 liefern",
  ).toBe(403);
  const feedErr = (await feedAfterDowngrade.json()) as { code?: string };
  expect(feedErr.code, "Feed-403 muss plan_feature_required tragen").toBe(
    "plan_feature_required",
  );

  const tokenAfterDowngrade = await assistantCtx.post("/api/calendar-token");
  expect(
    tokenAfterDowngrade.status(),
    "Im reinen Free-Umfeld darf der Assistent KEINEN Token erzeugen (403)",
  ).toBe(403);
  const tokenErr = (await tokenAfterDowngrade.json()) as { code?: string };
  expect(tokenErr.code, "Token-403 muss plan_feature_required tragen").toBe(
    "plan_feature_required",
  );

  // Widerruf bleibt bewusst OHNE Plan-Gate möglich (Zugriff entziehen muss
  // auch nach Downgrade gehen).
  const revokeRes = await assistantCtx.delete("/api/calendar-token");
  expect(
    revokeRes.status(),
    "Widerruf muss auch im Free-Umfeld möglich sein (204)",
  ).toBe(204);

  // Premium wiederherstellen, damit spätere Assertions/Aufräumarbeiten in
  // Geschwister-Specs nicht von diesem Downgrade beeinflusst werden.
  await setAccountPlan(admin.email, "premium");
});
