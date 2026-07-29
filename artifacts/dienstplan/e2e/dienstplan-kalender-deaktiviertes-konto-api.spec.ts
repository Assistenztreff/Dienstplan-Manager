import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import {
  BASE_URL,
  deleteFreeAccount,
  registerFreeAccount,
  setAccountPlan,
  type FreeAccount,
} from "./helpers/teams";
import { dbSetUserActive } from "./helpers/db";

/**
 * API-Test #539: Der Kalender-Abo-Feed (`GET /api/calendar-feed/:token`) muss
 * sofort 404 liefern, sobald der Konto-Eigentümer deaktiviert wird.
 *
 * Die Route prüft `users.is_active` neben dem Token selbst:
 *   if (!owner || !owner.isActive) { res.status(404) }
 *
 * Sicherheitsrelevanz: Eine Kündigung der Assistenzkraft muss den geteilten
 * Kalender-Link sofort abschalten — kein nachträglicher Zugriff auf
 * Dienstplandaten möglich.
 *
 * Ablauf:
 *   1. Premium-Konto erzeugt Token → Feed liefert 200
 *   2. Konto via SQL deaktivieren (is_active = false; API-seitige IDOR-Sperre
 *      würde einen fremden Admin-Request blockieren; SQL ist der einzig
 *      zuverlässige Weg im Test-Harness)
 *   3. Feed liefert sofort 404 — kein Zugriff nach Kündigung
 *   4. Konto reaktivieren (is_active = true)
 *   5. Feed liefert wieder 200 — Reaktivierung hebt Sperre auf
 */

type TokenResponse = { token: string; feedPath: string };

let premium: FreeAccount;
/** Unauthentifizierter Kontext — simuliert einen externen Kalender-Client. */
let publicCtx: APIRequestContext;

test.beforeAll(async () => {
  premium = await registerFreeAccount("privat", "kal-deaktiviert");
  await setAccountPlan(premium.email, "premium");
  publicCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
});

test.afterAll(async () => {
  // Konto reaktivieren (falls Test unterbrochen wurde) und aufräumen.
  await dbSetUserActive(premium.email, true).catch(() => {/* ignore */});
  await deleteFreeAccount(premium);
  await publicCtx.dispose();
});

test("Kalender-Feed eines deaktivierten Kontos liefert sofort 404", async () => {
  // --- 1. Token erzeugen und Feed-Zugriff bestätigen ----------------------
  const createRes = await premium.ctx.post("/api/calendar-token");
  expect(createRes.ok(), "Premium-Konto sollte einen Token erzeugen können").toBe(true);
  const { feedPath } = (await createRes.json()) as TokenResponse;

  const feed1 = await publicCtx.get(feedPath);
  expect(
    feed1.status(),
    "Feed mit gültigem Token und aktivem Konto muss 200 liefern",
  ).toBe(200);
  expect(feed1.headers()["content-type"]).toContain("text/calendar");

  // --- 2. Konto per SQL deaktivieren --------------------------------------
  // Direkt in der Test-DB — ein Admin-PATCH-Request würde am IDOR-Schutz
  // scheitern (fremdes Konto, kein geteiltes Team), SQL ist der einzig
  // zuverlässige Weg im Test-Harness (analog zu setAccountPlan).
  await dbSetUserActive(premium.email, false);

  // --- 3. Feed nach Deaktivierung: sofort 404 ------------------------------
  const feed2 = await publicCtx.get(feedPath);
  expect(
    feed2.status(),
    "Feed eines deaktivierten Kontos muss sofort 404 liefern — kein Zugriff nach Kündigung",
  ).toBe(404);

  // --- 4. Konto reaktivieren -----------------------------------------------
  await dbSetUserActive(premium.email, true);

  // --- 5. Feed nach Reaktivierung: wieder 200 ------------------------------
  const feed3 = await publicCtx.get(feedPath);
  expect(
    feed3.status(),
    "Nach Reaktivierung muss der Feed wieder 200 liefern",
  ).toBe(200);
  expect(feed3.headers()["content-type"]).toContain("text/calendar");
});
