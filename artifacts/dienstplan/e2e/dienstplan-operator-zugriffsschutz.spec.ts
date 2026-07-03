import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";
import {
  registerFreeAccount,
  deleteFreeAccount,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  BASE_URL,
  type FreeAccount,
} from "./helpers/teams";

/**
 * Regressionstest (Task #330): Normale Konten dürfen das Plan-Änderungsprotokoll
 * NIEMALS einsehen oder Plan-Flips auslösen.
 *
 * Das Protokoll (GET /api/operator/plan-changes) enthält Konto-E-Mails und
 * Zahlungsreferenzen ALLER Kunden — ein Leck wäre ein Datenschutzvorfall.
 * PATCH /api/operator/accounts/:id/plan würde zudem Selbst-Freischaltung auf
 * Premium erlauben. Beide Endpunkte sind über requireSuperadmin
 * (middleware/auth.ts, Rolle frisch aus der DB) geschützt; dieser Spec beweist:
 *
 *   - unauthentifiziert  -> 401 (beide Endpunkte)
 *   - Rolle admin        -> 403 (beide Endpunkte, inkl. Selbst-Upgrade-Versuch)
 *   - Rolle assistant    -> 403 (beide Endpunkte)
 *   - GET /operator/accounts (Plattform-Kontenliste) ebenso 401/403
 *   - kein Nebeneffekt: der Ziel-Plan bleibt nach abgewiesenen PATCHes "free"
 *   - die 403-/401-Antworten leaken keine Protokoll-/Kontodaten
 *
 * Setup: Admin-Konto frisch via registerFreeAccount (startet garantiert Free);
 * Assistent über den Einladungsflow des Premium-Setup-Admins
 * (admin@dienstplan.local ist in der Test-DB Premium, caregiverLogin frei).
 * Läuft gegen den isolierten Test-Stack (eigene `_test`-DB).
 */

const OPERATOR_ENDPOINTS = ["/api/operator/plan-changes", "/api/operator/accounts"];

const ASSISTANT_PASSWORD = "assistent1234";

test.describe("Operator-Endpunkte: Zugriffsschutz für normale Konten", () => {
  // Registrierung + Einladungsflow können unter Suiten-Volllast dauern.
  test.setTimeout(120_000);

  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const assistantEmail = `e2e.opguard.assistent.${stamp}@dienstplan.test`;

  let admin: FreeAccount;
  let adminCtx: APIRequestContext; // Premium-Setup-Admin (nur für Assistenten-Setup)
  let assistantCtx: APIRequestContext;
  let assistantId = 0;

  test.beforeAll(async () => {
    // Angreifer 1: frisch registrierter Admin (Rolle admin, Plan free).
    admin = await registerFreeAccount("privat", "opguard");

    // Angreifer 2: Assistent — anlegen + einladen über den Premium-Setup-Admin,
    // dann Passwort per Token setzen und einloggen (einziger Weg an eine echte
    // Assistenten-Session, siehe helpers in dienstplan-assistant-write-forbidden).
    adminCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    const loginRes = await adminCtx.post("/api/auth/login", {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(loginRes.ok(), "Setup-Admin-Login fehlgeschlagen").toBe(true);

    const createRes = await adminCtx.post("/api/users", {
      data: {
        name: `E2E Opguard Assistent ${stamp}`,
        email: assistantEmail,
        role: "assistant",
      },
    });
    expect(createRes.ok(), `Assistent anlegen fehlgeschlagen (${createRes.status()})`).toBe(
      true,
    );
    assistantId = ((await createRes.json()) as { id: number }).id;

    const inviteRes = await adminCtx.post(`/api/users/${assistantId}/invite`, {});
    expect(inviteRes.ok(), "Einladung fehlgeschlagen").toBe(true);
    const { token } = (await inviteRes.json()) as { token: string };

    assistantCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    const pwRes = await assistantCtx.post("/api/auth/set-password", {
      data: { token, password: ASSISTANT_PASSWORD },
    });
    expect(pwRes.ok(), "Passwort setzen fehlgeschlagen").toBe(true);
    const assistantLogin = await assistantCtx.post("/api/auth/login", {
      data: { email: assistantEmail, password: ASSISTANT_PASSWORD },
    });
    expect(assistantLogin.ok(), "Assistenten-Login fehlgeschlagen").toBe(true);
    const me = (await assistantLogin.json()) as { role: string };
    expect(me.role, "Angreifer 2 muss wirklich Rolle assistant haben").toBe("assistant");
  });

  test.afterAll(async () => {
    try {
      if (assistantId) await adminCtx.delete(`/api/users/${assistantId}`);
    } catch {
      /* Best effort — Cleanup darf den Lauf nicht kippen. */
    }
    try {
      await assistantCtx?.dispose();
    } catch {
      /* ignore */
    }
    try {
      await adminCtx?.dispose();
    } catch {
      /* ignore */
    }
    await deleteFreeAccount(admin);
  });

  /** Beweist, dass die abgewiesene Antwort keine Kunden-/Protokolldaten leakt. */
  async function expectNoDataLeak(body: string): Promise<void> {
    // Das Protokoll würde accountEmail/note-Felder bzw. E-Mail-Adressen tragen.
    expect(body).not.toContain("accountEmail");
    expect(body).not.toContain("@dienstplan");
    expect(body).not.toContain("note");
  }

  test("unauthentifiziert: alle Operator-Endpunkte liefern 401", async () => {
    const anon = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      for (const path of OPERATOR_ENDPOINTS) {
        const res = await anon.get(path);
        expect(res.status(), `${path} muss anonym 401 liefern`).toBe(401);
        await expectNoDataLeak(await res.text());
      }
      const patchRes = await anon.patch(`/api/operator/accounts/${admin.id}/plan`, {
        data: { plan: "premium" },
      });
      expect(patchRes.status(), "Plan-Flip muss anonym 401 liefern").toBe(401);
    } finally {
      await anon.dispose();
    }
  });

  test("Rolle admin: Protokoll & Kontenliste liefern 403, kein Datenleck", async () => {
    for (const path of OPERATOR_ENDPOINTS) {
      const res = await admin.ctx.get(path);
      expect(res.status(), `${path} muss für admin 403 liefern`).toBe(403);
      await expectNoDataLeak(await res.text());
    }
  });

  test("Rolle admin: Selbst-Upgrade via Plan-Flip liefert 403 und wirkt nicht", async () => {
    const patchRes = await admin.ctx.patch(`/api/operator/accounts/${admin.id}/plan`, {
      data: { plan: "premium" },
    });
    expect(patchRes.status(), "Selbst-Upgrade muss 403 liefern").toBe(403);

    // Kein Nebeneffekt: das Konto bleibt Free (getUserPlan liest frisch aus der DB).
    const meRes = await admin.ctx.get("/api/auth/me");
    expect(meRes.ok()).toBe(true);
    const me = (await meRes.json()) as { plan: string };
    expect(me.plan, "Abgewiesener Plan-Flip darf den Plan nicht ändern").toBe("free");
  });

  test("Rolle assistant: Protokoll & Kontenliste liefern 403, kein Datenleck", async () => {
    for (const path of OPERATOR_ENDPOINTS) {
      const res = await assistantCtx.get(path);
      expect(res.status(), `${path} muss für assistant 403 liefern`).toBe(403);
      await expectNoDataLeak(await res.text());
    }
  });

  test("Rolle assistant: Plan-Flip auf fremdes Konto liefert 403 und wirkt nicht", async () => {
    const patchRes = await assistantCtx.patch(
      `/api/operator/accounts/${admin.id}/plan`,
      { data: { plan: "premium" } },
    );
    expect(patchRes.status(), "Plan-Flip als assistant muss 403 liefern").toBe(403);

    const meRes = await admin.ctx.get("/api/auth/me");
    expect(meRes.ok()).toBe(true);
    const me = (await meRes.json()) as { plan: string };
    expect(me.plan, "Ziel-Konto bleibt trotz Angriffsversuch Free").toBe("free");
  });
});
