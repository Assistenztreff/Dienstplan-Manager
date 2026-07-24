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
 * E2E-Test: Suche im Plan-Änderungsprotokoll (Task #375).
 *
 * Abgesichert wird:
 *   1. Der Endpunkt GET /api/operator/plan-changes akzeptiert den neuen
 *      `search`-Parameter und filtert nach Konto (Name/E-Mail) UND Inhalt der
 *      Referenz/Notiz — Treffer (eindeutige Belegnummer, E-Mail) und
 *      Kein-Treffer (unmöglicher Begriff) werden geprüft.
 *   2. Der Zugriffsschutz bleibt bestehen: ohne superadmin-Session gibt es
 *      keinen Zugriff auf das Protokoll (auch nicht mit search-Parameter).
 *   3. Das Operator-Dashboard bietet ein Suchfeld, das die Liste filtert.
 *
 * Setup analog dienstplan-operator-plan-audit.spec.ts: der superadmin muss
 * direkt in der Test-DB via setup-superadmin-Skript geseedet werden (die
 * öffentliche Registrierung erzeugt immer Rolle admin). E-Mail folgt dem
 * Muster e2e.*@dienstplan.test, damit der Cleanup greift.
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
    env.APP_DATABASE_URL = process.env.E2E_TEST_DATABASE_URL;
  }
  execSync("pnpm --filter @workspace/scripts run setup-superadmin", {
    env,
    stdio: "pipe",
  });
}

test.describe("Suche im Plan-Änderungsprotokoll", () => {
  // Setup (Registrierung + Skript-Seeding) kann unter Suiten-Volllast dauern.
  test.setTimeout(120_000);

  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const superEmail = `e2e.superadmin.search.${stamp}@dienstplan.test`;
  const superPassword = "superadmin1234";
  const superName = `E2E Sucher ${stamp}`;
  // Eindeutige Belegnummer, die als Volltext-Treffer dient.
  const invoiceNote = `SUCHBELEG-${stamp}`;

  let target: FreeAccount;
  let superCtx: APIRequestContext;

  test.beforeAll(async () => {
    // Ziel-Konto: frisch registrierter Admin, startet garantiert auf Free.
    target = await registerFreeAccount("privat", "plansearch");

    // Betreiber-Konto direkt in der Test-DB seeden und einloggen.
    seedSuperadmin(superEmail, superPassword, superName);
    superCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    const loginRes = await superCtx.post("/api/auth/login", {
      data: { email: superEmail, password: superPassword },
    });
    expect(loginRes.ok(), `Superadmin-Login fehlgeschlagen (${loginRes.status()})`).toBe(
      true,
    );

    // Einen Protokoll-Eintrag mit eindeutiger Belegnummer erzeugen.
    const patchRes = await superCtx.patch(`/api/operator/accounts/${target.id}/plan`, {
      data: { plan: "premium", note: invoiceNote },
    });
    expect(patchRes.status(), "Plan-Flip muss 200 liefern").toBe(200);
  });

  test.afterAll(async () => {
    try {
      await deleteAccountByEmail(superEmail);
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

  test("API: Suche nach Belegnummer liefert genau den passenden Eintrag", async () => {
    const res = await superCtx.get(
      `/api/operator/plan-changes?search=${encodeURIComponent(invoiceNote)}`,
    );
    expect(res.status()).toBe(200);
    const changes = (await res.json()) as PlanChangeRow[];
    expect(changes.length).toBeGreaterThan(0);
    // ALLE Treffer müssen die gesuchte Belegnummer in der Notiz enthalten.
    for (const c of changes) {
      expect(c.note).toBe(invoiceNote);
    }
    const entry = changes.find((c) => c.accountId === target.id);
    expect(entry, "Eintrag des Ziel-Kontos fehlt").toBeTruthy();
    expect(entry!.note).toBe(invoiceNote);
  });

  test("API: Suche nach E-Mail des Kontos findet den Eintrag", async () => {
    const res = await superCtx.get(
      `/api/operator/plan-changes?search=${encodeURIComponent(target.email)}`,
    );
    expect(res.status()).toBe(200);
    const changes = (await res.json()) as PlanChangeRow[];
    const entry = changes.find((c) => c.accountId === target.id);
    expect(entry, "Konto-Suche über E-Mail muss den Eintrag liefern").toBeTruthy();
  });

  test("API: unmöglicher Suchbegriff liefert eine leere Liste", async () => {
    const res = await superCtx.get(
      `/api/operator/plan-changes?search=${encodeURIComponent(`kein-treffer-${stamp}`)}`,
    );
    expect(res.status()).toBe(200);
    const changes = (await res.json()) as PlanChangeRow[];
    expect(changes.length).toBe(0);
  });

  test("API: Zugriffsschutz — ohne superadmin kein Zugriff (auch mit search)", async () => {
    const anonCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      const res = await anonCtx.get(
        `/api/operator/plan-changes?search=${encodeURIComponent(invoiceNote)}`,
      );
      expect(res.status(), "Unautorisiert darf nicht 200 sein").not.toBe(200);
      expect([401, 403]).toContain(res.status());
    } finally {
      await anonCtx.dispose();
    }
  });

  test("UI: Suchfeld filtert das Protokoll auf den Beleg-Eintrag", async ({ page }) => {
    // Programmatische Anmeldung als superadmin (Cookie-Jar geteilt mit dem
    // Browser — der Dev-Auto-Login greift dadurch nie).
    const loginRes = await page.request.post("/api/auth/login", {
      data: { email: superEmail, password: superPassword },
    });
    expect(loginRes.ok(), "UI-Login als superadmin fehlgeschlagen").toBe(true);

    await page.goto("/operator-dashboard");

    const searchInput = page.getByTestId("input-plan-change-search");
    await expect(searchInput).toBeVisible();

    // Treffer: die eindeutige Belegnummer eingeben, Zeile muss erscheinen.
    await searchInput.fill(invoiceNote);
    await expect(
      page.locator("[data-testid^='row-plan-change-']").first(),
    ).toBeVisible();
    await expect(
      page.locator("[data-testid^='text-plan-change-note-']").first(),
    ).toContainText(invoiceNote);

    // Kein-Treffer: unmöglicher Begriff → Leer-Hinweis.
    await searchInput.fill(`kein-treffer-${stamp}`);
    await expect(
      page.getByTestId("text-operator-plan-changes-empty"),
    ).toBeVisible();
  });
});
