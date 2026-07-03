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
    const createdAt = new Date(entry!.createdAt).getTime();
    expect(Number.isNaN(createdAt), "createdAt muss ein Datum sein").toBe(false);

    recordedErrorId = entry!.id;
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
  });
});
