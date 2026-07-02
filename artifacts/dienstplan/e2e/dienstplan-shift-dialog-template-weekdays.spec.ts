import { test, expect, type Page } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";

/**
 * E2E-Test: Wochentage von Arbeitszeit-Vorlagen werden im ShiftDialog genutzt.
 *
 * - Vorlagen, die zum gewählten Datum passen, werden in einer eigenen Gruppe
 *   ("Passend zum Datum") zuerst gelistet; unpassende unter "Andere Wochentage"
 *   inklusive ihrer Wochentags-Angabe.
 * - Beim Anwenden einer unpassenden Vorlage erscheint ein dezenter Hinweis
 *   (data-testid shift-dialog-template-mismatch); die Zeiten werden trotzdem
 *   übernommen.
 * - Wird das Datum anschließend auf einen passenden Tag geändert, verschwindet
 *   der Hinweis (rein abgeleitete Logik).
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";

const MONTHS_DE = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

function parseMonthLabel(text: string): { year: number; month: number } {
  const parts = text.trim().split(/\s+/);
  const monthIndex = MONTHS_DE.indexOf(parts[0]);
  const year = Number(parts[1]);
  expect(monthIndex, `Unbekannter Monatsname in "${text}"`).toBeGreaterThanOrEqual(0);
  expect(Number.isFinite(year), `Ungültiges Jahr in "${text}"`).toBe(true);
  return { year, month: monthIndex + 1 };
}

/** ISO-Wochentag 1 (Mo) .. 7 (So) eines lokalen Datums. */
function isoWeekday(year: number, month: number, day: number): number {
  return ((new Date(year, month - 1, day).getDay() + 6) % 7) + 1;
}

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

async function ensureAssistant(page: Page): Promise<{ id: number; name: string }> {
  const listRes = await page.request.get("/api/users?role=assistant");
  expect(listRes.ok(), "GET /api/users?role=assistant fehlgeschlagen").toBe(true);
  const assistants = (await listRes.json()) as { id: number; name: string }[];
  if (assistants.length > 0) return { id: assistants[0].id, name: assistants[0].name };

  const unique = Date.now();
  const createRes = await page.request.post("/api/users", {
    data: {
      name: `E2E Assistent ${unique}`,
      email: `e2e.assistant.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(createRes.ok(), "Anlegen des Test-Assistenten fehlgeschlagen").toBe(true);
  const created = (await createRes.json()) as { id: number; name: string };
  return { id: created.id, name: created.name };
}

async function ensureShiftModel(page: Page): Promise<void> {
  const listRes = await page.request.get("/api/shift-models?activeOnly=true");
  expect(listRes.ok(), "GET /api/shift-models fehlgeschlagen").toBe(true);
  const models = (await listRes.json()) as unknown[];
  if (models.length > 0) return;

  const createRes = await page.request.post("/api/shift-models", {
    data: { name: `E2E Modell ${Date.now()}` },
  });
  expect(createRes.ok(), "Anlegen des Test-Schichtmodells fehlgeschlagen").toBe(true);
}

async function createTemplate(
  page: Page,
  name: string,
  startTime: string,
  endTime: string,
  weekdays: number[],
): Promise<number> {
  const res = await page.request.post("/api/shift-templates", {
    data: { name, startTime, endTime, weekdays },
  });
  expect(res.ok(), `Anlegen der Vorlage "${name}" fehlgeschlagen (${res.status()})`).toBe(true);
  const created = (await res.json()) as { id: number };
  return created.id;
}

/** Löscht liegengebliebene Test-Vorlagen früherer (abgebrochener) Läufe. */
async function cleanupLeftoverTemplates(page: Page): Promise<void> {
  const res = await page.request.get("/api/shift-templates");
  if (!res.ok()) return;
  const templates = (await res.json()) as { id: number; name: string }[];
  for (const t of templates) {
    if (/^E2E (Passend|Unpassend) \d+$/.test(t.name)) {
      await page.request.delete(`/api/shift-templates/${t.id}`);
    }
  }
}

test.describe("ShiftDialog: Vorlagen-Wochentage", () => {
  test("gruppiert Vorlagen nach Datum und warnt bei unpassendem Wochentag", async ({ page }) => {
    test.setTimeout(90_000);
    await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await ensureAssistant(page);
    await ensureShiftModel(page);
    await cleanupLeftoverTemplates(page);

    const unique = Date.now();
    const templateIds: number[] = [];

    try {
      // Zielmonat = heute + 8 Monate (gleiche Navigation wie unten per UI);
      // Wochentag des Zieltags VOR dem Seitenaufruf berechnen, damit die
      // Vorlagen bereits existieren, wenn die Seite (und damit der
      // Template-Query-Cache) lädt.
      const target = new Date();
      target.setDate(1);
      target.setMonth(target.getMonth() + 8);
      const expectedYear = target.getFullYear();
      const expectedMonth = target.getMonth() + 1;

      // Fester Zieltag + sein Wochentag; die "unpassende" Vorlage bekommt
      // bewusst einen ANDEREN Wochentag, die "passende" genau diesen.
      const day = 16;
      const targetWeekday = isoWeekday(expectedYear, expectedMonth, day);
      const otherWeekday = (targetWeekday % 7) + 1;

      const matchName = `E2E Passend ${unique}`;
      const mismatchName = `E2E Unpassend ${unique}`;
      templateIds.push(await createTemplate(page, matchName, "07:15", "13:45", [targetWeekday]));
      templateIds.push(await createTemplate(page, mismatchName, "10:30", "18:20", [otherWeekday]));

      await page.goto("/dienstplan");
      await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();
      const mobile = page.getByTestId("dienstplan-mobile");
      await expect(mobile).toBeVisible();

      // Weit in die Zukunft navigieren (kollisionsfreier Monat).
      for (let i = 0; i < 8; i++) {
        await page.getByTestId("next-month").click();
      }
      const { year, month } = parseMonthLabel(
        await page.getByTestId("month-label").innerText(),
      );
      expect(year).toBe(expectedYear);
      expect(month).toBe(expectedMonth);

      // Tag auswählen und Dialog öffnen.
      const cell = mobile.getByTestId(`day-cell-${dateKey(year, month, day)}`);
      await cell.click();
      await mobile.getByTestId("add-shift").click();
      const dialog = page.getByTestId("shift-dialog");
      await expect(dialog).toBeVisible();

      // --- Gruppierung: passende Vorlage zuerst, unpassende separat --------
      await dialog.getByTestId("shift-dialog-template").click();
      await expect(page.getByText("Passend zum Datum")).toBeVisible();
      await expect(page.getByText("Andere Wochentage")).toBeVisible();
      // Die unpassende Vorlage zeigt ihre Wochentage im Eintrag.
      const mismatchOption = page.getByRole("option", { name: new RegExp(mismatchName) });
      await expect(mismatchOption).toBeVisible();

      // --- Unpassende Vorlage anwenden → Hinweis + Zeiten übernommen -------
      await mismatchOption.click();
      const hint = dialog.getByTestId("shift-dialog-template-mismatch");
      await expect(hint).toBeVisible();
      await expect(hint).toContainText("gilt nur");
      await expect(dialog.getByTestId("shift-dialog-start")).toHaveValue("10:30");
      await expect(dialog.getByTestId("shift-dialog-end")).toHaveValue("18:20");

      // --- Datum auf einen passenden Tag ändern → Hinweis verschwindet -----
      // day+1 hat genau otherWeekday (der Wochentag der unpassenden Vorlage).
      await dialog.getByTestId("shift-dialog-date").fill(dateKey(year, month, day + 1));
      await expect(hint).toHaveCount(0);

      // --- Passende Vorlage: kein Hinweis -----------------------------------
      // Zurück auf den Zieltag; die passende Vorlage anwenden.
      await dialog.getByTestId("shift-dialog-date").fill(dateKey(year, month, day));
      await dialog.getByTestId("shift-dialog-template").click();
      await page.getByRole("option", { name: new RegExp(matchName) }).click();
      await expect(dialog.getByTestId("shift-dialog-template-mismatch")).toHaveCount(0);
      await expect(dialog.getByTestId("shift-dialog-start")).toHaveValue("07:15");
      await expect(dialog.getByTestId("shift-dialog-end")).toHaveValue("13:45");
    } finally {
      // Aufräumen: Test-Vorlagen entfernen.
      for (const id of templateIds) {
        await page.request.delete(`/api/shift-templates/${id}`);
      }
    }
  });
});
