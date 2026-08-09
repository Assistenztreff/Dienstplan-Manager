import { test, expect, type Page } from "@playwright/test";
import { TeamTestHarness } from "./helpers/teams";

/**
 * E2E-Test: Speichern-/Aktions-Dialoge zeigen die KONKRETE Servermeldung
 * (via `readableApiError`) und nicht einen generischen Fallback-Text
 * (Task #7/#58/#78, abgesichert durch #106).
 *
 * Geprüft wird ein realer 409-Fehlerpfad der Team-Verwaltung
 * (`pages/team-verwaltung.tsx` -> Toast):
 *   Team kann nicht gelöscht werden, solange Mitglieder/Daten hängen.
 *
 * Die Meldung unterscheidet sich bewusst vom UI-Fallback. Fällt die
 * Stelle wieder auf den festen Fallback zurück, schlägt der Test fehl, weil
 * der erwartete Server-Wortlaut dann NICHT im Toast erscheint.
 *
 * Hinweis: Der frühere zweite Test (doppelte Mitgliedschaft im
 * Mitglieder-Dialog) wurde entfernt — der Mitglieder-Dialog existiert nicht
 * mehr; das Entfernen läuft über die Assistenten-Seite, Team-Wechsel
 * ausschließlich über den „Überführen"-Dialog (Zuordnen-Sektion entfernt).
 *
 * Setup (Dienstleister + Teams + Nutzer) läuft über die `TeamTestHarness`
 * (eigener API-Kontext). Der Browser meldet sich separat programmatisch an
 * (kein Login-Formular), damit der Test unabhängig vom Dev-Auto-Login ist.
 *
 * Der reine Helfer `readableApiError` ist zusätzlich in
 * `src/lib/api-error.test.ts` (Vitest) abgedeckt.
 */

// Echte Server-Wortlaute aus artifacts/api-server/src/routes/teams.ts.
const DELETE_SERVER_MSG =
  "Team kann nicht gelöscht werden, solange noch Daten oder Mitglieder zugeordnet sind.";

// Generischer UI-Fallback (darf NICHT erscheinen, wenn der Server eine
// konkrete Meldung liefert).
const DELETE_FALLBACK = "Es sind noch Daten oder Mitglieder zugeordnet.";

test.use({ viewport: { width: 1280, height: 800 } });

let harness: TeamTestHarness;
let teamDelId: number;
let teamDelName: string;

test.beforeAll(async () => {
  harness = await TeamTestHarness.login();
  await harness.becomeDienstleister();

  teamDelName = `E2E Fehler-Del ${harness.run}`;
  teamDelId = await harness.createTeam(teamDelName);

  // Mitglied von teamDel -> teamDel ist nicht löschbar (409).
  await harness.createUser({
    name: `E2E Fehler Person ${harness.run}`,
    email: `e2e.fehler.${harness.run}@dienstplan.test`,
    role: "assistant",
    teamId: teamDelId,
  });
});

test.afterAll(async () => {
  await harness.cleanup();
});

async function loginBrowserAndOpenTeams(page: Page): Promise<void> {
  // Programmatischer Login im Browser-Kontext (page.request teilt sich den
  // Cookie-Jar mit der Seite), danach lädt die App die Session via /auth/me.
  // Login als das vom Harness registrierte Dienstleister-Konto (die Teams
  // dieses Specs gehören diesem Konto, nicht mehr dem Setup-Admin).
  const res = await page.request.post("/api/auth/login", {
    data: { email: harness.email, password: harness.password },
  });
  expect(res.ok(), `Browser-Login fehlgeschlagen (${res.status()})`).toBe(true);

  await page.goto("/team-verwaltung");
  await expect(
    page.getByRole("heading", { name: "Team-Verwaltung", exact: true }),
  ).toBeVisible();
}

test("Team-Löschen mit Mitglied zeigt die konkrete 409-Servermeldung im Toast", async ({
  page,
}) => {
  await loginBrowserAndOpenTeams(page);

  // Teams werden seit dem Umbau der Team-Verwaltung als Karten
  // (`team-block-<id>`) gerendert, nicht mehr als Listenelemente.
  const row = page.getByTestId(`team-block-${teamDelId}`);
  await expect(row).toBeVisible();

  // Erster Klick aktiviert die Bestätigung ("Wirklich?"), zweiter löst das
  // (fehlschlagende) Löschen aus.
  const deleteButton = row.getByRole("button", { name: /Löschen|Wirklich/ });
  await deleteButton.click();
  await expect(row.getByRole("button", { name: /Wirklich/ })).toBeVisible();
  await row.getByRole("button", { name: /Wirklich/ }).click();

  // Konkrete Servermeldung muss im Toast erscheinen ...
  await expect(page.getByText(DELETE_SERVER_MSG, { exact: true })).toBeVisible();
  // ... und der generische Fallback NICHT.
  await expect(page.getByText(DELETE_FALLBACK, { exact: true })).toHaveCount(0);
});
