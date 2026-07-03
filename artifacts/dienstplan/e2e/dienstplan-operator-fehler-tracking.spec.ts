import { execSync } from "node:child_process";
import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";
import {
  registerFreeAccount,
  deleteFreeAccount,
  deleteAccountByEmail,
  type FreeAccount,
} from "./helpers/teams";

/**
 * E2E-/Regressionstest: Echtes Fehler-Tracking im Operator-Dashboard (Task #337).
 *
 * Abgesichert wird die komplette Kette:
 *   1. Ein unbehandelter Serverfehler (Dev-Route GET /api/dev/boom) wird vom
 *      zentralen Error-Handler abgefangen, als 500 beantwortet und in
 *      `platform_errors` persistiert,
 *   2. GET /api/operator/errors liefert den Eintrag NUR für superadmin
 *      (admin → 403, anonym → 401),
 *   3. das Operator-Dashboard zeigt die Zeile in der Karte „Fehler-Tracking"
 *      und die Lexware-Karte trägt das „Demo-Daten"-Badge.
 *
 * Setup wie im Plan-Audit-Spec: superadmin kann nur per setup-superadmin-Skript
 * direkt in der Test-DB geseedet werden; E-Mail im Muster
 * `e2e.*@dienstplan.test` für den automatischen Cleanup.
 *
 * Läuft gegen den isolierten Test-Stack (eigener API + Vite auf der `_test`-DB,
 * NODE_ENV=development — die Dev-Route /api/dev/boom ist dort vorhanden).
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

interface OperatorErrorRow {
  id: number;
  level: "error" | "warning";
  message: string;
  context: string | null;
  resolved: boolean;
  count: number;
  lastSeenAt: string;
  createdAt: string;
}

/** Seedet einen superadmin direkt in der (Test-)DB via setup-superadmin-Skript. */
function seedSuperadmin(email: string, password: string, name: string): void {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SUPERADMIN_EMAIL: email,
    SUPERADMIN_PASSWORD: password,
    SUPERADMIN_NAME: name,
  };
  if (process.env.E2E_TEST_DATABASE_URL) {
    env.DATABASE_URL = process.env.E2E_TEST_DATABASE_URL;
  }
  execSync("pnpm --filter @workspace/scripts run setup-superadmin", {
    env,
    stdio: "pipe",
  });
}

test.describe("Fehler-Tracking im Operator-Dashboard", () => {
  // Setup (Registrierung + Skript-Seeding) kann unter Suiten-Volllast dauern.
  test.setTimeout(120_000);

  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const superEmail = `e2e.superadmin.err.${stamp}@dienstplan.test`;
  const superPassword = "superadmin1234";
  const superName = `E2E Betreiber Fehler ${stamp}`;

  let admin: FreeAccount;
  let superCtx: APIRequestContext;
  let recordedErrorId = 0;

  test.beforeAll(async () => {
    // Normales Admin-Konto: darf die Operator-Endpunkte NICHT sehen.
    admin = await registerFreeAccount("privat", "fehlertracking");

    // Betreiber-Konto direkt in der Test-DB seeden und einloggen.
    seedSuperadmin(superEmail, superPassword, superName);
    superCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    const loginRes = await superCtx.post("/api/auth/login", {
      data: { email: superEmail, password: superPassword },
    });
    expect(loginRes.ok(), `Superadmin-Login fehlgeschlagen (${loginRes.status()})`).toBe(
      true,
    );
  });

  test.afterAll(async () => {
    try {
      deleteAccountByEmail(superEmail);
    } catch {
      /* Best effort — Cleanup darf den Lauf nicht kippen. */
    }
    try {
      await superCtx?.dispose();
    } catch {
      /* ignore */
    }
    await deleteFreeAccount(admin);
  });

  test("API: unbehandelter Serverfehler wird persistiert und geliefert", async () => {
    // Absichtlich einen 500er auslösen (Dev-Route, wirft synchron).
    const boomRes = await superCtx.get("/api/dev/boom");
    expect(boomRes.status(), "Dev-Boom-Route muss 500 liefern").toBe(500);
    const body = (await boomRes.json()) as { error: string };
    expect(body.error, "Kein Stacktrace/Details im Response-Body").toBe(
      "Interner Serverfehler",
    );

    // Der Fehler MUSS im Operator-Endpunkt auftauchen (neueste zuerst).
    const listRes = await superCtx.get("/api/operator/errors");
    expect(listRes.status()).toBe(200);
    const errors = (await listRes.json()) as OperatorErrorRow[];

    const entry = errors.find(
      (e) => e.message.includes("Dev-Testfehler") && e.context === "GET /api/dev/boom",
    );
    expect(entry, "Ausgelöster Fehler fehlt in /api/operator/errors").toBeTruthy();
    expect(entry!.level).toBe("error");
    expect(entry!.resolved, "Neue Fehler starten als offen").toBe(false);
    expect(entry!.count, "Zähler startet bei mindestens 1").toBeGreaterThanOrEqual(1);
    const createdAt = new Date(entry!.createdAt).getTime();
    expect(Number.isNaN(createdAt), "createdAt muss ein Datum sein").toBe(false);
    const lastSeenAt = new Date(entry!.lastSeenAt).getTime();
    expect(Number.isNaN(lastSeenAt), "lastSeenAt muss ein Datum sein").toBe(false);

    recordedErrorId = entry!.id;
  });

  test("API: Wiederholungen werden gebündelt (eine Zeile, Zähler steigt)", async () => {
    expect(recordedErrorId, "API-Test muss vorher gelaufen sein").toBeGreaterThan(0);

    // Ausgangszustand des gebündelten Eintrags festhalten.
    const beforeRes = await superCtx.get("/api/operator/errors");
    const before = ((await beforeRes.json()) as OperatorErrorRow[]).find(
      (e) => e.id === recordedErrorId,
    );
    expect(before, "Gebündelter Eintrag muss existieren").toBeTruthy();

    // Denselben Fehler zweimal erneut auslösen …
    for (let i = 0; i < 2; i++) {
      const res = await superCtx.get("/api/dev/boom");
      expect(res.status()).toBe(500);
    }

    // … es bleibt EINE Zeile (gleiche id), der Zähler steigt um 2 und
    // lastSeenAt rückt nach vorn.
    const afterRes = await superCtx.get("/api/operator/errors");
    const errors = (await afterRes.json()) as OperatorErrorRow[];
    const matching = errors.filter(
      (e) => e.message.includes("Dev-Testfehler") && e.context === "GET /api/dev/boom",
    );
    expect(matching.length, "Wiederholungen dürfen KEINE neuen Zeilen anlegen").toBe(1);
    expect(matching[0].id, "Gebündelt in denselben Eintrag").toBe(recordedErrorId);
    expect(matching[0].count).toBe(before!.count + 2);
    expect(
      new Date(matching[0].lastSeenAt).getTime(),
      "lastSeenAt muss beim Wiederauftreten nach vorn rücken",
    ).toBeGreaterThanOrEqual(new Date(before!.lastSeenAt).getTime());
  });

  test("API: abgehakter Fehler gilt beim Wiederauftreten wieder als offen", async () => {
    expect(recordedErrorId, "API-Test muss vorher gelaufen sein").toBeGreaterThan(0);

    // Ganze Gruppe abhaken …
    const resolveRes = await superCtx.patch(
      `/api/operator/errors/${recordedErrorId}`,
      { data: { resolved: true } },
    );
    expect(resolveRes.status()).toBe(200);
    expect(((await resolveRes.json()) as OperatorErrorRow).resolved).toBe(true);

    // … Fehler tritt erneut auf …
    const boomRes = await superCtx.get("/api/dev/boom");
    expect(boomRes.status()).toBe(500);

    // … derselbe Eintrag ist wieder offen.
    const listRes = await superCtx.get("/api/operator/errors");
    const entry = ((await listRes.json()) as OperatorErrorRow[]).find(
      (e) => e.id === recordedErrorId,
    );
    expect(entry, "Eintrag muss weiterhin existieren").toBeTruthy();
    expect(entry!.resolved, "Wiederauftreten öffnet den Eintrag erneut").toBe(false);
  });

  test("API: Fehler abhaken und wieder öffnen (PATCH), nur superadmin", async () => {
    expect(recordedErrorId, "API-Test muss vorher gelaufen sein").toBeGreaterThan(0);

    // Abhaken …
    const resolveRes = await superCtx.patch(
      `/api/operator/errors/${recordedErrorId}`,
      { data: { resolved: true } },
    );
    expect(resolveRes.status()).toBe(200);
    const resolvedRow = (await resolveRes.json()) as OperatorErrorRow;
    expect(resolvedRow.resolved).toBe(true);

    // … Status ist in der Liste sichtbar …
    const listRes = await superCtx.get("/api/operator/errors");
    const errors = (await listRes.json()) as OperatorErrorRow[];
    expect(errors.find((e) => e.id === recordedErrorId)?.resolved).toBe(true);

    // … und wieder öffnen (für den UI-Test unten, der mit einem OFFENEN
    // Eintrag startet).
    const reopenRes = await superCtx.patch(
      `/api/operator/errors/${recordedErrorId}`,
      { data: { resolved: false } },
    );
    expect(reopenRes.status()).toBe(200);
    expect(((await reopenRes.json()) as OperatorErrorRow).resolved).toBe(false);

    // Zugriffsschutz: normaler Admin darf NICHT abhaken (403), unbekannte
    // ID liefert 404.
    const adminPatch = await admin.ctx.patch(
      `/api/operator/errors/${recordedErrorId}`,
      { data: { resolved: true } },
    );
    expect(adminPatch.status(), "Admin darf Fehler nicht abhaken").toBe(403);

    const missingPatch = await superCtx.patch("/api/operator/errors/999999", {
      data: { resolved: true },
    });
    expect(missingPatch.status()).toBe(404);
  });

  test("API: Zugriffsschutz — admin 403, anonym 401", async () => {
    const adminRes = await admin.ctx.get("/api/operator/errors");
    expect(adminRes.status(), "Normaler Admin darf Fehler nicht sehen").toBe(403);

    const anonCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      const anonRes = await anonCtx.get("/api/operator/errors");
      expect(anonRes.status(), "Anonym muss 401 liefern").toBe(401);
    } finally {
      await anonCtx.dispose();
    }
  });

  test("UI: Karte Fehler-Tracking zeigt den Eintrag, Lexware-Karte ist als Demo markiert", async ({
    page,
  }) => {
    expect(recordedErrorId, "API-Test muss vorher gelaufen sein").toBeGreaterThan(0);

    // Programmatische Anmeldung als superadmin (Cookie-Jar geteilt mit dem
    // Browser — der Dev-Auto-Login greift dadurch nie).
    const loginRes = await page.request.post("/api/auth/login", {
      data: { email: superEmail, password: superPassword },
    });
    expect(loginRes.ok(), "UI-Login als superadmin fehlgeschlagen").toBe(true);

    await page.goto("/operator-dashboard");

    // Der aufgezeichnete Fehler ist in der Karte „Fehler-Tracking" sichtbar …
    const row = page.getByTestId(`row-operator-error-${recordedErrorId}`);
    await expect(row).toBeVisible();
    await expect(row).toContainText("Dev-Testfehler");
    await expect(row).toContainText("GET /api/dev/boom");
    await expect(row).toContainText("Fehler");

    // … und die Lexware-Karte ist ehrlich als Demo-Daten gekennzeichnet.
    await expect(page.getByTestId("badge-lexware-demo")).toBeVisible();

    // --- Abhaken-Flow: Eintrag als erledigt markieren ---
    // Standard-Filter „Offene": nach dem Abhaken verschwindet die Zeile.
    await row.getByTestId(`button-error-toggle-${recordedErrorId}`).click();
    await expect(row).not.toBeVisible();

    // Filter „Alle": erledigter Eintrag ist ausgegraut sichtbar (Text
    // „Erledigt") und lässt sich wieder öffnen.
    await page.getByTestId("button-error-filter-all").click();
    await expect(row).toBeVisible();
    await expect(row).toContainText("Erledigt");

    await row.getByTestId(`button-error-toggle-${recordedErrorId}`).click();
    await expect(row).not.toContainText("· Erledigt");

    // Zurück auf „Offene": der wieder geöffnete Eintrag ist dort sichtbar.
    await page.getByTestId("button-error-filter-open").click();
    await expect(row).toBeVisible();
  });

  test("API: Alle offenen Fehler in einem Schritt abhaken (resolve-all), nur superadmin", async () => {
    // Zwei zusätzliche offene Einträge erzeugen (Vorfall-Szenario mit
    // mehreren gleichartigen Fehlern).
    await superCtx.get("/api/dev/boom");
    await superCtx.get("/api/dev/boom");

    const beforeRes = await superCtx.get("/api/operator/errors");
    const before = (await beforeRes.json()) as OperatorErrorRow[];
    const openBefore = before.filter((e) => !e.resolved);
    expect(openBefore.length, "Es müssen offene Einträge existieren").toBeGreaterThanOrEqual(2);

    // Zugriffsschutz: normaler Admin (403) und anonym (401) dürfen NICHT
    // sammel-abhaken.
    const adminRes = await admin.ctx.post("/api/operator/errors/resolve-all");
    expect(adminRes.status(), "Admin darf nicht sammel-abhaken").toBe(403);
    const anonCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      const anonRes = await anonCtx.post("/api/operator/errors/resolve-all");
      expect(anonRes.status(), "Anonym muss 401 liefern").toBe(401);
    } finally {
      await anonCtx.dispose();
    }

    // Superadmin hakt alle offenen Einträge in einem Schritt ab.
    const resolveAllRes = await superCtx.post("/api/operator/errors/resolve-all");
    expect(resolveAllRes.status()).toBe(200);
    const result = (await resolveAllRes.json()) as { resolvedCount: number };
    expect(
      result.resolvedCount,
      "resolvedCount muss mindestens die vorher offenen Einträge umfassen",
    ).toBeGreaterThanOrEqual(openBefore.length);

    // Alle vorher offenen Einträge sind jetzt erledigt.
    const afterRes = await superCtx.get("/api/operator/errors");
    const after = (await afterRes.json()) as OperatorErrorRow[];
    for (const e of openBefore) {
      expect(
        after.find((a) => a.id === e.id)?.resolved,
        `Eintrag ${e.id} muss nach resolve-all erledigt sein`,
      ).toBe(true);
    }

    // Zweiter Aufruf ohne offene Einträge ist ein sauberer No-Op (0).
    const noopRes = await superCtx.post("/api/operator/errors/resolve-all");
    expect(noopRes.status()).toBe(200);
    expect(((await noopRes.json()) as { resolvedCount: number }).resolvedCount).toBe(0);
  });

  test("UI: Button „Alle abhaken“ mit Bestätigung räumt die Liste auf", async ({ page }) => {
    // Frischen offenen Eintrag erzeugen, damit der Button sichtbar ist.
    await superCtx.get("/api/dev/boom");

    const loginRes = await page.request.post("/api/auth/login", {
      data: { email: superEmail, password: superPassword },
    });
    expect(loginRes.ok(), "UI-Login als superadmin fehlgeschlagen").toBe(true);

    await page.goto("/operator-dashboard");

    // Button ist nur sichtbar, solange offene Einträge existieren.
    const resolveAllButton = page.getByTestId("button-error-resolve-all");
    await expect(resolveAllButton).toBeVisible();

    // Abbrechen im Bestätigungs-Dialog ändert nichts.
    await resolveAllButton.click();
    const dialog = page.getByTestId("dialog-error-resolve-all");
    await expect(dialog).toBeVisible();
    await page.getByTestId("button-error-resolve-all-cancel").click();
    await expect(dialog).not.toBeVisible();
    await expect(resolveAllButton).toBeVisible();

    // Bestätigen: alle offenen Einträge werden abgehakt, der Leerzustand
    // „Keine offenen Fehler" erscheint und der Button verschwindet.
    await resolveAllButton.click();
    await expect(dialog).toBeVisible();
    await page.getByTestId("button-error-resolve-all-confirm").click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByTestId("text-operator-errors-empty")).toContainText(
      "Keine offenen Fehler",
    );
    await expect(resolveAllButton).not.toBeVisible();

    // Filter „Alle": die erledigten Einträge sind weiterhin vorhanden
    // (Bestandsschutz — abhaken löscht nichts).
    await page.getByTestId("button-error-filter-all").click();
    await expect(page.getByText("· Erledigt").first()).toBeVisible();
  });
});
