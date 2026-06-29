import { test, expect, type Page, type Locator } from "@playwright/test";

/**
 * E2E-Test: Eine mehrtägige Abwesenheit, die über die Monatsgrenze läuft
 * (letzte Tage eines Monats → erste Tage des Folgemonats), wird in BEIDER
 * Monatsansicht korrekt als jeweils sauber gekappter Teil-Balken dargestellt.
 *
 * Hintergrund: Der Kalender lädt und rendert nur den aktuell sichtbaren Monat
 * (`eachDayOfInterval(start..end)`, `useListShifts({month, year})`). Start-/
 * End-Kappen werden gegen die Nachbar-Tage IM sichtbaren `days`-Array berechnet
 * (`days[dayIdx-1]` / `days[dayIdx+1]`). Am Monatsrand sind diese Nachbarn
 * `undefined` → der Randtag bekommt eine geschlossene Kappe. So wird die
 * Abwesenheit in jedem Monat unabhängig am Monatsrand gekappt, während die
 * Verbindung zwischen den sichtbaren Tagen erhalten bleibt; der Typ-Name
 * erscheint erneut am Start jedes sichtbaren Segments. Eine künftige Änderung
 * an dieser Rand-Logik (z. B. ein versehentlich offener Rand oder eine
 * zerbrochene Verbindung am Monatsanfang/-ende) würde diesen Test brechen.
 *
 * Deckt ab:
 * - Admin-Login über den echten Auth-Flow, Desktop-Tabellenansicht (Standard)
 * - Urlaub über die Monatsgrenze: 2 Tage Monatsende + 2 Tage Folgemonat (API)
 * - Monatsende-Ansicht: vorletzter Tag = linke Kappe + Verbindung nach rechts,
 *   letzter Tag = geschlossene rechte Kappe (Monatsrand) + Verbindung nach links
 * - Folgemonat-Ansicht (per Monatsnavigation): erster Tag = geschlossene linke
 *   Kappe (Monatsrand) + erneuter Typ-Name + Verbindung nach rechts,
 *   zweiter Tag = rechte Kappe + Verbindung nach links
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";

// Desktop-Viewport: nur hier rendert die Tabelle mit den AbsenceTableBar-Segmenten
// (md:block). Die mobile Ansicht nutzt stattdessen Punkte/Balken ohne Testids.
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

/** "YYYY-MM-DD" für einen Tag eines (1-basierten) Monats. */
function dateKey(year: number, month: number, dayOfMonth: number): string {
  const mm = String(month).padStart(2, "0");
  const dd = String(dayOfMonth).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/** Anzahl Tage eines (1-basierten) Monats. */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Folgemonat (1-basiert), mit Jahresübertrag. */
function nextMonthOf(year: number, month: number): { year: number; month: number } {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
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
  // In Vite-DEV loggt die App automatisch als Dev-Admin ein und leitet sofort
  // auf "/" um — das Anmeldeformular rendert dann nie. Im Prod-Build
  // (Validierung) erscheint das Formular. Beide Wege führen zum selben Admin.
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
      name: `E2E Monatsrand ${unique}`,
      email: `e2e.boundary.${unique}@dienstplan.test`,
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

test("Abwesenheit über die Monatsgrenze: jeder Monat zeigt den korrekt gekappten Teil-Balken", async ({
  page,
}) => {
  await loginAsAdmin(page);
  const assistant = await createAssistant(page);
  const createdShiftIds: number[] = [];

  try {
    const desktop = await openDesktopCalendar(page);

    // Aktuell angezeigten Monat als "Monat A" verwenden; Folgemonat = "Monat B".
    const a = parseMonthLabel(await page.getByTestId("month-label").innerText());
    const b = nextMonthOf(a.year, a.month);

    const lastA = daysInMonth(a.year, a.month);
    // Lauf: vorletzter + letzter Tag von Monat A → erste zwei Tage von Monat B.
    const aPenultimate = lastA - 1;
    const aLast = lastA;
    const bFirst = 1;
    const bSecond = 2;

    // Alle vier Tage als gleichartige Abwesenheit (Urlaub) derselben Person =
    // EIN logischer, durchgehender Lauf über die Monatsgrenze.
    const aPenultimateShift = await createAbsenceDay(page, {
      userId: assistant.id,
      dateStr: dateKey(a.year, a.month, aPenultimate),
      type: "vacation",
    });
    const aLastShift = await createAbsenceDay(page, {
      userId: assistant.id,
      dateStr: dateKey(a.year, a.month, aLast),
      type: "vacation",
    });
    const bFirstShift = await createAbsenceDay(page, {
      userId: assistant.id,
      dateStr: dateKey(b.year, b.month, bFirst),
      type: "vacation",
    });
    const bSecondShift = await createAbsenceDay(page, {
      userId: assistant.id,
      dateStr: dateKey(b.year, b.month, bSecond),
      type: "vacation",
    });
    createdShiftIds.push(
      aPenultimateShift.id,
      aLastShift.id,
      bFirstShift.id,
      bSecondShift.id,
    );

    // Neu laden, damit die frisch angelegten Abwesenheiten erscheinen.
    await page.reload();
    await expect(desktop).toBeVisible();

    const badge = (id: number): Locator => desktop.getByTestId(`shift-badge-${id}`);

    // --- Monat A (Monatsende) --------------------------------------------
    // Sichtbarer Lauf in Monat A: vorletzter + letzter Tag.
    await expect(badge(aPenultimateShift.id)).toBeVisible();
    await expect(badge(aLastShift.id)).toBeVisible();

    // Typ-Name genau einmal: am sichtbaren Start (vorletzter Tag).
    await expect(badge(aPenultimateShift.id)).toHaveText("Urlaub");
    await expect(badge(aLastShift.id)).toHaveText("");

    // Vorletzter Tag = linke Kappe + Verbindung nach rechts (kein rechter Rand).
    await expect(badge(aPenultimateShift.id)).toHaveClass(/rounded-l/);
    await expect(badge(aPenultimateShift.id)).not.toHaveClass(/rounded-r/);
    await expect(badge(aPenultimateShift.id)).not.toHaveClass(/-ml-/);
    await expect(badge(aPenultimateShift.id)).toHaveClass(/-mr-/);

    // Letzter Tag = geschlossene rechte Kappe AM MONATSRAND (Folgetag liegt
    // außerhalb des sichtbaren Monats → undefined → isEnd=true), verbunden nach
    // links. Der Balken setzt sich in Monat B fort, wird hier aber gekappt.
    await expect(badge(aLastShift.id)).toHaveClass(/rounded-r/);
    await expect(badge(aLastShift.id)).not.toHaveClass(/rounded-l/);
    await expect(badge(aLastShift.id)).toHaveClass(/-ml-/);
    await expect(badge(aLastShift.id)).not.toHaveClass(/-mr-/);

    // --- Zum Folgemonat (Monat B) navigieren -----------------------------
    await page.getByTestId("next-month").click();
    await expect(page.getByTestId("month-label")).toHaveText(
      `${MONTHS_DE[b.month - 1]} ${b.year}`,
    );

    // --- Monat B (Monatsanfang) ------------------------------------------
    await expect(badge(bFirstShift.id)).toBeVisible();
    await expect(badge(bSecondShift.id)).toBeVisible();
    // Die Tage aus Monat A sind hier nicht mehr gerendert.
    await expect(badge(aLastShift.id)).toHaveCount(0);

    // Typ-Name erscheint ERNEUT am Start des sichtbaren Segments (erster Tag).
    await expect(badge(bFirstShift.id)).toHaveText("Urlaub");
    await expect(badge(bSecondShift.id)).toHaveText("");

    // Erster Tag = geschlossene linke Kappe AM MONATSRAND (Vortag außerhalb des
    // sichtbaren Monats → undefined → isStart=true), verbunden nach rechts.
    await expect(badge(bFirstShift.id)).toHaveClass(/rounded-l/);
    await expect(badge(bFirstShift.id)).not.toHaveClass(/rounded-r/);
    await expect(badge(bFirstShift.id)).not.toHaveClass(/-ml-/);
    await expect(badge(bFirstShift.id)).toHaveClass(/-mr-/);

    // Zweiter Tag = rechte Kappe (echtes Lauf-Ende), verbunden nach links.
    await expect(badge(bSecondShift.id)).toHaveClass(/rounded-r/);
    await expect(badge(bSecondShift.id)).not.toHaveClass(/rounded-l/);
    await expect(badge(bSecondShift.id)).toHaveClass(/-ml-/);
    await expect(badge(bSecondShift.id)).not.toHaveClass(/-mr-/);
  } finally {
    for (const id of createdShiftIds) {
      await page.request.delete(`/api/shifts/${id}`);
    }
    await page.request.delete(`/api/users/${assistant.id}`);
  }
});
