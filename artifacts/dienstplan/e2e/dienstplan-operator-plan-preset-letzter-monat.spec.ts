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
 * E2E-Test: Schnellauswahl "Letzter Monat" im Plan-Änderungsprotokoll (Task #418).
 *
 * Die Preset-Buttons (Dieser Monat / Letzter Monat / Letzte 30 Tage) befuellen
 * die von/bis-Felder — bisher war nur DAS verifiziert. Dieser Spec beweist,
 * dass die daraus resultierende SERVER-Filterung wirklich nur Eintraege des
 * gewaehlten Monats liefert, inklusive der Randtage:
 *
 *   - Eintrag am ERSTEN Tag des Vormonats, 00:00 Uhr  -> muss erscheinen
 *   - Eintrag am LETZTEN Tag des Vormonats, 23:59 Uhr -> muss erscheinen
 *   - Eintrag am letzten Tag des VOR-Vormonats        -> darf NICHT erscheinen
 *   - Eintrag am ersten Tag des AKTUELLEN Monats      -> darf NICHT erscheinen
 *
 * Vorgehen: plan_changes.created_at wird serverseitig immer auf "jetzt"
 * gesetzt (append-only Audit-Log). Der Spec erzeugt daher vier Plan-Flips mit
 * eindeutigen Belegnummern und backdatiert deren Zeitstempel anschliessend
 * direkt in der Test-DB (backdate-plan-change-Skript, analog set-plan).
 *
 * Der Browser-Kontext laeuft mit timezoneId "UTC", damit die lokalen
 * Tagesgrenzen der Preset-Berechnung deterministisch den backdatierten
 * UTC-Zeitstempeln entsprechen (die Zeitzonen-Korrektheit der Datums-Eingaben
 * selbst deckt dienstplan-operator-plan-zeitraum.spec.ts bereits ab).
 *
 * Setup analog dienstplan-operator-plan-zeitraum.spec.ts: superadmin via
 * setup-superadmin-Skript in die Test-DB seeden; E-Mails folgen dem Muster
 * e2e.*@dienstplan.test, damit der Cleanup greift.
 *
 * Laeuft gegen den isolierten Test-Stack (eigener API + Vite auf der `_test`-DB).
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

interface PlanChangeRow {
  id: number;
  accountId: number;
  note: string | null;
  createdAt: string;
}

/** Env-Basis fuer Skript-Aufrufe gegen die Test-DB (execSync). */
function scriptEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  if (process.env.E2E_TEST_DATABASE_URL) {
    env.DATABASE_URL = process.env.E2E_TEST_DATABASE_URL;
    env.APP_DATABASE_URL = process.env.E2E_TEST_DATABASE_URL;
  }
  return env;
}

/** Seedet einen superadmin direkt in der (Test-)DB via setup-superadmin-Skript. */
function seedSuperadmin(email: string, password: string, name: string): void {
  execSync("pnpm --filter @workspace/scripts run setup-superadmin", {
    env: scriptEnv({
      SUPERADMIN_EMAIL: email,
      SUPERADMIN_PASSWORD: password,
      SUPERADMIN_NAME: name,
    }),
    stdio: "pipe",
  });
}

/** Backdatiert einen plan_changes-Eintrag (identifiziert per Notiz) in der Test-DB. */
function backdatePlanChange(note: string, createdAt: Date): void {
  execSync("pnpm --filter @workspace/scripts run backdate-plan-change", {
    env: scriptEnv({
      BACKDATE_PLAN_CHANGE_NOTE: note,
      BACKDATE_PLAN_CHANGE_CREATED_AT: createdAt.toISOString(),
    }),
    stdio: "pipe",
  });
}

test.describe("Schnellauswahl Letzter Monat filtert das Protokoll serverseitig", () => {
  // Setup (Registrierung + Skript-Seeding + 4 Backdates) kann unter
  // Suiten-Volllast dauern.
  test.setTimeout(120_000);

  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const superEmail = `e2e.superadmin.preset.${stamp}@dienstplan.test`;
  const superPassword = "superadmin1234";
  const superName = `E2E Preset ${stamp}`;

  // Gemeinsames Suchpraefix aller vier Belege, damit die UI-Assertions
  // unabhaengig von fremden Protokoll-Zeilen sind.
  const prefix = `MONATSPRESET-${stamp}`;
  const noteVormonatErster = `${prefix}-VORMONAT-ERSTER`;
  const noteVormonatLetzter = `${prefix}-VORMONAT-LETZTER`;
  const noteVorVormonat = `${prefix}-VORVORMONAT`;
  const noteAktuellerMonat = `${prefix}-AKTUELLER-MONAT`;

  // Zeitstempel in UTC — der Browser-Kontext laeuft mit timezoneId "UTC",
  // sodass die "lokale" Preset-Berechnung exakt diese Grenzen ergibt.
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  // Randtage des Vormonats (einschliesslich).
  const tsVormonatErster = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));
  const tsVormonatLetzter = new Date(Date.UTC(y, m, 0, 23, 59, 0, 0));
  // Knapp AUSSERHALB: letzter Tag des Vor-Vormonats bzw. erster Tag des
  // aktuellen Monats (kurz nach Mitternacht).
  const tsVorVormonat = new Date(Date.UTC(y, m - 1, 0, 23, 59, 0, 0));
  const tsAktuellerMonat = new Date(Date.UTC(y, m, 1, 0, 0, 30, 0));

  let target: FreeAccount;
  let superCtx: APIRequestContext;

  test.beforeAll(async () => {
    // Ziel-Konto: frisch registrierter Admin (Rolle admin ist Voraussetzung
    // fuer den Plan-Flip-Endpunkt).
    target = await registerFreeAccount("privat", "planpreset");

    seedSuperadmin(superEmail, superPassword, superName);
    superCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    const loginRes = await superCtx.post("/api/auth/login", {
      data: { email: superEmail, password: superPassword },
    });
    expect(
      loginRes.ok(),
      `Superadmin-Login fehlgeschlagen (${loginRes.status()})`,
    ).toBe(true);

    // Vier Protokoll-Eintraege mit eindeutigen Belegen erzeugen (Plan-Flips
    // abwechselnd premium/free — jeder Flip schreibt genau eine Zeile) und
    // anschliessend auf die vier Grenz-Zeitpunkte backdatieren.
    const flips: Array<{ plan: "premium" | "free"; note: string; ts: Date }> = [
      { plan: "premium", note: noteVormonatErster, ts: tsVormonatErster },
      { plan: "free", note: noteVormonatLetzter, ts: tsVormonatLetzter },
      { plan: "premium", note: noteVorVormonat, ts: tsVorVormonat },
      { plan: "free", note: noteAktuellerMonat, ts: tsAktuellerMonat },
    ];
    for (const flip of flips) {
      const res = await superCtx.patch(
        `/api/operator/accounts/${target.id}/plan`,
        { data: { plan: flip.plan, note: flip.note } },
      );
      expect(res.status(), `Plan-Flip "${flip.note}" muss 200 liefern`).toBe(200);
      backdatePlanChange(flip.note, flip.ts);
    }
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

  test("API: Vormonats-Grenzen liefern GENAU die beiden Randtag-Eintraege", async () => {
    // Exakt die Grenzen, die die Schnellauswahl "Letzter Monat" (in UTC)
    // erzeugt: Monatserster 00:00:00.000 bis Monatsletzter 23:59:59.999.
    const from = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0)).toISOString();
    const to = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999)).toISOString();
    const res = await superCtx.get(
      `/api/operator/plan-changes?search=${encodeURIComponent(prefix)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
    expect(res.status()).toBe(200);
    const rows = (await res.json()) as PlanChangeRow[];
    const notes = rows.map((r) => r.note).sort();
    expect(notes, "Nur die beiden Vormonats-Randtage duerfen erscheinen").toEqual(
      [noteVormonatErster, noteVormonatLetzter].sort(),
    );
  });

  test("UI: Klick auf 'Letzter Monat' zeigt NUR Eintraege des Vormonats (inkl. Randtage)", async ({
    browser,
  }) => {
    // Eigener Kontext mit UTC-Zeitzone: die Preset-Berechnung nutzt das
    // LOKALE Datum des Browsers — mit UTC entsprechen die berechneten
    // Tagesgrenzen exakt den backdatierten UTC-Zeitstempeln.
    const context = await browser.newContext({
      baseURL: BASE_URL,
      timezoneId: "UTC",
    });
    try {
      const page = await context.newPage();
      // Programmatische Anmeldung als superadmin (Cookie-Jar geteilt mit dem
      // Browser — der Dev-Auto-Login greift dadurch nie).
      const loginRes = await page.request.post("/api/auth/login", {
        data: { email: superEmail, password: superPassword },
      });
      expect(loginRes.ok(), "UI-Login als superadmin fehlgeschlagen").toBe(true);

      await page.goto("/operator-dashboard");

      // Erst per Suche auf die vier eindeutigen Belege einschraenken, damit
      // die Assertions unabhaengig von anderen Protokoll-Zeilen sind. Ohne
      // Zeitraum muessen alle VIER erscheinen (Kontrolle, dass die
      // Testdaten wirklich da sind — sonst wuerde der Preset-Test nichts
      // beweisen).
      await page.getByTestId("input-plan-change-search").fill(prefix);
      const noteCells = page.locator("[data-testid^='text-plan-change-note-']");
      await expect(noteCells).toHaveCount(4);

      // Schnellauswahl "Letzter Monat" klicken -> von/bis werden befuellt,
      // der Server filtert neu.
      await page.getByTestId("button-plan-change-preset-last-month").click();

      // Die Felder muessen auf den Vormonat zeigen (Vorbedingung aus #382,
      // hier nur als Sanity-Check).
      const pad = (n: number) => String(n).padStart(2, "0");
      const prevYear = m === 0 ? y - 1 : y;
      const prevMonth = m === 0 ? 12 : m;
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      await expect(page.getByTestId("input-plan-change-from")).toHaveAttribute("data-value", 
        `${prevYear}-${pad(prevMonth)}-01`,
      );
      await expect(page.getByTestId("input-plan-change-to")).toHaveAttribute("data-value", 
        `${prevYear}-${pad(prevMonth)}-${pad(lastDay)}`,
      );

      // Ergebnis: GENAU die beiden Vormonats-Randtage — nicht mehr, nicht
      // weniger. Die Nachbar-Eintraege (Vor-Vormonat, aktueller Monat)
      // duerfen NICHT erscheinen.
      await expect(noteCells).toHaveCount(2);
      await expect(
        page.locator(`text=${noteVormonatErster}`),
      ).toBeVisible();
      await expect(
        page.locator(`text=${noteVormonatLetzter}`),
      ).toBeVisible();
      await expect(page.locator(`text=${noteVorVormonat}`)).toHaveCount(0);
      await expect(page.locator(`text=${noteAktuellerMonat}`)).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
