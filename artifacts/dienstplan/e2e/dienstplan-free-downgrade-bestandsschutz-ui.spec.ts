import { test, expect, type Page } from "@playwright/test";
import { addMonths, format } from "date-fns";
import { registerFreeAccount, setAccountPlan, type FreeAccount } from "./helpers/teams";

/**
 * UI-Test (#248): Nach einem Downgrade Premium -> Free zeigt das WEB-FRONTEND
 * weiterhin ALLE Bestandsdaten an — nichts verschwindet, nichts wird gesperrt.
 *
 * Hintergrund: #235 beweist per API-Test, dass der Server nach einem Downgrade
 * keine Zeilen versteckt oder loescht (Bestandsschutz-Regel in replit.md).
 * Die Frontend-Gates sind aber "reine UX" — eine Regression, die eines dieser
 * Client-Gates in einen ANZEIGE-Filter verwandelt (z.B. Schichtmodelle ueber
 * dem Limit in den Einstellungen ausblenden, den Team-Wechsler einklappen oder
 * zu ferne Monate leeren), liesse die Daten eines zahlenden Kunden im UI
 * scheinbar verschwinden, obwohl die API sie liefert. Genau das prueft dieser
 * Spec im Browser.
 *
 * Aufbau (einmalig in beforeAll):
 * - Frisches Dienstleister-Konto per Self-Service-Registrierung (startet Free,
 *   Registrierung legt 1 "Standard-Team" + 4 Standard-Dienste an).
 * - Plan-Flip auf Premium (direkt in der Test-DB = manuelle Freischaltung).
 * - Als Premium UEBER alle Free-Caps fahren:
 *     - 2. Team            (Free: maxTeams = 1)
 *     - 7 Assistenten      (Free: maxAssistants = 6)
 *     - 2 Zusatz-Dienste   (4 Seeds + 2 = 6 > Free-Limit 5)
 *     - FIX-Schicht 2 Monate im Voraus (Free: historyMonths = 1)
 * - Downgrade zurueck auf Free.
 *
 * Danach wird im Browser (Session-Cookies injiziert, damit NICHT das
 * Dev-Auto-Login als Premium-Admin greift) geprueft, dass alle Seiten die
 * Bestandsdaten voll anzeigen und nur die "Neu anlegen"-Elemente das Limit
 * reflektieren.
 *
 * Laeuft gegen den isolierten Test-Stack (eigener API + Vite auf der `_test`-DB).
 */

const FREE_MAX_ASSISTANTS = 6;
const OVER_LIMIT_ASSISTANTS = FREE_MAX_ASSISTANTS + 1; // 7 — einer ueber dem Cap
const EXTRA_MODEL_COUNT = 2; // 4 Seeds + 2 = 6 > Free-Limit 5

const SECOND_TEAM_NAME = "E2E Downgrade Zweitteam";

/** Session-Cookies des per API registrierten Kontos in den Browser uebernehmen. */
async function adoptSession(page: Page, account: FreeAccount): Promise<void> {
  const state = await account.ctx.storageState();
  await page.context().addCookies(state.cookies);
}

test.describe("Downgrade auf Free: Bestandsdaten bleiben im UI sichtbar", () => {
  let acc: FreeAccount;
  let standardTeamId = 0;
  let secondTeamId = 0;
  let standardTeamName = "";
  let farShiftId = 0;

  const assistantNames: string[] = [];
  const assistantIds: number[] = [];
  const extraModelNames: string[] = [];
  const extraModelIds: number[] = [];
  const seededModelNames: string[] = [];

  // Ein Monat sicher AUSSERHALB des Free-Fensters (aktueller + naechster
  // Monat): 2 Kalendermonate voraus, Tag 15 (keine Monatsrand-Effekte).
  const farBase = addMonths(new Date(), 2);
  const farDate = new Date(farBase.getFullYear(), farBase.getMonth(), 15);
  const farDateKey = format(farDate, "yyyy-MM-dd");

  test.beforeAll(async () => {
    test.setTimeout(120000);
    const unique = Date.now();

    // Dienstleister-Konto: nur dort gibt es Team-Verwaltung + Team-Wechsler.
    acc = await registerFreeAccount("dienstleister", "free.ui.downgrade");

    // Standard-Team der Registrierung ermitteln (fuer explizite teamId-Zuordnung).
    const teamsRes = await acc.ctx.get("/api/teams");
    expect(teamsRes.ok(), "Teams-Liste sollte ladbar sein").toBe(true);
    const teams = (await teamsRes.json()) as { id: number; name: string }[];
    expect(teams.length, "Registrierung sollte genau 1 Team anlegen").toBe(1);
    standardTeamId = teams[0].id;
    standardTeamName = teams[0].name;

    // Namen der 4 geseedeten Standard-Dienste merken (Sichtbarkeits-Assertions).
    const modelsRes = await acc.ctx.get("/api/shift-models");
    expect(modelsRes.ok(), "Dienste-Liste sollte ladbar sein").toBe(true);
    const seeded = (await modelsRes.json()) as { id: number; name: string }[];
    expect(seeded.length, "Registrierung sollte 4 Standard-Dienste seeden").toBe(4);
    for (const m of seeded) seededModelNames.push(m.name);

    // === Premium: ueber alle Free-Caps hinaus Bestandsdaten aufbauen ========
    setAccountPlan(acc.email, "premium");

    // 2. Team (Free-Limit maxTeams = 1 wird damit ueberschritten).
    const teamRes = await acc.ctx.post("/api/teams", {
      data: { name: SECOND_TEAM_NAME },
    });
    expect(teamRes.status(), "2. Team sollte als Premium 201 liefern").toBe(201);
    secondTeamId = ((await teamRes.json()) as { id: number }).id;

    // 7 Assistenten (Free-Limit maxAssistants = 6 wird ueberschritten).
    for (let i = 1; i <= OVER_LIMIT_ASSISTANTS; i++) {
      const name = `E2E Downgrade Assistent ${i}`;
      const res = await acc.ctx.post("/api/users", {
        data: {
          name,
          email: `e2e.free.ui.downgrade.${unique}.${i}@dienstplan.test`,
          role: "assistant",
          teamId: standardTeamId,
        },
      });
      expect(res.status(), `Assistent ${i} sollte als Premium 201 liefern`).toBe(201);
      assistantIds.push(((await res.json()) as { id: number }).id);
      assistantNames.push(name);
    }

    // 2 Zusatz-Dienste (4 Seeds + 2 = 6 > Free-Limit 5).
    for (let i = 1; i <= EXTRA_MODEL_COUNT; i++) {
      const name = `E2E Zusatzdienst ${unique}-${i}`;
      const res = await acc.ctx.post("/api/shift-models", {
        data: { name, valuationPercent: 100, teamId: standardTeamId },
      });
      expect(res.status(), `Zusatzdienst ${i} sollte als Premium 201 liefern`).toBe(201);
      extraModelIds.push(((await res.json()) as { id: number }).id);
      extraModelNames.push(name);
    }

    // FIX-Schicht 2 Monate im Voraus (Free-Fenster historyMonths = 1).
    const shiftRes = await acc.ctx.post("/api/shifts", {
      data: {
        userId: assistantIds[0],
        teamId: standardTeamId,
        startTime: `${farDateKey}T08:00:00.000Z`,
        endTime: `${farDateKey}T16:00:00.000Z`,
        type: "active",
        planningStatus: "FIX",
      },
    });
    expect(shiftRes.status(), "Fern-Schicht sollte als Premium 201 liefern").toBe(201);
    farShiftId = ((await shiftRes.json()) as { id: number }).id;

    // === Downgrade: ab hier ist das Konto wieder Free =======================
    setAccountPlan(acc.email, "free");

    // Absicherung: der Server liefert den Free-Plan (frisch aus der DB) —
    // sonst wuerden die UI-Assertions gar keinen Downgrade-Zustand pruefen.
    const meRes = await acc.ctx.get("/api/auth/me");
    expect(meRes.ok(), "auth/me sollte ladbar sein").toBe(true);
    expect(
      ((await meRes.json()) as { plan: string }).plan,
      "Konto muss nach dem Flip wieder Free sein",
    ).toBe("free");
  });

  test.afterAll(async () => {
    const tryDelete = async (path: string) => {
      try {
        await acc.ctx.delete(path);
      } catch {
        /* ignore */
      }
    };
    // FK-sicher: erst Schichten, dann Dienste, dann Nutzer, dann Teams, dann Konto.
    if (farShiftId) await tryDelete(`/api/shifts/${farShiftId}`);
    for (const id of extraModelIds) await tryDelete(`/api/shift-models/${id}`);
    try {
      // Auch die 4 geseedeten Dienste entfernen, damit das Team loeschbar wird.
      const modelsRes = await acc.ctx.get("/api/shift-models");
      if (modelsRes.ok()) {
        const models = (await modelsRes.json()) as { id: number }[];
        for (const m of models) await tryDelete(`/api/shift-models/${m.id}`);
      }
    } catch {
      /* ignore */
    }
    for (const id of assistantIds) await tryDelete(`/api/users/${id}`);
    try {
      const teamsRes = await acc.ctx.get("/api/teams");
      if (teamsRes.ok()) {
        const teams = (await teamsRes.json()) as { id: number }[];
        for (const t of teams) {
          const membersRes = await acc.ctx.get(`/api/teams/${t.id}/members`);
          if (membersRes.ok()) {
            const members = (await membersRes.json()) as { userId: number }[];
            for (const m of members) await tryDelete(`/api/teams/${t.id}/members/${m.userId}`);
          }
          await tryDelete(`/api/teams/${t.id}`);
        }
      }
    } catch {
      /* ignore */
    }
    if (acc?.id) await tryDelete(`/api/users/${acc.id}`);
    await acc.ctx.dispose();
  });

  test("Einstellungen: alle 6 Dienste bleiben sichtbar und bearbeitbar, nur Neu-Anlegen ist gesperrt", async ({
    page,
  }) => {
    test.setTimeout(60000);
    await adoptSession(page, acc);

    await page.goto("/einstellungen");
    await expect(page.getByRole("heading", { name: "Einstellungen" })).toBeVisible();

    // ALLE 6 Dienste (4 Seeds + 2 als Premium angelegte) bleiben gelistet —
    // insbesondere die beiden UEBER dem Free-Limit von 5.
    for (const name of [...seededModelNames, ...extraModelNames]) {
      await expect(
        page.getByText(name, { exact: true }),
        `Dienst "${name}" muss nach dem Downgrade sichtbar bleiben`,
      ).toBeVisible();
    }

    // Bearbeiten bleibt fuer ein Modell UEBER dem Limit nutzbar: der Dialog
    // oeffnet sich (kein deaktivierter Button, kein Sperr-Hinweis).
    const overLimitRow = page.locator("li", { hasText: extraModelNames[1] });
    const editButton = overLimitRow.getByRole("button").first();
    await expect(editButton, "Bearbeiten muss aktiv bleiben").toBeEnabled();
    await editButton.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Schichtmodell bearbeiten")).toBeVisible();
    await expect(dialog.getByPlaceholder("z.B. Aktivdienst")).toHaveValue(extraModelNames[1]);
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();

    // NUR das Neu-Anlegen reflektiert das Limit: Banner + gesperrter Button.
    await expect(page.getByText(/maximal 5 Schichtmodelle/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Neu", exact: true }).first()).toBeDisabled();
  });

  test("Team-Wechsler und Team-Verwaltung zeigen weiterhin beide Teams", async ({ page }) => {
    test.setTimeout(60000);
    await adoptSession(page, acc);

    // Team-Wechsler (z.B. im Dienstplan-Kopf) listet beide Teams — er darf
    // nach dem Downgrade nicht einklappen oder das 2. Team verstecken.
    await page.goto("/dienstplan");
    await expect(page.getByRole("heading", { name: "Dienstplan" })).toBeVisible();
    const switcher = page.getByLabel("Team auswählen");
    await expect(switcher, "Team-Wechsler muss sichtbar bleiben").toBeVisible();
    await switcher.click();
    await expect(page.getByRole("option", { name: standardTeamName })).toBeVisible();
    await expect(
      page.getByRole("option", { name: SECOND_TEAM_NAME }),
      "Das 2. Team (ueber dem Free-Limit) muss waehlbar bleiben",
    ).toBeVisible();
    await page.keyboard.press("Escape");

    // Team-Verwaltung listet ebenfalls beide Teams.
    await page.goto("/team-verwaltung");
    await expect(page.getByRole("heading", { name: "Team-Verwaltung" })).toBeVisible();
    await expect(page.getByText(standardTeamName).first()).toBeVisible();
    await expect(page.getByText(SECOND_TEAM_NAME).first()).toBeVisible();
  });

  test("Assistenten: alle 7 Assistenten (einer ueber dem Limit) bleiben gelistet", async ({
    page,
  }) => {
    test.setTimeout(60000);
    await adoptSession(page, acc);

    await page.goto("/assistenten");
    await expect(page.getByRole("heading", { name: "Assistenten" })).toBeVisible();

    for (let i = 0; i < assistantIds.length; i++) {
      await expect(
        page.getByTestId(`assistant-card-${assistantIds[i]}`),
        `Assistent "${assistantNames[i]}" muss nach dem Downgrade sichtbar bleiben`,
      ).toBeVisible();
    }
  });

  test("Dienstplan: die weit-zukuenftige FIX-Schicht bleibt trotz Free-Sperrbanner sichtbar", async ({
    page,
  }) => {
    test.setTimeout(60000);
    await adoptSession(page, acc);

    await page.goto("/dienstplan");
    await expect(page.getByRole("heading", { name: "Dienstplan" })).toBeVisible();
    // Mobile Listenansicht (agenda-day-Testids) aktivieren.
    await page.getByTestId("view-toggle-list").click();

    // Zwei Monate vorblaettern — ausserhalb des Free-Planungsfensters.
    await page.getByTestId("next-month").click();
    await page.getByTestId("next-month").click();
    await expect(page.getByTestId("month-label")).toContainText(format(farDate, "yyyy"));

    // Das Free-Gate sperrt hier nur das NEU-Anlegen (Banner sichtbar) …
    await expect(
      page.getByText(/Im Free-Tarif nur bis nächsten Monat planbar/i).first(),
    ).toBeVisible();

    // … aber die bestehende FIX-Schicht bleibt voll sichtbar. (Das Badge
    // rendert auch in der versteckten Desktop-Ansicht — daher auf den
    // sichtbaren Agenda-Tag der Mobilansicht einschraenken.)
    const agendaDay = page.getByTestId(`agenda-day-${farDateKey}`);
    await expect(agendaDay, "Der Tag der Fern-Schicht muss gelistet sein").toBeVisible();
    const badge = agendaDay.getByTestId(`shift-badge-${farShiftId}`);
    await expect(
      badge,
      "Die als Premium geplante Fern-Schicht muss nach dem Downgrade sichtbar bleiben",
    ).toBeVisible();
    await expect(badge).toContainText(assistantNames[0]);
  });
});
