import { test, expect, type Page } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";

/**
 * E2E-Test: der gemerkte Assistenten-Filter im Dienstplan bleibt nach einem
 * Reload erhalten (localStorage-Key `dienstplan.selectedAssistant`).
 *
 * Deckt ab:
 * - Admin-Login über den echten Auth-Flow und Öffnen von /dienstplan
 * - Assistent im kompakten Select auswählen, Seite neu laden → Auswahl bleibt
 * - Bereinigungsfall: gespeicherter Assistent existiert nicht mehr → der
 *   Filter fällt nach dem Reload sauber auf "Alle Assistenten" zurück
 *
 * Der Assistenten-Filter ist ein shadcn/Radix-<Select> in der (sticky)
 * Kopfzeile: Trigger `assistant-select`, Optionen `assistant-option-<id>`
 * bzw. `assistant-option-all`.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";

const ASSISTANT_FILTER_KEY = "dienstplan.selectedAssistant";

async function loginAsAdmin(page: Page): Promise<void> {
  // Delegiert an den gemeinsamen Helper, der den Vite-Dev-Auto-Login
  // toleriert (kein Login-Formular) und im Prod-Build das Formular ausfüllt.
  await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
}

/**
 * Legt deterministisch einen frischen Assistenten an und liefert dessen ID,
 * damit die zugehörige Filter-Option (`assistant-option-<id>`) eindeutig
 * adressierbar ist. Nutzt die authentifizierte Session des eingeloggten Admins
 * (page.request teilt die Cookies des Browser-Kontexts).
 */
async function createAssistant(page: Page): Promise<number> {
  const unique = Date.now();
  const res = await page.request.post("/api/users", {
    data: {
      name: `E2E Filter-Assistent ${unique}`,
      email: `e2e.filter.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(res.ok(), `Anlegen des Test-Assistenten fehlgeschlagen (${res.status()})`).toBe(true);
  const user = (await res.json()) as { id: number };
  return user.id;
}

async function openCalendar(page: Page): Promise<void> {
  await page.goto("/dienstplan");
  await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();
}

/** Öffnet das Filter-Select und wählt die Option mit dem gegebenen testid. */
async function selectOption(page: Page, optionTestId: string): Promise<void> {
  await page.getByTestId("assistant-select").click();
  await page.getByTestId(optionTestId).click();
}

test.describe("Dienstplan: gemerkter Assistenten-Filter (Reload)", () => {
  let assistantId: number;

  test.beforeEach(async ({ page }) => {
    // Großzügiges Timeout: der erste Seitenaufruf in einem frischen
    // Browser-Kontext lädt das komplette App-Bundle über den Proxy und kann
    // in der Replit-Umgebung deutlich länger als die Standard-30s dauern.
    test.setTimeout(120_000);
    await loginAsAdmin(page);
    assistantId = await createAssistant(page);
  });

  test("behält die Assistenten-Auswahl nach einem Reload bei", async ({ page }) => {
    await openCalendar(page);

    const trigger = page.getByTestId("assistant-select");
    await expect(trigger).toBeVisible();
    await expect(trigger).toContainText("Alle Assistenten");

    // Den konkreten Assistenten auswählen.
    await selectOption(page, `assistant-option-${assistantId}`);
    await expect(trigger).toContainText(`E2E Filter-Assistent`);

    // Auswahl muss in localStorage gemerkt worden sein.
    await expect
      .poll(async () =>
        page.evaluate((key) => localStorage.getItem(key), ASSISTANT_FILTER_KEY),
      )
      .toBe(String(assistantId));

    // Seite neu laden: die Auswahl bleibt erhalten.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();

    await expect(page.getByTestId("assistant-select")).toContainText(`E2E Filter-Assistent`);
    expect(
      await page.evaluate((key) => localStorage.getItem(key), ASSISTANT_FILTER_KEY),
    ).toBe(String(assistantId));
  });

  test("fällt auf 'Alle' zurück, wenn der gemerkte Assistent nicht mehr existiert", async ({
    page,
  }) => {
    // Zuerst die Seite öffnen, damit localStorage für diese Origin verfügbar ist.
    await openCalendar(page);

    // Einen Assistenten merken, den es nicht (mehr) gibt.
    const STALE_ID = 999_999_999;
    await page.evaluate(
      ([key, value]) => localStorage.setItem(key, value),
      [ASSISTANT_FILTER_KEY, String(STALE_ID)] as const,
    );

    // Reload: die Bereinigungslogik muss die ungültige Auswahl auf "Alle" setzen.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();

    // Der Filter steht wieder auf "Alle Assistenten".
    await expect(page.getByTestId("assistant-select")).toContainText("Alle Assistenten");

    // Die Bereinigung muss auch in localStorage zurückgeschrieben werden.
    await expect
      .poll(async () =>
        page.evaluate((key) => localStorage.getItem(key), ASSISTANT_FILTER_KEY),
      )
      .toBe("all");
  });
});
