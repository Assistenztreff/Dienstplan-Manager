import { test, expect, type Page, type Locator } from "@playwright/test";
import { selectDayCell } from "./helpers/shifts";

/**
 * E2E-Test: Abwesenheiten erscheinen seit der HANDOFF-Entscheidung (05.08.2026)
 * NICHT mehr in den Kalenderzellen — weder als Balken im Monatsraster noch als
 * durchgehende Balken in der Tabellenansicht. Die Zellen zeigen nur noch Dienste.
 *
 * Gleichzeitig bleiben Abwesenheiten über die Tagesleiste unter dem Kalender
 * sichtbar, inkl. der neuen Filter-Leiste (Anzeigetyp: Alle/Dienste/Abwesenheiten,
 * Zeitraum: Heute/Diese Woche/Dieser Monat/Nächste 2 Monate).
 *
 * Ersetzt den früheren Balken-Test (AbsenceTableBar/absence-bar-Testids wurden
 * mit dem Feature entfernt).
 *
 * Deckt ab:
 * - Admin-Login über den echten Auth-Flow, Desktop-Viewport
 * - Mehrtägiger Urlaub (3 Tage) + Krank-Lauf (2 Tage) + regulärer Dienst via API
 * - Tabellenansicht: keine Abwesenheits-Badges in den Zellen, Dienst bleibt
 * - Monatsraster: keine absence-bar-Testids mehr vorhanden
 * - Tagesleiste: Abwesenheits-Badge sichtbar, Typfilter „Abwesenheiten"/„Dienste"
 *   und Zeitraumfilter „Dieser Monat" greifen
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";

// Desktop-Viewport: Tabellenansicht ist hier der Standard, Monatsraster umschaltbar.
test.use({ viewport: { width: 1280, height: 900 } });

const MONTHS_DE = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

type ApiShift = {
  id: number;
  userId: number;
  startTime: string;
  endTime: string;
  type: string;
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

/** "YYYY-MM-DD" für den n-ten Tag des angezeigten Monats. */
function dateKey(year: number, month: number, dayOfMonth: number): string {
  const mm = String(month).padStart(2, "0");
  const dd = String(dayOfMonth).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function localIso(dateStr: string, time: string): string {
  return new Date(`${dateStr}T${time}`).toISOString();
}

async function loginAsAdmin(page: Page): Promise<void> {
  // Programmatische Anmeldung über die API: page.request teilt den Cookie-Jar
  // mit dem Browser, dadurch ist /api/auth/me beim ersten Laden sofort 200 und
  // der Vite-Dev-Auto-Login greift nie (dev- UND prod-tauglich).
  const res = await page.request.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(res.ok(), `Admin-Login fehlgeschlagen (${res.status()})`).toBe(true);
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
}

/** Legt einen dedizierten Test-Assistenten an (kollisionsfrei). */
async function createAssistant(page: Page): Promise<{ id: number; name: string }> {
  const unique = Date.now();
  const res = await page.request.post("/api/users", {
    data: {
      name: `E2E Zellen ${unique}`,
      email: `e2e.zellen.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(res.ok(), `Anlegen des Test-Assistenten fehlgeschlagen (${res.status()})`).toBe(true);
  return (await res.json()) as { id: number; name: string };
}

async function createShift(
  page: Page,
  data: { userId: number; dateStr: string; from: string; to: string; type: string },
): Promise<ApiShift> {
  const res = await page.request.post("/api/shifts", {
    data: {
      userId: data.userId,
      startTime: localIso(data.dateStr, data.from),
      endTime: localIso(data.dateStr, data.to),
      type: data.type,
      shiftModelId: null,
    },
  });
  expect(
    res.ok(),
    `POST /api/shifts (${data.type} ${data.dateStr}) fehlgeschlagen: ${res.status()} ${await res.text()}`,
  ).toBe(true);
  return (await res.json()) as ApiShift;
}

test("Abwesenheiten erscheinen nicht mehr in Kalenderzellen, aber in der Tagesleiste mit Filtern", async ({
  page,
}) => {
  await loginAsAdmin(page);
  const assistant = await createAssistant(page);
  const createdShiftIds: number[] = [];

  try {
    await page.goto("/dienstplan");
    await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();
    const desktop = page.getByTestId("dienstplan-desktop");
    await expect(desktop).toBeVisible();
    // Tabellenansicht ist auf dem Desktop der Standard.
    await expect(
      page.getByTestId("view-toggles-desktop").getByTestId("view-toggle-table"),
    ).toHaveAttribute("data-active", "true");

    const { year, month } = parseMonthLabel(
      await page.getByTestId("month-label").innerText(),
    );

    const vacationDays = [6, 7, 8];
    const sickDays = [20, 21];
    const vacation: ApiShift[] = [];
    for (const d of vacationDays) {
      const s = await createShift(page, {
        userId: assistant.id,
        dateStr: dateKey(year, month, d),
        from: "00:00:00",
        to: "23:59:59",
        type: "vacation",
      });
      vacation.push(s);
      createdShiftIds.push(s.id);
    }
    const sick: ApiShift[] = [];
    for (const d of sickDays) {
      const s = await createShift(page, {
        userId: assistant.id,
        dateStr: dateKey(year, month, d),
        from: "00:00:00",
        to: "23:59:59",
        type: "sick",
      });
      sick.push(s);
      createdShiftIds.push(s.id);
    }
    // Kontroll-Dienst: muss in den Zellen sichtbar bleiben.
    const work = await createShift(page, {
      userId: assistant.id,
      dateStr: dateKey(year, month, 10),
      from: "09:00:00",
      to: "17:00:00",
      type: "active",
    });
    createdShiftIds.push(work.id);

    await page.reload();
    await expect(desktop).toBeVisible();

    // --- Tabellenansicht: Abwesenheiten NICHT mehr in den Zellen -----------
    for (const s of [...vacation, ...sick]) {
      await expect(
        desktop.getByTestId(`shift-badge-${s.id}`),
        `Abwesenheit ${s.id} darf nicht in der Tabellenzelle erscheinen`,
      ).toHaveCount(0);
    }
    // Kontrolle: Der reguläre Dienst ist weiterhin in der Zelle sichtbar.
    await expect(desktop.getByTestId(`shift-badge-${work.id}`)).toBeVisible();

    // --- Monatsraster: keine absence-bar-Testids mehr ----------------------
    await page.getByTestId("view-toggles-desktop").getByTestId("view-toggle-grid").click();
    await expect(
      page.getByTestId("view-toggles-desktop").getByTestId("view-toggle-grid"),
    ).toHaveAttribute("data-active", "true");
    await expect(desktop.getByTestId("month-grid")).toBeVisible();
    await expect(desktop.locator('[data-testid^="absence-bar-"]')).toHaveCount(0);

    // --- Tagesleiste: Abwesenheit bleibt sichtbar --------------------------
    // Urlaubstag anklicken (Tag hat nur eine Abwesenheit → gilt als „leer",
    // der Helper schließt den sich öffnenden Anlage-Dialog per Escape).
    await selectDayCell(
      page,
      desktop.getByTestId(`day-cell-${dateKey(year, month, vacationDays[0])}`),
    );
    const dayPanel = desktop.getByTestId("day-detail-panel");
    const vacBadge = dayPanel.getByTestId(`shift-badge-${vacation[0]!.id}`);
    await expect(vacBadge).toBeVisible();
    await expect(vacBadge).toContainText("Urlaub");

    // Typfilter „Abwesenheiten": Badge bleibt.
    await dayPanel.getByTestId("day-detail-type-menu").click();
    await page.getByRole("option", { name: "Abwesenheiten" }).click();
    await expect(vacBadge).toBeVisible();

    // Typfilter „Dienste": Urlaub verschwindet aus der Liste.
    await dayPanel.getByTestId("day-detail-type-menu").click();
    await page.getByRole("option", { name: "Dienste" }).click();
    await expect(vacBadge).toHaveCount(0);
    await expect(dayPanel.getByText("Keine Dienste geplant").first()).toBeVisible();

    // Zurück auf „Alle" + Zeitraum „Dieser Monat": alle 5 Abwesenheits-Tage
    // (3 Urlaub + 2 Krank) erscheinen mit Datumsprefix in der Liste.
    await dayPanel.getByTestId("day-detail-type-menu").click();
    await page.getByRole("option", { name: "Alle" }).click();
    await dayPanel.getByTestId("day-detail-range-menu").click();
    await page.getByRole("option", { name: "Dieser Monat" }).click();
    for (const s of [...vacation, ...sick]) {
      await expect(dayPanel.getByTestId(`shift-badge-${s.id}`)).toBeVisible();
    }

    // --- Menüleiste oben (Task #710) ---------------------------------------
    // Beide Dropdowns + Datum + „Dienst anlegen" sind in der Kopfzeile sichtbar.
    const menu = dayPanel.getByTestId("day-detail-menu");
    await expect(menu.getByTestId("day-detail-type-menu")).toBeVisible();
    await expect(menu.getByTestId("day-detail-range-menu")).toBeVisible();
    await expect(menu.getByTestId("day-detail-header")).toBeVisible();
    await expect(menu.getByTestId("add-shift")).toBeVisible();

    // Zeiträume über einen Tag gruppieren die Liste nach Datum (Tagesüberschriften).
    await expect(
      dayPanel.getByTestId(`day-detail-group-${dateKey(year, month, vacationDays[0]!)}`),
      "Zeitraum Dieser Monat muss Tagesüberschriften gruppieren",
    ).toBeVisible();

    // Zeitraum über die Menüleiste zurück auf „Heute": nur der gewählte Tag bleibt.
    await menu.getByTestId("day-detail-range-menu").click();
    await page.getByRole("option", { name: "Heute" }).click();
    await expect(vacBadge).toBeVisible();
    await expect(dayPanel.getByTestId(`shift-badge-${sick[0]!.id}`)).toHaveCount(0);

    // Die doppelte Filterzeile unten ist entfernt (Nutzerkorrektur): die
    // Menüleiste oben ist die einzige Steuerung, kein zweites Dropdown-Paar.
    await expect(dayPanel.getByTestId("day-detail-filters")).toHaveCount(0);
    await expect(dayPanel.getByTestId("day-detail-type-filter")).toHaveCount(0);
    await expect(dayPanel.getByTestId("day-detail-range-filter")).toHaveCount(0);

    // Typfilter über die Menüleiste: Auswahl wirkt auf die Liste und wird
    // am Trigger angezeigt.
    await menu.getByTestId("day-detail-type-menu").click();
    await page.getByRole("option", { name: "Dienste" }).click();
    await expect(vacBadge).toHaveCount(0);
    await expect(menu.getByTestId("day-detail-type-menu")).toContainText("Dienste");
    await menu.getByTestId("day-detail-type-menu").click();
    await page.getByRole("option", { name: "Abwesenheiten" }).click();
    await expect(vacBadge).toBeVisible();
    await expect(menu.getByTestId("day-detail-type-menu")).toContainText("Abwesenheiten");
  } finally {
    for (const id of createdShiftIds) {
      await page.request.delete(`/api/shifts/${id}`);
    }
    await page.request.delete(`/api/users/${assistant.id}`);
  }
});
