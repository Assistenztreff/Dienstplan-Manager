import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";
import {
  registerFreeAccount,
  deleteFreeAccount,
  type FreeAccount,
} from "./helpers/teams";
import { dbSeedSuperadmin, dbBackdatePlanChange, dbDeleteAccountByEmail } from "./helpers/db";

/**
 * E2E-Test: Schnellauswahl "Dieser Monat" und "Letzte 30 Tage" im
 * Plan-Aenderungsprotokoll (Task #431, analog zum "Letzter Monat"-Spec
 * dienstplan-operator-plan-preset-letzter-monat.spec.ts aus #418).
 *
 * Bisher war fuer diese beiden Presets nur die korrekte Befuellung der
 * von/bis-Felder verifiziert. Dieser Spec beweist die tatsaechliche
 * SERVER-Filterwirkung an den Randpunkten:
 *
 * "Dieser Monat":
 *   - Eintrag am ERSTEN Tag des aktuellen Monats, 00:00 Uhr -> muss erscheinen
 *   - Eintrag "jetzt" (heute)                               -> muss erscheinen
 *   - Eintrag am LETZTEN Tag des Vormonats, 23:59 Uhr       -> darf NICHT erscheinen
 *
 * "Letzte 30 Tage" (heute = Tag 1, also heute-29 = Tag 30 eingeschlossen,
 * heute-30 = Tag 31 ausgeschlossen):
 *   - Eintrag am Tag heute-29, 00:00 Uhr  -> muss erscheinen (unterer Rand)
 *   - Eintrag "jetzt" (heute)             -> muss erscheinen (oberer Rand)
 *   - Eintrag am Tag heute-30, 23:59 Uhr  -> darf NICHT erscheinen
 *
 * Vorgehen wie im Vorlage-Spec: plan_changes.created_at wird serverseitig
 * immer auf "jetzt" gesetzt (append-only Audit-Log). Der Spec erzeugt daher
 * sechs Plan-Flips mit eindeutigen Belegnummern und backdatiert deren
 * Zeitstempel anschliessend direkt in der Test-DB — hier in-Prozess via
 * dbBackdatePlanChange (helpers/db.ts) statt per execSync-Skript, damit das
 * Setup nicht pro Backdate ~3s Prozess-Overhead kostet.
 *
 * Der Browser-Kontext laeuft mit timezoneId "UTC", damit die lokalen
 * Tagesgrenzen der Preset-Berechnung deterministisch den backdatierten
 * UTC-Zeitstempeln entsprechen.
 *
 * Bekannte (bewusst akzeptierte) Rest-Unschaerfe: rollt der UTC-Tag GENAU
 * zwischen Seeding und Preset-Klick um Mitternacht um, verschieben sich die
 * berechneten Grenzen um einen Tag (extrem kleines Zeitfenster, wie beim
 * Monatswechsel im Vorlage-Spec).
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

const pad = (n: number) => String(n).padStart(2, "0");

test.describe("Schnellauswahl Dieser Monat / Letzte 30 Tage filtern serverseitig", () => {
  // Setup (Registrierung + superadmin-Seed + 6 Plan-Flips mit Backdates)
  // kann unter Suiten-Volllast dauern.
  test.setTimeout(120_000);

  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const superEmail = `e2e.superadmin.preset2.${stamp}@dienstplan.test`;
  const superPassword = "superadmin1234";
  const superName = `E2E Preset2 ${stamp}`;

  // Zwei DISJUNKTE Suchpraefixe (eines je Preset), damit die Assertions je
  // Preset unabhaengig voneinander und von fremden Protokoll-Zeilen sind.
  const prefixMonat = `DIESERMONAT-${stamp}`;
  const noteMonatErster = `${prefixMonat}-MONATSERSTER`;
  const noteMonatHeute = `${prefixMonat}-HEUTE`;
  const noteMonatVormonat = `${prefixMonat}-VORMONAT-LETZTER`;

  const prefix30 = `LETZTE30-${stamp}`;
  const note30Tag30 = `${prefix30}-TAG30-EINGESCHLOSSEN`;
  const note30Heute = `${prefix30}-HEUTE`;
  const note30Tag31 = `${prefix30}-TAG31-AUSGESCHLOSSEN`;

  // Zeitstempel in UTC — der Browser-Kontext laeuft mit timezoneId "UTC",
  // sodass die "lokale" Preset-Berechnung exakt diese Grenzen ergibt.
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();

  // "Dieser Monat": unterer Rand einschliesslich, Vormonat knapp ausserhalb.
  const tsMonatErster = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
  const tsMonatVormonat = new Date(Date.UTC(y, m, 0, 23, 59, 0, 0));

  // "Letzte 30 Tage": heute = Tag 1 -> heute-29 (Tag 30) einschliesslich,
  // heute-30 (Tag 31) knapp ausserhalb.
  const ts30Tag30 = new Date(Date.UTC(y, m, d - 29, 0, 0, 0, 0));
  const ts30Tag31 = new Date(Date.UTC(y, m, d - 30, 23, 59, 0, 0));

  // "Heute"-Eintraege beider Presets: oberer Rand (liegt vor dem jeweiligen
  // Tages-/Monatsende, muss also erscheinen). Fester Zeitpunkt statt
  // Server-"jetzt", damit die Assertions deterministisch bleiben.
  const tsHeute = new Date(Date.UTC(y, m, d, 0, 0, 30, 0));

  let target: FreeAccount;
  let superCtx: APIRequestContext;

  test.beforeAll(async () => {
    // Ziel-Konto: frisch registrierter Admin (Rolle admin ist Voraussetzung
    // fuer den Plan-Flip-Endpunkt).
    target = await registerFreeAccount("privat", "planpreset2");

    await dbSeedSuperadmin(superEmail, superPassword, superName);
    superCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    const loginRes = await superCtx.post("/api/auth/login", {
      data: { email: superEmail, password: superPassword },
    });
    expect(
      loginRes.ok(),
      `Superadmin-Login fehlgeschlagen (${loginRes.status()})`,
    ).toBe(true);

    // Sechs Protokoll-Eintraege mit eindeutigen Belegen erzeugen (Plan-Flips
    // abwechselnd premium/free — jeder Flip schreibt genau eine Zeile) und
    // anschliessend auf die Grenz-Zeitpunkte backdatieren.
    const flips: Array<{ plan: "premium" | "free"; note: string; ts: Date }> = [
      { plan: "premium", note: noteMonatErster, ts: tsMonatErster },
      { plan: "free", note: noteMonatHeute, ts: tsHeute },
      { plan: "premium", note: noteMonatVormonat, ts: tsMonatVormonat },
      { plan: "free", note: note30Tag30, ts: ts30Tag30 },
      { plan: "premium", note: note30Heute, ts: tsHeute },
      { plan: "free", note: note30Tag31, ts: ts30Tag31 },
    ];
    for (const flip of flips) {
      const res = await superCtx.patch(
        `/api/operator/accounts/${target.id}/plan`,
        { data: { plan: flip.plan, note: flip.note } },
      );
      expect(res.status(), `Plan-Flip "${flip.note}" muss 200 liefern`).toBe(200);
      await dbBackdatePlanChange(flip.note, flip.ts);
    }
  });

  test.afterAll(async () => {
    try {
      await dbDeleteAccountByEmail(superEmail);
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

  test("API: Grenzen von 'Dieser Monat' liefern GENAU Monatserster + Heute", async () => {
    // Exakt die Grenzen, die die Schnellauswahl "Dieser Monat" (in UTC)
    // erzeugt: Monatserster 00:00:00.000 bis Monatsletzter 23:59:59.999.
    const from = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0)).toISOString();
    const to = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999)).toISOString();
    const res = await superCtx.get(
      `/api/operator/plan-changes?search=${encodeURIComponent(prefixMonat)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
    expect(res.status()).toBe(200);
    const rows = (await res.json()) as PlanChangeRow[];
    const notes = rows.map((r) => r.note).sort();
    expect(
      notes,
      "Nur Monatserster + Heute duerfen erscheinen, Vormonat nicht",
    ).toEqual([noteMonatErster, noteMonatHeute].sort());
  });

  test("API: Grenzen von 'Letzte 30 Tage' schliessen Tag 30 ein, Tag 31 aus", async () => {
    // Exakt die Grenzen, die die Schnellauswahl "Letzte 30 Tage" (in UTC)
    // erzeugt: heute-29 00:00:00.000 bis heute 23:59:59.999.
    const from = new Date(Date.UTC(y, m, d - 29, 0, 0, 0, 0)).toISOString();
    const to = new Date(Date.UTC(y, m, d, 23, 59, 59, 999)).toISOString();
    const res = await superCtx.get(
      `/api/operator/plan-changes?search=${encodeURIComponent(prefix30)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
    expect(res.status()).toBe(200);
    const rows = (await res.json()) as PlanChangeRow[];
    const notes = rows.map((r) => r.note).sort();
    expect(
      notes,
      "Tag 30 (heute-29) und Heute duerfen erscheinen, Tag 31 (heute-30) nicht",
    ).toEqual([note30Heute, note30Tag30].sort());
  });

  test("UI: Klick auf 'Dieser Monat' zeigt NUR Eintraege des aktuellen Monats", async ({
    browser,
  }) => {
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

      // Erst per Suche auf die drei eindeutigen Belege einschraenken. Ohne
      // Zeitraum muessen alle DREI erscheinen (Kontrolle, dass die Testdaten
      // wirklich da sind — sonst wuerde der Preset-Test nichts beweisen).
      await page.getByTestId("input-plan-change-search").fill(prefixMonat);
      const noteCells = page.locator("[data-testid^='text-plan-change-note-']");
      await expect(noteCells).toHaveCount(3);

      // Schnellauswahl "Dieser Monat" klicken -> von/bis werden befuellt,
      // der Server filtert neu.
      await page.getByTestId("button-plan-change-preset-this-month").click();

      // Die Felder muessen auf den aktuellen Monat zeigen (Vorbedingung aus
      // #382, hier nur als Sanity-Check).
      const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      await expect(page.getByTestId("input-plan-change-from")).toHaveAttribute("data-value", 
        `${y}-${pad(m + 1)}-01`,
      );
      await expect(page.getByTestId("input-plan-change-to")).toHaveAttribute("data-value", 
        `${y}-${pad(m + 1)}-${pad(lastDay)}`,
      );

      // Ergebnis: GENAU Monatserster + Heute — der Vormonats-Nachbar
      // (letzter Tag Vormonat 23:59) darf NICHT erscheinen.
      await expect(noteCells).toHaveCount(2);
      await expect(page.locator(`text=${noteMonatErster}`)).toBeVisible();
      await expect(page.locator(`text=${noteMonatHeute}`)).toBeVisible();
      await expect(page.locator(`text=${noteMonatVormonat}`)).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("UI: Klick auf 'Letzte 30 Tage' zeigt Tag 30, aber nicht Tag 31", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      baseURL: BASE_URL,
      timezoneId: "UTC",
    });
    try {
      const page = await context.newPage();
      const loginRes = await page.request.post("/api/auth/login", {
        data: { email: superEmail, password: superPassword },
      });
      expect(loginRes.ok(), "UI-Login als superadmin fehlgeschlagen").toBe(true);

      await page.goto("/operator-dashboard");

      // Kontrolle: alle DREI Belege ohne Zeitraum sichtbar.
      await page.getByTestId("input-plan-change-search").fill(prefix30);
      const noteCells = page.locator("[data-testid^='text-plan-change-note-']");
      await expect(noteCells).toHaveCount(3);

      // Schnellauswahl "Letzte 30 Tage" klicken.
      await page.getByTestId("button-plan-change-preset-last-30-days").click();

      // Felder muessen heute-29 bis heute zeigen (Sanity-Check). Datum via
      // UTC-Getter aus dem backdatierten Tag-30-Zeitstempel abgeleitet.
      const from30 = ts30Tag30;
      await expect(page.getByTestId("input-plan-change-from")).toHaveAttribute("data-value", 
        `${from30.getUTCFullYear()}-${pad(from30.getUTCMonth() + 1)}-${pad(from30.getUTCDate())}`,
      );
      await expect(page.getByTestId("input-plan-change-to")).toHaveAttribute("data-value", 
        `${y}-${pad(m + 1)}-${pad(d)}`,
      );

      // Ergebnis: GENAU Tag 30 + Heute — Tag 31 (heute-30, 23:59) darf
      // NICHT erscheinen.
      await expect(noteCells).toHaveCount(2);
      await expect(page.locator(`text=${note30Tag30}`)).toBeVisible();
      await expect(page.locator(`text=${note30Heute}`)).toBeVisible();
      await expect(page.locator(`text=${note30Tag31}`)).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
