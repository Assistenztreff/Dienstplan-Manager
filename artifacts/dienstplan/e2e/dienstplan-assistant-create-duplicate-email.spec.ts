import {
  test,
  expect,
  request as playwrightRequest,
  type Page,
  type APIRequestContext,
} from "@playwright/test";

/**
 * E2E-Test: Doppelte E-Mail beim ANLEGEN zeigt eine verständliche Meldung
 * statt eines generischen Serverfehlers.
 *
 * Gegenstück zu `dienstplan-assistant-edit-duplicate-email.spec.ts` (dort der
 * Bearbeiten-Pfad). Hier der Anlege-Pfad: Wird ein NEUER Assistent mit einer
 * bereits vergebenen E-Mail-Adresse angelegt, muss der Server mit 409 antworten
 * und der Dialog eine lesbare Fehlermeldung am E-Mail-Feld anzeigen — statt
 * kommentarlos zu scheitern (früher: UNIQUE-Constraint als unbehandelter 500).
 *
 * Ablauf:
 * - Bestehenden Assistenten A per API anlegen (belegt die E-Mail).
 * - Anlege-Dialog öffnen, Formular mit A's E-Mail ausfüllen, "Anlegen".
 * - Der Dialog bleibt offen und zeigt die Kollisionsmeldung.
 * - Per API verifiziert: es entstand KEIN zweiter Assistent mit dieser E-Mail.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

// Desktop-Viewport: die "Neu anlegen"-Aktion samt Dialog ist hier stabil.
test.use({ viewport: { width: 1280, height: 800 } });

// Cold-Start (Login + Navigation) kann das 30s-Default überschreiten.
test.setTimeout(60000);

interface UserResponse {
  id: number;
  name: string;
  email: string;
  role: string;
}

let adminCtx: APIRequestContext;
let existingUser: { id: number; email: string };

async function gotoAssistentenAsAdmin(page: Page): Promise<void> {
  const loginRes = await page.request.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(loginRes.ok(), `Admin-Login fehlgeschlagen (${loginRes.status()})`).toBe(true);
  await page.goto("/assistenten");
  await expect(
    page.getByRole("heading", { name: "Assistenten", exact: true }),
  ).toBeVisible({ timeout: 30000 });
}

test.beforeAll(async () => {
  const unique = Date.now();
  adminCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });

  const loginRes = await adminCtx.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(loginRes.ok(), "Admin-Login für Setup fehlgeschlagen").toBe(true);

  const email = `e2e.dupcreate.${unique}@dienstplan.test`;
  const userRes = await adminCtx.post("/api/users", {
    data: {
      name: `Bestehend DupCreate${unique}`,
      email,
      role: "assistant",
      address: "Dupstr. 7, 77777 Dupstadt",
    },
  });
  expect(userRes.ok(), `Anlegen des Bestands-Assistenten fehlgeschlagen (${userRes.status()})`).toBe(true);
  const user = (await userRes.json()) as UserResponse;
  existingUser = { id: user.id, email };
});

test.afterAll(async () => {
  if (existingUser) await adminCtx.delete(`/api/users/${existingUser.id}`);
  await adminCtx.dispose();
});

test.describe("AssistentDialog: Doppelte E-Mail beim Anlegen", () => {
  test("409 vom Server → Dialog bleibt offen mit lesbarer Meldung, kein Duplikat angelegt", async ({
    page,
  }) => {
    await gotoAssistentenAsAdmin(page);

    // --- Anlege-Dialog öffnen ------------------------------------------------
    await page.getByRole("button", { name: "Neu anlegen" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Neuen Assistenten anlegen")).toBeVisible();

    // --- Formular mit der bereits vergebenen E-Mail ausfüllen ----------------
    await dialog.getByPlaceholder("Max", { exact: true }).fill("Neu");
    await dialog.getByPlaceholder("Mustermann").fill(`Kollision${Date.now()}`);
    await dialog.getByPlaceholder("max@example.de").fill(existingUser.email);
    await dialog.getByPlaceholder("Musterstr. 1, 12345 Musterstadt").fill("Neuweg 8, 88888 Neustadt");

    // Die 409-Antwort des POST abfangen, um den Serverstatus zu verifizieren.
    const postResponsePromise = page.waitForResponse(
      (res) =>
        res.url().includes("/api/users") &&
        res.request().method() === "POST",
      { timeout: 15000 },
    );

    await dialog.getByRole("button", { name: "Anlegen", exact: true }).click();

    const postResponse = await postResponsePromise;
    expect(postResponse.status(), "Server muss die Kollision mit 409 melden").toBe(409);

    // --- Dialog bleibt offen und zeigt eine verständliche Meldung ------------
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(
      dialog.getByText("Diese E-Mail-Adresse wird bereits von einem anderen Konto verwendet."),
    ).toBeVisible();

    // Kein stilles Schließen: auch nach kurzer Wartezeit bleibt der Dialog offen.
    await page.waitForTimeout(500);
    await expect(page.getByRole("dialog")).toHaveCount(1);

    // --- Verifikation gegen die API: kein Duplikat mit dieser E-Mail ---------
    const listRes = await adminCtx.get("/api/users?role=assistant");
    expect(listRes.ok(), `GET /api/users fehlgeschlagen (${listRes.status()})`).toBe(true);
    const users = (await listRes.json()) as UserResponse[];
    const matches = users.filter(
      (u) => u.email.toLowerCase() === existingUser.email.toLowerCase(),
    );
    expect(matches.length, "Es darf nur genau ein Konto mit dieser E-Mail geben").toBe(1);
    expect(matches[0]?.id).toBe(existingUser.id);

    // Aufräumen im UI: Dialog schließen.
    await dialog.getByRole("button", { name: "Abbrechen" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
