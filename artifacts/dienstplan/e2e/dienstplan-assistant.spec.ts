import {
  test,
  expect,
  request as playwrightRequest,
  type Page,
  type APIRequestContext,
} from "@playwright/test";

/**
 * E2E-Test für die eingeschränkte Assistenten-Sicht auf den Dienstplan.
 *
 * Die Rolle "assistant" darf bewusst nur die eigenen Daten sehen und keine
 * Schichten anlegen oder bearbeiten. Diese Trennung ist sicherheitsrelevant
 * und wird hier automatisiert abgesichert.
 *
 * Deckt ab:
 * - Login als Assistent über den echten Auth-Flow und Öffnen von /dienstplan
 * - Es werden nur die eigenen Schichten angezeigt ("Meine Schichten"),
 *   keine Schichten anderer Assistenten
 * - Der Assistenten-Filter (Alle/Chips) erscheint NICHT
 * - Keine Bearbeiten-/Anlegen-Aktionen: kein "Schicht"-Button, Tagesklick
 *   öffnet keinen Dialog
 *
 * Die Ansicht wird im Desktop-Viewport getestet, da die Tabellen-Beschriftung
 * "Meine Schichten" nur dort gerendert wird.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

// Desktop-Viewport: die Tabellenansicht mit "Meine Schichten" ist nur unter
// md: sichtbar; die globale Config nutzt sonst ein mobiles Viewport.
test.use({ viewport: { width: 1280, height: 800 } });

type CreatedUser = { id: number; name: string; email: string };

type Assistant = {
  id: number;
  name: string;
  email: string;
  password: string;
};

/** Eigener Assistent (Testsubjekt) mit gesetztem Passwort und einer Schicht. */
let assistant: Assistant;
/** Zweiter Assistent, dessen Schicht der erste Assistent NICHT sehen darf. */
let otherAssistant: CreatedUser;
/** Monat/Jahr, in dem die Test-Schichten liegen (aktueller Monat). */
const now = new Date();
const month = now.getMonth() + 1;
const year = now.getFullYear();
/** Tag der eigenen Schicht bzw. der fremden Schicht (existieren in jedem Monat). */
const OWN_DAY = 10;
const FOREIGN_DAY = 20;

const pad2 = (n: number) => String(n).padStart(2, "0");
const dayCellId = (day: number) => `day-cell-${year}-${pad2(month)}-${pad2(day)}`;

/** Erstellt einen Assistenten und gibt die angelegten Stammdaten zurück. */
async function createAssistant(ctx: APIRequestContext, suffix: string): Promise<CreatedUser> {
  const res = await ctx.post("/api/users", {
    data: {
      name: `E2E Assistent ${suffix}`,
      email: `e2e.assistant.${suffix}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(res.ok(), `Anlegen des Assistenten fehlgeschlagen (${res.status()})`).toBe(true);
  const user = (await res.json()) as CreatedUser;
  return user;
}

/**
 * Generiert über den Admin-Kontext einen Einladungstoken und setzt darüber das
 * Passwort des Assistenten. set-password läuft in einem eigenen Kontext, damit
 * die Admin-Session unberührt bleibt.
 */
async function setAssistantPassword(
  adminCtx: APIRequestContext,
  userId: number,
  password: string,
): Promise<void> {
  const inviteRes = await adminCtx.post(`/api/users/${userId}/invite`, {});
  expect(inviteRes.ok(), "Einladung fehlgeschlagen").toBe(true);
  const { token } = (await inviteRes.json()) as { token: string };

  const pwCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const pwRes = await pwCtx.post("/api/auth/set-password", {
    data: { token, password },
  });
  expect(pwRes.ok(), "Passwort setzen fehlgeschlagen").toBe(true);
  await pwCtx.dispose();
}

/** Legt für einen Tag des aktuellen Monats eine reguläre Schicht an. */
async function createShift(
  ctx: APIRequestContext,
  userId: number,
  dayOfMonth: number,
  startHour: number,
  endHour: number,
): Promise<void> {
  const start = new Date(year, month - 1, dayOfMonth, startHour, 0, 0);
  const end = new Date(year, month - 1, dayOfMonth, endHour, 0, 0);
  const res = await ctx.post("/api/shifts", {
    data: {
      userId,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      type: "active",
    },
  });
  expect(res.ok(), `Anlegen der Schicht fehlgeschlagen (${res.status()})`).toBe(true);
}

async function loginViaUi(page: Page, email: string, password: string): Promise<void> {
  // Programmatische Anmeldung über die API: page.request teilt den Cookie-Jar
  // mit dem Browser, dadurch ist /api/auth/me beim ersten Laden sofort 200 und
  // der Vite-Dev-Auto-Login (der sonst als Seed-Admin anmeldet) greift nie —
  // der Test agiert garantiert als der gewünschte Nutzer (dev- UND prod-tauglich).
  const res = await page.request.post("/api/auth/login", { data: { email, password } });
  expect(res.ok(), `Login als ${email} fehlgeschlagen (${res.status()})`).toBe(true);
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
}

test.beforeAll(async () => {
  const unique = Date.now();
  const adminCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });

  const loginRes = await adminCtx.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(loginRes.ok(), "Admin-Login für Setup fehlgeschlagen").toBe(true);

  const me = await createAssistant(adminCtx, `${unique}a`);
  otherAssistant = await createAssistant(adminCtx, `${unique}b`);

  // Eigene Schicht am 10. (08:00–16:00), fremde Schicht am 20. (12:00–20:00).
  // Unterschiedliche Tage UND Zeiten machen Datenlecks eindeutig erkennbar.
  await createShift(adminCtx, me.id, OWN_DAY, 8, 16);
  await createShift(adminCtx, otherAssistant.id, FOREIGN_DAY, 12, 20);

  const password = `Pw${unique}!secure`;
  await setAssistantPassword(adminCtx, me.id, password);

  await adminCtx.dispose();

  assistant = { ...me, password };
});

test.describe("Dienstplan-Sicht als Assistent (eingeschränkte Rechte)", () => {
  test.beforeEach(async ({ page }) => {
    await loginViaUi(page, assistant.email, assistant.password);
    await page.goto("/dienstplan");
    await expect(
      page.getByRole("heading", { name: "Dienstplan", exact: true }),
    ).toBeVisible();
  });

  test("zeigt nur eigene Schichten als 'Meine Schichten' ohne fremde Daten", async ({ page }) => {
    // Sicherstellen, dass der angezeigte Monat der ist, in dem die Schichten liegen.
    await expect(page.getByTestId("month-label")).toBeVisible();

    // Die App rendert Mobil- und Desktop-Markup parallel (per CSS umgeschaltet);
    // im Desktop-Viewport ist nur der Desktop-Block sichtbar.
    const desktop = page.getByTestId("dienstplan-desktop");

    // In der Tabellenansicht (Desktop-Standard) erscheint die eigene Zeile als
    // "Meine Schichten" — nicht der Klarname und nicht andere Assistenten.
    await expect(desktop.getByText("Meine Schichten")).toBeVisible();
    await expect(desktop.getByText(otherAssistant.name)).toHaveCount(0);

    // Datenisolation (eindeutig über die Uhrzeit): die eigene Schicht
    // (08:00–16:00) ist sichtbar, die fremde Schicht (12:00–20:00) NICHT —
    // weder in der Tabelle noch irgendwo sonst auf der Seite.
    await expect(desktop.getByText("08:00–16:00").first()).toBeVisible();
    await expect(page.getByText("12:00–20:00")).toHaveCount(0);

    // Tagesgenaue Prüfung im Monatsgitter: der eigene Tag zeigt die Schicht,
    // der fremde Tag ist leer (kein Datenleck über die Tagesauswahl).
    await page.getByTestId("view-toggles-desktop").getByTestId("view-toggle-grid").click();
    await expect(desktop.getByTestId("month-grid")).toBeVisible();

    await desktop.getByTestId(dayCellId(OWN_DAY)).click();
    await expect(desktop.getByTestId("day-detail-header")).toContainText(`${OWN_DAY}.`);
    await expect(desktop.getByTestId("day-detail-header").locator("..")).toContainText("1 Schicht");
    await expect(desktop.getByText("08:00–16:00").first()).toBeVisible();

    await desktop.getByTestId(dayCellId(FOREIGN_DAY)).click();
    await expect(desktop.getByTestId("day-detail-header")).toContainText(`${FOREIGN_DAY}.`);
    await expect(desktop.getByText("12:00–20:00")).toHaveCount(0);
    await expect(desktop.getByText("Keine Schichten").first()).toBeVisible();
  });

  test("zeigt keinen Assistenten-Filter", async ({ page }) => {
    await expect(page.getByTestId("assistant-filter")).toHaveCount(0);
    await expect(page.getByTestId("assistant-chip-all")).toHaveCount(0);
  });

  test("erlaubt kein Anlegen oder Bearbeiten von Schichten", async ({ page }) => {
    const desktop = page.getByTestId("dienstplan-desktop");

    // Tabellenansicht: kein "Schicht"-Button, Tagesklick öffnet keinen Dialog.
    await expect(desktop.getByRole("button", { name: "Schicht", exact: true })).toHaveCount(0);

    // Klick auf eine Tabellenzelle darf keinen Dialog öffnen.
    const cell = desktop.locator("td").filter({ hasText: "08:00–16:00" }).first();
    await cell.click();
    await expect(page.getByText("Neue Schicht anlegen")).toHaveCount(0);
    await expect(page.getByText("Schicht bearbeiten")).toHaveCount(0);

    // Auch in der Monatsgitter-Ansicht gibt es keinen "Schicht"-Button und ein
    // Tagesklick legt nichts an.
    await page.getByTestId("view-toggles-desktop").getByTestId("view-toggle-grid").click();
    await expect(desktop.getByTestId("month-grid")).toBeVisible();
    await expect(desktop.getByRole("button", { name: "Schicht", exact: true })).toHaveCount(0);

    const dayCell = desktop.getByTestId(
      `day-cell-${year}-${String(month).padStart(2, "0")}-15`,
    );
    await dayCell.click();
    await expect(page.getByText("Neue Schicht anlegen")).toHaveCount(0);
    await expect(page.getByText("Schicht bearbeiten")).toHaveCount(0);
  });
});
