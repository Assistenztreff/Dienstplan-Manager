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
 * UI-Test (Task #373, frühere Idee #311): Ein ASSISTENT mit einem
 * PREMIUM-Arbeitgeber sieht in den Einstellungen die Kalender-Export-/Abo-Karte
 * (`CalendarExportCard`) tatsächlich FREIGESCHALTET — der Zugang hängt am Plan
 * des Arbeitgebers (Team-Eigentümers), nicht am eigenen Assistenten-Plan (der
 * bleibt bewusst „free"). Das Frontend prüft das über die ohnehin Premium-
 * gegatete Token-Probe `GET /api/calendar-token` (200 = entsperrt, 403 = gesperrt),
 * NICHT über `currentUser.plan`.
 *
 * Gegenprobe: Nach einem Downgrade des Arbeitgebers auf „free" ist die Karte
 * für denselben Assistenten wieder gesperrt (deaktivierter Button + Premium-
 * Hinweis) — die Session des Assistenten bleibt dabei gültig (Bestandsschutz).
 *
 * Läuft gegen den isolierten Test-Stack (eigener API + Vite auf der `_test`-DB).
 */

/** Der Premium-Hinweis, den die gesperrte Karte im Free-Umfeld anzeigt. */
const CALENDAR_SYNC_HINT = /Der Kalender-Export \(\.ics\) ist ein Premium-Feature/;

let admin: FreeAccount;
let assistantCtx: APIRequestContext | undefined;
let assistantId = 0;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  admin = await registerFreeAccount("privat", "kal-karte-assist");
  // Manuelle Premium-Freischaltung direkt in der Test-DB (wie im Operator-
  // Dashboard) — Einladen + Kalender-Token sind Premium-Features.
  setAccountPlan(admin.email, "premium");

  const unique = Date.now();
  const assistantRes = await admin.ctx.post("/api/users", {
    data: {
      name: `E2E KalKarte Assistent ${unique}`,
      email: `e2e.kalkarte.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(assistantRes.status(), "Assistent anlegen sollte 201 liefern").toBe(201);
  assistantId = ((await assistantRes.json()) as { id: number }).id;

  // Assistent per Einladungsflow einloggen (Invite ist Premium; set-password
  // meldet direkt an). Der Assistent selbst bleibt „free".
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
  // inkl. des angelegten Assistenten (verwaiste Assistenten werden mitgelöscht).
  await deleteFreeAccount(admin);
  try {
    await assistantCtx?.dispose();
  } catch {
    /* ignore */
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

test("Premium-Arbeitgeber: Assistent sieht die Kalender-Abo-Karte freigeschaltet", async ({
  page,
}) => {
  test.setTimeout(60_000);
  // Arbeitgeber sicher auf Premium (unabhängig von der Reihenfolge der Tests).
  setAccountPlan(admin.email, "premium");
  await adoptAssistant(page);

  await page.goto("/einstellungen");

  // Der Export-Button ist sichtbar UND freigeschaltet (kein disabled).
  const exportButton = page.getByTestId("calendar-export-button");
  await expect(exportButton).toBeVisible();
  await expect(
    exportButton,
    "Bei Premium-Arbeitgeber muss der Export-Button freigeschaltet sein",
  ).toBeEnabled();

  // Der Abo-Bereich ist freigeschaltet: der Assistent hat noch keinen Token,
  // also erscheint der „Abo-Link erstellen"-Button.
  await expect(
    page.getByTestId("calendar-feed-create"),
    "Der Abo-Link-Bereich muss für den Assistenten nutzbar sein",
  ).toBeVisible();

  // Der Premium-Sperrhinweis darf NICHT erscheinen.
  await expect(
    page.getByText(CALENDAR_SYNC_HINT),
    "Bei Premium-Arbeitgeber darf kein Premium-Sperrhinweis erscheinen",
  ).toHaveCount(0);
});

test("Free-Arbeitgeber: Karte bleibt für den Assistenten gesperrt (Gegentest)", async ({
  page,
}) => {
  test.setTimeout(60_000);
  // Arbeitgeber-Downgrade — die Assistenten-Session bleibt gültig (Bestands-
  // schutz), nur das calendarSync-Gate greift wieder (Plan pro Request frisch).
  setAccountPlan(admin.email, "free");
  await adoptAssistant(page);

  await page.goto("/einstellungen");

  const exportButton = page.getByTestId("calendar-export-button");
  await expect(exportButton).toBeVisible();
  await expect(
    exportButton,
    "Bei Free-Arbeitgeber muss der Export-Button gesperrt sein",
  ).toBeDisabled();

  await expect(
    page.getByText(CALENDAR_SYNC_HINT),
    "Bei Free-Arbeitgeber muss der Premium-Sperrhinweis erscheinen",
  ).toBeVisible();

  // Der Abo-Bereich (erstellen/erneuern) darf im Free-Umfeld nicht auftauchen.
  await expect(page.getByTestId("calendar-feed-create")).toHaveCount(0);
  await expect(page.getByTestId("calendar-feed-rotate")).toHaveCount(0);

  // Premium wiederherstellen, damit Geschwister-Specs nicht beeinflusst werden.
  setAccountPlan(admin.email, "premium");
});
