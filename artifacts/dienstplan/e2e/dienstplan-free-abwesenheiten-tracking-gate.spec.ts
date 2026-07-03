import { test, expect, type Page } from "@playwright/test";
import {
  deleteFreeAccount,
  registerFreeAccount,
  setAccountPlan,
  type FreeAccount,
} from "./helpers/teams";

/**
 * E2E-Absicherung der Produktentscheidung aus Task #319 (Task #321):
 *
 *   Das EINTRAGEN von Urlaub/Krankheit ist für ALLE Pläne frei —
 *   Premium ist ausschließlich das TRACKING (Resturlaub-Konto).
 *
 * Schützt vor Regressionen wie dem versehentlichen Wieder-Einführen eines
 * Erstellungs-Gates (absenceTracking hat bewusst KEIN Server-Gate im
 * shifts-POST) oder dem Verschwinden des Upgrade-Hinweises.
 *
 * Abgedeckt:
 * 1. FREE (frisch registriertes Konto, garantiert Free-Plan):
 *    - legt auf /abwesenheiten Urlaub UND Krankheit über die UI an (beides
 *      gelingt, erscheint in der Liste "Eingetragene Abwesenheiten")
 *    - die Karte "Resturlaub {Jahr}" zeigt NUR den Upgrade-Hinweis
 *      (data-testid="absence-tracking-premium-hint"), keine Bilanz-Zeilen
 * 2. PREMIUM (users.plan-Flip direkt in der Test-DB = manuelle Freischaltung
 *    im Operator-Dashboard):
 *    - der Upgrade-Hinweis verschwindet, die Bilanz-Tabelle erscheint
 *    - die im Free-Tarif eingetragenen Urlaubstage sind KORREKT mitgezählt
 *      (kein Datenverlust: vacationDaysUsed-Buchhaltung läuft plan-unabhängig)
 *
 * Läuft gegen den isolierten Test-Stack (eigener API + Vite auf der `_test`-DB).
 */

// Desktop-Viewport: Erfassungsformular, Resturlaub-Karte und Liste sind so
// gleichzeitig stabil sichtbar (die Config-Default-Breite von 400px staucht
// das dreispaltige Layout).
test.use({ viewport: { width: 1280, height: 800 } });

const YEAR = new Date().getFullYear();
const VACATION_DAYS = 30;

/** Tag im aktuellen Monat als YYYY-MM-DD (Vergangenheit ist nie geblockt,
 *  aktueller Monat liegt immer innerhalb des Free-historyMonths-Fensters). */
function currentMonthDay(day: number): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return `${now.getFullYear()}-${mm}-${String(day).padStart(2, "0")}`;
}

const VACATION_FROM = currentMonthDay(10);
const VACATION_TO = currentMonthDay(11);
const SICK_DAY = currentMonthDay(13);

/**
 * Übernimmt die Session-Cookies des per API registrierten Free-Kontos in den
 * Browser-Kontext, damit die App als dieses Konto bootstrappt und NICHT das
 * Dev-Auto-Login (Premium-Seed-Admin) auslöst.
 */
async function adoptSession(page: Page, account: FreeAccount): Promise<void> {
  const state = await account.ctx.storageState();
  await page.context().addCookies(state.cookies);
}

test.describe("Abwesenheiten: Eintragen frei, Resturlaub-Tracking Premium", () => {
  // Die Tests bauen aufeinander auf (Free legt Daten an, Premium sieht sie
  // in der Bilanz) — strikt nacheinander ausführen.
  test.describe.configure({ mode: "serial" });

  let acc: FreeAccount;
  let assistantId = 0;
  let assistantName = "";

  test.beforeAll(async () => {
    // Frisch registriertes Konto = garantiert Free (der Seed-Admin ist
    // bewusst Premium und würde hier nichts beweisen).
    acc = await registerFreeAccount("privat", "abwesenheit-gate");
    const unique = Date.now();

    // Assistent + Vertrag VOR dem ersten Seitenaufruf anlegen (React Query
    // cached die Listen beim Laden — später geseedete Zeilen erscheinen nicht).
    assistantName = `E2E Abwesenheit Gate ${unique}`;
    const userRes = await acc.ctx.post("/api/users", {
      data: {
        name: assistantName,
        email: `e2e.abwesenheit.gate.${unique}@dienstplan.test`,
        role: "assistant",
      },
    });
    expect(userRes.status(), "Assistent anlegen sollte 201 liefern").toBe(201);
    assistantId = ((await userRes.json()) as { id: number }).id;

    // Aktiver Vertrag, damit die Premium-Bilanz später echte Zahlen zeigt
    // (Anspruch/genommen/verbleibend statt "Kein Vertrag").
    const contractRes = await acc.ctx.post("/api/contracts", {
      data: {
        userId: assistantId,
        startDate: `${YEAR}-01-01`,
        weeklyHours: 40,
        vacationDays: VACATION_DAYS,
      },
    });
    expect(contractRes.status(), "Vertrag anlegen sollte 201 liefern").toBe(201);
  });

  test.afterAll(async () => {
    // SQL-Bereinigung: Konto + Standard-Team + Schichten/Verträge/Assistenten
    // (DELETE /api/users scheitert bei selbst-registrierten Konten am FK-Baum).
    await deleteFreeAccount(acc);
  });

  test("Free-Konto legt Urlaub UND Krankheit an und sieht statt Bilanz den Upgrade-Hinweis", async ({
    page,
  }) => {
    await adoptSession(page, acc);
    await page.goto("/abwesenheiten");
    await expect(
      page.getByRole("heading", { name: "Abwesenheiten", exact: true }),
    ).toBeVisible();

    // --- Resturlaub-Karte: NUR der Upgrade-Hinweis, keine Bilanz-Zeilen ----
    await expect(
      page.getByTestId("absence-tracking-premium-hint"),
      "Free-Konto muss in der Resturlaub-Karte den Premium-Hinweis sehen",
    ).toBeVisible();
    await expect(
      page.getByTestId(`vacation-balance-row-${assistantId}`),
      "Free-Konto darf KEINE Bilanz-Zeile sehen",
    ).toHaveCount(0);

    // --- Urlaub eintragen (2 Tage) — muss im Free-Tarif gelingen ----------
    await page.getByTestId("absence-user").click();
    await page.getByRole("option", { name: assistantName }).click();
    // Art bleibt "Urlaub" (Default).
    await page.getByTestId("absence-from").fill(VACATION_FROM);
    await page.getByTestId("absence-to").fill(VACATION_TO);
    await page.getByTestId("absence-save").click();

    const list = page.getByTestId("absence-list");
    await expect(list, "Urlaub muss im Free-Tarif angelegt werden").toContainText(
      "Urlaub · 2 Tage",
    );

    // --- Krankheit eintragen (1 Tag) — muss ebenfalls gelingen ------------
    await page.getByTestId("absence-type").click();
    await page.getByRole("option", { name: "Krank" }).click();
    await page.getByTestId("absence-from").fill(SICK_DAY);
    await page.getByTestId("absence-to").fill(SICK_DAY);
    await page.getByTestId("absence-save").click();

    await expect(list, "Krankheit muss im Free-Tarif angelegt werden").toContainText(
      "Krank · 1 Tag",
    );

    // Beide Abwesenheiten sind serverseitig wirklich angelegt (kein reines
    // UI-Echo): die Schichten existieren mit dem richtigen Typ.
    const vacation = (await (
      await acc.ctx.get(`/api/shifts?type=vacation&userId=${assistantId}`)
    ).json()) as { userId: number }[];
    expect(
      vacation.filter((s) => s.userId === assistantId).length,
      "2 Urlaubs-Schichten müssen serverseitig existieren",
    ).toBe(2);
    const sick = (await (
      await acc.ctx.get(`/api/shifts?type=sick&userId=${assistantId}`)
    ).json()) as { userId: number }[];
    expect(
      sick.filter((s) => s.userId === assistantId).length,
      "1 Krank-Schicht muss serverseitig existieren",
    ).toBe(1);

    // Der Hinweis bleibt auch nach dem Eintragen stehen (kein Umschalten).
    await expect(page.getByTestId("absence-tracking-premium-hint")).toBeVisible();
  });

  test("Premium-Konto (SQL-Flip) sieht die Bilanz-Tabelle inkl. der als Free eingetragenen Tage", async ({
    page,
  }) => {
    // Manuelle Freischaltung wie im Operator-Dashboard: Plan-Flip direkt in
    // der Test-DB; wirkt sofort, da der Plan pro Request frisch gelesen wird.
    setAccountPlan(acc.email, "premium");

    await adoptSession(page, acc);
    await page.goto("/abwesenheiten");
    await expect(
      page.getByRole("heading", { name: "Abwesenheiten", exact: true }),
    ).toBeVisible();

    // Hinweis weg, Bilanz da.
    await expect(
      page.getByTestId("absence-tracking-premium-hint"),
      "Premium-Konto darf den Upgrade-Hinweis nicht mehr sehen",
    ).toHaveCount(0);
    await expect(
      page.getByTestId(`vacation-balance-row-${assistantId}`),
      "Premium-Konto muss die Bilanz-Zeile des Assistenten sehen",
    ).toBeVisible();

    // Kein Datenverlust durch das Free-Intermezzo: die 2 als Free
    // eingetragenen Urlaubstage sind korrekt mitgezählt (30 - 2 = 28).
    await expect(page.getByTestId(`vacation-entitlement-${assistantId}`)).toHaveText(
      String(VACATION_DAYS),
    );
    await expect(page.getByTestId(`vacation-taken-${assistantId}`)).toHaveText("2");
    await expect(page.getByTestId(`vacation-remaining-${assistantId}`)).toHaveText(
      String(VACATION_DAYS - 2),
    );
  });
});
