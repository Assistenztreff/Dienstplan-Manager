import { test, expect, type Page, type Locator } from "@playwright/test";

/**
 * E2E-Test: Mehrtägige Abwesenheiten werden in der Desktop-Tabelle als EIN
 * durchgehender Balken dargestellt — mit Typ-Namen genau einmal (am Anfang),
 * sauberen Start-/End-Kappen und korrekt verbundenen Mittel-Tagen.
 *
 * Hintergrund: Jeder Tag einer Abwesenheit ist ein eigener Datensatz. Die
 * Segmente (AbsenceTableBar) werden über negative Ränder optisch zu einem
 * Balken verbunden; der Typ-Name (z. B. "Urlaub") erscheint nur am Starttag.
 * Eine künftige Änderung an Zell-Padding, Grid-Lücken oder der Abwesenheits-
 * Verknüpfung könnte diese Balken-Verbindung oder die Start/End-Kappen
 * unbemerkt zerstören — dieser Test schlägt dann fehl.
 *
 * Deckt ab:
 * - Admin-Login über den echten Auth-Flow, Desktop-Tabellenansicht (Standard)
 * - Mehrtägiger Urlaub (3 Tage) + separater Krank-Lauf (2 Tage) via API
 * - Genau EIN beschrifteter Balken pro Lauf: Typ-Name nur am Starttag,
 *   Mittel-/End-Tage ohne Text
 * - Start-Tag = linke Kappe (rounded-l, keine linke Verbindung)
 * - End-Tag = rechte Kappe (rounded-r, keine rechte Verbindung)
 * - Mittel-Tag = beidseitig verbunden (negative Ränder, keine Rundung)
 * - Klick auf ein Balken-Segment öffnet den Bearbeiten-Dialog für GENAU
 *   diesen Tag (Datum stimmt)
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";

// Desktop-Viewport: nur hier wird die Tabelle mit den AbsenceTableBar-Segmenten
// gerendert (md:block). Die mobile Ansicht (md:hidden) nutzt stattdessen
// Punkte/Balken ohne shift-badge-Testids.
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

/**
 * Erzeugt eine ISO-Zeit aus Datum + Ortszeit. Spiegelt die Speicherweise der
 * App (lokale Zeit → toISOString), damit isSameDay im Browser exakt greift.
 */
function localIso(dateStr: string, time: string): string {
  return new Date(`${dateStr}T${time}`).toISOString();
}

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/login");
  // In Vite-DEV loggt die App automatisch als Dev-Admin ein (POST
  // /api/auth/dev-login bei 401) und leitet sofort auf "/" um — das
  // Anmeldeformular rendert dann nie. Im Prod-Build (Validierung) gibt es kein
  // Auto-Login, also erscheint das Formular. Beide Wege führen zum selben Admin
  // (admin@dienstplan.local).
  const emailField = page.locator("#email");
  const formVisible = await emailField
    .waitFor({ state: "visible", timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (formVisible) {
    await emailField.fill(ADMIN_EMAIL);
    await page.locator("#password").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Anmelden" }).click();
  }
  await expect(page).toHaveURL(/\/$/);
}

/** Legt einen dedizierten Test-Assistenten an (kollisionsfrei). */
async function createAssistant(page: Page): Promise<{ id: number; name: string }> {
  const unique = Date.now();
  const res = await page.request.post("/api/users", {
    data: {
      name: `E2E Balken ${unique}`,
      email: `e2e.bar.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(res.ok(), `Anlegen des Test-Assistenten fehlgeschlagen (${res.status()})`).toBe(true);
  return (await res.json()) as { id: number; name: string };
}

/** Legt eine ganztägige Abwesenheit (ein Tag = ein Datensatz) via API an. */
async function createAbsenceDay(
  page: Page,
  data: { userId: number; dateStr: string; type: "vacation" | "sick" },
): Promise<ApiShift> {
  const res = await page.request.post("/api/shifts", {
    data: {
      userId: data.userId,
      startTime: localIso(data.dateStr, "00:00:00"),
      endTime: localIso(data.dateStr, "23:59:59"),
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

async function openDesktopCalendar(page: Page): Promise<Locator> {
  await page.goto("/dienstplan");
  await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();
  const desktop = page.getByTestId("dienstplan-desktop");
  await expect(desktop).toBeVisible();
  // Tabellenansicht ist auf dem Desktop der Standard.
  await expect(desktop.getByTestId("view-toggle-table")).toHaveAttribute("data-active", "true");
  return desktop;
}

test("Mehrtägige Abwesenheiten bilden einen durchgehenden, einmal beschrifteten Balken", async ({
  page,
}) => {
  await loginAsAdmin(page);
  const assistant = await createAssistant(page);
  const createdShiftIds: number[] = [];

  try {
    const desktop = await openDesktopCalendar(page);

    // Aktuell angezeigten Monat verwenden — keine langsame Monatsnavigation.
    const { year, month } = parseMonthLabel(
      await page.getByTestId("month-label").innerText(),
    );

    // Zwei getrennte Läufe in unterschiedlichen Bereichen des Monats, damit sie
    // sich nicht berühren und jeweils eigene Start-/End-Kappen haben.
    const vacationDays = [6, 7, 8]; // 3-tägiger Urlaub
    const sickDays = [20, 21]; // 2-tägiger Krank-Lauf

    const vacation: ApiShift[] = [];
    for (const d of vacationDays) {
      const s = await createAbsenceDay(page, {
        userId: assistant.id,
        dateStr: dateKey(year, month, d),
        type: "vacation",
      });
      vacation.push(s);
      createdShiftIds.push(s.id);
    }

    const sick: ApiShift[] = [];
    for (const d of sickDays) {
      const s = await createAbsenceDay(page, {
        userId: assistant.id,
        dateStr: dateKey(year, month, d),
        type: "sick",
      });
      sick.push(s);
      createdShiftIds.push(s.id);
    }

    // Neu laden, damit die frisch angelegten Abwesenheiten im Kalender erscheinen.
    await page.reload();
    await expect(desktop).toBeVisible();

    const badge = (id: number): Locator => desktop.getByTestId(`shift-badge-${id}`);

    // --- Urlaub: 3-tägiger Balken -----------------------------------------
    const [vStart, vMid, vEnd] = vacation;
    await expect(badge(vStart.id)).toBeVisible();
    await expect(badge(vMid.id)).toBeVisible();
    await expect(badge(vEnd.id)).toBeVisible();

    // Typ-Name erscheint GENAU EINMAL — nur am Starttag.
    await expect(badge(vStart.id)).toHaveText("Urlaub");
    await expect(badge(vMid.id)).toHaveText("");
    await expect(badge(vEnd.id)).toHaveText("");

    // Start-Tag = linke Kappe (rounded-l), keine linke Verbindung.
    await expect(badge(vStart.id)).toHaveClass(/rounded-l/);
    await expect(badge(vStart.id)).not.toHaveClass(/rounded-r/);
    await expect(badge(vStart.id)).not.toHaveClass(/-ml-/);
    // End-Tag = rechte Kappe (rounded-r), keine rechte Verbindung.
    await expect(badge(vEnd.id)).toHaveClass(/rounded-r/);
    await expect(badge(vEnd.id)).not.toHaveClass(/rounded-l/);
    await expect(badge(vEnd.id)).not.toHaveClass(/-mr-/);
    // Mittel-Tag = beidseitig verbunden (negative Ränder, keine Rundung).
    await expect(badge(vMid.id)).toHaveClass(/-ml-/);
    await expect(badge(vMid.id)).toHaveClass(/-mr-/);
    await expect(badge(vMid.id)).not.toHaveClass(/rounded-l/);
    await expect(badge(vMid.id)).not.toHaveClass(/rounded-r/);

    // --- Krank: 2-tägiger Balken ------------------------------------------
    const [sStart, sEnd] = sick;
    await expect(badge(sStart.id)).toHaveText("Krankheit");
    await expect(badge(sEnd.id)).toHaveText("");
    // Start = linke Kappe, End = rechte Kappe; bei nur zwei Tagen gibt es keinen
    // Mittel-Tag, beide Segmente sind aber zur Mitte hin verbunden.
    await expect(badge(sStart.id)).toHaveClass(/rounded-l/);
    await expect(badge(sStart.id)).not.toHaveClass(/rounded-r/);
    await expect(badge(sEnd.id)).toHaveClass(/rounded-r/);
    await expect(badge(sEnd.id)).not.toHaveClass(/rounded-l/);

    // --- Klick öffnet den Bearbeiten-Dialog für GENAU diesen Tag ----------
    // Mittel-Tag des Urlaubs anklicken: Dialog muss exakt dessen Datum zeigen.
    await badge(vMid.id).click();
    const editDialog = page.getByTestId("shift-dialog");
    await expect(editDialog).toBeVisible();
    await expect(editDialog.getByText("Schicht bearbeiten")).toBeVisible();
    await expect(editDialog.getByTestId("shift-dialog-date")).toHaveValue(
      dateKey(year, month, vacationDays[1]),
    );

    // Dialog schließen (Escape) und Gegenprobe mit dem End-Tag des Krank-Laufs.
    await page.keyboard.press("Escape");
    await expect(editDialog).toHaveCount(0);

    await badge(sEnd.id).click();
    const editDialog2 = page.getByTestId("shift-dialog");
    await expect(editDialog2).toBeVisible();
    await expect(editDialog2.getByTestId("shift-dialog-date")).toHaveValue(
      dateKey(year, month, sickDays[1]),
    );
  } finally {
    for (const id of createdShiftIds) {
      await page.request.delete(`/api/shifts/${id}`);
    }
    await page.request.delete(`/api/users/${assistant.id}`);
  }
});
