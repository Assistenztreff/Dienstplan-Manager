import { test, expect, request as playwrightRequest, type Page } from "@playwright/test";
import {
  deleteFreeAccount,
  registerFreeAccount,
  setAccountPlan,
  type FreeAccount,
} from "./helpers/teams";

/**
 * E2E-Absicherung: Premium-Sperren greifen nach einem Plan-Wechsel SOFORT und
 * ÜBERALL (Task #256).
 *
 * Die fünf Premium-Feature-Gates, die bisher nur per curl stichprobenartig
 * geprüft wurden, werden hier automatisiert abgedeckt:
 *   - caregiverLogin        POST /api/users/:id/invite
 *   - strictTimeTracking    PATCH /api/time-tracking/:id/confirm
 *   - calendarSync          GET /api/calendar-export
 *   - advancedAnalytics     GET /api/dashboard/hours-balance
 *     (setzt payrollExport transitiv durch — Datenquelle des PDF-Nachweises)
 *   - advancedPersonnelFile POST/PATCH /api/users mit Lohn-/SV-Feldern
 * (bulkEdit + die numerischen Limits sind bereits durch die Specs #205/#225/
 * #234/#235 gedeckt und werden hier nicht dupliziert.)
 *
 * Geprüft wird der komplette Plan-Wechsel-Zyklus in EINER Session (kein
 * Re-Login, kein Server-Neustart — `getUserPlan` liest den Plan pro Request
 * frisch aus der DB):
 *
 * 1. FREE: alle fünf Gates liefern 403 `plan_feature_required` mit dem
 *    korrekten `feature`-Feld (das Frontend mappt darüber die Upgrade-Hinweise);
 *    die ROHDATEN (Schichten, Ist-Zeiten, Nutzer) bleiben voll sichtbar.
 * 2. PREMIUM (users.plan-Flip direkt in der Test-DB = manuelle Freischaltung im
 *    Operator-Dashboard): dieselben Aktionen funktionieren sofort.
 * 3. DOWNGRADE zurück auf FREE: die Gates greifen sofort wieder, aber
 *    Bestandsschutz — als Premium angelegte Daten (Lohnfelder, bestätigte
 *    Ist-Zeit, Assistenten-Login via Einladung) bleiben sichtbar bzw. nutzbar.
 *
 * Zusätzlich ein UI-Test: ein Free-Konto sieht im Web-Frontend die
 * Sperr-Hinweise (deaktivierte Buttons mit Premium-Hinweis) statt stiller
 * Fehlschläge.
 *
 * Läuft gegen den isolierten Test-Stack (eigener API + Vite auf der `_test`-DB).
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

type FeatureError = { code?: string; feature?: string };

/** Liefert den 15. des aktuellen Monats (robust gegen Monatslängen/Zeitzonen). */
function currentMonthDay(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}-15`;
}

/** Erwartet ein strukturiertes 403 plan_feature_required für ein Feature. */
async function expectFeatureGate(
  res: { status(): number; json(): Promise<unknown> },
  feature: string,
  what: string,
): Promise<void> {
  expect(res.status(), `${what} sollte im Free-Tarif 403 liefern`).toBe(403);
  const body = (await res.json()) as FeatureError;
  expect(body.code, `${what}: code`).toBe("plan_feature_required");
  expect(body.feature, `${what}: feature`).toBe(feature);
}

// ---------------------------------------------------------------------------
// Teil 1: API — Free-Gates, Premium-Flip, Downgrade + Bestandsschutz
// ---------------------------------------------------------------------------

test.describe("Premium-Feature-Gates: Plan-Flip (API)", () => {
  let acc: FreeAccount;
  const createdUserIds: number[] = [];
  let assistantId = 0;
  let shiftId = 0;
  let timeEntryId = 0;
  let inviteToken = "";
  const assistantPassword = "einladung12345";
  const testIban = "DE02120300000000202051";

  test.beforeAll(async () => {
    // Privat-Konto genügt: alle fünf Gates hängen nur am Plan, nicht am
    // Konto-Typ. Die Registrierung legt ein Standard-Team an, sodass POST
    // /users, /shifts und /time-tracking ohne explizite teamId funktionieren.
    acc = await registerFreeAccount("privat", "gates-flip");
    const unique = Date.now();

    // Assistent OHNE Lohn-/SV-Daten (die wären im Free-Tarif geblockt).
    const userRes = await acc.ctx.post("/api/users", {
      data: {
        name: "E2E Gates Assistent",
        email: `e2e.gates.${unique}@dienstplan.test`,
        role: "assistant",
      },
    });
    expect(userRes.status(), "Assistent anlegen sollte 201 liefern").toBe(201);
    assistantId = ((await userRes.json()) as { id: number }).id;
    createdUserIds.push(assistantId);

    // FIX-Schicht im aktuellen Monat (kein historyMonths-Gate; FIX = einzige
    // Kategorie, die der Kalender-Export liefert).
    const day = currentMonthDay();
    const shiftRes = await acc.ctx.post("/api/shifts", {
      data: {
        userId: assistantId,
        startTime: `${day}T08:00:00.000Z`,
        endTime: `${day}T16:00:00.000Z`,
        type: "active",
        planningStatus: "FIX",
      },
    });
    expect(shiftRes.status(), "Schicht anlegen sollte 201 liefern").toBe(201);
    shiftId = ((await shiftRes.json()) as { id: number }).id;

    // Ist-Zeit (Status "pending") — das ERFASSEN bleibt im Free-Tarif frei,
    // nur das Bestätigen/Ablehnen ist Premium.
    const entryRes = await acc.ctx.post("/api/time-tracking", {
      data: {
        userId: assistantId,
        actualStart: `${day}T08:00:00.000Z`,
        actualEnd: `${day}T16:00:00.000Z`,
      },
    });
    expect(entryRes.status(), "Ist-Zeit anlegen sollte 201 liefern").toBe(201);
    const entry = (await entryRes.json()) as { id: number; status: string };
    timeEntryId = entry.id;
    expect(entry.status, "Neue Ist-Zeit sollte offen (pending) sein").toBe("pending");
  });

  test.afterAll(async () => {
    // Konto + Standard-Team inkl. Ist-Zeiten/Schichten/Assistenten werden per
    // SQL-Bereinigung entfernt (DELETE /api/users scheitert am Team-FK-Baum).
    await deleteFreeAccount(acc);
  });

  test("Free blockt alle fünf Gates, Premium-Flip schaltet sofort frei, Downgrade wahrt Bestandsschutz", async () => {
    test.setTimeout(120000);
    const unique = Date.now();

    // === Phase 1: FREE — alle Gates liefern 403 plan_feature_required ======

    await expectFeatureGate(
      await acc.ctx.post(`/api/users/${assistantId}/invite`),
      "caregiverLogin",
      "Einladungslink",
    );
    await expectFeatureGate(
      await acc.ctx.patch(`/api/time-tracking/${timeEntryId}/confirm`, {
        data: { status: "confirmed", confirmedBy: acc.id },
      }),
      "strictTimeTracking",
      "Ist-Zeit bestätigen",
    );
    await expectFeatureGate(
      await acc.ctx.get("/api/calendar-export"),
      "calendarSync",
      "Kalender-Export",
    );
    await expectFeatureGate(
      await acc.ctx.get("/api/dashboard/hours-balance"),
      "advancedAnalytics",
      "Soll/Ist-Auswertung",
    );
    await expectFeatureGate(
      await acc.ctx.post("/api/users", {
        data: {
          name: "E2E Lohn Assistent",
          email: `e2e.gates.lohn.${unique}@dienstplan.test`,
          role: "assistant",
          iban: testIban,
        },
      }),
      "advancedPersonnelFile",
      "Anlegen mit Lohndaten",
    );
    await expectFeatureGate(
      await acc.ctx.patch(`/api/users/${assistantId}`, {
        data: { iban: testIban },
      }),
      "advancedPersonnelFile",
      "Lohndaten ändern",
    );

    // Bestandsschutz im Free-Tarif: die ROHDATEN bleiben voll sichtbar.
    const shiftsFree = (await (await acc.ctx.get("/api/shifts")).json()) as { id: number }[];
    expect(
      shiftsFree.some((s) => s.id === shiftId),
      "FIX-Schicht muss im Free-Tarif sichtbar bleiben",
    ).toBe(true);
    const entriesFree = (await (await acc.ctx.get("/api/time-tracking")).json()) as {
      id: number;
      status: string;
    }[];
    const entryFree = entriesFree.find((e) => e.id === timeEntryId);
    expect(entryFree, "Ist-Zeit muss im Free-Tarif sichtbar bleiben").toBeTruthy();
    expect(entryFree!.status, "Ist-Zeit bleibt im Free-Tarif offen").toBe("pending");

    // === Phase 2: PREMIUM-Flip (manuelle Freischaltung) — dieselbe Session ==

    await setAccountPlan(acc.email, "premium");

    // caregiverLogin: Einladungslink wird jetzt erzeugt.
    const inviteRes = await acc.ctx.post(`/api/users/${assistantId}/invite`);
    expect(inviteRes.status(), "Einladung sollte nach Upgrade 200 liefern").toBe(200);
    inviteToken = ((await inviteRes.json()) as { token: string }).token;
    expect(inviteToken.length, "Einladung sollte einen Token liefern").toBeGreaterThan(0);

    // strictTimeTracking: Bestätigen funktioniert jetzt.
    const confirmRes = await acc.ctx.patch(`/api/time-tracking/${timeEntryId}/confirm`, {
      data: { status: "confirmed", confirmedBy: acc.id },
    });
    expect(confirmRes.status(), "Bestätigen sollte nach Upgrade 200 liefern").toBe(200);
    expect(((await confirmRes.json()) as { status: string }).status).toBe("confirmed");

    // calendarSync: ICS-Export liefert die FIX-Schicht.
    const icsRes = await acc.ctx.get("/api/calendar-export");
    expect(icsRes.status(), "Kalender-Export sollte nach Upgrade 200 liefern").toBe(200);
    const ics = await icsRes.text();
    expect(ics, "ICS-Datei sollte ein VCALENDAR sein").toContain("BEGIN:VCALENDAR");
    expect(ics, "ICS-Datei sollte die FIX-Schicht enthalten").toContain("BEGIN:VEVENT");

    // advancedAnalytics (transitiv payrollExport): Soll/Ist-Daten kommen jetzt.
    const balanceRes = await acc.ctx.get("/api/dashboard/hours-balance");
    expect(balanceRes.status(), "hours-balance sollte nach Upgrade 200 liefern").toBe(200);

    // advancedPersonnelFile: Lohndaten ändern + mit Lohndaten anlegen.
    const patchIban = await acc.ctx.patch(`/api/users/${assistantId}`, {
      data: { iban: testIban },
    });
    expect(patchIban.status(), "IBAN setzen sollte nach Upgrade 200 liefern").toBe(200);
    const createWithWage = await acc.ctx.post("/api/users", {
      data: {
        name: "E2E Lohn Assistent",
        email: `e2e.gates.lohn2.${unique}@dienstplan.test`,
        role: "assistant",
        iban: testIban,
        taxClass: "1",
      },
    });
    expect(createWithWage.status(), "Anlegen mit Lohndaten sollte nach Upgrade 201 liefern").toBe(201);
    createdUserIds.push(((await createWithWage.json()) as { id: number }).id);

    // Assistent nimmt die Einladung an (setzt sein Passwort) — eigener Kontext.
    const assistantCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    const setPwRes = await assistantCtx.post("/api/auth/set-password", {
      data: { token: inviteToken, password: assistantPassword },
    });
    expect(setPwRes.status(), "Einladung annehmen sollte 200 liefern").toBe(200);
    await assistantCtx.dispose();

    // === Phase 3: DOWNGRADE zurück auf Free — Gates sofort wieder aktiv, ===
    // === Bestandsdaten bleiben sichtbar/nutzbar (Bestandsschutz)         ===

    await setAccountPlan(acc.email, "free");

    // Die Gates greifen sofort wieder (Plan wird pro Request frisch gelesen).
    await expectFeatureGate(
      await acc.ctx.get("/api/calendar-export"),
      "calendarSync",
      "Kalender-Export nach Downgrade",
    );
    await expectFeatureGate(
      await acc.ctx.post(`/api/users/${assistantId}/invite`),
      "caregiverLogin",
      "NEUE Einladung nach Downgrade",
    );

    // Bestandsschutz: als Premium gesetzte Lohndaten bleiben sichtbar …
    const userAfter = (await (
      await acc.ctx.get(`/api/users/${assistantId}`)
    ).json()) as { iban?: string | null };
    expect(userAfter.iban, "Als Premium gesetzte IBAN bleibt nach Downgrade sichtbar").toBe(testIban);

    // … und dürfen UNVERÄNDERT mitgesendet werden (nur echte Änderungen blocken).
    const patchUnchanged = await acc.ctx.patch(`/api/users/${assistantId}`, {
      data: { iban: testIban, name: "E2E Gates Assistent (umbenannt)" },
    });
    expect(
      patchUnchanged.status(),
      "PATCH mit UNVERÄNDERTER IBAN muss im Free-Tarif erlaubt bleiben",
    ).toBe(200);

    // Bestandsschutz: die als Premium bestätigte Ist-Zeit bleibt bestätigt.
    const entriesAfter = (await (await acc.ctx.get("/api/time-tracking")).json()) as {
      id: number;
      status: string;
    }[];
    const entryAfter = entriesAfter.find((e) => e.id === timeEntryId);
    expect(entryAfter, "Bestätigte Ist-Zeit bleibt nach Downgrade sichtbar").toBeTruthy();
    expect(entryAfter!.status, "Bestätigungs-Status bleibt nach Downgrade erhalten").toBe("confirmed");

    // Bestandsschutz: der als Premium eingeladene Assistent kann sich weiter
    // anmelden (gegated wird nur das Erzeugen NEUER Einladungslinks).
    const assistantLoginCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    // E-Mail des Assistenten aus der DB lesen statt sie im Test zu duplizieren.
    const assistantEmail = (
      (await (await acc.ctx.get(`/api/users/${assistantId}`)).json()) as { email: string }
    ).email;
    const loginRes = await assistantLoginCtx.post("/api/auth/login", {
      data: { email: assistantEmail, password: assistantPassword },
    });
    expect(
      loginRes.status(),
      "Eingeladener Assistent muss sich nach Downgrade weiter anmelden können",
    ).toBe(200);
    await assistantLoginCtx.dispose();
  });
});

// ---------------------------------------------------------------------------
// Teil 2: UI — ein Free-Konto sieht die Sperr-Hinweise (keine stillen Fehler)
// ---------------------------------------------------------------------------

/**
 * Übernimmt die Session-Cookies des per API registrierten Free-Kontos in den
 * Browser-Kontext, damit die App als Free-Konto bootstrappt und NICHT das
 * Dev-Auto-Login (Premium-Admin) auslöst.
 */
async function adoptSession(page: Page, account: FreeAccount): Promise<void> {
  const state = await account.ctx.storageState();
  await page.context().addCookies(state.cookies);
}

test.describe("Premium-Feature-Gates: Sperr-Hinweise im Frontend (UI)", () => {
  let free: FreeAccount;
  let assistantId = 0;
  let timeEntryId = 0;

  test.beforeAll(async () => {
    free = await registerFreeAccount("privat", "gates-ui");
    const unique = Date.now();

    const userRes = await free.ctx.post("/api/users", {
      data: {
        name: "E2E UI Gates Assistent",
        email: `e2e.gates.ui.${unique}@dienstplan.test`,
        role: "assistant",
      },
    });
    expect(userRes.status(), "Assistent anlegen sollte 201 liefern").toBe(201);
    assistantId = ((await userRes.json()) as { id: number }).id;

    // Offene Ist-Zeit, damit die Zeiterfassung die (gesperrten)
    // Bestätigen/Ablehnen-Buttons überhaupt rendert.
    const day = currentMonthDay();
    const entryRes = await free.ctx.post("/api/time-tracking", {
      data: {
        userId: assistantId,
        actualStart: `${day}T08:00:00.000Z`,
        actualEnd: `${day}T16:00:00.000Z`,
      },
    });
    expect(entryRes.status(), "Ist-Zeit anlegen sollte 201 liefern").toBe(201);
    timeEntryId = ((await entryRes.json()) as { id: number }).id;
  });

  test.afterAll(async () => {
    const tryDelete = async (path: string) => {
      try {
        await free.ctx.delete(path);
      } catch {
        /* ignore */
      }
    };
    if (timeEntryId) await tryDelete(`/api/time-tracking/${timeEntryId}`);
    if (assistantId) await tryDelete(`/api/users/${assistantId}`);
    if (free?.id) await tryDelete(`/api/users/${free.id}`);
    await free.ctx.dispose();
  });

  test("Einstellungen: Kalender-Export ist gesperrt und zeigt den Premium-Hinweis", async ({
    page,
  }) => {
    test.setTimeout(60000);
    await adoptSession(page, free);

    await page.goto("/einstellungen");
    const exportButton = page.getByTestId("calendar-export-button");
    await expect(exportButton).toBeVisible();
    await expect(exportButton, "Export-Button muss im Free-Tarif gesperrt sein").toBeDisabled();
    await expect(
      page.getByText(/Kalender-Export \(\.ics\) ist ein Premium-Feature/),
      "Der Premium-Hinweis zum Kalender-Export muss sichtbar sein",
    ).toBeVisible();
  });

  test("Assistenten: Nachweis- und Einladen-Buttons sind gesperrt mit Premium-Hinweis", async ({
    page,
  }) => {
    test.setTimeout(60000);
    await adoptSession(page, free);

    await page.goto("/assistenten");
    await expect(page.getByRole("heading", { name: "Assistenten" })).toBeVisible();

    // Auf schmalen Viewports (Config: 400px) sind die Button-Beschriftungen
    // ausgeblendet (`hidden sm:inline`) — daher über das title-Attribut suchen,
    // das im Free-Tarif den Premium-Hinweis trägt.
    const inviteButton = page
      .locator('button[title*="Einladungslinks für Assistenten sind ein Premium-Feature"]')
      .first();
    await expect(inviteButton).toBeVisible();
    await expect(inviteButton, "Einladen muss im Free-Tarif gesperrt sein").toBeDisabled();

    const exportButton = page
      .locator('button[title*="PDF-Stundennachweis ist ein Premium-Feature"]')
      .first();
    await expect(exportButton).toBeVisible();
    await expect(exportButton, "PDF-Nachweis muss im Free-Tarif gesperrt sein").toBeDisabled();
  });

  test("Zeiterfassung: Bestätigen/Ablehnen ist gesperrt mit Premium-Hinweis", async ({
    page,
  }) => {
    test.setTimeout(60000);
    await adoptSession(page, free);

    await page.goto("/zeiterfassung");

    // Die offene Ist-Zeit rendert zwei gesperrte Aktions-Buttons, deren
    // title-Attribut den Premium-Hinweis trägt (statt "Bestätigen"/"Ablehnen").
    const gatedButtons = page.locator(
      'button[title*="Bestätigen/Ablehnen von Ist-Zeiten ist ein Premium-Feature"]',
    );
    await expect(gatedButtons.first()).toBeVisible();
    await expect(gatedButtons.first(), "Bestätigen muss im Free-Tarif gesperrt sein").toBeDisabled();
    // 3 gesperrte Buttons: Bestätigen + Ablehnen in der Zeile plus der
    // Header-Button "Alle offenen bestätigen" (Sammelbestätigung, ebenfalls
    // Premium-gegated).
    await expect(gatedButtons).toHaveCount(3);
    await expect(
      page.getByTestId("batch-confirm-open"),
      "Sammelbestätigung muss im Free-Tarif gesperrt sein",
    ).toBeDisabled();
  });
});
