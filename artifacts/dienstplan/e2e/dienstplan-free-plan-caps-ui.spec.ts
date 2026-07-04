import { test, expect, type Page } from "@playwright/test";
import { addMonths, format } from "date-fns";
import { deleteFreeAccount, registerFreeAccount, type FreeAccount } from "./helpers/teams";

/**
 * UI-Test (#239): Die beiden verbleibenden serverseitig durchgesetzten
 * Free-Limits werden dem Nutzer auch im Web-Frontend KLAR angezeigt statt
 * still zu scheitern:
 *
 *   - maxShiftModels (5): Anlegen eines weiteren Dienstes (Schichtmodells)
 *     über dem Limit in den Einstellungen.
 *   - historyMonths (1): Planen einer Schicht mehr als 1 Monat im Voraus im
 *     Dienstplan (ShiftDialog).
 *
 * Beide Limits liefern serverseitig 403 `plan_limit_reached` (durch API-Tests
 * abgedeckt); hier wird geprueft, dass die Dialoge die gemappten
 * Upgrade-Hinweise (PLAN_LIMIT_MESSAGES in lib/api-error.ts) beim Speichern
 * sichtbar machen (der Anlege-Button bleibt bewusst immer aktiv).
 *
 * Vorgehen wie in dienstplan-free-plan-limits-ui.spec.ts (#224):
 * - Frisches Free-Konto per Self-Service-Registrierung (der Standard-Test-Admin
 *   ist auf Premium gehoben, taugt also nicht fuer Free-Gates).
 * - Session-Cookies ins Browser-Profil injizieren, damit die App NICHT das
 *   Dev-Auto-Login (Premium-Admin) ausloest, sondern als Free-Konto bootet.
 *
 * Laeuft gegen den isolierten Test-Stack (eigener API + Vite auf der `_test`-DB).
 */

const FREE_MAX_SHIFT_MODELS = 5;

/** Session-Cookies des per API registrierten Free-Kontos in den Browser uebernehmen. */
async function adoptSession(page: Page, account: FreeAccount): Promise<void> {
  const state = await account.ctx.storageState();
  await page.context().addCookies(state.cookies);
}

test.describe("Free-Limit Schichtmodelle (UI)", () => {
  let free: FreeAccount;
  const createdModelIds: number[] = [];

  test.beforeAll(async () => {
    // Registrierung seedet 5 Standard-Dienste = genau das Free-Limit (5). Für
    // das Race-Szenario (Dialog offen, Limit wird währenddessen erreicht) wird
    // ein Seed-Dienst gelöscht, damit das Konto UNTER dem Limit startet und
    // der Anlege-Button im UI aktiv ist.
    free = await registerFreeAccount("privat", "free.ui.model");
    const listRes = await free.ctx.get("/api/shift-models");
    expect(listRes.ok(), "Dienste-Liste sollte ladbar sein").toBe(true);
    const models = (await listRes.json()) as { id: number }[];
    if (models.length >= FREE_MAX_SHIFT_MODELS) {
      const delRes = await free.ctx.delete(`/api/shift-models/${models[models.length - 1]!.id}`);
      expect(delRes.ok(), "Seed-Dienst sollte löschbar sein").toBe(true);
    }
  });

  test.afterAll(async () => {
    // Konto + Standard-Team inkl. Dienste werden per SQL-Bereinigung
    // entfernt (DELETE /api/users scheitert am Team-FK-Baum).
    await deleteFreeAccount(free);
  });

  /** Legt per API so lange Dienste an, bis das Konto `target` Modelle hat. */
  async function ensureModelCount(target: number): Promise<void> {
    const listRes = await free.ctx.get("/api/shift-models");
    expect(listRes.ok(), "Dienste-Liste sollte ladbar sein").toBe(true);
    const models = (await listRes.json()) as { id: number }[];
    for (let i = models.length; i < target; i++) {
      const res = await free.ctx.post("/api/shift-models", {
        data: { name: `E2E Zusatzdienst ${Date.now()}-${i}`, valuationPercent: 100 },
      });
      expect(res.status(), `Dienst ${i + 1} sollte 201 liefern`).toBe(201);
      createdModelIds.push(((await res.json()) as { id: number }).id);
    }
  }

  test("Dialog zeigt am Modell-Limit den Upgrade-Hinweis statt stillem Fehlschlag", async ({
    page,
  }) => {
    test.setTimeout(60000);
    await adoptSession(page, free);

    // Mit 4 Diensten laden -> der Anlege-Button ist aktiv und der Dialog laesst
    // sich oeffnen. Das 5. Modell wird DANACH per API angelegt (Race-Szenario:
    // Limit wird erreicht, waehrend der Dialog schon offen ist). Der Submit
    // muss dann den servergemappten Upgrade-Hinweis anzeigen — genau der Pfad,
    // der bei einer Regression still verschluckt wuerde.
    await page.goto("/einstellungen");
    await expect(page.getByRole("heading", { name: "Einstellungen" })).toBeVisible();

    // Kopf-Button der Schichtmodell-Verwaltung (mobiles Viewport zeigt "Neu";
    // der erste "Neu"-Button der Seite gehoert zu den Modellen).
    const addButton = page.getByRole("button", { name: "Neu", exact: true }).first();
    await expect(addButton).toBeEnabled();
    await addButton.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Neues Schichtmodell")).toBeVisible();

    // Jetzt serverseitig ans Limit fahren (5. Dienst per API).
    await ensureModelCount(FREE_MAX_SHIFT_MODELS);

    await dialog.getByPlaceholder("z.B. Aktivdienst").fill("Sechster Dienst");
    await dialog.getByRole("button", { name: "Anlegen" }).click();

    // Klarer Upgrade-Hinweis statt stillem Fehlschlag.
    await expect(dialog.getByText(/max\. 5 Dienste/i)).toBeVisible();
    await expect(dialog.getByText(/Premium/i)).toBeVisible();
  });
});

test.describe("Free-Limit Vorausplanung (UI)", () => {
  let free: FreeAccount;
  let assistantId = 0;
  const assistantName = "Horizont Assistentin";

  // Ein Monat, der sicher AUSSERHALB des Free-Fensters (aktueller + naechster
  // Monat) liegt: 2 Kalendermonate voraus, Tag 15 (keine Monatsrand-Effekte).
  const farDate = new Date(addMonths(new Date(), 2).getFullYear(), addMonths(new Date(), 2).getMonth(), 15);
  const farDateKey = format(farDate, "yyyy-MM-dd");
  const todayKey = format(new Date(), "yyyy-MM-dd");

  test.beforeAll(async () => {
    free = await registerFreeAccount("privat", "free.ui.horizon");
    // Ein Assistent, damit der ShiftDialog einen waehlbaren Nutzer hat
    // (weit unter dem Assistenten-Limit von 6).
    const res = await free.ctx.post("/api/users", {
      data: {
        name: assistantName,
        email: `e2e.free.ui.horizon.${Date.now()}@dienstplan.test`,
        role: "assistant",
      },
    });
    expect(res.status(), "Assistent sollte 201 liefern").toBe(201);
    assistantId = ((await res.json()) as { id: number }).id;
  });

  test.afterAll(async () => {
    // Konto + Standard-Team inkl. Assistent werden per SQL-Bereinigung
    // entfernt (DELETE /api/users scheitert am Team-FK-Baum).
    await deleteFreeAccount(free);
  });

  /** Oeffnet den Dienstplan in der mobilen Listenansicht (agenda-day-Testids). */
  async function openDienstplanList(page: Page): Promise<void> {
    await page.goto("/dienstplan");
    await expect(page.getByRole("heading", { name: "Dienstplan" })).toBeVisible();
    // Default der Mobilansicht ist das Monatsgitter -> auf Liste umschalten.
    await page.getByTestId("view-toggle-list").click();
  }

  test("Kalender sperrt zu weite Monate mit Banner + Toast statt stillem Nichts", async ({
    page,
  }) => {
    test.setTimeout(60000);
    await adoptSession(page, free);
    await openDienstplanList(page);

    // Zwei Monate vorblaettern -> ausserhalb des Free-Fensters.
    await page.getByTestId("next-month").click();
    await page.getByTestId("next-month").click();
    await expect(page.getByTestId("month-label")).toContainText(
      format(farDate, "yyyy"),
    );

    // Banner: der Monat ist fuer Free nicht planbar.
    await expect(
      page.getByText(/Im Free-Tarif nur bis nächsten Monat planbar/i).first(),
    ).toBeVisible();

    // Klick auf einen Tag oeffnet KEINEN Dialog, sondern zeigt den
    // Upgrade-Hinweis als Toast.
    await page.getByTestId(`agenda-day-${farDateKey}`).locator("button").first().click();
    await expect(page.getByText(/Vorausplanung auf Premium upgraden/i)).toBeVisible();
    await expect(page.getByTestId("shift-dialog")).not.toBeVisible();
  });

  test("Dialog zeigt den Upgrade-Hinweis, wenn der Server ein zu fernes Datum ablehnt", async ({
    page,
  }) => {
    test.setTimeout(60000);
    await adoptSession(page, free);
    await openDienstplanList(page);

    // Dialog fuer HEUTE oeffnen (erlaubt) und dann das Datum im Formular auf
    // einen zu fernen Monat aendern — so wird der servergemappte 403-Pfad
    // (PLAN_LIMIT_MESSAGES.historyMonths) tatsaechlich ausgeuebt, nicht nur
    // das Client-Gate.
    await page.getByTestId(`agenda-day-${todayKey}`).locator("button").first().click();
    const dialog = page.getByTestId("shift-dialog");
    await expect(dialog.getByText("Neue Schicht anlegen")).toBeVisible();

    // Assistent auswaehlen (Typ/Zeiten haben Defaults: erstes Seed-Modell, 08-16).
    await dialog.getByTestId("shift-dialog-user").click();
    await page.getByRole("option", { name: assistantName }).click();

    // Datum auf 2 Monate voraus setzen und speichern -> Server lehnt mit
    // plan_limit_reached (historyMonths) ab.
    await dialog.getByTestId("shift-dialog-date").fill(farDateKey);
    await dialog.getByTestId("shift-dialog-save").click();

    // Klarer Upgrade-Hinweis im Dialog statt stillem Fehlschlag.
    await expect(dialog.getByText(/aktuellen und nächsten Monat/i)).toBeVisible();
    await expect(dialog.getByText(/Premium/i)).toBeVisible();
  });

  test("Auch Abwesenheiten im zu fernen Monat zeigen den Upgrade-Hinweis", async ({
    page,
  }) => {
    test.setTimeout(60000);
    await adoptSession(page, free);
    await openDienstplanList(page);

    // Abwesenheiten laufen ueber denselben POST /shifts (type vacation/sick)
    // und unterliegen serverseitig demselben historyMonths-Gate. Der Dialog
    // wird fuer HEUTE geoeffnet (Client-Gate greift nicht) und dann Typ
    // "Urlaub" + zu fernes Datum gewaehlt -> Server-403 muss als freundliche
    // Upgrade-Meldung erscheinen, nicht als "Keine Berechtigung".
    await page.getByTestId(`agenda-day-${todayKey}`).locator("button").first().click();
    const dialog = page.getByTestId("shift-dialog");
    await expect(dialog.getByText("Neue Schicht anlegen")).toBeVisible();

    await dialog.getByTestId("shift-dialog-user").click();
    await page.getByRole("option", { name: assistantName }).click();

    // Typ auf Abwesenheit "Urlaub" umstellen (Zeiten-Felder verschwinden).
    await dialog.getByTestId("shift-dialog-type").click();
    await page.getByRole("option", { name: "Urlaub" }).click();

    await dialog.getByTestId("shift-dialog-date").fill(farDateKey);
    await dialog.getByTestId("shift-dialog-save").click();

    // Die gemappte historyMonths-Meldung, NICHT der generische 403-Text.
    await expect(dialog.getByText(/aktuellen und nächsten Monat/i)).toBeVisible();
    await expect(dialog.getByText(/Premium/i)).toBeVisible();
    await expect(dialog.getByText("Keine Berechtigung zum Speichern.")).not.toBeVisible();
  });
});
