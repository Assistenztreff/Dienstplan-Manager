import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import {
  BASE_URL,
  deleteFreeAccount,
  registerFreeAccount,
  setAccountPlan,
  type FreeAccount,
} from "./helpers/teams";

/**
 * Upgrade-Transparenz aus ASSISTENTEN-Sicht (Task #267): Der Assistant-Branch
 * von `GET /api/dashboard/summary` (personalisierte uncountedPendingHours/
 * -Entries) war bisher ungetestet — der Admin-Branch ist durch
 * `dienstplan-uncounted-pending-notice.spec.ts` abgedeckt. Eine Regression im
 * Assistant-Branch würde Assistenten nach dem Upgrade ihres Arbeitgebers
 * kommentarlos schrumpfende Ist-Stunden zeigen.
 *
 * Ablauf gegen den isolierten Test-Stack:
 *
 * 1. Setup: Frisches Free-Konto (Arbeitgeber), Assistent im Standard-Team,
 *    pending 8h-Ist-Zeit-Eintrag im aktuellen Monat. Assistenten-Login über
 *    den Einladungsflow: Einladen ist Premium (caregiverLogin), daher wird der
 *    Arbeitgeber kurz auf Premium gehoben, der Token erzeugt und der Plan
 *    zurück auf Free gesetzt — Bestandsschutz: der gesetzte Login bleibt
 *    gültig (POST /auth/set-password meldet direkt an).
 * 2. Free-Phase: Der Assistent sieht seine offenen 8h in monthlyActualHours
 *    (lenient, Plan des TEAM-EIGENTÜMERS zählt, nicht der des Assistenten),
 *    uncounted* = 0.
 * 3. Owner-Upgrade (users.plan direkt in der Test-DB, wie die manuelle
 *    Freischaltung): dieselben Stunden wandern aus monthlyActualHours nach
 *    uncountedPendingHours/Entries.
 * 4. UI: Der blaue Hinweis (data-testid "uncounted-pending-notice") ist für
 *    den Assistenten sichtbar, aber OHNE "Jetzt prüfen"-Button (data-testid
 *    "uncounted-pending-review" existiert nicht) — Bestätigen ist eine
 *    Admin-Aktion (isAdmin-Prop im Dashboard).
 * 5. Nach Bestätigung durch den Admin zählen die Stunden wieder und der
 *    Hinweis verschwindet auch beim Assistenten.
 *
 * Hinweis Login: Der Browser-Teil nutzt die Session des Assistenten-
 * Request-Kontexts (storageState) statt des Login-Formulars — im Vite-DEV
 * feuert sonst der Auto-Dev-Login, sobald /api/auth/me 401 liefert (siehe
 * Memory e2e-dev-auto-login).
 */

test.describe.configure({ mode: "serial" });

/** 15. des aktuellen Monats (robust gegen Monatslängen/Zeitzonen). */
function currentMonthDay(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}-15`;
}

interface Summary {
  monthlyActualHours: number;
  uncountedPendingHours: number;
  uncountedPendingEntries: number;
}

let owner: FreeAccount;
let assistantCtx: APIRequestContext | undefined;
let assistantId = 0;
let entryId = 0;

async function fetchAssistantSummary(): Promise<Summary> {
  if (!assistantCtx) throw new Error("Assistenten-Kontext nicht initialisiert");
  const res = await assistantCtx.get("/api/dashboard/summary");
  expect(res.ok(), `GET /api/dashboard/summary (Assistent) fehlgeschlagen (${res.status()})`).toBe(true);
  return (await res.json()) as Summary;
}

test.beforeAll(async () => {
  test.setTimeout(180_000);
  // Frisches Free-Konto (privat genügt): Registrierung legt das Standard-Team
  // an, resolveWriteTeamId greift ohne explizite teamId.
  owner = await registerFreeAccount("privat", "asst-uncounted");

  // Assistent im Standard-Team anlegen ...
  const userRes = await owner.ctx.post("/api/users", {
    data: {
      name: `E2E Assistent Uncounted ${Date.now()}`,
      email: `e2e.asst.uncounted.${Date.now()}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(userRes.status(), "Assistent sollte 201 liefern").toBe(201);
  assistantId = ((await userRes.json()) as { id: number }).id;

  // ... mit einem offenen (pending) 8h-Ist-Zeit-Eintrag im aktuellen Monat.
  const day = currentMonthDay();
  const entryRes = await owner.ctx.post("/api/time-tracking", {
    data: {
      userId: assistantId,
      actualStart: `${day}T08:00:00.000Z`,
      actualEnd: `${day}T16:00:00.000Z`,
    },
  });
  expect(entryRes.status(), "Ist-Zeit sollte 201 liefern").toBe(201);
  const entry = (await entryRes.json()) as { id: number; status: string };
  entryId = entry.id;
  expect(entry.status, "Neuer Ist-Zeit-Eintrag muss 'pending' sein").toBe("pending");

  // Assistenten-Login über den Einladungsflow. Einladen (POST /users/:id/invite)
  // ist Premium-gegated (caregiverLogin) -> Owner kurz auf Premium heben, Token
  // ziehen, zurück auf Free. Bestandsschutz: der per Token gesetzte Login
  // bleibt auch unter Free gültig.
  setAccountPlan(owner.email, "premium");
  let token = "";
  try {
    const inviteRes = await owner.ctx.post(`/api/users/${assistantId}/invite`);
    expect(inviteRes.ok(), `Einladung sollte mit Premium klappen (${inviteRes.status()})`).toBe(true);
    token = ((await inviteRes.json()) as { token: string }).token;
    expect(token, "Einladungs-Token muss geliefert werden").toBeTruthy();
  } finally {
    setAccountPlan(owner.email, "free");
  }

  // Passwort setzen = direkter Login des Assistenten (eigener Session-Kontext).
  assistantCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const setPwRes = await assistantCtx.post("/api/auth/set-password", {
    data: { token, password: "assistent1234" },
  });
  expect(setPwRes.ok(), `set-password sollte 200 liefern (${setPwRes.status()})`).toBe(true);
  const me = await assistantCtx.get("/api/auth/me");
  expect(me.ok(), "Assistent muss nach set-password eingeloggt sein").toBe(true);
  const meBody = (await me.json()) as { id: number; role: string };
  expect(meBody.id).toBe(assistantId);
  expect(meBody.role, "Session muss die Assistenten-Rolle tragen").toBe("assistant");
});

test.afterAll(async () => {
  // Konto + Standard-Team inkl. Ist-Zeiten/Assistent werden per
  // SQL-Bereinigung entfernt (DELETE /api/users scheitert am Team-FK-Baum).
  await assistantCtx?.dispose();
  await deleteFreeAccount(owner);
});

test("Free-Phase: Assistent sieht seine offenen Stunden gezählt, nichts ungezählt", async () => {
  const summary = await fetchAssistantSummary();
  // Lenient: Der Plan des TEAM-EIGENTÜMERS (Free) zählt, nicht der des
  // Assistenten -> offene Stunden fließen in die Ist-Stunden.
  expect(summary.monthlyActualHours, "Offene 8h müssen beim Free-Owner zählen").toBe(8);
  expect(summary.uncountedPendingHours, "Beim Free-Owner darf nichts 'ungezählt' sein").toBe(0);
  expect(summary.uncountedPendingEntries).toBe(0);
});

test("Nach Owner-Upgrade: Stunden wandern in uncountedPendingHours/Entries", async () => {
  test.setTimeout(60_000);
  // Manuelle Premium-Freischaltung des ARBEITGEBERS direkt in der Test-DB.
  setAccountPlan(owner.email, "premium");

  const summary = await fetchAssistantSummary();
  // Strikt (Premium-Owner): pending zählt NICHT mehr ...
  expect(summary.monthlyActualHours, "Pending darf nach dem Owner-Upgrade nicht mehr zählen").toBe(0);
  // ... wird aber auch dem Assistenten explizit ausgewiesen (kein stilles Schrumpfen).
  expect(summary.uncountedPendingHours, "Die 8h müssen als ungezählt ausgewiesen werden").toBe(8);
  expect(summary.uncountedPendingEntries).toBe(1);
});

test("UI: Hinweis sichtbar, aber OHNE 'Jetzt prüfen'-Button für Assistenten", async ({ browser }) => {
  test.setTimeout(120_000);
  if (!assistantCtx) throw new Error("Assistenten-Kontext nicht initialisiert");
  // Session-Cookie des Assistenten übernehmen -> kein Login-Formular nötig
  // (und der Dev-Auto-Login feuert nicht, weil /api/auth/me 200 liefert).
  const context = await browser.newContext({ storageState: await assistantCtx.storageState() });
  const page = await context.newPage();
  try {
    await page.goto("/");

    const notice = page.getByTestId("uncounted-pending-notice");
    await expect(notice, "Hinweis muss auch für Assistenten sichtbar sein").toBeVisible({
      timeout: 30_000,
    });
    await expect(notice).toContainText("8 Stunden");
    // Assistenten-Variante des Erklärtexts (Bestätigen ist Admin-Sache).
    await expect(notice).toContainText("sobald die Einträge bestätigt wurden");
    // Der "Jetzt prüfen"-Button ist eine Admin-Aktion und darf NICHT erscheinen.
    await expect(
      page.getByTestId("uncounted-pending-review"),
      "'Jetzt prüfen' darf für Assistenten nicht existieren",
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("Nach Admin-Bestätigung: Stunden zählen wieder, Hinweis verschwindet", async ({ browser }) => {
  test.setTimeout(120_000);
  if (!assistantCtx) throw new Error("Assistenten-Kontext nicht initialisiert");
  // Der Admin (jetzt Premium -> strictTimeTracking) bestätigt den Eintrag.
  const confirmRes = await owner.ctx.patch(`/api/time-tracking/${entryId}/confirm`, {
    data: { status: "confirmed", confirmedBy: owner.id },
  });
  expect(confirmRes.status(), "Bestätigen sollte mit Premium 200 liefern").toBe(200);

  const summary = await fetchAssistantSummary();
  expect(summary.monthlyActualHours, "Bestätigte 8h müssen wieder zählen").toBe(8);
  expect(summary.uncountedPendingHours, "Nichts mehr ungezählt").toBe(0);
  expect(summary.uncountedPendingEntries).toBe(0);

  // UI-Gegenprobe: Der Hinweis ist vom Assistenten-Dashboard verschwunden.
  const context = await browser.newContext({ storageState: await assistantCtx.storageState() });
  const page = await context.newPage();
  try {
    await page.goto("/");
    // Erst warten, bis das Dashboard geladen ist (KPI-Kachel sichtbar), damit
    // das "nicht sichtbar" nicht nur den Ladezustand trifft.
    await expect(page.getByTestId("kpi-hours-balance")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("uncounted-pending-notice")).toHaveCount(0);
  } finally {
    await context.close();
  }
});
