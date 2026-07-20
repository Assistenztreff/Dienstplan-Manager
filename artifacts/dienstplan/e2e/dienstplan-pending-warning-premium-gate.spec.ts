import { test, expect } from "@playwright/test";
import {
  enableTimeTracking,
  deleteFreeAccount,
  registerFreeAccount,
  setAccountPlan,
  type FreeAccount,
} from "./helpers/teams";

/**
 * Beweist das Premium-Gate der Dashboard-Warnung "X offene Zeiterfassungen"
 * (Task #258): Der Server liefert in GET /api/dashboard/summary das Flag
 * `warnings.timeTrackingConfirmable` (true, sobald mindestens ein Team im Scope
 * einen Premium-Eigentümer mit Freigabe-Workflow hat) und das Frontend zeigt
 * die Warnung (`data-testid="warning-pending-time-entries"`) NUR dann.
 *
 * Für Free-Konten ist "offen" der Normalzustand (die Stunden zählen bereits,
 * Bestätigen ist Premium) — die Warnung wäre ein unerfüllbares To-do und wird
 * ausgeblendet. Der Zähler `pendingTimeEntries` bleibt dabei unverändert > 0
 * (Summary UND warnings-Block), nur die Warn-Darstellung ist gegated.
 *
 * Abdeckung gegen den isolierten Test-Stack:
 *
 * 1. Free-Phase (API): timeTrackingConfirmable=false, pendingTimeEntries > 0.
 * 2. Free-Phase (UI): Dashboard geladen, testid warning-pending-time-entries
 *    existiert NICHT.
 * 3. Upgrade (users.plan='premium' direkt in der Test-DB, wie die manuelle
 *    Freischaltung im Operator-Dashboard): Flag true, Zähler unverändert.
 * 4. Premium (UI): Warnung sichtbar, nennt den Zähler, Klick navigiert nach
 *    /zeiterfassung?status=pending.
 *
 * Hinweis Login: Die Browser-Teile übernehmen die per API registrierte Session
 * (storageState) statt des Login-Formulars — im Vite-DEV feuert sonst der
 * Auto-Dev-Login, sobald /api/auth/me 401 liefert (Memory e2e-dev-auto-login).
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
  pendingTimeEntries: number;
  warnings?: { pendingTimeEntries: number; timeTrackingConfirmable: boolean };
}

let acc: FreeAccount;
let assistantId = 0;
let entryId = 0;

async function fetchSummary(): Promise<Summary> {
  const res = await acc.ctx.get("/api/dashboard/summary");
  expect(res.ok(), `GET /api/dashboard/summary fehlgeschlagen (${res.status()})`).toBe(true);
  return (await res.json()) as Summary;
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  // Frisches Free-Konto (privat genügt): Registrierung legt das Standard-Team
  // an, resolveWriteTeamId greift ohne explizite teamId.
  acc = await registerFreeAccount("privat", "pendwarn");
  await enableTimeTracking(acc.ctx);

  // Assistent im Standard-Team anlegen ...
  const userRes = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E PendWarn Assistent ${Date.now()}`,
      email: `e2e.pendwarn.${Date.now()}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(userRes.status(), "Assistent sollte 201 liefern").toBe(201);
  assistantId = ((await userRes.json()) as { id: number }).id;

  // ... und einen offenen (pending) Ist-Zeit-Eintrag im aktuellen Monat.
  const day = currentMonthDay();
  const entryRes = await acc.ctx.post("/api/time-tracking", {
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
});

test.afterAll(async () => {
  // Konto + Standard-Team + Ist-Zeiten + verwaister Assistent werden per
  // SQL-Bereinigung entfernt (DELETE /api/users scheitert am Team-FK-Baum).
  await deleteFreeAccount(acc);
});

test("Free (API): Flag false, Zähler trotzdem > 0", async () => {
  const summary = await fetchSummary();
  // Reiner Free-Scope: kein Freigabe-Workflow -> keine Warn-Darstellung ...
  expect(
    summary.warnings?.timeTrackingConfirmable,
    "Free-Scope darf keinen Freigabe-Workflow melden",
  ).toBe(false);
  // ... aber der faktische Zähler bleibt korrekt (KPI-Kachel, kein Anzeige-Filter).
  expect(summary.pendingTimeEntries, "Zähler in der Summary muss > 0 bleiben").toBeGreaterThan(0);
  expect(
    summary.warnings?.pendingTimeEntries,
    "Zähler im warnings-Block muss > 0 bleiben",
  ).toBeGreaterThan(0);
});

test("Free (UI): keine 'offene Zeiterfassungen'-Warnung auf dem Dashboard", async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ storageState: await acc.ctx.storageState() });
  const page = await context.newPage();
  try {
    await page.goto("/");
    // Erst warten, bis das Dashboard geladen ist (KPI-Kachel sichtbar), damit
    // das "nicht vorhanden" nicht nur den Ladezustand trifft.
    await expect(page.getByTestId("kpi-hours-balance")).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByTestId("warning-pending-time-entries"),
      "Warnung darf für Free nicht gerendert werden",
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("Premium (API): Flag true, Zähler unverändert", async () => {
  test.setTimeout(60_000);
  // Manuelle Premium-Freischaltung direkt in der Test-DB (Operator-Dashboard-Weg).
  await setAccountPlan(acc.email, "premium");

  const summary = await fetchSummary();
  expect(
    summary.warnings?.timeTrackingConfirmable,
    "Premium-Eigentümer muss den Freigabe-Workflow aktivieren",
  ).toBe(true);
  expect(summary.pendingTimeEntries).toBeGreaterThan(0);
  expect(summary.warnings?.pendingTimeEntries).toBeGreaterThan(0);
});

test("Premium (UI): Warnung sichtbar, Klick führt zu /zeiterfassung?status=pending", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ storageState: await acc.ctx.storageState() });
  const page = await context.newPage();
  try {
    await page.goto("/");

    const warning = page.getByTestId("warning-pending-time-entries");
    await expect(warning, "Warnung muss für Premium sichtbar sein").toBeVisible({
      timeout: 30_000,
    });
    await expect(warning).toContainText(/offene Zeiterfassung/);

    await warning.click();
    await expect(page).toHaveURL(/\/zeiterfassung\?status=pending/);
  } finally {
    await context.close();
  }
});
