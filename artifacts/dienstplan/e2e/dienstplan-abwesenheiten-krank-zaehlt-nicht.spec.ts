import { pickDateField } from "./helpers/date-picker";
import {
  test,
  expect,
  request as playwrightRequest,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { loginViaUi } from "./helpers/auth";

/**
 * E2E-Gegenprobe zur Resturlaub-Karte bei einem Assistenten OHNE aktiven Vertrag.
 *
 * Die Resturlaub-Karte zeigt für vertragslose Assistenten "Kein Vertrag" und
 * ergänzt die im laufenden Jahr geplanten URLAUBStage als "… · N Tage geplant".
 * Krankheitstage dürfen dabei NICHT in diesen Zähler einfließen
 * (vacationByUser zählt in abwesenheiten.tsx ausschließlich type=vacation).
 *
 * Deckt ab:
 * - Admin-Login über den echten Auth-Flow
 * - Assistent OHNE Vertrag (kein createContract)
 * - Krank-Buchung über 4 Tage im laufenden Jahr über die UI
 * - Nach reiner Krank-Buchung: kein "geplant"-Zusatz, vacation-taken fehlt
 * - Zusätzliche Urlaubs-Buchung über 2 Tage im laufenden Jahr über die UI
 * - Danach: vacation-taken-<id> = 2 (nur Urlaub), nicht 6 (Urlaub + Krank)
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

// Desktop-Viewport hält das Layout der Resturlaub-Karte stabil.
test.use({ viewport: { width: 1280, height: 800 } });

// Laufendes Jahr — die Resturlaub-Anzeige zählt ausschließlich Urlaubstage des
// aktuellen Jahres (currentYear in der Seite).
const YEAR = new Date().getFullYear();

// 4 aufeinanderfolgende Krank-Tage im laufenden Jahr (fern von Jahresgrenzen).
const SICK_FROM = `${YEAR}-06-10`;
const SICK_TO = `${YEAR}-06-13`;

// 2 aufeinanderfolgende Urlaubs-Tage im laufenden Jahr, ohne Überschneidung
// mit den Krank-Tagen.
const VACATION_FROM = `${YEAR}-06-20`;
const VACATION_TO = `${YEAR}-06-21`;
const EXPECTED_VACATION_DAYS = 2;

type CreatedUser = { id: number; name: string; email: string };

let adminCtx: APIRequestContext;
let assistant: CreatedUser;

async function createAssistant(ctx: APIRequestContext, suffix: string): Promise<CreatedUser> {
  const res = await ctx.post("/api/users", {
    data: {
      name: `E2E KrankZaehltNicht ${suffix}`,
      email: `e2e.krankzaehltnicht.${suffix}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(res.ok(), `Anlegen des Assistenten fehlgeschlagen (${res.status()})`).toBe(true);
  return (await res.json()) as CreatedUser;
}

async function bookAbsence(
  page: Page,
  name: string,
  kind: "Urlaub" | "Krank",
  fromDate: string,
  toDate: string
): Promise<void> {
  await page.getByTestId("absence-user").click();
  await page.getByRole("option", { name }).click();

  await page.getByTestId("absence-type").click();
  await page.getByRole("option", { name: kind, exact: true }).click();

  await pickDateField(page, "absence-from", fromDate);
  await pickDateField(page, "absence-to", toDate);
  await page.getByTestId("absence-save").click();
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
  for (const type of ["vacation", "sick"]) {
    const shiftRes = await adminCtx.get(`/api/shifts?type=${type}&userId=${assistant.id}`);
    if (shiftRes.ok()) {
      const shifts = (await shiftRes.json()) as { id: number; userId: number }[];
      for (const s of shifts.filter((s) => s.userId === assistant.id)) {
        await adminCtx.delete(`/api/shifts/${s.id}`);
      }
    }
  }
  if (assistant?.id) await adminCtx.delete(`/api/users/${assistant.id}`);
  await adminCtx.dispose();
});

test("geplante Krank-Tage zählen nicht in den Resturlaub-Zähler", async ({ page }) => {
  await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.goto("/abwesenheiten");
  await expect(page.getByRole("heading", { name: "Abwesenheiten", exact: true })).toBeVisible();

  const row = page.getByTestId(`vacation-balance-row-${assistant.id}`);
  const taken = page.getByTestId(`vacation-taken-${assistant.id}`);

  // Ausgangszustand: nur "Kein Vertrag", ohne "Tage geplant"-Zusatz.
  await expect(row).toContainText("Kein Vertrag");
  await expect(taken).toHaveCount(0);
  await expect(row).not.toContainText("geplant");

  // 1) Krank-Tage buchen (4 Tage).
  await bookAbsence(page, assistant.name, "Krank", SICK_FROM, SICK_TO);
  await expect(page.getByTestId("absence-list")).toContainText("Krank");

  // Krank-Tage dürfen den Resturlaub-Zähler NICHT verändern: weiterhin
  // "Kein Vertrag" ohne "geplant"-Zusatz und ohne vacation-taken-Element.
  await expect(row).toContainText("Kein Vertrag");
  await expect(taken).toHaveCount(0);
  await expect(row).not.toContainText("geplant");

  // 2) Urlaubs-Tage buchen (2 Tage).
  await bookAbsence(page, assistant.name, "Urlaub", VACATION_FROM, VACATION_TO);
  await expect(page.getByTestId("absence-list")).toContainText("Urlaub");

  // Jetzt zählt der Zähler ausschließlich die Urlaubstage (2), NICHT die
  // Krank-Tage (sonst stünde hier 6).
  await expect(row).toContainText("Kein Vertrag");
  await expect(taken).toHaveText(String(EXPECTED_VACATION_DAYS));
  await expect(row).toContainText(`${EXPECTED_VACATION_DAYS} Tage geplant`);
});
