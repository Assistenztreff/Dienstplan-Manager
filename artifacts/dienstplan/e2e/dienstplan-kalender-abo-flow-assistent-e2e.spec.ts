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
import { openSettingsGroup } from "./helpers/einstellungen";

/**
 * End-to-End-Flow (Task #389): Ein ASSISTENT mit einem PREMIUM-Arbeitgeber kann
 * den Kalender-Abo-Link nicht nur SEHEN (das beweist bereits
 * `dienstplan-kalender-abo-karte-assistent-ui.spec.ts`), sondern ihn auch
 * FUNKTIONAL nutzen: er klickt in den Einstellungen „Abo-Link erstellen"
 * (`calendar-feed-create`), bekommt eine Feed-URL (`calendar-feed-url`), und der
 * daraus resultierende ÖFFENTLICHE Feed (`GET /api/calendar-feed/:token`)
 * liefert 200 und enthält ausschließlich die EIGENEN FIX-Schichten des
 * Assistenten (nicht die des Kollegen — PII-Schutz).
 *
 * Damit schließt dieser Test die Lücke zwischen „Button ist freigeschaltet" und
 * „Feature funktioniert wirklich" für Assistenten — inklusive der Gegenprobe,
 * dass ein Downgrade des Arbeitgebers auf „free" denselben Feed sperrt (403).
 *
 * Der Klick erzeugt den Token über die UI (echter Frontend-Pfad, kein direkter
 * API-Aufruf). Die Feed-URL wird anschließend über einen FRISCHEN Request-
 * Kontext OHNE Session-Cookies abgerufen — so wie es eine Kalender-App täte —,
 * um zu beweisen, dass allein der Token authentifiziert und scoped.
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
/** IDs der beiden FIX-Schichten (eigene vs. Kollege) für die Scope-Assertions. */
let ownShiftId = 0;
let colleagueShiftId = 0;
let colleagueName = "";

test.beforeAll(async () => {
  test.setTimeout(120_000);
  admin = await registerFreeAccount("privat", "kal-flow-assist");
  // Manuelle Premium-Freischaltung direkt in der Test-DB (wie im Operator-
  // Dashboard) — Einladen + Kalender-Token sind Premium-Features.
  await setAccountPlan(admin.email, "premium");

  publicCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });

  const unique = Date.now();

  // --- Assistent (der Abonnent) + Kollege, je eine FIX-Schicht --------------
  const assistantRes = await admin.ctx.post("/api/users", {
    data: {
      name: `E2E KalFlow Assistent ${unique}`,
      email: `e2e.kalflow.a.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(assistantRes.status(), "Assistent anlegen sollte 201 liefern").toBe(201);
  assistantId = ((await assistantRes.json()) as { id: number }).id;

  colleagueName = `E2E KalFlow Kollege ${unique}`;
  const colleagueRes = await admin.ctx.post("/api/users", {
    data: {
      name: colleagueName,
      email: `e2e.kalflow.b.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(colleagueRes.status(), "Kollege anlegen sollte 201 liefern").toBe(201);
  const colleagueId = ((await colleagueRes.json()) as { id: number }).id;

  // FIX-Schichten (Spalten-Default der API ist FIX; nur FIX landet im ICS).
  const ownShiftRes = await admin.ctx.post("/api/shifts", {
    data: {
      userId: assistantId,
      startTime: `${currentMonthDay(12)}T08:00:00.000Z`,
      endTime: `${currentMonthDay(12)}T16:00:00.000Z`,
      type: "active",
    },
  });
  expect(ownShiftRes.status(), "Eigene Schicht sollte 201 liefern").toBe(201);
  const ownShift = (await ownShiftRes.json()) as { id: number; planningStatus: string };
  expect(ownShift.planningStatus, "Eigene Schicht muss FIX sein").toBe("FIX");
  ownShiftId = ownShift.id;

  const colleagueShiftRes = await admin.ctx.post("/api/shifts", {
    data: {
      userId: colleagueId,
      startTime: `${currentMonthDay(13)}T08:00:00.000Z`,
      endTime: `${currentMonthDay(13)}T16:00:00.000Z`,
      type: "active",
    },
  });
  expect(colleagueShiftRes.status(), "Kollegen-Schicht sollte 201 liefern").toBe(201);
  const colleagueShift = (await colleagueShiftRes.json()) as {
    id: number;
    planningStatus: string;
  };
  expect(colleagueShift.planningStatus, "Kollegen-Schicht muss FIX sein").toBe("FIX");
  colleagueShiftId = colleagueShift.id;

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

test("Assistent erstellt Abo-Link über die UI; Feed liefert nur eigene FIX-Schichten", async ({
  page,
}) => {
  test.setTimeout(90_000);
  // Arbeitgeber sicher auf Premium (unabhängig von der Reihenfolge der Tests).
  await setAccountPlan(admin.email, "premium");
  await adoptAssistant(page);

  await page.goto("/einstellungen");
  await openSettingsGroup(page, "darstellung");

  // Der Abo-Bereich ist freigeschaltet und der Assistent hat noch keinen Token:
  // der „Abo-Link erstellen"-Button ist sichtbar.
  const createButton = page.getByTestId("calendar-feed-create");
  await expect(
    createButton,
    "Der Abo-Link-Bereich muss für den Assistenten nutzbar sein",
  ).toBeVisible();

  // Klick erzeugt den Token über den echten Frontend-Pfad (POST /calendar-token).
  await createButton.click();

  // Danach erscheint das Feld mit der Abo-URL.
  const feedUrlInput = page.getByTestId("calendar-feed-url");
  await expect(
    feedUrlInput,
    "Nach dem Erstellen muss die Abo-URL erscheinen",
  ).toBeVisible();

  const feedUrl = await feedUrlInput.inputValue();
  expect(feedUrl, "Die Abo-URL darf nicht leer sein").toBeTruthy();
  // Die URL enthält den 64-stelligen Hex-Token als Pfadsegment.
  const match = feedUrl.match(/\/api\/calendar-feed\/([0-9a-f]{64})$/);
  expect(match, `Abo-URL muss auf einen 64-Hex-Token enden (${feedUrl})`).not.toBeNull();
  const feedPath = `/api/calendar-feed/${match![1]}`;

  // --- Öffentlicher Feed (ohne Session-Cookies) liefert nur eigene Schichten -
  const feed = await publicCtx.get(feedPath);
  expect(feed.status(), "Öffentlicher Feed sollte 200 liefern").toBe(200);
  expect(feed.headers()["content-type"]).toContain("text/calendar");
  const ics = await feed.text();
  expect(ics).toContain("BEGIN:VCALENDAR");
  expect(
    ics,
    "Feed muss die EIGENE FIX-Schicht des Assistenten enthalten",
  ).toContain(`UID:shift-${ownShiftId}@dienstplan-app`);
  expect(
    ics,
    "SICHERHEIT: Feed darf die Schicht des Kollegen NICHT enthalten",
  ).not.toContain(`UID:shift-${colleagueShiftId}@dienstplan-app`);
  expect(
    ics,
    "SICHERHEIT: Feed darf den Namen des Kollegen NICHT enthalten (PII)",
  ).not.toContain(colleagueName);

  // --- Gegenprobe: Downgrade des Arbeitgebers sperrt den Feed (403) ----------
  // Der Assistent selbst bleibt „free"; das calendarSync-Gate hängt am Plan des
  // Team-Eigentümers (Arbeitgebers). Der bereits ausgegebene Token bleibt in der
  // DB, der Feed liefert aber 403 statt weiter Daten (Bestandsschutz betrifft
  // nur Login/Widerruf, nicht den Premium-Datenzugriff).
  await setAccountPlan(admin.email, "free");

  const feedAfterDowngrade = await publicCtx.get(feedPath);
  expect(
    feedAfterDowngrade.status(),
    "Nach Arbeitgeber-Downgrade muss der Feed 403 liefern",
  ).toBe(403);
  const feedErr = (await feedAfterDowngrade.json()) as { code?: string };
  expect(feedErr.code, "Feed-403 muss plan_feature_required tragen").toBe(
    "plan_feature_required",
  );

  // Premium wiederherstellen, damit Geschwister-Specs nicht beeinflusst werden.
  await setAccountPlan(admin.email, "premium");
});
