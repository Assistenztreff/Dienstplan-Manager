import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import {
  BASE_URL,
  deleteFreeAccount,
  registerFreeAccount,
  setAccountPlan,
  type FreeAccount,
} from "./helpers/teams";

/**
 * API-Test (Task: Kalender-Export nur verbindliche Dienste): Der ICS-Export
 * (`GET /calendar-export`) und der öffentliche Abo-Feed
 * (`GET /calendar-feed/:token`) dürfen laut Produktregel AUSSCHLIESSLICH
 * FIX-Schichten ausliefern. Landet ein Entwurf (VORLAEUFIG) oder Vorschlag
 * (ANGEBOTEN) im ICS, sehen Assistenten unverbindliche Dienste in ihrem
 * privaten Kalender als feste Termine.
 *
 * Aufbau (frisches Premium-Konto, deterministisch):
 * - 3 Schichten: FIX, VORLAEUFIG, ANGEBOTEN (Erkennung über die stabile
 *   `UID:shift-<id>@dienstplan-app`-Zeile im ICS).
 *
 * Geprüft (Done-Kriterien):
 * 1. Export enthält NUR das VEVENT der FIX-Schicht; Entwurf/Vorschlag fehlen.
 * 2. Feed (ohne Session, nur Token) enthält ebenfalls NUR die FIX-Schicht.
 * 3. Positiv-Kontrolle: Wird der Entwurf per PATCH auf FIX gehoben, taucht er
 *    sofort in Export UND Feed auf — der FIX-Filter (und nichts anderes, z. B.
 *    kein Datums- oder Scope-Filter) war also der Grund für den Ausschluss;
 *    ANGEBOTEN bleibt weiterhin außen vor.
 */

type TokenResponse = { token: string; feedPath: string };
type CreatedShift = { id: number; planningStatus: string };

/** Liefert einen Tag im aktuellen Monat (robust gegen Monatslängen/Zeitzonen). */
function currentMonthDay(day: number): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}-${String(day).padStart(2, "0")}`;
}

function uidOf(shiftId: number): string {
  return `UID:shift-${shiftId}@dienstplan-app`;
}

let premium: FreeAccount;
/** Unauthentifizierter Kontext — simuliert einen Kalender-Client ohne Cookies. */
let publicCtx: APIRequestContext;
let feedPath = "";
let fixShiftId = 0;
let draftShiftId = 0;
let offeredShiftId = 0;

async function createShift(
  assistantId: number,
  day: string,
  planningStatus: "FIX" | "VORLAEUFIG" | "ANGEBOTEN",
): Promise<number> {
  const res = await premium.ctx.post("/api/shifts", {
    data: {
      userId: assistantId,
      startTime: `${day}T08:00:00.000Z`,
      endTime: `${day}T16:00:00.000Z`,
      type: "active",
      planningStatus,
    },
  });
  expect(res.status(), `Schicht (${planningStatus}) anlegen sollte 201 liefern`).toBe(201);
  const shift = (await res.json()) as CreatedShift;
  // Guard: Der Status darf vom Server nicht still gestrippt/überschrieben
  // werden — sonst würden die folgenden Assertions nichts beweisen.
  expect(shift.planningStatus, `planningStatus muss ${planningStatus} sein`).toBe(planningStatus);
  return shift.id;
}

/** Holt den ICS-Export über die Session des Premium-Kontos. */
async function fetchExportIcs(): Promise<string> {
  const res = await premium.ctx.get("/api/calendar-export");
  expect(res.status(), "Export sollte 200 liefern").toBe(200);
  expect(res.headers()["content-type"]).toContain("text/calendar");
  const ics = await res.text();
  expect(ics).toContain("BEGIN:VCALENDAR");
  return ics;
}

/** Holt den Abo-Feed OHNE Session — allein der Token authentifiziert. */
async function fetchFeedIcs(): Promise<string> {
  const res = await publicCtx.get(feedPath);
  expect(res.status(), "Feed sollte 200 liefern").toBe(200);
  expect(res.headers()["content-type"]).toContain("text/calendar");
  const ics = await res.text();
  expect(ics).toContain("BEGIN:VCALENDAR");
  return ics;
}

test.beforeAll(async () => {
  const unique = Date.now();
  premium = await registerFreeAccount("privat", "kal-nurfix");
  // Manuelle Premium-Freischaltung direkt in der Test-DB (wie im Operator-
  // Dashboard) — calendarSync ist ein Premium-Feature.
  await setAccountPlan(premium.email, "premium");

  publicCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });

  const assistantRes = await premium.ctx.post("/api/users", {
    data: {
      name: `E2E KalNurFix ${unique}`,
      email: `e2e.kalnurfix.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(assistantRes.status(), "Assistent anlegen sollte 201 liefern").toBe(201);
  const assistantId = ((await assistantRes.json()) as { id: number }).id;

  // Drei Schichten an verschiedenen Tagen — nur die FIX-Schicht ist verbindlich.
  fixShiftId = await createShift(assistantId, currentMonthDay(10), "FIX");
  draftShiftId = await createShift(assistantId, currentMonthDay(11), "VORLAEUFIG");
  offeredShiftId = await createShift(assistantId, currentMonthDay(12), "ANGEBOTEN");

  const tokenRes = await premium.ctx.post("/api/calendar-token");
  expect(tokenRes.ok(), "Premium-Konto sollte einen Kalender-Token erzeugen können").toBe(true);
  feedPath = ((await tokenRes.json()) as TokenResponse).feedPath;
  expect(feedPath).toMatch(/^\/api\/calendar-feed\/[0-9a-f]{64}$/);
});

test.afterAll(async () => {
  await deleteFreeAccount(premium);
  try {
    await publicCtx.dispose();
  } catch {
    /* ignore */
  }
});

test("ICS-Export enthält nur das VEVENT der FIX-Schicht", async () => {
  const ics = await fetchExportIcs();
  expect(ics, "FIX-Schicht fehlt im Export").toContain(uidOf(fixShiftId));
  expect(ics, "VORLAEUFIG-Entwurf ist im Export gelandet").not.toContain(uidOf(draftShiftId));
  expect(ics, "ANGEBOTEN-Vorschlag ist im Export gelandet").not.toContain(uidOf(offeredShiftId));
});

test("Abo-Feed enthält nur das VEVENT der FIX-Schicht", async () => {
  const ics = await fetchFeedIcs();
  expect(ics, "FIX-Schicht fehlt im Feed").toContain(uidOf(fixShiftId));
  expect(ics, "VORLAEUFIG-Entwurf ist im Feed gelandet").not.toContain(uidOf(draftShiftId));
  expect(ics, "ANGEBOTEN-Vorschlag ist im Feed gelandet").not.toContain(uidOf(offeredShiftId));
});

test("Positiv-Kontrolle: Entwurf -> FIX erscheint sofort in Export UND Feed, ANGEBOTEN bleibt außen vor", async () => {
  const res = await premium.ctx.patch(`/api/shifts/${draftShiftId}`, {
    data: { planningStatus: "FIX" },
  });
  expect(res.ok(), `Hochstufen auf FIX fehlgeschlagen (${res.status()})`).toBe(true);

  const exportIcs = await fetchExportIcs();
  expect(exportIcs, "Hochgestufte Schicht fehlt im Export").toContain(uidOf(draftShiftId));
  expect(exportIcs, "FIX-Schicht fehlt weiterhin im Export").toContain(uidOf(fixShiftId));
  expect(exportIcs, "ANGEBOTEN darf auch jetzt nicht im Export sein").not.toContain(
    uidOf(offeredShiftId),
  );

  const feedIcs = await fetchFeedIcs();
  expect(feedIcs, "Hochgestufte Schicht fehlt im Feed").toContain(uidOf(draftShiftId));
  expect(feedIcs, "FIX-Schicht fehlt weiterhin im Feed").toContain(uidOf(fixShiftId));
  expect(feedIcs, "ANGEBOTEN darf auch jetzt nicht im Feed sein").not.toContain(
    uidOf(offeredShiftId),
  );
});
