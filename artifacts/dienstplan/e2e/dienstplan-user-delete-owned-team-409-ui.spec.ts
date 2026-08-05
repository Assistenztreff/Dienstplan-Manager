import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { execSync } from "node:child_process";

/**
 * UI-Test (#291): Wenn DELETE /api/users/:id mit 409 abgelehnt wird, weil das
 * Konto noch Teams besitzt (teams.owner_id), muss der Lösch-Dialog auf der
 * Assistenten-Seite die deutsche Server-Meldung als Hinweis anzeigen — kein
 * stilles Scheitern, kein generischer Fehler.
 *
 * Ablauf: Assistent über die API anlegen → ihm per Skript direkt in der
 * (Test-)DB ein Team als Eigentümer zuschreiben (über die API unmöglich; nur
 * Dienstleister-Admins legen Teams an, Owner = Anfragender) → im UI löschen →
 * 409-Meldung erscheint im offenen Bestätigungs-Dialog, die Karte bleibt.
 * Danach Team abräumen → Löschen klappt und die Karte verschwindet.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

// Desktop-Viewport: Assistenten-Karten samt "Bearbeiten" sind hier stabil.
test.use({ viewport: { width: 1280, height: 800 } });

// Cold-Start (Login + Navigation) kann das 30s-Default überschreiten.
test.setTimeout(90000);

type CreatedUser = { id: number; name: string; email: string };

let adminCtx: APIRequestContext;
let assistant: CreatedUser | undefined;
let teamSeeded = false;

const TEAM_NAME = `E2E Owned Team ${Date.now()}`;

/**
 * Führt das seed-owned-team-Skript gegen die richtige DB aus: gegen den
 * isolierten Test-Stack MUSS in die `_test`-DB geschrieben werden
 * (`E2E_TEST_DATABASE_URL`), sonst landet das Team via Dev-`DATABASE_URL`
 * in der falschen DB und der 409 bleibt aus.
 */
function runOwnedTeamScript(email: string, action: "create" | "delete"): void {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OWNED_TEAM_EMAIL: email,
    OWNED_TEAM_NAME: TEAM_NAME,
    OWNED_TEAM_ACTION: action,
  };
  if (process.env.E2E_TEST_DATABASE_URL) {
    env.DATABASE_URL = process.env.E2E_TEST_DATABASE_URL;
    env.APP_DATABASE_URL = process.env.E2E_TEST_DATABASE_URL;
  }
  execSync("pnpm --filter @workspace/scripts run seed-owned-team", {
    env,
    stdio: "pipe",
  });
}

async function gotoAssistentenAsAdmin(page: Page): Promise<void> {
  // Programmatische Anmeldung über die API: page.request teilt den Cookie-Jar
  // mit dem Browser, dadurch greift der Vite-Dev-Auto-Login nie.
  const loginRes = await page.request.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(loginRes.ok(), `Admin-Login fehlgeschlagen (${loginRes.status()})`).toBe(true);
  await page.goto("/assistenten");
  await expect(
    page.getByRole("heading", { name: "Assistenzkräfte", exact: true }),
  ).toBeVisible({ timeout: 30000 });
}

test.beforeAll(async () => {
  const unique = Date.now();
  adminCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });

  const loginRes = await adminCtx.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(loginRes.ok(), "Admin-Login für Setup fehlgeschlagen").toBe(true);

  const res = await adminCtx.post("/api/users", {
    data: {
      name: `E2E Team-Eigner ${unique}`,
      email: `e2e.owned.team.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(res.ok(), `Anlegen des Assistenten fehlgeschlagen (${res.status()})`).toBe(true);
  assistant = (await res.json()) as CreatedUser;

  // Direkt in der DB: Assistent wird Eigentümer eines Teams.
  runOwnedTeamScript(assistant.email, "create");
  teamSeeded = true;
});

test.afterAll(async () => {
  // Best-effort-Cleanup, falls der Test vorher abbricht.
  if (assistant && teamSeeded) {
    try {
      runOwnedTeamScript(assistant.email, "delete");
    } catch {
      /* Cleanup darf andere Schritte nie blockieren. */
    }
  }
  if (assistant?.id) {
    await adminCtx.delete(`/api/users/${assistant.id}`).catch(() => {});
  }
  await adminCtx.dispose();
});

test("409 wegen eigener Teams erscheint als verständliche Meldung im Lösch-Dialog", async ({
  page,
}) => {
  expect(assistant).toBeDefined();
  await gotoAssistentenAsAdmin(page);

  const card = page.getByTestId(`assistant-card-${assistant!.id}`);
  await expect(card).toBeVisible();

  // Bearbeiten-Dialog öffnen und Löschen anstoßen.
  await card.getByRole("button", { name: "Bearbeiten" }).click();
  await expect(
    page.getByRole("heading", { name: "Assistenzkraft bearbeiten" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Loeschen" }).click();

  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Endgueltig loeschen" }).click();

  // Die 409-Server-Meldung erscheint als Hinweis im weiterhin offenen Dialog —
  // exakt der Text des Servers, KEIN generischer Fallback.
  await expect(confirm).toContainText(
    "Konto kann nicht gelöscht werden, solange es noch Teams besitzt",
    { timeout: 15000 },
  );
  await expect(confirm).not.toContainText("Loeschen fehlgeschlagen");

  // Nichts wurde gelöscht: Dialog schließen, Karte steht noch in der Liste.
  await confirm.getByRole("button", { name: "Abbrechen" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(card).toBeVisible();

  // Backend: Nutzer existiert weiterhin.
  const usersRes = await adminCtx.get("/api/users");
  expect(usersRes.ok()).toBe(true);
  const users = (await usersRes.json()) as CreatedUser[];
  expect(users.some((u) => u.id === assistant!.id)).toBe(true);

  // --- Nach dem Abräumen des Teams klappt das Löschen im UI ---
  runOwnedTeamScript(assistant!.email, "delete");
  teamSeeded = false;

  await page.getByRole("button", { name: "Loeschen" }).click();
  const confirm2 = page.getByRole("alertdialog");
  await expect(confirm2).toBeVisible();
  await confirm2.getByRole("button", { name: "Endgueltig loeschen" }).click();

  // Karte verschwindet, Dialoge schließen sich.
  await expect(card).toHaveCount(0, { timeout: 15000 });

  const usersAfter = (await (await adminCtx.get("/api/users")).json()) as CreatedUser[];
  expect(usersAfter.some((u) => u.id === assistant!.id)).toBe(false);
  assistant = undefined;
});
