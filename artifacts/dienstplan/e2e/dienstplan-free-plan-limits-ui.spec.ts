import { test, expect, type Page } from "@playwright/test";
import { registerFreeAccount, type FreeAccount } from "./helpers/teams";

/**
 * UI-Test: Ein Free-Konto, das am Assistenten- bzw. Team-Limit ist, bekommt im
 * Web-Frontend eine KLARE Meldung (Upgrade-Hinweis) statt eines stillen
 * Fehlschlags ("Button tut nichts").
 *
 * Hintergrund (#224): Die serverseitige Durchsetzung der Free-Limits
 * (maxAssistants/maxTeams) ist durch reine API-Tests abgedeckt (#216/#217).
 * Es fehlte aber automatisierte Abdeckung, dass das FRONTEND diese 403er
 * (`plan_limit_reached`) auch sichtbar an den Nutzer weiterreicht. Eine
 * UI-Regression (z.B. verschluckter Fehler) wuerde Free-Nutzer ratlos
 * zuruecklassen, obwohl das Backend korrekt blockt.
 *
 * Vorgehen je Test:
 * - Frisch ein Free-Konto registrieren (garantiert Plan `free`, der
 *   Standard-Test-Admin ist auf Premium gehoben).
 * - Per API genau an das jeweilige Limit fahren (Assistenten anlegen / das
 *   Standard-Team behalten).
 * - Die Session des Free-Kontos in den Browser injizieren, damit die App NICHT
 *   das Dev-Auto-Login (als Premium-Admin) ausloest, sondern als Free-Konto
 *   bootstrappt.
 * - Im UI den Anlege-Dialog ausfuellen und absenden; erwartet wird der
 *   Upgrade-Hinweis statt eines stillen Fehlschlags.
 *
 * Laeuft gegen den isolierten Test-Stack (eigener API + Vite auf der `_test`-DB).
 */

const FREE_MAX_ASSISTANTS = 6;

/**
 * Uebernimmt die Session-Cookies des per API registrierten Free-Kontos in den
 * Browser-Kontext. So liefert `/api/auth/me` beim App-Bootstrap das Free-Konto
 * und das Dev-Auto-Login (das sonst als Premium-Admin anmeldet) greift NICHT.
 */
async function adoptSession(page: Page, account: FreeAccount): Promise<void> {
  const state = await account.ctx.storageState();
  await page.context().addCookies(state.cookies);
}

test.describe("Free-Limit Assistenten (UI)", () => {
  let free: FreeAccount;
  const createdUserIds: number[] = [];

  test.beforeAll(async () => {
    free = await registerFreeAccount("privat", "free.ui.assistant");

    // Genau bis ans Limit fahren: 6 Assistenten anlegen (der Admin selbst zaehlt
    // nicht). Der 7. wird dann im UI versucht und muss geblockt werden.
    const unique = Date.now();
    for (let i = 1; i <= FREE_MAX_ASSISTANTS; i++) {
      const res = await free.ctx.post("/api/users", {
        data: {
          name: `Assistent ${i}`,
          email: `e2e.free.ui.assistant.${unique}.${i}@dienstplan.test`,
          role: "assistant",
        },
      });
      expect(res.status(), `Assistent ${i} sollte 201 liefern`).toBe(201);
      createdUserIds.push(((await res.json()) as { id: number }).id);
    }
  });

  test.afterAll(async () => {
    const tryDelete = async (path: string) => {
      try {
        await free.ctx.delete(path);
      } catch {
        /* ignore */
      }
    };
    for (const id of createdUserIds) await tryDelete(`/api/users/${id}`);
    if (free?.id) await tryDelete(`/api/users/${free.id}`);
    await free.ctx.dispose();
  });

  test("zeigt am Assistenten-Limit einen Upgrade-Hinweis statt stillem Fehlschlag", async ({
    page,
  }) => {
    test.setTimeout(60000);
    await adoptSession(page, free);

    await page.goto("/assistenten");
    await expect(page.getByRole("heading", { name: "Assistenten" })).toBeVisible();

    // Anlege-Dialog oeffnen (Header-Button; mobiles Viewport zeigt "Neu").
    await page.getByRole("button", { name: "Neu", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Neuen Assistenten anlegen")).toBeVisible();

    // Pflichtfelder ausfuellen (Vertragsfelder haben bereits Defaults).
    await dialog.getByPlaceholder("Max", { exact: true }).fill("Sieben");
    await dialog.getByPlaceholder("Mustermann").fill("Zuviel");
    await dialog.getByPlaceholder("max@example.de").fill(`e2e.over.${Date.now()}@dienstplan.test`);
    await dialog
      .getByPlaceholder("Musterstr. 1, 12345 Musterstadt")
      .fill("Teststr. 1, 12345 Teststadt");

    await dialog.getByRole("button", { name: "Anlegen" }).click();

    // Klarer Upgrade-Hinweis statt stillem Fehlschlag.
    await expect(dialog.getByText(/max\. 6 Assistenten/i)).toBeVisible();
    await expect(dialog.getByText(/Premium/i)).toBeVisible();
  });
});

test.describe("Free-Limit Teams (UI)", () => {
  let free: FreeAccount;

  test.beforeAll(async () => {
    // Dienstleister-Konto: die Registrierung legt genau 1 "Standard-Team" an,
    // sodass das Konto direkt am Free-Limit maxTeams = 1 startet.
    free = await registerFreeAccount("dienstleister", "free.ui.team");
  });

  test.afterAll(async () => {
    const tryDelete = async (path: string) => {
      try {
        await free.ctx.delete(path);
      } catch {
        /* ignore */
      }
    };
    // FK-sicheres Best-effort-Cleanup: erst Dienste, dann Mitglieder, dann Teams,
    // zuletzt das Konto.
    try {
      const modelsRes = await free.ctx.get("/api/shift-models");
      if (modelsRes.ok()) {
        const models = (await modelsRes.json()) as { id: number }[];
        for (const m of models) await tryDelete(`/api/shift-models/${m.id}`);
      }
    } catch {
      /* ignore */
    }
    try {
      const teamsRes = await free.ctx.get("/api/teams");
      if (teamsRes.ok()) {
        const teams = (await teamsRes.json()) as { id: number }[];
        for (const t of teams) {
          const membersRes = await free.ctx.get(`/api/teams/${t.id}/members`);
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
    if (free?.id) await tryDelete(`/api/users/${free.id}`);
    await free.ctx.dispose();
  });

  test("zeigt am Team-Limit einen Upgrade-Hinweis statt stillem Fehlschlag", async ({ page }) => {
    test.setTimeout(60000);
    await adoptSession(page, free);

    await page.goto("/team-verwaltung");
    await expect(page.getByRole("heading", { name: "Team-Verwaltung" })).toBeVisible();

    // Anlege-Dialog oeffnen (Header-Button; mobiles Viewport zeigt "Neu").
    await page.getByRole("button", { name: "Neu", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Neues Team")).toBeVisible();

    await dialog.getByPlaceholder("z.B. Team Nord").fill("Zweites Team");
    await dialog.getByRole("button", { name: "Anlegen" }).click();

    // Klarer Upgrade-Hinweis statt stillem Fehlschlag.
    await expect(dialog.getByText(/max\. 1 Team/i)).toBeVisible();
    await expect(dialog.getByText(/Premium/i)).toBeVisible();
  });
});
