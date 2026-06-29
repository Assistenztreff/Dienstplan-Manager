import {
  test,
  expect,
  request as playwrightRequest,
  type Page,
  type APIRequestContext,
} from "@playwright/test";

/**
 * E2E-Test für die Resturlaub-Karte bei einem Assistenten OHNE aktiven Vertrag.
 *
 * Die Karte zeigt für vertragslose Assistenten "Kein Vertrag" — und ergänzt
 * die bereits im laufenden Jahr geplanten Urlaubstage als "Kein Vertrag ·
 * N Tage geplant". Dieser Test sichert beide Zustände ab:
 *
 * Deckt ab:
 * - Admin-Login über den echten Auth-Flow
 * - Assistent OHNE Vertrag (kein createContract)
 * - Vor jeder Buchung: Zeile zeigt nur "Kein Vertrag" (kein vacation-taken-Zusatz)
 * - Urlaubsbuchung über 3 Tage im laufenden Jahr über die UI
 * - Nach der Buchung: Zeile enthält "Kein Vertrag" und vacation-taken-<id> = 3
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

// Desktop-Viewport hält das Layout der Resturlaub-Karte stabil.
test.use({ viewport: { width: 1280, height: 800 } });

// Laufendes Jahr — die Resturlaub-Anzeige zählt ausschließlich Urlaubstage des
// aktuellen Jahres (currentYear in der Seite).
const YEAR = new Date().getFullYear();
// 3 aufeinanderfolgende Tage im laufenden Jahr (fern von Jahresgrenzen).
const VACATION_FROM = `${YEAR}-06-15`;
const VACATION_TO = `${YEAR}-06-17`;
const EXPECTED_DAYS = 3;

type CreatedUser = { id: number; name: string; email: string };

let adminCtx: APIRequestContext;
let assistant: CreatedUser;

async function createAssistant(ctx: APIRequestContext, suffix: string): Promise<CreatedUser> {
  const res = await ctx.post("/api/users", {
    data: {
      name: `E2E OhneVertrag ${suffix}`,
      email: `e2e.ohnevertrag.${suffix}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(res.ok(), `Anlegen des Assistenten fehlgeschlagen (${res.status()})`).toBe(true);
  return (await res.json()) as CreatedUser;
}

async function loginViaUi(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test.beforeAll(async () => {
  const unique = Date.now();
  adminCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });

  const loginRes = await adminCtx.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(loginRes.ok(), "Admin-Login für Setup fehlgeschlagen").toBe(true);

  // Bewusst KEIN Vertrag — der zu prüfende "Kein Vertrag"-Zustand.
  assistant = await createAssistant(adminCtx, `${unique}`);
});

test.afterAll(async () => {
  const shiftRes = await adminCtx.get(`/api/shifts?type=vacation&userId=${assistant.id}`);
  if (shiftRes.ok()) {
    const shifts = (await shiftRes.json()) as { id: number; userId: number }[];
    for (const s of shifts.filter((s) => s.userId === assistant.id)) {
      await adminCtx.delete(`/api/shifts/${s.id}`);
    }
  }
  if (assistant?.id) await adminCtx.delete(`/api/users/${assistant.id}`);
  await adminCtx.dispose();
});

test("geplanter Urlaub erscheint in der Resturlaub-Karte auch ohne Vertrag", async ({ page }) => {
  await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.goto("/abwesenheiten");
  await expect(page.getByRole("heading", { name: "Abwesenheiten", exact: true })).toBeVisible();

  const row = page.getByTestId(`vacation-balance-row-${assistant.id}`);
  const taken = page.getByTestId(`vacation-taken-${assistant.id}`);

  // Vor der Buchung: nur "Kein Vertrag", ohne den "Tage geplant"-Zusatz.
  await expect(row).toContainText("Kein Vertrag");
  await expect(taken).toHaveCount(0);
  await expect(row).not.toContainText("geplant");

  // Assistent im Erfassungsformular auswählen.
  await page.getByTestId("absence-user").click();
  await page.getByRole("option", { name: assistant.name }).click();

  // Typ bleibt "Urlaub" (Default). Zeitraum = 3 Tage im laufenden Jahr.
  await page.getByTestId("absence-from").fill(VACATION_FROM);
  await page.getByTestId("absence-to").fill(VACATION_TO);
  await page.getByTestId("absence-save").click();

  // Buchung erscheint in der Liste.
  await expect(page.getByTestId("absence-list")).toContainText("Urlaub");

  // Nach der Buchung: weiterhin "Kein Vertrag", jetzt mit korrekter Tageszahl.
  await expect(row).toContainText("Kein Vertrag");
  await expect(taken).toHaveText(String(EXPECTED_DAYS));
  await expect(row).toContainText(`${EXPECTED_DAYS} Tage geplant`);
});
