import { execSync } from "node:child_process";
import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";
import {
  BASE_URL,
  registerFreeAccount,
  deleteFreeAccount,
  deleteAccountByEmail,
  setAccountPlan,
  type FreeAccount,
} from "./helpers/teams";

/**
 * E2E-/Regressionstest (Task #359): Das Lexware-Buchungs-Log
 * (`GET /api/operator/lexware/bookings`) darf ausschließlich dem Betreiber
 * (superadmin) sichtbar sein und muss die Demo-Daten ehrlich kennzeichnen.
 *
 * Manuell war das bereits geprüft (401 anonym, 403 admin, 200 superadmin mit
 * `source: "demo"`). Ohne automatischen Test könnte eine spätere Änderung den
 * Superadmin-Schutz oder die Demo-Kennzeichnung unbemerkt aufweichen —
 * Buchungsdaten sind sensibel.
 *
 * Abgedeckt:
 * - API-Zugriffsschutz: anonym → 401, normaler Admin → 403, Assistent → 403,
 *   superadmin → 200 mit `source === "demo"` und nicht-leerer bookings-Liste.
 * - UI: Die Karte „Lexware-Buchungs-Log" zeigt das Badge „Demo-Daten"
 *   (data-testid `badge-lexware-demo`) und mindestens eine Buchungszeile
 *   (`row-lexware-booking-<id>`).
 *
 * Setup wie im Fehler-Tracking-Spec: superadmin kann nur per
 * setup-superadmin-Skript direkt in die Test-DB geseedet werden; E-Mail im
 * Muster `e2e.*@dienstplan.test` für den automatischen Cleanup.
 */

interface LexwareBooking {
  id: string | number;
}
interface LexwareResponse {
  source: "demo" | "live";
  bookings: LexwareBooking[];
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

test.describe("Lexware-Buchungs-Log nur für den Betreiber", () => {
  test.setTimeout(120_000);

  // Der Test-Stack läuft bewusst OHNE echten Lexware-Key (MockLexwareClient,
  // source === "demo"). Wäre ein LEXWARE_API_KEY gesetzt, würde der Server
  // absichtlich LAUT werfen (echter Client noch nicht implementiert) — dann
  // prüfte dieser Test etwas anderes als den Zugriffsschutz. Die
  // Demo-abhängigen Assertions werden in dem Fall übersprungen.
  const demoMode = !process.env.LEXWARE_API_KEY;

  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const superEmail = `e2e.superadmin.lexware.${stamp}@dienstplan.test`;
  const superPassword = "superadmin1234";
  const superName = `E2E Betreiber Lexware ${stamp}`;

  let admin: FreeAccount;
  let superCtx: APIRequestContext;
  let assistantCtx: APIRequestContext | undefined;

  test.beforeAll(async () => {
    // Normaler Admin (Premium, damit er einen Assistenten einladen kann) —
    // darf den Lexware-Endpunkt trotzdem NICHT sehen (rein rollenbasiert).
    admin = await registerFreeAccount("privat", "lexware-admin");
    await setAccountPlan(admin.email, "premium");

    // Assistent per Einladungsflow einloggen (Arbeitgeber ist Premium).
    const assistantRes = await admin.ctx.post("/api/users", {
      data: {
        name: `E2E Lexware Assistent ${stamp}`,
        email: `e2e.lexware.assistent.${stamp}@dienstplan.test`,
        role: "assistant",
      },
    });
    expect(assistantRes.status(), "Assistent anlegen sollte 201 liefern").toBe(201);
    const assistantId = ((await assistantRes.json()) as { id: number }).id;
    const inviteRes = await admin.ctx.post(`/api/users/${assistantId}/invite`);
    expect(inviteRes.ok(), `Einladung sollte klappen (${inviteRes.status()})`).toBe(true);
    const inviteToken = ((await inviteRes.json()) as { token: string }).token;
    assistantCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    const setPwRes = await assistantCtx.post("/api/auth/set-password", {
      data: { token: inviteToken, password: "assistent1234" },
    });
    expect(setPwRes.ok(), `set-password sollte 200 liefern (${setPwRes.status()})`).toBe(true);

    // Betreiber-Konto direkt in der Test-DB seeden und einloggen.
    seedSuperadmin(superEmail, superPassword, superName);
    superCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    const loginRes = await superCtx.post("/api/auth/login", {
      data: { email: superEmail, password: superPassword },
    });
    expect(loginRes.ok(), `Superadmin-Login fehlgeschlagen (${loginRes.status()})`).toBe(true);
  });

  test.afterAll(async () => {
    try {
      await deleteAccountByEmail(superEmail);
    } catch {
      /* Best effort */
    }
    try {
      await superCtx?.dispose();
    } catch {
      /* ignore */
    }
    try {
      await assistantCtx?.dispose();
    } catch {
      /* ignore */
    }
    await deleteFreeAccount(admin);
  });

  test("API: anonym 401, Admin 403, Assistent 403", async () => {
    const anonCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      const anonRes = await anonCtx.get("/api/operator/lexware/bookings");
      expect(anonRes.status(), "Anonym muss 401 liefern").toBe(401);
    } finally {
      await anonCtx.dispose();
    }

    const adminRes = await admin.ctx.get("/api/operator/lexware/bookings");
    expect(adminRes.status(), "Normaler Admin darf das Log nicht sehen").toBe(403);
    const adminBody = await adminRes.text();
    expect(adminBody, "403-Antwort darf keine Buchungen enthalten").not.toContain("bookings");

    const assistantRes = await assistantCtx!.get("/api/operator/lexware/bookings");
    expect(assistantRes.status(), "Assistent darf das Log nicht sehen").toBe(403);
  });

  test("API: superadmin 200 mit source demo und nicht-leerer Buchungsliste", async () => {
    test.skip(!demoMode, "Nur ohne echten LEXWARE_API_KEY (Demo-Adapter) aussagekräftig");
    const res = await superCtx.get("/api/operator/lexware/bookings");
    expect(res.status(), "Superadmin muss 200 bekommen").toBe(200);
    const body = (await res.json()) as LexwareResponse;
    expect(body.source, "Ohne echten Lexware-Key ist die Quelle Demo").toBe("demo");
    expect(Array.isArray(body.bookings), "bookings muss eine Liste sein").toBe(true);
    expect(body.bookings.length, "Demo-Log muss mindestens eine Buchung liefern").toBeGreaterThan(0);
    for (const booking of body.bookings) {
      expect(booking.id, "Jede Buchung muss eine id tragen").toBeTruthy();
    }
  });

  test("UI: Karte zeigt Demo-Badge und mindestens eine Buchungszeile", async ({ page }) => {
    test.skip(!demoMode, "Demo-Badge erscheint nur im Demo-Adapter-Modus");
    // Buchungs-IDs vorab über die API bestimmen (stabile Zeilen-Selektoren).
    const res = await superCtx.get("/api/operator/lexware/bookings");
    const body = (await res.json()) as LexwareResponse;
    const firstBookingId = body.bookings[0]!.id;

    // Programmatische Anmeldung als superadmin (geteilter Cookie-Jar → kein
    // Dev-Auto-Login).
    const loginRes = await page.request.post("/api/auth/login", {
      data: { email: superEmail, password: superPassword },
    });
    expect(loginRes.ok(), "UI-Login als superadmin fehlgeschlagen").toBe(true);

    await page.goto("/operator-dashboard");

    await expect(page.getByTestId("badge-lexware-demo")).toBeVisible();
    await expect(
      page.getByTestId(`row-lexware-booking-${firstBookingId}`),
    ).toBeVisible();
  });
});
