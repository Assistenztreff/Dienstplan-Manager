import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import {
  BASE_URL,
  deleteFreeAccount,
  registerFreeAccount,
  setAccountPlan,
  type FreeAccount,
} from "./helpers/teams";

/**
 * API-Test: Der öffentliche Kalender-Abo-Feed (`GET /calendar-feed/:token`) ist
 * der EINZIGE unauthentifizierte Datenzugang der App. Eine Regression bei
 * Rotation (POST /calendar-token macht den alten Link ungültig) oder Widerruf
 * (DELETE, bewusst OHNE Plan-Gate) würde Dienstpläne dauerhaft öffentlich
 * lassen — dieser Test beweist den kompletten Token-Lebenszyklus:
 *
 * 1. Premium-Konto erzeugt Token → der Feed liefert OHNE Session ein ICS mit
 *    der FIX-Schicht des Kontos.
 * 2. Rotation (erneutes POST): der ALTE Token liefert sofort 404, der NEUE
 *    funktioniert.
 * 3. Widerruf (DELETE): auch der neue Token liefert 404 — kein Zugang mehr.
 * 4. Gegenprobe Free: ein Free-Konto kann keinen Token erzeugen (403
 *    plan_feature_required).
 * 5. Downgrade-Fall: hat ein Premium-Konto einen Token und wird auf Free
 *    zurückgestuft, liefert der Feed 403 (Plan-Gate über den Token-Eigentümer),
 *    Rotation ist gesperrt (403) — aber der WIDERRUF (DELETE) bleibt möglich
 *    (204) und macht den Token endgültig unbekannt (404).
 *
 * Läuft rein über die API gegen den isolierten Test-Stack. Der Feed wird
 * bewusst über einen FRISCHEN Request-Kontext OHNE Session-Cookies abgerufen,
 * um zu beweisen, dass allein der Token authentifiziert.
 */

type TokenResponse = { token: string; feedPath: string };
type PlanError = { code?: string; feature?: string };

/** Liefert den 15. des aktuellen Monats (robust gegen Monatslängen/Zeitzonen). */
function currentMonthDay(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}-15`;
}

let premium: FreeAccount;
let free: FreeAccount;
/** Unauthentifizierter Kontext — simuliert einen Kalender-Client ohne Cookies. */
let publicCtx: APIRequestContext;

test.beforeAll(async () => {
  premium = await registerFreeAccount("privat", "kal-token");
  // Manuelle Premium-Freischaltung direkt in der Test-DB (wie im Operator-
  // Dashboard) — nur Premium darf Kalender-Token erzeugen.
  setAccountPlan(premium.email, "premium");

  free = await registerFreeAccount("privat", "kal-token-free");

  publicCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
});

test.afterAll(async () => {
  await deleteFreeAccount(premium);
  await deleteFreeAccount(free);
  try {
    await publicCtx.dispose();
  } catch {
    /* ignore */
  }
});

test("Token-Lebenszyklus: Erzeugen → Feed liefert ICS → Rotation invalidiert alten Link → Widerruf invalidiert alles", async () => {
  const unique = Date.now();

  // Eine FIX-Schicht anlegen, damit der Feed echten Inhalt hat (Default der
  // planning_status-Spalte ist FIX; nur FIX-Schichten landen im ICS).
  const assistantRes = await premium.ctx.post("/api/users", {
    data: {
      name: `E2E Kalender Assistent ${unique}`,
      email: `e2e.kaltoken.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(assistantRes.status(), "Assistent anlegen sollte 201 liefern").toBe(201);
  const assistantId = ((await assistantRes.json()) as { id: number }).id;

  const day = currentMonthDay();
  const shiftRes = await premium.ctx.post("/api/shifts", {
    data: {
      userId: assistantId,
      startTime: `${day}T08:00:00.000Z`,
      endTime: `${day}T16:00:00.000Z`,
      type: "active",
    },
  });
  expect(shiftRes.status(), "FIX-Schicht anlegen sollte 201 liefern").toBe(201);
  const shift = (await shiftRes.json()) as { id: number; planningStatus: string };
  expect(shift.planningStatus, "Neue API-Schicht muss FIX sein (Spalten-Default)").toBe("FIX");

  // --- 1. Token erzeugen, Feed OHNE Session abrufen ------------------------
  const createRes = await premium.ctx.post("/api/calendar-token");
  expect(createRes.ok(), "Premium-Konto sollte einen Token erzeugen können").toBe(true);
  const first = (await createRes.json()) as TokenResponse;
  expect(first.token).toMatch(/^[0-9a-f]{64}$/);
  expect(first.feedPath).toBe(`/api/calendar-feed/${first.token}`);

  const feed1 = await publicCtx.get(first.feedPath);
  expect(feed1.status(), "Feed mit gültigem Token sollte 200 liefern").toBe(200);
  expect(feed1.headers()["content-type"]).toContain("text/calendar");
  const ics = await feed1.text();
  expect(ics).toContain("BEGIN:VCALENDAR");
  expect(ics, "Feed sollte die FIX-Schicht enthalten").toContain(`UID:shift-${shift.id}@dienstplan-app`);

  // --- 2. Rotation: alter Link sofort ungültig, neuer funktioniert ---------
  const rotateRes = await premium.ctx.post("/api/calendar-token");
  expect(rotateRes.ok(), "Rotation sollte einen neuen Token liefern").toBe(true);
  const second = (await rotateRes.json()) as TokenResponse;
  expect(second.token).toMatch(/^[0-9a-f]{64}$/);
  expect(second.token, "Rotation muss einen ANDEREN Token erzeugen").not.toBe(first.token);

  const oldAfterRotate = await publicCtx.get(`/api/calendar-feed/${first.token}`);
  expect(oldAfterRotate.status(), "ALTER Token muss nach Rotation sofort 404 liefern").toBe(404);

  const newAfterRotate = await publicCtx.get(`/api/calendar-feed/${second.token}`);
  expect(newAfterRotate.status(), "NEUER Token muss nach Rotation funktionieren").toBe(200);
  expect(await newAfterRotate.text()).toContain(`UID:shift-${shift.id}@dienstplan-app`);

  // --- 3. Widerruf: auch der neue Token wird ungültig -----------------------
  const revokeRes = await premium.ctx.delete("/api/calendar-token");
  expect(revokeRes.status(), "Widerruf sollte 204 liefern").toBe(204);

  const afterRevoke = await publicCtx.get(`/api/calendar-feed/${second.token}`);
  expect(afterRevoke.status(), "Nach Widerruf muss auch der neue Token 404 liefern").toBe(404);

  // GET /calendar-token bestätigt: kein Token mehr hinterlegt.
  const statusRes = await premium.ctx.get("/api/calendar-token");
  expect(statusRes.ok()).toBe(true);
  const status = (await statusRes.json()) as { token: string | null };
  expect(status.token, "Nach Widerruf darf kein Token mehr existieren").toBeNull();
});

test("Free-Konto kann keinen Token erzeugen (403 plan_feature_required)", async () => {
  const createRes = await free.ctx.post("/api/calendar-token");
  expect(createRes.status(), "Free-Konto sollte beim Token-Erzeugen 403 erhalten").toBe(403);
  const body = (await createRes.json()) as PlanError;
  expect(body.code).toBe("plan_feature_required");
  expect(body.feature).toBe("calendarSync");
});

test("Downgrade: Feed liefert 403, Rotation gesperrt, aber Widerruf (DELETE) bleibt möglich", async () => {
  // Premium-Konto erzeugt erneut einen Token …
  const createRes = await premium.ctx.post("/api/calendar-token");
  expect(createRes.ok(), "Premium-Konto sollte erneut einen Token erzeugen können").toBe(true);
  const token = ((await createRes.json()) as TokenResponse).token;

  // … und wird dann auf Free zurückgestuft (manueller Downgrade in der DB).
  setAccountPlan(premium.email, "free");

  // Der Feed liefert für Free-Eigentümer 403 (Plan-Gate über den Token-
  // EIGENTÜMER, keine Session) — keine Daten mehr, aber der Token existiert noch.
  const feedFree = await publicCtx.get(`/api/calendar-feed/${token}`);
  expect(feedFree.status(), "Feed eines Free-Eigentümers sollte 403 liefern").toBe(403);

  // Rotation (POST) ist im Free-Tarif gesperrt.
  const rotateFree = await premium.ctx.post("/api/calendar-token");
  expect(rotateFree.status(), "Rotation sollte im Free-Tarif 403 liefern").toBe(403);

  // Der WIDERRUF muss auch nach dem Downgrade möglich sein (bewusst KEIN
  // Plan-Gate auf DELETE — Zugriff entziehen darf nie am Tarif scheitern).
  const revokeFree = await premium.ctx.delete("/api/calendar-token");
  expect(revokeFree.status(), "Widerruf muss auch im Free-Tarif 204 liefern").toBe(204);

  // Danach ist der Token endgültig unbekannt (404 statt 403).
  const afterRevoke = await publicCtx.get(`/api/calendar-feed/${token}`);
  expect(afterRevoke.status(), "Nach Widerruf muss der Token 404 liefern").toBe(404);
});
