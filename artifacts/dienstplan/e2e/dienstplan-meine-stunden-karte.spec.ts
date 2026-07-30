import { test, expect } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";
import {
  registerFreeAccount,
  setAccountPlan,
  deleteFreeAccount,
  FREE_ACCOUNT_PASSWORD,
  type FreeAccount,
} from "./helpers/teams";

/**
 * Task #675 — Meine-Stunden-Karte im Assistenten-Dashboard.
 *
 * Die MeineStundenKarte-Komponente (src/components/meine-stunden-karte.tsx)
 * erscheint nur für Nicht-Admins (`{!isAdmin && <MeineStundenKarte />}`).
 * Sie ruft GET /api/dashboard/my-hours-balance auf und rendert
 * IST-Stunden, Krankheitsstunden und Urlaubstage; ohne Vertrag bleibt sie
 * ausgeblendet (null). Der Detail-Button navigiert nach /auswertungen.
 *
 * Test-Aufbau:
 *   1. Frisch registriertes Dienstleister-Konto (Premium für caregiverLogin).
 *   2. Assistenten-Nutzer anlegen + Vertrag für den aktuellen Monat.
 *   3. Einladungstoken generieren, Passwort setzen.
 *   4. Als Assistent einloggen → Dashboard prüfen.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

// Desktop: Header + Karte zuverlässig sichtbar.
test.use({ viewport: { width: 1280, height: 800 } });

const NOW = new Date();
const YEAR = NOW.getFullYear();
const MONTH = NOW.getMonth() + 1;
const MM = String(MONTH).padStart(2, "0");
const SHIFT_DAY = `${YEAR}-${MM}-05`;

let acc: FreeAccount;
let assistantId: number;
let assistantEmail: string;
const ASSISTANT_PASSWORD = "assistenz1234";

test.beforeAll(async () => {
  test.setTimeout(90_000);

  // 1. Dienstleister-Konto registrieren + Premium für caregiverLogin
  acc = await registerFreeAccount("dienstleister", "meinestunden");
  await setAccountPlan(acc.email, "premium");

  // 2. Assistenten-Nutzer anlegen
  const unique = Date.now();
  assistantEmail = `e2e.meinestunden.asst.${unique}@dienstplan.test`;
  const userRes = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E Assistent Stunden ${unique}`,
      email: assistantEmail,
      role: "assistant",
    },
  });
  expect(userRes.status(), `Assistent anlegen (${userRes.status()})`).toBe(201);
  assistantId = ((await userRes.json()) as { id: number }).id;

  // 3. Vertrag für den Assistenten (aktueller Monat)
  const contractRes = await acc.ctx.post("/api/contracts", {
    data: {
      userId: assistantId,
      startDate: `${YEAR}-01-01`,
      weeklyHours: 40,
      vacationDays: 30,
    },
  });
  expect(contractRes.status(), `Vertrag anlegen (${contractRes.status()})`).toBe(201);

  // 4. Arbeitsdienst im aktuellen Monat
  const shiftRes = await acc.ctx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "work",
      planningStatus: "FIX",
      startTime: `${SHIFT_DAY}T08:00:00.000Z`,
      endTime: `${SHIFT_DAY}T16:00:00.000Z`,
    },
  });
  expect(shiftRes.status(), `Schicht anlegen (${shiftRes.status()})`).toBe(201);

  // 4b. Kind-krank-Tag für Testid-Prüfung (#681)
  const kindKrankDay = `${YEAR}-${MM}-07`;
  const kindKrankRes = await acc.ctx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "kind_krank",
      planningStatus: "FIX",
      startTime: `${kindKrankDay}T00:00:00.000Z`,
      endTime: `${kindKrankDay}T23:59:59.000Z`,
    },
  });
  expect(kindKrankRes.status(), `Kind-krank anlegen (${kindKrankRes.status()})`).toBe(201);

  // 5. Einladungstoken generieren
  const inviteRes = await acc.ctx.post(`/api/users/${assistantId}/invite`);
  expect(inviteRes.status(), `Einladung erstellen (${inviteRes.status()})`).toBe(200);
  const { token } = (await inviteRes.json()) as { token: string };

  // 6. Passwort setzen
  const pwRes = await acc.ctx.post("/api/auth/set-password", {
    data: { token, password: ASSISTANT_PASSWORD },
  });
  expect(pwRes.status(), `Passwort setzen (${pwRes.status()})`).toBe(200);
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

test("Meine-Stunden-Karte erscheint für Assistenten mit Vertrag (#675)", async ({
  page,
}) => {
  test.setTimeout(45_000);

  // Als Assistent einloggen
  await loginViaUi(page, assistantEmail, ASSISTANT_PASSWORD);
  await page.goto("/");

  // Karte muss sichtbar sein
  const karte = page.getByTestId("meine-stunden-karte");
  await expect(karte, "Meine-Stunden-Karte muss für Assistenten erscheinen").toBeVisible({
    timeout: 25_000,
  });

  // Stunden-Zeile vorhanden
  await expect(page.getByTestId("meine-stunden-ist")).toBeVisible();

  // Urlaubstage-Zeile vorhanden
  await expect(page.getByTestId("meine-stunden-urlaub")).toBeVisible();

  // Krankheitsstunden-Zeile vorhanden
  await expect(page.getByTestId("meine-stunden-krank")).toBeVisible();

  // Kind-krank-Tag wurde in beforeAll angelegt → Zeile muss erscheinen (#681)
  await expect(page.getByTestId("meine-stunden-kindkrank")).toBeVisible();
});

test("Detail-Button der Meine-Stunden-Karte navigiert nach /auswertungen (#675)", async ({
  page,
}) => {
  test.setTimeout(45_000);

  await loginViaUi(page, assistantEmail, ASSISTANT_PASSWORD);
  await page.goto("/");

  await expect(page.getByTestId("meine-stunden-karte")).toBeVisible({
    timeout: 25_000,
  });

  await page.getByTestId("meine-stunden-details-btn").click();
  await expect
    .poll(() => new URL(page.url()).pathname, { timeout: 10_000 })
    .toContain("/auswertungen");
});

test("Admin sieht keine Meine-Stunden-Karte (nur für Assistenten) (#675)", async ({
  page,
}) => {
  test.setTimeout(45_000);

  // Als Admin (Konto-Inhaber) einloggen
  await loginViaUi(page, acc.email, FREE_ACCOUNT_PASSWORD);
  await page.goto("/");

  // Auf Dashboard-Überschrift warten
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({
    timeout: 20_000,
  });

  // Admin sieht die Karte NICHT
  await expect(page.getByTestId("meine-stunden-karte")).not.toBeVisible();
});
