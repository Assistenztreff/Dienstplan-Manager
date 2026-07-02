import { test, expect, type Page } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";

/**
 * E2E-Test: Gezieltes Massen-Löschen pro Assistent löscht NUR dessen Einträge.
 *
 * Der BulkDeleteDialog kann die Löschung über das Select `bulk-delete-user`
 * auf eine einzelne Person einschränken ("Alle Assistenten" vs. konkreter
 * Assistent). Eine Regression in diesem Filter würde versehentlich fremde
 * Dienste an denselben Tagen vernichten — dieser Test fängt genau das ab.
 *
 * Deckt ab:
 * - An denselben zwei Tagen existieren Schichten von ZWEI Assistenten
 *   (je zwei, per API angelegt).
 * - Auswahl-Modus aktivieren, beide Tage wählen, BulkDeleteDialog öffnen.
 * - Assistent A über `bulk-delete-user` wählen → `bulk-delete-count` zeigt
 *   nur DESSEN Anzahl (2 Einträge), nicht die aller Assistenten.
 * - Nach `bulk-delete-confirm`: A's Schichten sind weg (API), B's Schichten
 *   bleiben vollständig erhalten (API + Badges im Kalender).
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";

// Desktop-Viewport: der Auswahl-Modus über klickbare Spalten-Header
// (col-header-*) existiert nur in der Tabellenansicht (md:block).
test.use({ viewport: { width: 1280, height: 900 } });

const MONTHS_DE = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

type ApiShift = {
  id: number;
  userId: number;
  startTime: string;
};

/** Parst das Label "MMMM yyyy" (z. B. "Juni 2026") in Jahr und 1-basierten Monat. */
function parseMonthLabel(text: string): { year: number; month: number } {
  const parts = text.trim().split(/\s+/);
  const monthIndex = MONTHS_DE.indexOf(parts[0]);
  const year = Number(parts[1]);
  expect(monthIndex, `Unbekannter Monatsname in "${text}"`).toBeGreaterThanOrEqual(0);
  expect(Number.isFinite(year), `Ungültiges Jahr in "${text}"`).toBe(true);
  return { year, month: monthIndex + 1 };
}

/** "YYYY-MM-DD" für den n-ten Tag des Monats. */
function dateKey(year: number, month: number, dayOfMonth: number): string {
  const mm = String(month).padStart(2, "0");
  const dd = String(dayOfMonth).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/** Legt einen dedizierten Test-Assistenten an (kollisionsfrei benannt). */
async function createAssistant(page: Page, suffix: string): Promise<{ id: number; name: string }> {
  const unique = Date.now();
  const res = await page.request.post("/api/users", {
    data: {
      name: `E2E DelFilter ${suffix} ${unique}`,
      email: `e2e.delfilter.${suffix.toLowerCase()}.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(res.ok(), `Anlegen des Test-Assistenten ${suffix} fehlgeschlagen (${res.status()})`).toBe(true);
  return (await res.json()) as { id: number; name: string };
}

/**
 * Legt eine Schicht per API an. Die Uhrzeiten werden als LOKALE Zeit gesendet
 * (ohne "Z"), damit der Tag-Schlüssel des Dialogs (lokale Zeitzone) sicher auf
 * denselben Kalendertag fällt.
 */
async function createShift(
  page: Page,
  userId: number,
  day: string,
  startHour: string,
  endHour: string,
): Promise<number> {
  const res = await page.request.post("/api/shifts", {
    data: {
      userId,
      startTime: new Date(`${day}T${startHour}:00`).toISOString(),
      endTime: new Date(`${day}T${endHour}:00`).toISOString(),
      type: "active",
    },
  });
  expect(res.ok(), `Anlegen der Schicht (${day}, User ${userId}) fehlgeschlagen (${res.status()})`).toBe(true);
  return ((await res.json()) as { id: number }).id;
}

/** Holt alle Schichten eines Monats für genau diesen Assistenten. */
async function shiftsForAssistant(
  page: Page,
  year: number,
  month: number,
  userId: number,
): Promise<ApiShift[]> {
  const res = await page.request.get(`/api/shifts?month=${month}&year=${year}`);
  expect(res.ok(), `GET /api/shifts fehlgeschlagen (${res.status()})`).toBe(true);
  const all = (await res.json()) as ApiShift[];
  return all.filter((s) => s.userId === userId);
}

test("Gezieltes Löschen pro Assistent entfernt nur dessen Einträge", async ({ page }) => {
  // Mehrstufiger Flow (2 Assistenten + 4 Schichten + UI-Dialog) — unter
  // Volllast der Gesamtsuite großzügig bemessen.
  test.setTimeout(90000);

  await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);

  const assistantA = await createAssistant(page, "A");
  const assistantB = await createAssistant(page, "B");
  const cleanupShiftIds: number[] = [];

  try {
    // Kalender öffnen und den angezeigten Monat ermitteln (aktueller Monat —
    // vermeidet Free-Plan-Grenzen für die Vorausplanung).
    await page.goto("/dienstplan");
    await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();
    const desktop = page.getByTestId("dienstplan-desktop");
    await expect(desktop).toBeVisible();
    await expect(desktop.getByTestId("view-toggle-table")).toHaveAttribute("data-active", "true");

    const { year, month } = parseMonthLabel(
      await page.getByTestId("month-label").innerText(),
    );

    // An denselben zwei Tagen je eine Schicht für BEIDE Assistenten anlegen.
    // (Dedizierte frische Assistenten → keine Überschneidungen mit Bestand.)
    const days = [6, 7];
    const shiftIdsA: number[] = [];
    const shiftIdsB: number[] = [];
    for (const d of days) {
      const key = dateKey(year, month, d);
      shiftIdsA.push(await createShift(page, assistantA.id, key, "08:00", "12:00"));
      shiftIdsB.push(await createShift(page, assistantB.id, key, "13:00", "17:00"));
    }
    cleanupShiftIds.push(...shiftIdsA, ...shiftIdsB);

    // Kalender neu laden, damit die per API angelegten Schichten geladen sind;
    // alle vier Badges müssen sichtbar sein.
    await page.reload();
    await expect(desktop).toBeVisible();
    for (const id of [...shiftIdsA, ...shiftIdsB]) {
      await expect(desktop.getByTestId(`shift-badge-${id}`)).toBeVisible();
    }

    // --- Auswahl-Modus aktivieren und beide Tage wählen --------------------
    await page.getByTestId("toggle-selection-mode").click();
    for (const d of days) {
      const header = page.getByTestId(`col-header-${dateKey(year, month, d)}`);
      await header.click();
      await expect(header).toHaveAttribute("data-selected", "true");
    }
    await expect(page.getByTestId("bulk-selected-count")).toHaveText("2 Tage ausgewählt");

    // --- BulkDeleteDialog: auf Assistent A einschränken --------------------
    await page.getByTestId("bulk-delete-open").click();
    const delDialog = page.getByTestId("bulk-delete-dialog");
    await expect(delDialog).toBeVisible();

    await delDialog.getByTestId("bulk-delete-user").click();
    await page.getByRole("option", { name: assistantA.name }).first().click();

    // Der Zähler zeigt NUR die Einträge von Assistent A (2), nicht alle (4).
    await expect(delDialog.getByTestId("bulk-delete-count")).toContainText("2");
    await expect(delDialog.getByTestId("bulk-delete-count")).toContainText("Einträge");
    await expect(delDialog.getByTestId("bulk-delete-count")).not.toContainText("4");

    await delDialog.getByTestId("bulk-delete-confirm").click();

    // Dialog schließt; Auswahl geleert, Modus beendet.
    await expect(delDialog).toHaveCount(0);
    await expect(page.getByTestId("bulk-action-bar")).toHaveCount(0);

    // --- Verifikation: nur A's Schichten sind weg ---------------------------
    // API: Assistent A hat keine Schichten mehr in diesem Monat.
    await expect
      .poll(async () => (await shiftsForAssistant(page, year, month, assistantA.id)).length, {
        message: "Die Schichten von Assistent A wurden nicht gelöscht",
      })
      .toBe(0);

    // API: Assistent B hat weiterhin exakt seine zwei Schichten.
    const remainingB = await shiftsForAssistant(page, year, month, assistantB.id);
    expect(
      remainingB.map((s) => s.id).sort((a, b) => a - b),
      "Die Schichten von Assistent B müssen unangetastet bleiben",
    ).toEqual([...shiftIdsB].sort((a, b) => a - b));

    // UI: A's Badges sind verschwunden, B's Badges weiterhin sichtbar.
    for (const id of shiftIdsA) {
      await expect(desktop.getByTestId(`shift-badge-${id}`)).toHaveCount(0);
    }
    for (const id of shiftIdsB) {
      await expect(desktop.getByTestId(`shift-badge-${id}`)).toBeVisible();
    }
  } finally {
    // Aufräumen: übrig gebliebene Schichten und beide Test-Assistenten löschen.
    for (const id of cleanupShiftIds) {
      await page.request.delete(`/api/shifts/${id}`);
    }
    await page.request.delete(`/api/users/${assistantA.id}`);
    await page.request.delete(`/api/users/${assistantB.id}`);
  }
});
