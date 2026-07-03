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
 * E2E-/Regressionstest: Jede manuelle Premium-Freischaltung landet wirklich
 * im Plan-Änderungsprotokoll (Task #307).
 *
 * Abgesichert wird die komplette Audit-Kette:
 *   1. superadmin führt einen Plan-Flip via PATCH /api/operator/accounts/:id/plan
 *      aus (mit Rechnungsreferenz als `note`),
 *   2. GET /api/operator/plan-changes liefert den Eintrag mit ALLEN Feldern
 *      (Konto-Name/-E-Mail, alter/neuer Plan, Notiz, ausführender superadmin,
 *      Zeitstempel) — auch für den Rück-Flip (premium→free),
 *   3. die Karte „Plan-Änderungsprotokoll" im Operator-Dashboard zeigt die
 *      Zeile (`row-plan-change-*`) mit denselben Angaben an.
 *
 * Setup-Besonderheit: superadmin kann NICHT über die öffentliche API angelegt
 * werden (Registrierung erzeugt immer Rolle admin) — der einzige Weg ist das
 * setup-superadmin-Skript direkt gegen die Test-DB (analog seedForeignAdmin,
 * siehe Memory second-admin-only-via-seed). Die E-Mail folgt bewusst dem
 * Muster `e2e.*@dienstplan.test`, damit cleanup-test-accounts/global-teardown
 * das Konto nach dem Lauf sicher abräumen.
 *
 * Läuft gegen den isolierten Test-Stack (eigener API + Vite auf der `_test`-DB).
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

interface PlanChangeRow {
  id: number;
  accountId: number;
  accountName: string;
  accountEmail: string;
  oldPlan: "free" | "premium";
  newPlan: "free" | "premium";
  note: string | null;
  changedByName: string;
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

test.describe("Plan-Änderungsprotokoll (Operator-Audit-Log)", () => {
  // Setup (Registrierung + Skript-Seeding) kann unter Suiten-Volllast dauern.
  test.setTimeout(120_000);

  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const superEmail = `e2e.superadmin.${stamp}@dienstplan.test`;
  const superPassword = "superadmin1234";
  const superName = `E2E Betreiber ${stamp}`;
  const invoiceNote = `Lexware RE-2026-${stamp}`;

  let target: FreeAccount;
  let superCtx: APIRequestContext;
  let upgradeChangeId = 0;

  test.beforeAll(async () => {
    // Ziel-Konto: frisch registrierter Admin, startet garantiert auf Free.
    target = await registerFreeAccount("privat", "planaudit");

    // Betreiber-Konto direkt in der Test-DB seeden und einloggen.
    seedSuperadmin(superEmail, superPassword, superName);
    superCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    const loginRes = await superCtx.post("/api/auth/login", {
      data: { email: superEmail, password: superPassword },
    });
    expect(loginRes.ok(), `Superadmin-Login fehlgeschlagen (${loginRes.status()})`).toBe(
      true,
    );
    const me = (await (await superCtx.get("/api/auth/me")).json()) as {
      role: string;
    };
    expect(me.role, "Geseedetes Konto muss Rolle superadmin haben").toBe("superadmin");
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
    await deleteFreeAccount(target);
  });

  test("API: Premium-Freischaltung schreibt einen vollständigen Protokoll-Eintrag", async () => {
    const before = Date.now();

    // Plan-Flip free -> premium mit Rechnungsreferenz.
    const patchRes = await superCtx.patch(`/api/operator/accounts/${target.id}/plan`, {
      data: { plan: "premium", note: invoiceNote },
    });
    expect(patchRes.status(), "Plan-Flip muss 200 liefern").toBe(200);
    const account = (await patchRes.json()) as { id: number; plan: string };
    expect(account.plan).toBe("premium");

    // Der Eintrag MUSS sofort im Protokoll auftauchen (neueste zuerst).
    const listRes = await superCtx.get("/api/operator/plan-changes");
    expect(listRes.status()).toBe(200);
    const changes = (await listRes.json()) as PlanChangeRow[];

    const entry = changes.find(
      (c) => c.accountId === target.id && c.newPlan === "premium",
    );
    expect(entry, "Premium-Freischaltung fehlt im Protokoll").toBeTruthy();
    expect(entry!.oldPlan).toBe("free");
    expect(entry!.newPlan).toBe("premium");
    expect(entry!.accountEmail).toBe(target.email);
    expect(entry!.note).toBe(invoiceNote);
    // Ausführender superadmin wird namentlich protokolliert.
    expect(entry!.changedByName).toBe(superName);
    // Zeitstempel plausibel: nicht älter als der Testbeginn (großzügige
    // Toleranz gegen Uhren-Drift zwischen Test-Runner und DB).
    const createdAt = new Date(entry!.createdAt).getTime();
    expect(Number.isNaN(createdAt), "createdAt muss ein Datum sein").toBe(false);
    expect(createdAt).toBeGreaterThan(before - 5 * 60_000);

    upgradeChangeId = entry!.id;
  });

  test("API: auch die Rückstufung (premium→free) wird protokolliert", async () => {
    const patchRes = await superCtx.patch(`/api/operator/accounts/${target.id}/plan`, {
      data: { plan: "free" },
    });
    expect(patchRes.status()).toBe(200);

    const listRes = await superCtx.get("/api/operator/plan-changes");
    expect(listRes.status()).toBe(200);
    const changes = (await listRes.json()) as PlanChangeRow[];

    const downgrade = changes.find(
      (c) => c.accountId === target.id && c.oldPlan === "premium" && c.newPlan === "free",
    );
    expect(downgrade, "Rückstufung fehlt im Protokoll").toBeTruthy();
    // Ohne Notiz bleibt das Feld NULL (kein Pflichtfeld).
    expect(downgrade!.note).toBeNull();
    // Append-only: der Upgrade-Eintrag bleibt unverändert bestehen.
    const upgrade = changes.find((c) => c.id === upgradeChangeId);
    expect(upgrade, "Ursprünglicher Upgrade-Eintrag darf nicht verschwinden").toBeTruthy();
    expect(upgrade!.note).toBe(invoiceNote);
  });

  test("UI: Karte Plan-Änderungsprotokoll zeigt den Eintrag im Operator-Dashboard", async ({
    page,
  }) => {
    expect(upgradeChangeId, "API-Test muss vorher gelaufen sein").toBeGreaterThan(0);

    // Programmatische Anmeldung als superadmin (Cookie-Jar geteilt mit dem
    // Browser — der Dev-Auto-Login greift dadurch nie, siehe helpers/auth.ts).
    const loginRes = await page.request.post("/api/auth/login", {
      data: { email: superEmail, password: superPassword },
    });
    expect(loginRes.ok(), "UI-Login als superadmin fehlgeschlagen").toBe(true);

    await page.goto("/operator-dashboard");

    // Die Protokoll-Zeile des Upgrade-Flips muss sichtbar sein …
    const row = page.getByTestId(`row-plan-change-${upgradeChangeId}`);
    await expect(row).toBeVisible();
    // … mit Konto, Plan-Wechsel, Referenz und ausführendem superadmin.
    await expect(row).toContainText(target.email);
    await expect(row).toContainText("Free");
    await expect(row).toContainText("Premium");
    await expect(row).toContainText(superName);
    await expect(page.getByTestId(`text-plan-change-note-${upgradeChangeId}`)).toContainText(
      invoiceNote,
    );
  });
});
