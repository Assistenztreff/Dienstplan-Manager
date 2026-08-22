import { test, expect, type Page } from "@playwright/test";
import { TeamTestHarness } from "./helpers/teams";
import { startSelectionMode } from "./helpers/header";

/**
 * UI-Pendant zu Task #869 (API-only abgesichert in
 * dienstplan-massen-dienstart-wechsel-api.spec.ts): Ein echter Klick-Test für
 * den Massen-Modellwechsel-Dialog (`bulk-edit-dialog.tsx`).
 *
 * Bug-Hintergrund (#869): Ein reiner Schichtmodell-Wechsel über die
 * Massenbearbeitung sendet je Schicht `PATCH { type: "work", shiftModelId,
 * force: true }` OHNE explizites `planningStatus`. Vor dem Fix fiel eine
 * bereits bestätigte (FIX) Schicht dadurch fälschlich auf ANGEBOTEN zurück
 * und verschwand aus der Stunden-Bilanz. Dieser Test bildet den Bug-Pfad
 * über die echte UI nach (Mehrfachauswahl → "Einträge ändern" → Dienst
 * ändern → Speichern) und prüft direkt am Backend, dass die Schichten FIX
 * bleiben und weiterhin in der Stunden-Bilanz auftauchen.
 */

const MONTHS_DE = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

function dateKey(year: number, month: number, dayOfMonth: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(dayOfMonth).padStart(2, "0")}`;
}

function parseMonthLabel(text: string): { year: number; month: number } {
  const parts = text.trim().split(/\s+/);
  const monthIndex = MONTHS_DE.indexOf(parts[0]);
  const year = Number(parts[1]);
  expect(monthIndex, `Unbekannter Monatsname in "${text}"`).toBeGreaterThanOrEqual(0);
  return { year, month: monthIndex + 1 };
}

// Desktop-Viewport: Mehrfachauswahl über klickbare Spalten-Header
// (col-header-*) existiert nur in der Tabellenansicht (md:block).
test.use({ viewport: { width: 1280, height: 900 } });
test.setTimeout(60_000);

type Shift = {
  id: number;
  userId: number;
  type: string;
  shiftModelId: number | null;
  planningStatus: string;
};

type BalanceRow = { userId: number; plannedHours: number; valuedHours: number };

let h: TeamTestHarness;
let assistantId: number;
let assistantName: string;
let modelAId: number;
let modelBId: number;
let modelBName: string;
let shiftIds: number[] = [];
let year: number;
let month: number;

const createdModelIds: number[] = [];

test.beforeAll(async () => {
  h = await TeamTestHarness.login();

  const unique = Date.now();
  assistantName = `E2E ModellwechselUI ${unique}`;
  assistantId = await h.createUser({ name: assistantName, role: "assistant" });

  async function createModel(name: string, valuationPercent: number): Promise<number> {
    const res = await h.ctx.post("/api/shift-models", {
      data: { name, valuationPercent, compensationType: "regular" },
    });
    expect(res.ok(), `Schichtmodell ${name} anlegen fehlgeschlagen (${res.status()})`).toBe(true);
    const id = ((await res.json()) as { id: number }).id;
    createdModelIds.push(id);
    return id;
  }

  modelAId = await createModel(`E2E Modell A ${unique}`, 100);
  modelBName = `E2E Modell B ${unique}`;
  modelBId = await createModel(modelBName, 50);

  // Aktueller Monat, Tage 10 und 11 — keine Monatsnavigation nötig, die
  // Kalenderseite öffnet standardmäßig den aktuellen Monat.
  const now = new Date();
  year = now.getFullYear();
  month = now.getMonth() + 1;

  async function createFixWorkShift(day: number): Promise<number> {
    const d = String(day).padStart(2, "0");
    const mm = String(month).padStart(2, "0");
    const res = await h.ctx.post("/api/shifts", {
      data: {
        userId: assistantId,
        type: "work",
        shiftModelId: modelAId,
        startTime: `${year}-${mm}-${d}T08:00:00.000Z`,
        endTime: `${year}-${mm}-${d}T16:00:00.000Z`,
      },
    });
    expect(res.ok(), `FIX-Schicht Tag ${day} anlegen fehlgeschlagen (${res.status()})`).toBe(true);
    return ((await res.json()) as { id: number }).id;
  }

  shiftIds = [await createFixWorkShift(10), await createFixWorkShift(11)];

  // Ausgangslage bestätigen: beide Schichten sind FIX (Server-Default).
  for (const id of shiftIds) {
    const res = await h.ctx.get(`/api/shifts/${id}`);
    expect(res.ok()).toBe(true);
    const shift = (await res.json()) as Shift;
    expect(shift.planningStatus, `Schicht ${id} ist nicht FIX vor dem Test`).toBe("FIX");
  }
});

test.afterAll(async () => {
  for (const id of shiftIds) {
    await h.ctx.delete(`/api/shifts/${id}`).catch(() => {});
  }
  for (const id of createdModelIds) {
    await h.ctx.delete(`/api/shift-models/${id}`).catch(() => {});
  }
});

async function loginAsHarnessAdmin(page: Page): Promise<void> {
  const res = await page.request.post("/api/auth/login", {
    data: { email: h.email, password: h.password },
  });
  expect(res.ok(), `Login fehlgeschlagen (${res.status()})`).toBe(true);
}

test("Massen-Modellwechsel über die UI hält FIX-Dienste FIX und in der Stunden-Bilanz", async ({
  page,
}) => {
  await loginAsHarnessAdmin(page);

  // Erst die Auswertungen-Seite laden (echter Dokument-Reload, einmalig zu
  // Sitzungsbeginn) — das befüllt den React-Query-Cache der hours-balance-
  // Abfrage mit dem VOR-Modellwechsel-Stand (16 / 16 h). Ohne diesen Schritt
  // wäre die spätere Rückkehr zur Auswertungen-Seite ein Frisch-Fetch und
  // könnte eine fehlende Invalidierung nicht aufdecken.
  await page.goto("/auswertungen");
  await expect(page.getByRole("heading", { name: "Auswertungen", exact: true })).toBeVisible();
  const workedCell = page.getByTestId(`matrix-cell-worked-${assistantId}`);
  await expect(workedCell).toBeVisible({ timeout: 20_000 });
  await expect(workedCell).toContainText("16 / 16 h");

  // Weiter zum Dienstplan NUR per Client-seitiger Navigation (Header-
  // Gruppenlink "Planen", führt direkt zu dessen erstem Kind /dienstplan —
  // kein page.goto). Der React-Query-Cache (inkl. der eben geladenen
  // hours-balance-Query) bleibt dabei im Speicher erhalten, genau wie bei
  // einem echten Nutzer, der zwischen den Reitern wechselt.
  await page.getByTestId("nav-group-planen").click();
  await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();
  const desktop = page.getByTestId("dienstplan-desktop");
  await expect(desktop).toBeVisible();

  const { year: shownYear, month: shownMonth } = parseMonthLabel(
    await page.getByTestId("month-label").innerText(),
  );
  expect(shownYear, "Kalender zeigt nicht den erwarteten Monat").toBe(year);
  expect(shownMonth, "Kalender zeigt nicht den erwarteten Monat").toBe(month);

  // Vor dem Wechsel: beide Schicht-Badges sichtbar (Beweis, dass sie nicht
  // schon vorher aus dem Kalender verschwunden sind). shift-badge-<id>
  // existiert mehrfach im DOM (Desktop-Tabelle + persistente Wochen-Listen
  // mobil/desktop) — auf den Desktop-Tabellen-Container scopen (Strict Mode).
  for (const id of shiftIds) {
    await expect(desktop.getByTestId(`shift-badge-${id}`)).toBeVisible();
  }

  // Beide Tage per Mehrfachauswahl markieren.
  await startSelectionMode(page);
  await page.getByTestId(`col-header-${dateKey(year, month, 10)}`).click();
  await page.getByTestId(`col-header-${dateKey(year, month, 11)}`).click();
  await expect(page.getByTestId("bulk-selected-count")).toHaveText("2 Tage ausgewählt");

  // "Einträge ändern" öffnen.
  await page.getByTestId("bulk-edit-open").click();
  const dialog = page.getByTestId("bulk-edit-dialog");
  await expect(dialog).toBeVisible();

  // Auf den Test-Assistenten filtern, damit parallel laufende Specs mit
  // eigenen Schichten an denselben Kalendertagen die Ziel-Anzahl nicht verfälschen.
  await dialog.getByTestId("bulk-edit-filter-user").click();
  await page.getByRole("option", { name: assistantName }).click();
  await expect(dialog.getByTestId("bulk-edit-count")).toContainText("2");

  // Dienst (Schichtmodell) ändern → Modell B wählen.
  await dialog.getByTestId("bulk-edit-toggle-shift-model").click();
  await dialog.getByTestId("bulk-edit-shift-model").click();
  await page.getByRole("option", { name: modelBName }).click();

  await dialog.getByTestId("bulk-edit-confirm").click();
  await expect(dialog).toHaveCount(0, { timeout: 15000 });

  // Backend: beide Schichten tragen jetzt Modell B, sind aber weiterhin FIX
  // (Kern des #869-Fixes — kein Rückfall auf ANGEBOTEN durch den reinen
  // Modellwechsel).
  for (const id of shiftIds) {
    const res = await h.ctx.get(`/api/shifts/${id}`);
    expect(res.ok()).toBe(true);
    const shift = (await res.json()) as Shift;
    expect(shift.shiftModelId, `Schicht ${id} hat nicht das neue Modell`).toBe(modelBId);
    expect(shift.planningStatus, `Schicht ${id} ist nach dem Modellwechsel nicht mehr FIX`).toBe(
      "FIX",
    );
  }

  // Badges bleiben im Kalender sichtbar (nichts verschwindet durch den Wechsel).
  for (const id of shiftIds) {
    await expect(desktop.getByTestId(`shift-badge-${id}`)).toBeVisible();
    await expect(desktop.getByTestId(`shift-badge-${id}`)).toHaveAttribute(
      "data-planning-status",
      "FIX",
    );
  }

  // Stunden-Bilanz: der Test-Assistent behält seine geplanten Stunden (2 × 8h)
  // — ohne den #869-Fix wären die FIX-Dienste auf ANGEBOTEN gefallen und aus
  // der Bilanz verschwunden.
  const balanceRes = await h.ctx.get(`/api/dashboard/hours-balance?month=${month}&year=${year}`);
  expect(balanceRes.ok(), `hours-balance fehlgeschlagen (${balanceRes.status()})`).toBe(true);
  const rows = (await balanceRes.json()) as BalanceRow[];
  const row = rows.find((r) => r.userId === assistantId);
  expect(row, "hours-balance-Zeile des Test-Assistenten fehlt").toBeTruthy();
  expect(row!.plannedHours).toBeCloseTo(16, 1);
  expect(row!.valuedHours).toBeGreaterThan(0);

  // Zurück zur Auswertungen-Seite — wieder NUR per Client-seitiger
  // Navigation (Header-Link "Auswerten", kein page.goto). Das ist die
  // eigentliche Regressionsprüfung: die hours-balance-Query wurde bereits
  // oben mit dem VOR-Modellwechsel-Stand (16 / 16 h) in den Cache geladen.
  // Würde die Massen-Bearbeitung diese Query nicht explizit invalidieren
  // (wie zuvor der Fall), läge hier weiterhin der veraltete Cache-Wert vor —
  // unabhängig davon, dass das Backend längst den neuen Wert liefert.
  await page.getByRole("link", { name: "Auswerten" }).click();
  await expect(page.getByRole("heading", { name: "Auswertungen", exact: true })).toBeVisible();
  // Admin sieht immer die Gesamtübersichts-Matrix (der einzige über die UI
  // erreichbare Ansichts-Modus); die Zeile "worked" ist die Zeile "Geleistete
  // Stunden (gewertet)" (Format "<valuedHours> / <plannedHours> h"), pro
  // Assistent eine eigene Spalte — kein Filtern auf den Test-Assistenten nötig.
  // Geplante (Brutto-)Stunden bleiben 16 h (2 × 8h): die Dienste sind nach
  // dem reinen Modellwechsel weiterhin FIX und zählen unverändert in die
  // Bilanz — ohne den #869-Fix wären sie hier verschwunden. Bewertete
  // Stunden sind jetzt 8 h (16 h × Modell-B-Bewertung 50 %) statt der zuvor
  // im Cache geladenen 16 h.
  await expect(workedCell).toContainText("8 / 16 h", { timeout: 20_000 });
});
