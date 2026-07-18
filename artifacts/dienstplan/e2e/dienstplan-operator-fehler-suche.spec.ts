import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";
import {
  dbSeedSuperadmin,
  dbDeleteAccountByEmail,
  dbInsertPlatformError,
  dbDeletePlatformErrorsByContextPrefix,
} from "./helpers/db";

/**
 * E2E-Test: Suche in der Operator-Fehlerliste (Task #437, analog zur Suche im
 * Plan-Änderungsprotokoll, dienstplan-operator-plan-search.spec.ts).
 *
 * Abgesichert wird:
 *   1. GET /api/operator/errors akzeptiert den neuen `search`-Parameter und
 *      filtert serverseitig case-insensitiv über message UND context — Treffer
 *      (Meldung), Treffer (Route/Kontext) und Kein-Treffer (unmöglicher
 *      Begriff).
 *   2. Die Suche ist mit dem Zeitraum-Filter (from/to) kombinierbar.
 *   3. Der Zugriffsschutz bleibt bestehen (ohne superadmin kein Zugriff, auch
 *      mit search-Parameter).
 *   4. Das Operator-Dashboard bietet ein Suchfeld, das die Fehlerliste filtert.
 *
 * Die Fehler-Einträge werden mit eindeutigen (stamp-basierten) Meldungen und
 * Kontexten direkt in die Test-DB geseedet, damit die Assertions unabhängig
 * von parallel laufenden Specs deterministisch sind.
 *
 * Läuft gegen den isolierten Test-Stack (eigener API + Vite auf der `_test`-DB).
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

interface OperatorErrorList {
  errors: OperatorErrorRow[];
  totalStored: number;
  retentionLimit: number;
}

test.describe("Suche in der Operator-Fehlerliste", () => {
  test.setTimeout(120_000);

  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const superEmail = `e2e.superadmin.fehlersuche.${stamp}@dienstplan.test`;
  const superPassword = "superadmin1234";
  const superName = `E2E Fehlersuche ${stamp}`;

  // Eindeutiger Kontext-Präfix für gezielten Cleanup + eindeutige Suchbegriffe.
  const contextPrefix = `e2e-fehlersuche-${stamp}`;
  const messageMatch = `SUCHFEHLER-MELDUNG-${stamp}`;
  const contextMatch = `${contextPrefix}/GET /api/suchroute`;
  const otherMessage = `Anderer Fehler ohne Treffer ${stamp}`;
  const otherContext = `${contextPrefix}/GET /api/andereroute`;

  let superCtx: APIRequestContext;
  let matchByMessageId: number;
  let matchByContextId: number;

  test.beforeAll(async () => {
    await dbSeedSuperadmin(superEmail, superPassword, superName);
    superCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    const loginRes = await superCtx.post("/api/auth/login", {
      data: { email: superEmail, password: superPassword },
    });
    expect(
      loginRes.ok(),
      `Superadmin-Login fehlgeschlagen (${loginRes.status()})`,
    ).toBe(true);

    // Eintrag 1: Treffer über die MELDUNG (eindeutiger message-Text).
    matchByMessageId = await dbInsertPlatformError({
      message: messageMatch,
      context: `${contextPrefix}/GET /api/harmlos`,
    });
    // Eintrag 2: Treffer über den KONTEXT/Route.
    matchByContextId = await dbInsertPlatformError({
      message: `Ganz gewöhnliche Meldung ${stamp}`,
      context: contextMatch,
    });
    // Eintrag 3: Kein-Treffer-Kontrolle (weder Meldung noch Kontext passen).
    await dbInsertPlatformError({
      message: otherMessage,
      context: otherContext,
    });
  });

  test.afterAll(async () => {
    try {
      await dbDeletePlatformErrorsByContextPrefix(contextPrefix);
    } catch {
      /* Best effort — Cleanup darf den Lauf nicht kippen. */
    }
    try {
      await dbDeleteAccountByEmail(superEmail);
    } catch {
      /* Best effort */
    }
    try {
      await superCtx?.dispose();
    } catch {
      /* ignore */
    }
  });

  test("API: Suche nach Meldung liefert den passenden Eintrag", async () => {
    const res = await superCtx.get(
      `/api/operator/errors?search=${encodeURIComponent(messageMatch)}`,
    );
    expect(res.status()).toBe(200);
    const list = (await res.json()) as OperatorErrorList;
    const entry = list.errors.find((e) => e.id === matchByMessageId);
    expect(entry, "Meldungs-Treffer muss erscheinen").toBeTruthy();
    // Der Nicht-Treffer darf nicht dabei sein.
    expect(list.errors.some((e) => e.message === otherMessage)).toBe(false);
  });

  test("API: Suche nach Route/Kontext liefert den passenden Eintrag", async () => {
    const res = await superCtx.get(
      `/api/operator/errors?search=${encodeURIComponent("api/suchroute")}`,
    );
    expect(res.status()).toBe(200);
    const list = (await res.json()) as OperatorErrorList;
    const entry = list.errors.find((e) => e.id === matchByContextId);
    expect(entry, "Kontext-Treffer muss erscheinen").toBeTruthy();
  });

  test("API: Suche ist case-insensitiv", async () => {
    const res = await superCtx.get(
      `/api/operator/errors?search=${encodeURIComponent(messageMatch.toLowerCase())}`,
    );
    expect(res.status()).toBe(200);
    const list = (await res.json()) as OperatorErrorList;
    expect(list.errors.find((e) => e.id === matchByMessageId)).toBeTruthy();
  });

  test("API: unmöglicher Suchbegriff liefert eine leere Trefferliste", async () => {
    const res = await superCtx.get(
      `/api/operator/errors?search=${encodeURIComponent(`kein-treffer-${stamp}`)}`,
    );
    expect(res.status()).toBe(200);
    const list = (await res.json()) as OperatorErrorList;
    expect(list.errors.find((e) => e.id === matchByMessageId)).toBeFalsy();
    expect(list.errors.find((e) => e.id === matchByContextId)).toBeFalsy();
  });

  test("API: Suche kombiniert mit Zeitraum (from/to)", async () => {
    const oneHour = 60 * 60 * 1000;
    const from = new Date(Date.now() - oneHour).toISOString();
    const to = new Date(Date.now() + oneHour).toISOString();
    // Kombination Treffer: Meldung passt UND liegt im Zeitfenster.
    const hitRes = await superCtx.get(
      `/api/operator/errors?search=${encodeURIComponent(messageMatch)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
    expect(hitRes.status()).toBe(200);
    const hitList = (await hitRes.json()) as OperatorErrorList;
    expect(hitList.errors.find((e) => e.id === matchByMessageId)).toBeTruthy();

    // Kombination Kein-Treffer: Meldung passt, Zeitfenster liegt aber in der
    // Zukunft (nach dem lastSeenAt der geseedeten Zeile).
    const future = new Date(Date.now() + oneHour).toISOString();
    const missRes = await superCtx.get(
      `/api/operator/errors?search=${encodeURIComponent(messageMatch)}&from=${encodeURIComponent(future)}`,
    );
    expect(missRes.status()).toBe(200);
    const missList = (await missRes.json()) as OperatorErrorList;
    expect(missList.errors.find((e) => e.id === matchByMessageId)).toBeFalsy();
  });

  test("API: Zugriffsschutz — ohne superadmin kein Zugriff (auch mit search)", async () => {
    const anonCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      const res = await anonCtx.get(
        `/api/operator/errors?search=${encodeURIComponent(messageMatch)}`,
      );
      expect(res.status(), "Unautorisiert darf nicht 200 sein").not.toBe(200);
      expect([401, 403]).toContain(res.status());
    } finally {
      await anonCtx.dispose();
    }
  });

  test("UI: Suchfeld filtert die Fehlerliste auf den Meldungs-Treffer", async ({
    page,
  }) => {
    const loginRes = await page.request.post("/api/auth/login", {
      data: { email: superEmail, password: superPassword },
    });
    expect(loginRes.ok(), "UI-Login als superadmin fehlgeschlagen").toBe(true);

    await page.goto("/operator-dashboard");

    const searchInput = page.getByTestId("input-error-search");
    await expect(searchInput).toBeVisible();

    // Treffer: die eindeutige Meldung eingeben -> Zeile muss erscheinen.
    await searchInput.fill(messageMatch);
    await expect(
      page.getByTestId(`row-operator-error-${matchByMessageId}`),
    ).toBeVisible();
    // Der Nicht-Treffer darf nicht in der Liste stehen.
    await expect(page.locator(`text=${otherMessage}`)).toHaveCount(0);

    // Kein-Treffer: unmöglicher Begriff -> Leer-Hinweis.
    await searchInput.fill(`kein-treffer-${stamp}`);
    await expect(page.getByTestId("text-operator-errors-empty")).toBeVisible();
  });
});
