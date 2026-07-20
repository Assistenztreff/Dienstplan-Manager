import { execSync } from "node:child_process";
import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";
import { deleteAccountByEmail } from "./helpers/teams";
import {
  DEV_BOOM_ROUTE_PATH,
  DEV_BOOM_ERROR_CONTEXT,
} from "@workspace/test-fixtures";

/**
 * E2E-Test: Zeitraum-Filter in der Fehlerliste des Operator-Dashboards
 * (Task #414).
 *
 * Analog zum Zeitraum-Filter des Plan-Änderungsprotokolls (Task #382,
 * dienstplan-operator-plan-zeitraum.spec.ts) sichert dieser Spec ab:
 *   1. GET /api/operator/errors akzeptiert optionale from/to-Parameter
 *      (ISO-8601) und grenzt die Liste nach dem LETZTEN Auftreten
 *      (platform_errors.last_seen_at) ein — Treffer (Zeitraum umschliesst
 *      das letzte Auftreten) und Kein-Treffer (Zeitraum komplett davor
 *      bzw. danach).
 *   2. Ungueltige Datumswerte liefern 400.
 *   3. Der Zugriffsschutz bleibt bestehen (ohne superadmin kein Zugriff).
 *   4. Das Operator-Dashboard bietet eine Zeitraum-Auswahl, die die
 *      Fehlerliste filtert; die Tagesgrenzen folgen der LOKALEN Zeitzone
 *      (nicht UTC), wie beim Plan-Protokoll.
 *
 * Fehler-Seeding wie in dienstplan-operator-fehler-tracking.spec.ts: die
 * Dev-Route GET /api/dev/boom erzeugt einen echten Eintrag; Wiederauftreten
 * buendelt auf dieselbe Zeile und setzt lastSeenAt = jetzt — genau darauf
 * stuetzt sich der Zeitraum-Filter.
 *
 * Laeuft gegen den isolierten Test-Stack (eigener API + Vite auf der
 * `_test`-DB, NODE_ENV=development — /api/dev/boom ist dort vorhanden).
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

const BOOM_MESSAGE = "Dev-Testfehler (absichtlich ausgeloest ueber /dev/boom)";
const BOOM_URL = `/api${DEV_BOOM_ROUTE_PATH}`;
const BOOM_CONTEXT = DEV_BOOM_ERROR_CONTEXT;

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

interface OperatorErrorList {
  errors: OperatorErrorRow[];
  totalStored: number;
  retentionLimit: number;
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

test.describe("Zeitraum-Filter in der Operator-Fehlerliste", () => {
  // Setup (Skript-Seeding) kann unter Suiten-Volllast dauern.
  test.setTimeout(120_000);

  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const superEmail = `e2e.superadmin.fehlerzeitraum.${stamp}@dienstplan.test`;
  const superPassword = "superadmin1234";
  const superName = `E2E Fehlerzeitraum ${stamp}`;

  // Zeitfenster relativ zu "jetzt" (der Boom setzt lastSeenAt ~ now).
  // +/- 1 Stunde ist robust gegen Zeitzonen-/Tagesgrenzen.
  const oneHour = 60 * 60 * 1000;
  const fromRecent = new Date(Date.now() - oneHour).toISOString();
  const toRecent = new Date(Date.now() + oneHour).toISOString();
  const toPast = new Date(Date.now() - oneHour).toISOString();
  const fromFuture = new Date(Date.now() + oneHour).toISOString();

  let superCtx: APIRequestContext;
  let boomErrorId: number;

  test.beforeAll(async () => {
    seedSuperadmin(superEmail, superPassword, superName);
    superCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    const loginRes = await superCtx.post("/api/auth/login", {
      data: { email: superEmail, password: superPassword },
    });
    expect(
      loginRes.ok(),
      `Superadmin-Login fehlgeschlagen (${loginRes.status()})`,
    ).toBe(true);

    // Fehler-Eintrag erzeugen/auffrischen: der Boom buendelt auf die
    // bestehende Zeile (gleiche Meldung + Kontext) und setzt lastSeenAt=jetzt.
    const boomRes = await superCtx.get(BOOM_URL);
    expect(boomRes.status(), "Dev-Boom muss 500 liefern").toBe(500);

    // Die Zeilen-ID des Boom-Eintrags fuer die UI-Assertions merken.
    const listRes = await superCtx.get("/api/operator/errors");
    expect(listRes.status()).toBe(200);
    const list = (await listRes.json()) as OperatorErrorList;
    const boomRow = list.errors.find(
      (e) => e.message === BOOM_MESSAGE && e.context === BOOM_CONTEXT,
    );
    expect(boomRow, "Boom-Eintrag muss in der Fehlerliste stehen").toBeTruthy();
    boomErrorId = boomRow!.id;
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
  });

  test("API: Zeitraum umschliesst das letzte Auftreten -> Treffer", async () => {
    const res = await superCtx.get(
      `/api/operator/errors?from=${encodeURIComponent(fromRecent)}&to=${encodeURIComponent(toRecent)}`,
    );
    expect(res.status()).toBe(200);
    const list = (await res.json()) as OperatorErrorList;
    const entry = list.errors.find((e) => e.id === boomErrorId);
    expect(entry, "Boom-Eintrag muss im umschliessenden Zeitraum erscheinen").toBeTruthy();
    // Alle gelieferten Eintraege liegen (nach lastSeenAt) im Fenster.
    for (const e of list.errors) {
      const t = new Date(e.lastSeenAt).getTime();
      expect(t).toBeGreaterThanOrEqual(new Date(fromRecent).getTime());
      expect(t).toBeLessThanOrEqual(new Date(toRecent).getTime());
    }
  });

  test("API: Zeitraum-Ende liegt vor dem letzten Auftreten -> kein Treffer", async () => {
    const res = await superCtx.get(
      `/api/operator/errors?to=${encodeURIComponent(toPast)}`,
    );
    expect(res.status()).toBe(200);
    const list = (await res.json()) as OperatorErrorList;
    expect(list.errors.find((e) => e.id === boomErrorId)).toBeFalsy();
  });

  test("API: Zeitraum-Anfang liegt nach dem letzten Auftreten -> kein Treffer", async () => {
    const res = await superCtx.get(
      `/api/operator/errors?from=${encodeURIComponent(fromFuture)}`,
    );
    expect(res.status()).toBe(200);
    const list = (await res.json()) as OperatorErrorList;
    expect(list.errors.find((e) => e.id === boomErrorId)).toBeFalsy();
  });

  test("API: ungueltiges Datum liefert 400", async () => {
    const res = await superCtx.get("/api/operator/errors?from=nichteindatum");
    expect(res.status()).toBe(400);
  });

  test("API: Zugriffsschutz — ohne superadmin kein Zugriff (auch mit Zeitraum)", async () => {
    const anonCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      const res = await anonCtx.get(
        `/api/operator/errors?from=${encodeURIComponent(fromRecent)}&to=${encodeURIComponent(toRecent)}`,
      );
      expect(res.status(), "Unautorisiert darf nicht 200 sein").not.toBe(200);
      expect([401, 403]).toContain(res.status());
    } finally {
      await anonCtx.dispose();
    }
  });

  test("UI: Zeitraum-Auswahl filtert die Fehlerliste", async ({ page }) => {
    // Programmatische Anmeldung als superadmin (Cookie-Jar geteilt mit dem
    // Browser — der Dev-Auto-Login greift dadurch nie).
    const loginRes = await page.request.post("/api/auth/login", {
      data: { email: superEmail, password: superPassword },
    });
    expect(loginRes.ok(), "UI-Login als superadmin fehlgeschlagen").toBe(true);

    await page.goto("/operator-dashboard");

    const fromInput = page.getByTestId("input-error-range-from");
    const toInput = page.getByTestId("input-error-range-to");
    await expect(fromInput).toBeVisible();
    await expect(toInput).toBeVisible();

    // Treffer: Zeitraum gestern..morgen umschliesst das heutige Auftreten.
    await fromInput.fill(isoDate(-1));
    await toInput.fill(isoDate(1));
    await expect(
      page.getByTestId(`row-operator-error-${boomErrorId}`),
    ).toBeVisible();

    // Kein-Treffer: Zeitraum-Anfang weit in der Zukunft -> KEIN Eintrag kann
    // dort ein letztes Auftreten haben, der Leer-Hinweis erscheint (robust
    // gegen parallel laufende Specs, die neue Fehler erzeugen).
    await fromInput.fill(isoDate(2));
    await toInput.fill(isoDate(3));
    await expect(page.getByTestId("text-operator-errors-empty")).toBeVisible();
    await expect(
      page.getByTestId(`row-operator-error-${boomErrorId}`),
    ).toHaveCount(0);

    // Zuruecksetzen: der Eintrag ist wieder sichtbar.
    await page.getByTestId("button-error-range-clear").click();
    await expect(
      page.getByTestId(`row-operator-error-${boomErrorId}`),
    ).toBeVisible();
  });

  test("UI: Tagesgrenzen folgen der lokalen Zeitzone (Europe/Berlin), nicht UTC", async ({
    browser,
  }) => {
    // Eigener Browser-Kontext mit deutscher Zeitzone: die Datums-Eingaben
    // muessen als LOKALE Tagesgrenzen (Berlin) an die API gehen, nicht als
    // fixe UTC-Grenzen (T00:00:00.000Z).
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
      await expect(page.getByTestId("input-error-range-from")).toBeVisible();

      // Fester Beispiel-Tag; auf den naechsten Request mit BEIDEN Parametern
      // (from UND to) warten und die gesendeten Grenzen pruefen.
      const day = "2026-06-15";
      const requestPromise = page.waitForRequest(
        (req) =>
          req.url().includes("/api/operator/errors") &&
          req.url().includes("from=") &&
          req.url().includes("to="),
      );
      await page.getByTestId("input-error-range-from").fill(day);
      await page.getByTestId("input-error-range-to").fill(day);
      const req = await requestPromise;
      const url = new URL(req.url());
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      expect(from, "from-Parameter muss gesetzt sein").toBeTruthy();

      // Berlin-Mitternacht am 15.06. (Sommerzeit, UTC+2) = 14.06. 22:00 UTC.
      expect(from).toBe("2026-06-14T22:00:00.000Z");
      expect(to).toBe("2026-06-15T21:59:59.999Z");
    } finally {
      await context.close();
    }
  });
});
