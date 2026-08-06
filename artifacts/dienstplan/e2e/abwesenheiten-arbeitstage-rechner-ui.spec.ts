import { test, expect, type Page } from "@playwright/test";
import { setAccountPlan } from "./helpers/teams";

/**
 * E2E-Test (Task #706): Datenpflege-Hinweis + Arbeitstage-Rechner auf
 * /abwesenheiten.
 *
 * Deckt ab:
 * - Hinweis erscheint nur, solange die Arbeitstage/Woche noch nie bewusst
 *   festgelegt wurden (workdaysConfirmedAt == null) und die Urlaubstag-
 *   Bewertung aus den Vertragsdaten stammt (hier: 28 h ÷ 5 Tage = 5,6 h).
 * - Das X bestätigt den Ist-Wert: Hinweis dauerhaft weg, Wert unverändert,
 *   serverseitig workdaysConfirmedAt gesetzt.
 * - Der „Neu berechnen"-Button in der Urlaubszeile öffnet den Rechner
 *   jederzeit wieder; 24-h-Dienste × 5/Monat → 1,15 Arbeitstage und
 *   27,6 Wochenstunden (1 Urlaubstag = exakt 24 h); Übernehmen schreibt
 *   beide Werte konsistent in den Vertrag.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";

// Desktop-Viewport: die Urlaubszeile liegt sonst in der Mobil-Variante.
test.use({ viewport: { width: 1400, height: 900 } });

type ApiContract = {
  id: number;
  workdaysPerWeek: number;
  weeklyHours: number;
  workdaysConfirmedAt: string | null;
};

async function loginAsAdmin(page: Page): Promise<void> {
  const res = await page.request.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(res.ok(), `Admin-Login fehlgeschlagen (${res.status()})`).toBe(true);
  await page.goto("/");
}

async function fetchContract(page: Page, userId: number, contractId: number): Promise<ApiContract> {
  const res = await page.request.get(`/api/contracts?userId=${userId}`);
  expect(res.ok(), `Vertragsabfrage fehlgeschlagen (${res.status()})`).toBe(true);
  const list = (await res.json()) as ApiContract[];
  const found = list.find((c) => c.id === contractId);
  expect(found, "Vertrag muss in der Liste enthalten sein").toBeTruthy();
  return found!;
}

test.beforeAll(async () => {
  // vacation-balance (Datenbasis des Hinweises) ist absenceTracking-Premium.
  await setAccountPlan(ADMIN_EMAIL, "premium");
});

test("Hinweis bestätigen und Arbeitstage per Rechner neu berechnen", async ({ page }) => {
  test.setTimeout(90_000);
  await loginAsAdmin(page);

  const unique = Date.now();
  const userRes = await page.request.post("/api/users", {
    data: {
      name: `E2E Rechner ${unique}`,
      email: `e2e.rechner.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(userRes.status(), "Assistent anlegen sollte 201 liefern").toBe(201);
  const assistant = (await userRes.json()) as { id: number; name: string };

  try {
    // Vertrag OHNE workdaysPerWeek → Migrations-Default 5, nicht bestätigt.
    const contractRes = await page.request.post("/api/contracts", {
      data: {
        userId: assistant.id,
        startDate: "2026-01-01",
        weeklyHours: 28,
        vacationDays: 30,
      },
    });
    expect(contractRes.status(), "Vertrag anlegen sollte 201 liefern").toBe(201);
    const contract = (await contractRes.json()) as ApiContract;
    expect(contract.workdaysConfirmedAt, "Neuer Vertrag ohne explizite Arbeitstage ist unbestätigt").toBeNull();

    await page.goto("/abwesenheiten");

    // Hinweis mit der Vertrags-Bewertung 5,6 h/Tag.
    const hint = page.getByTestId(`workdays-hint-${contract.id}`);
    await expect(hint).toBeVisible({ timeout: 20_000 });
    await expect(hint).toContainText("5,6 h/Tag");

    // X = Ist-Wert bestätigen: Hinweis verschwindet dauerhaft, Wert bleibt 5.
    await hint.getByTestId(`workdays-hint-close-${contract.id}`).click();
    await expect(page.getByTestId(`workdays-hint-${contract.id}`)).toHaveCount(0);
    const afterClose = await fetchContract(page, assistant.id, contract.id);
    expect(afterClose.workdaysPerWeek, "Bestätigen darf den Wert nicht ändern").toBe(5);
    expect(afterClose.workdaysConfirmedAt, "Bestätigen setzt den Zeitstempel").not.toBeNull();

    // „Neu berechnen" öffnet den Rechner trotz bestätigtem Hinweis wieder.
    await page.getByTestId(`workdays-recalc-${assistant.id}`).click();
    const dialog = page.getByTestId("arbeitstage-rechner-dialog");
    await expect(dialog).toBeVisible();

    // 24-h-Dienste × 5 pro Monat → 1,15 Arbeitstage, 27,6 Wochenstunden,
    // 1 Urlaubstag = exakt 24 h.
    await dialog.getByTestId("rechner-dienstlaenge").click();
    await page.getByRole("option", { name: "24 Stunden" }).click();
    await dialog.getByTestId("rechner-dienste-pro-monat").fill("5");
    const preview = dialog.getByTestId("rechner-vorschau");
    await expect(preview).toContainText("1,15 Arbeitstage");
    await expect(preview).toContainText("27,6 Wochenstunden");
    await expect(preview).toContainText("1 Urlaubstag = 24 h");

    await dialog.getByTestId("rechner-uebernehmen").click();
    await expect(page.getByTestId("arbeitstage-rechner-dialog")).toHaveCount(0);

    // Vertrag trägt jetzt beide konsistenten Werte, Hinweis bleibt weg.
    const afterApply = await fetchContract(page, assistant.id, contract.id);
    expect(afterApply.workdaysPerWeek).toBeCloseTo(1.15, 2);
    expect(afterApply.weeklyHours).toBeCloseTo(27.6, 2);
    await expect(page.getByTestId(`workdays-hint-${contract.id}`)).toHaveCount(0);
  } finally {
    await page.request.delete(`/api/users/${assistant.id}`);
  }
});
