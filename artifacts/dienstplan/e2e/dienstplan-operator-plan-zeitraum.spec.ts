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
 * E2E-Test: Zeitraum-Filter im Plan-Änderungsprotokoll (Task #382).
 *
 * Baut auf der Textsuche (#375) auf und sichert den neuen von/bis-Filter ab:
 *   1. GET /api/operator/plan-changes akzeptiert optionale from/to-Parameter
 *      (ISO-8601) und grenzt die Liste über plan_changes.createdAt ein —
 *      Treffer (Zeitraum umschliesst den Eintrag) und Kein-Treffer (Zeitraum
 *      liegt komplett vor bzw. nach dem Eintrag).
 *   2. from/to sind mit search kombinierbar.
 *   3. Ungueltige Datumswerte liefern 400.
 *   4. Der Zugriffsschutz bleibt bestehen (ohne superadmin kein Zugriff).
 *   5. Das Operator-Dashboard bietet eine Zeitraum-Auswahl, die die Liste
 *      filtert.
 *
 * Setup analog dienstplan-operator-plan-search.spec.ts: der superadmin muss
 * direkt in der Test-DB via setup-superadmin-Skript geseedet werden (die
 * oeffentliche Registrierung erzeugt immer Rolle admin). E-Mail folgt dem
 * Muster e2e.*@dienstplan.test, damit der Cleanup greift.
 *
 * Laeuft gegen den isolierten Test-Stack (eigener API + Vite auf der `_test`-DB).
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

/** YYYY-MM-DD (UTC) fuer heute plus/minus einer Tagesanzahl. */
function isoDate(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

test.describe("Zeitraum-Filter im Plan-Änderungsprotokoll", () => {
  // Setup (Registrierung + Skript-Seeding) kann unter Suiten-Volllast dauern.
  test.setTimeout(120_000);

  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const superEmail = `e2e.superadmin.zeitraum.${stamp}@dienstplan.test`;
  const superPassword = "superadmin1234";
  const superName = `E2E Zeitraum ${stamp}`;
  // Eindeutige Belegnummer, damit der Eintrag zweifelsfrei identifizierbar ist.
  const invoiceNote = `ZEITRAUMBELEG-${stamp}`;

  // Zeitfenster relativ zu "jetzt" (der Eintrag entsteht mit createdAt ~ now).
  // +/- 1 Stunde ist robust gegen Zeitzonen-/Tagesgrenzen.
  const oneHour = 60 * 60 * 1000;
  const fromRecent = new Date(Date.now() - oneHour).toISOString();
  const toRecent = new Date(Date.now() + oneHour).toISOString();
  const toPast = new Date(Date.now() - oneHour).toISOString();
  const fromFuture = new Date(Date.now() + oneHour).toISOString();

  let target: FreeAccount;
  let superCtx: APIRequestContext;

  test.beforeAll(async () => {
    // Ziel-Konto: frisch registrierter Admin, startet garantiert auf Free.
    target = await registerFreeAccount("privat", "planzeitraum");

    // Betreiber-Konto direkt in der Test-DB seeden und einloggen.
    seedSuperadmin(superEmail, superPassword, superName);
    superCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    const loginRes = await superCtx.post("/api/auth/login", {
      data: { email: superEmail, password: superPassword },
    });
    expect(
      loginRes.ok(),
      `Superadmin-Login fehlgeschlagen (${loginRes.status()})`,
    ).toBe(true);

    // Genau einen Protokoll-Eintrag mit eindeutiger Belegnummer erzeugen.
    const patchRes = await superCtx.patch(
      `/api/operator/accounts/${target.id}/plan`,
      { data: { plan: "premium", note: invoiceNote } },
    );
    expect(patchRes.status(), "Plan-Flip muss 200 liefern").toBe(200);
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

  test("API: Zeitraum umschliesst den Eintrag -> Treffer", async () => {
    const res = await superCtx.get(
      `/api/operator/plan-changes?from=${encodeURIComponent(fromRecent)}&to=${encodeURIComponent(toRecent)}`,
    );
    expect(res.status()).toBe(200);
    const changes = (await res.json()) as PlanChangeRow[];
    const entry = changes.find((c) => c.accountId === target.id);
    expect(entry, "Eintrag muss im umschliessenden Zeitraum erscheinen").toBeTruthy();
    // Alle gelieferten Eintraege liegen im Fenster.
    for (const c of changes) {
      const t = new Date(c.createdAt).getTime();
      expect(t).toBeGreaterThanOrEqual(new Date(fromRecent).getTime());
      expect(t).toBeLessThanOrEqual(new Date(toRecent).getTime());
    }
  });

  test("API: Zeitraum-Ende liegt vor dem Eintrag -> kein Treffer", async () => {
    const res = await superCtx.get(
      `/api/operator/plan-changes?to=${encodeURIComponent(toPast)}`,
    );
    expect(res.status()).toBe(200);
    const changes = (await res.json()) as PlanChangeRow[];
    expect(changes.find((c) => c.accountId === target.id)).toBeFalsy();
  });

  test("API: Zeitraum-Anfang liegt nach dem Eintrag -> kein Treffer", async () => {
    const res = await superCtx.get(
      `/api/operator/plan-changes?from=${encodeURIComponent(fromFuture)}`,
    );
    expect(res.status()).toBe(200);
    const changes = (await res.json()) as PlanChangeRow[];
    expect(changes.find((c) => c.accountId === target.id)).toBeFalsy();
  });

  test("API: search + Zeitraum kombiniert filtern beide", async () => {
    // Treffer: passende Belegnummer UND umschliessender Zeitraum.
    const hit = await superCtx.get(
      `/api/operator/plan-changes?search=${encodeURIComponent(invoiceNote)}&from=${encodeURIComponent(fromRecent)}&to=${encodeURIComponent(toRecent)}`,
    );
    expect(hit.status()).toBe(200);
    const hitRows = (await hit.json()) as PlanChangeRow[];
    expect(hitRows.length).toBeGreaterThan(0);
    for (const c of hitRows) {
      expect(c.note).toBe(invoiceNote);
    }
    expect(hitRows.find((c) => c.accountId === target.id)).toBeTruthy();

    // Kein-Treffer: passende Belegnummer, aber Zeitraum vor dem Eintrag.
    const miss = await superCtx.get(
      `/api/operator/plan-changes?search=${encodeURIComponent(invoiceNote)}&to=${encodeURIComponent(toPast)}`,
    );
    expect(miss.status()).toBe(200);
    const missRows = (await miss.json()) as PlanChangeRow[];
    expect(missRows.find((c) => c.accountId === target.id)).toBeFalsy();
  });

  test("API: ungueltiges Datum liefert 400", async () => {
    const res = await superCtx.get(
      "/api/operator/plan-changes?from=nichteindatum",
    );
    expect(res.status()).toBe(400);
  });

  test("API: Zugriffsschutz — ohne superadmin kein Zugriff (auch mit Zeitraum)", async () => {
    const anonCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      const res = await anonCtx.get(
        `/api/operator/plan-changes?from=${encodeURIComponent(fromRecent)}&to=${encodeURIComponent(toRecent)}`,
      );
      expect(res.status(), "Unautorisiert darf nicht 200 sein").not.toBe(200);
      expect([401, 403]).toContain(res.status());
    } finally {
      await anonCtx.dispose();
    }
  });

  test("UI: Zeitraum-Auswahl filtert das Protokoll", async ({ page }) => {
    // Programmatische Anmeldung als superadmin (Cookie-Jar geteilt mit dem
    // Browser — der Dev-Auto-Login greift dadurch nie).
    const loginRes = await page.request.post("/api/auth/login", {
      data: { email: superEmail, password: superPassword },
    });
    expect(loginRes.ok(), "UI-Login als superadmin fehlgeschlagen").toBe(true);

    await page.goto("/operator-dashboard");

    // Erst per Suche auf den eindeutigen Beleg-Eintrag einschraenken, damit die
    // Assertions unabhaengig von anderen Protokoll-Zeilen sind.
    await page.getByTestId("input-plan-change-search").fill(invoiceNote);
    await expect(
      page.locator("[data-testid^='row-plan-change-']").first(),
    ).toBeVisible();

    const fromInput = page.getByTestId("input-plan-change-from");
    const toInput = page.getByTestId("input-plan-change-to");
    await expect(fromInput).toBeVisible();
    await expect(toInput).toBeVisible();

    // Treffer: Zeitraum gestern..morgen umschliesst den heutigen Eintrag.
    await fromInput.fill(isoDate(-1));
    await toInput.fill(isoDate(1));
    await expect(
      page.locator("[data-testid^='text-plan-change-note-']").first(),
    ).toContainText(invoiceNote);

    // Kein-Treffer: Zeitraum-Anfang in der Zukunft -> Leer-Hinweis.
    await fromInput.fill(isoDate(2));
    await toInput.fill(isoDate(3));
    await expect(
      page.getByTestId("text-operator-plan-changes-empty"),
    ).toBeVisible();
  });

  test("UI: Tagesgrenzen folgen der lokalen Zeitzone (Europe/Berlin), nicht UTC", async ({
    browser,
  }) => {
    // Eigener Browser-Kontext mit deutscher Zeitzone: die Datums-Eingaben
    // muessen als LOKALE Tagesgrenzen (Berlin) an die API gehen, nicht als
    // fixe UTC-Grenzen (T00:00:00.000Z). Ein Eintrag von 00:30 Uhr deutscher
    // Zeit gehoert sonst zum falschen Tag.
    const context = await browser.newContext({
      baseURL: BASE_URL,
      timezoneId: "Europe/Berlin",
    });
    try {
      const page = await context.newPage();
      const loginRes = await page.request.post("/api/auth/login", {
        data: { email: superEmail, password: superPassword },
      });
      expect(loginRes.ok(), "UI-Login als superadmin fehlgeschlagen").toBe(true);

      await page.goto("/operator-dashboard");
      await expect(page.getByTestId("input-plan-change-from")).toBeVisible();

      // Fester Beispiel-Tag; auf den naechsten Request mit BEIDEN Parametern
      // (from UND to) warten und die gesendeten Grenzen pruefen. Das Fuellen
      // des ersten Feldes feuert bereits einen Request nur mit from.
      const day = "2026-06-15";
      const requestPromise = page.waitForRequest(
        (req) =>
          req.url().includes("/api/operator/plan-changes") &&
          req.url().includes("from=") &&
          req.url().includes("to="),
      );
      await page.getByTestId("input-plan-change-from").fill(day);
      await page.getByTestId("input-plan-change-to").fill(day);
      const req = await requestPromise;
      const url = new URL(req.url());
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      expect(from, "from-Parameter muss gesetzt sein").toBeTruthy();

      // Berlin-Mitternacht am 15.06. (Sommerzeit, UTC+2) = 14.06. 22:00 UTC.
      // Die alte UTC-Variante haette 2026-06-15T00:00:00.000Z gesendet.
      expect(from).toBe("2026-06-14T22:00:00.000Z");
      expect(to).toBe("2026-06-15T21:59:59.999Z");
    } finally {
      await context.close();
    }
  });
});
