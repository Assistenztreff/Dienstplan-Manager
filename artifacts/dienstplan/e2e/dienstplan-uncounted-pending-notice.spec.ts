import { test, expect } from "@playwright/test";
import {
  deleteFreeAccount,
  registerFreeAccount,
  setAccountPlan,
  type FreeAccount,
} from "./helpers/teams";

/**
 * Absicherung des Upgrade-Transparenz-Flows (Task #265): Nach einer manuellen
 * Premium-Freischaltung fallen zuvor gezählte "offene" Zeiteinträge aus den
 * Ist-Stunden (strictTimeTracking), bis sie bestätigt sind. Damit die Stunden
 * nicht kommentarlos schrumpfen, weist `GET /api/dashboard/summary` die nicht
 * gezählte Summe als `uncountedPendingHours`/`uncountedPendingEntries` aus und
 * das Dashboard zeigt daraus den blauen Hinweis (`UncountedPendingNotice`,
 * data-testid "uncounted-pending-notice") mit "Jetzt prüfen"-Link auf
 * /zeiterfassung?status=pending.
 *
 * Abgedeckt wird der komplette Lebenszyklus gegen den isolierten Test-Stack:
 *
 * 1. Free-Phase: pending-Eintrag zählt in monthlyActualHours (lenient),
 *    uncountedPendingHours/Entries = 0, keine "offen"-Warnung
 *    (timeTrackingConfirmable = false).
 * 2. Upgrade (users.plan = 'premium' direkt in der Test-DB, wie die manuelle
 *    Freischaltung im Operator-Dashboard): dieselben Stunden wandern aus
 *    monthlyActualHours nach uncountedPendingHours/Entries,
 *    timeTrackingConfirmable wird true.
 * 3. UI: Der Hinweis ist auf dem Dashboard sichtbar (nur bei
 *    uncountedPendingHours > 0) und "Jetzt prüfen" navigiert nach
 *    /zeiterfassung?status=pending.
 * 4. Nach Bestätigung (PATCH /time-tracking/:id/confirm): Stunden zählen
 *    wieder in monthlyActualHours, uncounted* = 0, der Hinweis verschwindet.
 *
 * Eine Regression in der Summary-Route oder der Lenient-Team-Logik
 * (getLenientTimeTrackingTeamIds) würde hier sofort auffallen.
 *
 * Hinweis Login: Der Browser-Teil nutzt die per API registrierte Session
 * (storageState des Request-Kontexts) statt des Login-Formulars — im Vite-DEV
 * feuert sonst der Auto-Dev-Login, sobald /api/auth/me 401 liefert (siehe
 * Memory e2e-dev-auto-login). Mit gültigem Session-Cookie lädt die App direkt
 * als unser frisches Konto.
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
  warnings?: { timeTrackingConfirmable: boolean };
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
  acc = await registerFreeAccount("privat", "uncounted");

  // Assistent im Standard-Team anlegen ...
  const userRes = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E Uncounted Assistent ${Date.now()}`,
      email: `e2e.uncounted.${Date.now()}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(userRes.status(), "Assistent sollte 201 liefern").toBe(201);
  assistantId = ((await userRes.json()) as { id: number }).id;

  // ... und einen offenen (pending) 8h-Ist-Zeit-Eintrag im aktuellen Monat.
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

test("Free-Phase: pending zählt in den Ist-Stunden, kein Hinweis nötig", async () => {
  const summary = await fetchSummary();
  // Lenient (Free-Eigentümer, kein Freigabe-Workflow): offene Stunden zählen.
  expect(summary.monthlyActualHours, "Offene 8h müssen im Free-Team zählen").toBe(8);
  expect(summary.uncountedPendingHours, "Im Free-Team darf nichts 'ungezählt' sein").toBe(0);
  expect(summary.uncountedPendingEntries).toBe(0);
  // Reiner Free-Scope: "offen" ist Normalzustand, keine Warnung.
  expect(summary.warnings?.timeTrackingConfirmable).toBe(false);
});

test("Nach Upgrade: Stunden wandern nach uncountedPendingHours/Entries", async () => {
  test.setTimeout(60_000);
  // Manuelle Premium-Freischaltung direkt in der Test-DB (Operator-Dashboard-Weg).
  setAccountPlan(acc.email, "premium");

  const summary = await fetchSummary();
  // Strikt (Premium-Eigentümer): pending zählt NICHT mehr ...
  expect(summary.monthlyActualHours, "Pending darf nach dem Upgrade nicht mehr zählen").toBe(0);
  // ... wird aber explizit als ungezählt ausgewiesen (kein stilles Schrumpfen).
  expect(summary.uncountedPendingHours, "Die 8h müssen als ungezählt ausgewiesen werden").toBe(8);
  expect(summary.uncountedPendingEntries).toBe(1);
  // Jetzt gibt es einen Freigabe-Workflow -> "offen" ist ein To-do.
  expect(summary.warnings?.timeTrackingConfirmable).toBe(true);
});

test("UI: Hinweis sichtbar, 'Jetzt prüfen' führt zu /zeiterfassung?status=pending", async ({ browser }) => {
  test.setTimeout(120_000);
  // Session-Cookie aus dem API-Kontext übernehmen -> kein Login-Formular nötig
  // (und der Dev-Auto-Login feuert nicht, weil /api/auth/me 200 liefert).
  const context = await browser.newContext({ storageState: await acc.ctx.storageState() });
  const page = await context.newPage();
  try {
    await page.goto("/");

    const notice = page.getByTestId("uncounted-pending-notice");
    await expect(notice, "Hinweis muss bei uncountedPendingHours > 0 sichtbar sein").toBeVisible({
      timeout: 30_000,
    });
    await expect(notice).toContainText("8 Stunden");

    await page.getByTestId("uncounted-pending-review").click();
    await expect(page).toHaveURL(/\/zeiterfassung\?status=pending/);
  } finally {
    await context.close();
  }
});

test("Nach Bestätigung: Stunden zählen wieder, Hinweis verschwindet", async ({ browser }) => {
  test.setTimeout(120_000);
  // Nachbestätigen (jetzt Premium -> strictTimeTracking erlaubt die Aktion).
  const confirmRes = await acc.ctx.patch(`/api/time-tracking/${entryId}/confirm`, {
    data: { status: "confirmed", confirmedBy: acc.id },
  });
  expect(confirmRes.status(), "Bestätigen sollte mit Premium 200 liefern").toBe(200);

  const summary = await fetchSummary();
  expect(summary.monthlyActualHours, "Bestätigte 8h müssen wieder zählen").toBe(8);
  expect(summary.uncountedPendingHours, "Nichts mehr ungezählt").toBe(0);
  expect(summary.uncountedPendingEntries).toBe(0);

  // UI-Gegenprobe: Der Hinweis ist vom Dashboard verschwunden.
  const context = await browser.newContext({ storageState: await acc.ctx.storageState() });
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
