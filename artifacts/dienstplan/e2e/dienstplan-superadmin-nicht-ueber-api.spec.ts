import { execSync } from "node:child_process";
import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";
import { deleteAccountByEmail, BASE_URL } from "./helpers/teams";

/**
 * Absicherungstest (Task #379): Betreiber-Rechte (Rolle "superadmin") können
 * NIEMALS über die normalen APIs VERGEBEN oder ENTZOGEN werden — der einzige
 * Weg zum Vergeben ist das Skript `setup-superadmin`, der einzige Weg zum
 * Entziehen das Skript `revoke-superadmin`.
 *
 * Der Spec beweist die drei im Sicherheitsmodell genannten Angriffsflächen:
 *   - Registrierung        -> role=superadmin im Body wird ignoriert (Konto admin)
 *   - Profil               -> update-profile / PATCH /users heben die Rolle nie
 *   - Operator-Plan-Endpunkt -> setzt ausschließlich `plan`, nie die Rolle
 * und zusätzlich, dass ein ECHTER superadmin über keine dieser APIs entzogen
 * werden kann — wohl aber sauber und idempotent per `revoke-superadmin`-Skript.
 *
 * Läuft gegen den isolierten Test-Stack (eigene `_test`-DB). Der superadmin
 * wird über `setup-superadmin` in die Test-DB geseedet (accountType/Rolle sind
 * nicht über die öffentliche API setzbar); Cleanup per E-Mail-Muster.
 */

const stamp = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
const attackerEmail = `e2e.superguard.attacker.${stamp}@dienstplan.test`;
const attackerPassword = "attacker1234";
const superEmail = `e2e.superguard.betreiber.${stamp}@dienstplan.test`;
const superPassword = "superguard1234";

/** Seedet einen echten superadmin in die (Test-)DB via setup-superadmin. */
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

/** Entzieht Betreiber-Rechte via revoke-superadmin-Skript. Gibt stdout zurück. */
function revokeSuperadmin(email: string): string {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SUPERADMIN_EMAIL: email,
    // In der Test-DB ist dieser Superadmin ggf. der einzige — Sicherung umgehen.
    SUPERADMIN_ALLOW_LAST_REVOKE: "1",
  };
  if (process.env.E2E_TEST_DATABASE_URL) {
    env.DATABASE_URL = process.env.E2E_TEST_DATABASE_URL;
    env.APP_DATABASE_URL = process.env.E2E_TEST_DATABASE_URL;
  }
  return execSync("pnpm --filter @workspace/scripts run revoke-superadmin", {
    env,
    stdio: "pipe",
  }).toString();
}

test.describe("Superadmin-Rechte: nicht über normale APIs vergeben/entziehen", () => {
  // Registrierung + Skript-Seeding können unter Suiten-Volllast dauern.
  test.setTimeout(120_000);

  // Angreifer: frisch registriertes Konto (Rolle admin, Plan free).
  let attackerCtx: APIRequestContext;
  let attackerId = 0;
  let attackerRegisteredRole = "";

  // Echter Betreiber (nur zum Beweis, dass auch der Operator-Endpunkt keine
  // Rolle vergibt und dass kein API-Weg die Rolle entzieht).
  let superCtx: APIRequestContext;

  test.beforeAll(async () => {
    // Registrierung MIT injiziertem role=superadmin — der Server muss es ignorieren.
    attackerCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    const regRes = await attackerCtx.post("/api/auth/register", {
      data: {
        name: `E2E Superguard Angreifer ${stamp}`,
        email: attackerEmail,
        password: attackerPassword,
        accountType: "privat",
        // Injektion: darf NICHT übernommen werden.
        role: "superadmin",
      },
    });
    expect(regRes.status(), "Registrierung fehlgeschlagen").toBe(201);
    const reg = (await regRes.json()) as { id: number; role: string; plan: string };
    attackerId = reg.id;
    attackerRegisteredRole = reg.role;
    // Ein frisch registriertes Konto ist immer Admin/Free.
    expect(reg.plan, "Frisch registriertes Konto muss Free sein").toBe("free");

    // Echten superadmin seeden + einloggen (einziger Weg an eine Betreiber-Session).
    seedSuperadmin(superEmail, superPassword, `E2E Superguard Betreiber ${stamp}`);
    superCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    const loginRes = await superCtx.post("/api/auth/login", {
      data: { email: superEmail, password: superPassword },
    });
    expect(loginRes.ok(), "Superadmin-Login fehlgeschlagen").toBe(true);
    const me = (await loginRes.json()) as { role: string };
    expect(me.role, "Geseedetes Konto muss wirklich superadmin sein").toBe(
      "superadmin",
    );
  });

  test.afterAll(async () => {
    try {
      await attackerCtx?.dispose();
    } catch {
      /* ignore */
    }
    try {
      await superCtx?.dispose();
    } catch {
      /* ignore */
    }
    // FK-sicheres Cleanup beider Konten aus der Test-DB (Best effort).
    try {
      await deleteAccountByEmail(attackerEmail);
    } catch {
      /* ignore */
    }
    try {
      await deleteAccountByEmail(superEmail);
    } catch {
      /* ignore */
    }
  });

  test("Registrierung: role=superadmin im Body wird ignoriert (Konto bleibt admin)", async () => {
    expect(
      attackerRegisteredRole,
      "Registrierung darf niemals einen superadmin anlegen",
    ).toBe("admin");

    const meRes = await attackerCtx.get("/api/auth/me");
    expect(meRes.ok()).toBe(true);
    const me = (await meRes.json()) as { role: string };
    expect(me.role).toBe("admin");

    // Kein Betreiber -> kein Operator-Zugriff.
    const opRes = await attackerCtx.get("/api/operator/accounts");
    expect(opRes.status(), "Angreifer darf keinen Operator-Zugriff haben").toBe(403);
  });

  test("Profil: update-profile kann die Rolle nicht auf superadmin heben", async () => {
    const res = await attackerCtx.post("/api/auth/update-profile", {
      data: { name: "Angreifer Umbenannt", email: attackerEmail, role: "superadmin" },
    });
    expect(res.ok(), "update-profile sollte erfolgreich sein (role wird ignoriert)").toBe(
      true,
    );
    const body = (await res.json()) as { role: string };
    expect(body.role, "update-profile darf die Rolle nicht ändern").toBe("admin");

    const opRes = await attackerCtx.get("/api/operator/accounts");
    expect(opRes.status()).toBe(403);
  });

  test("Profil: PATCH /users/:id ignoriert ein injiziertes role=superadmin (Rolle bleibt admin)", async () => {
    // Das UpdateUserBody-Schema kennt gar kein `role`-Feld -> Zod strippt es
    // still weg; die Rolle ist über diesen Endpunkt grundsätzlich nicht setzbar.
    // Ein zulässiges Feld (name) wird mitgesendet, damit das Update nicht leer
    // ist (ein leeres Update ist ein unabhängiger Randfall, nicht Thema hier).
    const res = await attackerCtx.patch(`/api/users/${attackerId}`, {
      data: { name: `E2E Superguard Angreifer ${stamp} (PATCH)`, role: "superadmin" },
    });
    expect(res.ok(), "PATCH sollte erfolgreich sein (role wird ignoriert)").toBe(true);

    const meRes = await attackerCtx.get("/api/auth/me");
    const me = (await meRes.json()) as { role: string };
    expect(me.role, "PATCH /users darf die Rolle nicht auf superadmin heben").toBe("admin");

    const opRes = await attackerCtx.get("/api/operator/accounts");
    expect(opRes.status()).toBe(403);
  });

  test("Operator-Plan-Endpunkt: injiziertes role=superadmin wird nicht übernommen", async () => {
    // Selbst der privilegierte Betreiber-Endpunkt setzt AUSSCHLIESSLICH den Plan.
    const res = await superCtx.patch(`/api/operator/accounts/${attackerId}/plan`, {
      data: { plan: "premium", role: "superadmin" },
    });
    expect(res.ok(), "Plan-Flip sollte erfolgreich sein").toBe(true);

    // Konto ist jetzt Premium, aber weiterhin nur admin.
    const meRes = await attackerCtx.get("/api/auth/me");
    const me = (await meRes.json()) as { role: string; plan: string };
    expect(me.plan, "Plan-Flip sollte greifen").toBe("premium");
    expect(me.role, "Operator-Plan-Endpunkt darf die Rolle nicht heben").toBe("admin");

    const opRes = await attackerCtx.get("/api/operator/accounts");
    expect(opRes.status(), "Konto bleibt ohne Operator-Zugriff").toBe(403);
  });

  test("Entziehen: update-profile mit role=admin entzieht dem Betreiber die Rolle nicht", async () => {
    const res = await superCtx.post("/api/auth/update-profile", {
      data: { name: "Betreiber Umbenannt", email: superEmail, role: "admin" },
    });
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as { role: string };
    expect(body.role, "update-profile darf superadmin nicht entziehen").toBe(
      "superadmin",
    );

    // Betreiber-Zugriff bleibt bestehen.
    const opRes = await superCtx.get("/api/operator/accounts");
    expect(opRes.status()).toBe(200);
  });

  test("Skript: revoke-superadmin entzieht die Betreiber-Rechte und ist idempotent", async () => {
    // Erster Lauf entzieht die Rolle (superadmin -> admin).
    const out1 = revokeSuperadmin(superEmail);
    expect(out1).toContain("entzogen");

    // Rolle wird pro Request frisch aus der DB gelesen -> Operator-Zugriff sofort weg.
    const opRes = await superCtx.get("/api/operator/accounts");
    expect(opRes.status(), "Nach Entzug darf der Operator-Zugriff nicht mehr greifen").toBe(
      403,
    );

    // Zweiter Lauf: idempotent, kein Fehler.
    const out2 = revokeSuperadmin(superEmail);
    expect(out2).toContain("Nichts zu tun");
  });
});
