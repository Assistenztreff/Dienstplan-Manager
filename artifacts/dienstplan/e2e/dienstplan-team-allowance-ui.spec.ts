import { test, expect, type Page } from "@playwright/test";
import {
  registerFreeAccount,
  setAccountPlan,
  deleteFreeAccount,
  type FreeAccount,
} from "./helpers/teams";

/**
 * UI-Test (#374): Team-spezifische Zuschlags-Overrides greifen und werden im
 * BROWSER sichtbar — nicht nur über die API.
 *
 * Bewiesen wird die Fallback-Kette Team-Override → Konto → Default aus der
 * Nutzerperspektive:
 *   - Auswertungen: Nach Umschalten auf das Team via TeamSwitcher zeigen die
 *     Zuschlags-Labels ("Nacht (X%)", "Sonntag (X%)", "Feiertag (X%)") die
 *     TEAM-Sätze, NICHT die abweichenden Konto-Standards.
 *   - Einstellungen: Der Bereichs-Wähler ("Gilt für") lädt für das Team die
 *     Override-Prozente in die Formularfelder; für den Konto-Standard die
 *     abweichenden Konto-Werte.
 *
 * Kein Eingriff in die Zuschlags-Logik/Fallback-Kette — nur Beobachtung.
 *
 * Aufbau über ein FRISCH registriertes Dienstleister-Konto (eigenes Standard-
 * Team, Team-Switcher sichtbar), das per set-plan auf Premium gehoben wird, damit
 * advancedAnalytics (Soll/Ist-Auswertung) freigeschaltet ist. Der Konto-Typ wird
 * bei der Registrierung fixiert (API-seitiger Wechsel ist bewusst gesperrt).
 *
 * Läuft gegen den isolierten Test-Stack (eigener API + Vite auf der `_test`-DB).
 */

// Konto-Standard-Sätze — bewusst ungleich den DB-Defaults (25/50/100) UND den
// Team-Overrides, damit eine Verwechslung sofort auffällt. Alle > 0, sodass die
// Labels garantiert gerendert werden (0%-Zuschläge werden ausgeblendet).
const ACCOUNT = { nightPercent: 20, sundayPercent: 40, holidayPercent: 80 };
// Team-Override — die tatsächlich anzuwendenden Sätze.
const TEAM = { nightPercent: 35, sundayPercent: 65, holidayPercent: 95 };

const TEAM_NAME = "Zuschlag-Team";
const ASSISTANT_NAME = "Zuschlag Assistentin";

// Fester Tag im AKTUELLEN Monat (Auswertungen starten auf dem aktuellen Monat,
// keine Navigation nötig). Tag 10 liegt immer im Monat, keine Monatsrand-Effekte.
const now = new Date();
const YEAR = now.getFullYear();
const MM = String(now.getMonth() + 1).padStart(2, "0");
const DAY = "10";
const NEXT_DAY = "11";

/** Session-Cookies des per API eingeloggten Kontos in den Browser übernehmen. */
async function adoptSession(page: Page, account: FreeAccount): Promise<void> {
  const state = await account.ctx.storageState();
  await page.context().addCookies(state.cookies);
}

test.describe("Team-Zuschläge greifen im Browser (UI)", () => {
  let acc: FreeAccount;
  let teamId = 0;

  test.beforeAll(async () => {
    // Frisches Dienstleister-Konto (eigenes Standard-Team) und auf Premium heben.
    acc = await registerFreeAccount("dienstleister", "team.allowance.ui");
    await setAccountPlan(acc.email, "premium");

    // Konto-Standard-Zuschläge auf bekannte, abweichende Werte setzen (die
    // GET-Anfrage legt die Konto-Zeile lazy mit Defaults an).
    const putAccount = await acc.ctx.put("/api/allowance-settings", {
      data: {
        nightPercent: ACCOUNT.nightPercent,
        nightStart: "23:00",
        nightEnd: "06:00",
        sundayPercent: ACCOUNT.sundayPercent,
        holidayPercent: ACCOUNT.holidayPercent,
      },
    });
    expect(putAccount.ok(), "Konto-Zuschläge setzen fehlgeschlagen").toBe(true);

    // Eigenes Team + Assistent (Mitgliedschaft via teamId) + Team-Override.
    const teamRes = await acc.ctx.post("/api/teams", { data: { name: TEAM_NAME } });
    expect(teamRes.ok(), `Team anlegen fehlgeschlagen (${teamRes.status()})`).toBe(true);
    teamId = ((await teamRes.json()) as { id: number }).id;

    const userRes = await acc.ctx.post("/api/users", {
      data: {
        name: ASSISTANT_NAME,
        email: `e2e.team.allowance.assist.${Date.now()}@dienstplan.test`,
        role: "assistant",
        teamId,
      },
    });
    expect(userRes.status(), "Assistent sollte 201 liefern").toBe(201);
    const assistantId = ((await userRes.json()) as { id: number }).id;

    const putTeam = await acc.ctx.put(`/api/allowance-settings?teamId=${teamId}`, {
      data: {
        nightPercent: TEAM.nightPercent,
        nightStart: "23:00",
        nightEnd: "06:00",
        sundayPercent: TEAM.sundayPercent,
        holidayPercent: TEAM.holidayPercent,
      },
    });
    expect(putTeam.ok(), `Team-Override setzen fehlgeschlagen (${putTeam.status()})`).toBe(true);

    // Ein Nachtdienst (20:00→06:00) im aktuellen Monat, damit der Assistent in
    // der Auswertung mit Nacht-Stunden > 0 erscheint.
    const shiftRes = await acc.ctx.post("/api/shifts", {
      data: {
        userId: assistantId,
        teamId,
        startTime: `${YEAR}-${MM}-${DAY}T20:00:00.000Z`,
        endTime: `${YEAR}-${MM}-${NEXT_DAY}T06:00:00.000Z`,
        type: "active",
      },
    });
    expect(shiftRes.ok(), `Schicht anlegen fehlgeschlagen (${shiftRes.status()})`).toBe(true);
  });

  test.afterAll(async () => {
    // Konto + alle besessenen Teams + team-gebundene Daten + Override (cascade)
    // werden per SQL-Bereinigung entfernt.
    await deleteFreeAccount(acc);
  });

  test("Auswertungen zeigen nach Team-Wechsel die Team-Sätze, nicht die Konto-Standards", async ({
    page,
  }) => {
    test.setTimeout(60000);
    await adoptSession(page, acc);

    await page.goto("/auswertungen");
    await expect(page.getByRole("heading", { name: "Auswertungen" })).toBeVisible();

    // Auf das Zuschlag-Team umschalten (TeamSwitcher, nur Dienstleister sichtbar).
    await page.getByLabel("Team auswählen").click();
    await page.getByRole("option", { name: TEAM_NAME }).click();

    // Die Assistenten-Karte des Teams erscheint mit den ANGEWANDTEN Team-Sätzen.
    const card = page.locator(".border-border\\/50", { hasText: ASSISTANT_NAME }).first();
    await expect(card).toBeVisible();
    await expect(card.getByText(`Nacht (${TEAM.nightPercent}%)`)).toBeVisible();
    await expect(card.getByText(`Sonntag (${TEAM.sundayPercent}%)`)).toBeVisible();
    await expect(card.getByText(`Feiertag (${TEAM.holidayPercent}%)`)).toBeVisible();

    // Gegenprobe: Die abweichenden Konto-Standard-Sätze dürfen NICHT auftauchen.
    await expect(card.getByText(`Nacht (${ACCOUNT.nightPercent}%)`)).toHaveCount(0);
    await expect(card.getByText(`Sonntag (${ACCOUNT.sundayPercent}%)`)).toHaveCount(0);
    await expect(card.getByText(`Feiertag (${ACCOUNT.holidayPercent}%)`)).toHaveCount(0);
  });

  test("Einstellungen laden je Bereich die Team- bzw. Konto-Zuschläge", async ({ page }) => {
    test.setTimeout(60000);
    await adoptSession(page, acc);

    await page.goto("/einstellungen");
    await expect(page.getByRole("heading", { name: "Einstellungen" })).toBeVisible();

    const nightInput = page.locator("#nightPercent");
    const sundayInput = page.locator("#sundayPercent");
    const holidayInput = page.locator("#holidayPercent");

    // Bereich = Konto-Standard (Default): abweichende Konto-Werte.
    await expect(nightInput).toHaveValue(String(ACCOUNT.nightPercent));
    await expect(sundayInput).toHaveValue(String(ACCOUNT.sundayPercent));
    await expect(holidayInput).toHaveValue(String(ACCOUNT.holidayPercent));

    // Bereich auf das Team umschalten → Formular lädt die Override-Prozente.
    await page.getByTestId("allowance-scope-select").click();
    await page.getByRole("option", { name: `Team: ${TEAM_NAME}` }).click();

    await expect(page.getByTestId("allowance-scope-hint")).toContainText("eigene Regelung");
    await expect(nightInput).toHaveValue(String(TEAM.nightPercent));
    await expect(sundayInput).toHaveValue(String(TEAM.sundayPercent));
    await expect(holidayInput).toHaveValue(String(TEAM.holidayPercent));
  });
});
