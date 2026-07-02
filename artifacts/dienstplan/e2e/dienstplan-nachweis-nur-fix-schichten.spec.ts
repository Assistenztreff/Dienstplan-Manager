import fs from "node:fs";
import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";
import { loginViaUi } from "./helpers/auth";

/**
 * E2E-Beweis: Entwurfsschichten (VORLAEUFIG/ANGEBOTEN) gelangen NIE in den
 * offiziellen Nachweis — weder in den Soll/Ist-Abgleich (hours-balance) noch
 * in die Schichtdetail-Tabelle des PDF-Stundennachweises.
 *
 * Aufbau (frischer Assistent, daher deterministische Aggregate):
 * - 3 Schichten im aktuellen Monat: FIX (8h), VORLAEUFIG (6h), ANGEBOTEN (4h).
 *
 * Geprüft (Done-Kriterien):
 * 1. GET /api/dashboard/hours-balance zählt nur die FIX-Stunden als
 *    plannedHours (8, nicht 18) — Entwürfe/Vorschläge zählen nicht.
 * 2. Der PDF-Export (Einzel-Nachweis, aktueller Monat) enthält in der
 *    Schichtdetail-Tabelle NUR die FIX-Schicht: das Datum der FIX-Schicht
 *    steht im PDF, die Daten der Entwurfs-/Vorschlags-Schichten NICHT.
 *    (jsPDF schreibt Text unkomprimiert in den Content-Stream, daher sind die
 *    Datums-Strings der Tabellenzellen im Roh-PDF direkt auffindbar.)
 * 3. Positiv-Kontrolle: Wird der Entwurf per PATCH auf FIX gehoben, springen
 *    plannedHours auf 14 und valuedHours steigen um >= 6h — der Filter (und
 *    nichts anderes) war also der Grund für den Ausschluss; ANGEBOTEN bleibt
 *    weiterhin außen vor (14, nicht 18).
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

test.use({ viewport: { width: 1280, height: 800 } });

const NOW = new Date();
const YEAR = NOW.getFullYear();
const MONTH = NOW.getMonth() + 1;
const MM = String(MONTH).padStart(2, "0");
const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Drei aufeinanderfolgende Tage im aktuellen Monat. Wichtig: Die Tage der
 * NICHT-FIX-Schichten dürfen nicht auf den heutigen Tag fallen, weil der
 * PDF-Footer "Erstellt am <heute>" enthält — sonst würde die
 * "Datum kommt NICHT im PDF vor"-Assertion fälschlich fehlschlagen.
 * Basisfenster Tag 8-10; bei Kollision mit "heute" um 7 Tage verschoben
 * (Tag 15-17, immer gültig in jedem Monat).
 */
function pickDays(): { fixDay: number; draftDay: number; offeredDay: number } {
  const today = NOW.getDate();
  let base = 8;
  if (today >= base + 1 && today <= base + 2) base += 7;
  return { fixDay: base, draftDay: base + 1, offeredDay: base + 2 };
}

const { fixDay, draftDay, offeredDay } = pickDays();
const FIX_DAY = `${YEAR}-${MM}-${pad2(fixDay)}`;
const DRAFT_DAY = `${YEAR}-${MM}-${pad2(draftDay)}`;
const OFFERED_DAY = `${YEAR}-${MM}-${pad2(offeredDay)}`;

// Datums-Strings, wie sie die Schichtdetail-Tabelle im PDF rendert (dd.MM.yyyy).
const FIX_DATE_PDF = `${pad2(fixDay)}.${MM}.${YEAR}`;
const DRAFT_DATE_PDF = `${pad2(draftDay)}.${MM}.${YEAR}`;
const OFFERED_DATE_PDF = `${pad2(offeredDay)}.${MM}.${YEAR}`;

type CreatedUser = { id: number; name: string };
type CreatedShift = { id: number; planningStatus?: string };
type BalanceRow = { userId: number; plannedHours: number; valuedHours: number };

let adminCtx: APIRequestContext;
let assistant: CreatedUser;
let contractId = 0;
const shiftIds: number[] = [];
let draftShiftId = 0;

async function createShift(
  day: string,
  hours: number,
  planningStatus: "VORLAEUFIG" | "ANGEBOTEN" | "FIX",
): Promise<number> {
  const res = await adminCtx.post("/api/shifts", {
    data: {
      userId: assistant.id,
      startTime: `${day}T08:00:00.000Z`,
      endTime: `${day}T${pad2(8 + hours)}:00:00.000Z`,
      type: "active",
      planningStatus,
    },
  });
  expect(res.ok(), `Schicht (${planningStatus}) anlegen fehlgeschlagen (${res.status()})`).toBe(
    true,
  );
  const shift = (await res.json()) as CreatedShift;
  // Guard: Der Status darf vom Server nicht still gestrippt/überschrieben
  // werden — sonst würden die folgenden Assertions nichts beweisen.
  expect(shift.planningStatus, `planningStatus muss ${planningStatus} sein`).toBe(planningStatus);
  shiftIds.push(shift.id);
  return shift.id;
}

async function fetchBalanceRow(): Promise<BalanceRow> {
  const res = await adminCtx.get(`/api/dashboard/hours-balance?month=${MONTH}&year=${YEAR}`);
  expect(res.ok(), `hours-balance fehlgeschlagen (${res.status()})`).toBe(true);
  const rows = (await res.json()) as BalanceRow[];
  const row = rows.find((r) => r.userId === assistant.id);
  expect(row, "hours-balance enthält keine Zeile für den Test-Assistenten").toBeTruthy();
  return row!;
}

test.beforeAll(async () => {
  const unique = Date.now();
  adminCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });

  const loginRes = await adminCtx.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(loginRes.ok(), "Admin-Login für Setup fehlgeschlagen").toBe(true);

  const userRes = await adminCtx.post("/api/users", {
    data: {
      name: `E2E NurFix ${unique}`,
      email: `e2e.nurfix.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(userRes.ok(), `Anlegen des Assistenten fehlgeschlagen (${userRes.status()})`).toBe(true);
  assistant = (await userRes.json()) as CreatedUser;

  const contractRes = await adminCtx.post("/api/contracts", {
    data: {
      userId: assistant.id,
      startDate: `${YEAR}-01-01`,
      weeklyHours: 40,
      vacationDays: 30,
    },
  });
  expect(contractRes.ok(), `Anlegen des Vertrags fehlgeschlagen (${contractRes.status()})`).toBe(
    true,
  );
  contractId = ((await contractRes.json()) as { id: number }).id;

  // 8h FIX + 6h VORLAEUFIG + 4h ANGEBOTEN — nur die 8h dürfen offiziell zählen.
  await createShift(FIX_DAY, 8, "FIX");
  draftShiftId = await createShift(DRAFT_DAY, 6, "VORLAEUFIG");
  await createShift(OFFERED_DAY, 4, "ANGEBOTEN");
});

test.afterAll(async () => {
  for (const id of shiftIds) await adminCtx.delete(`/api/shifts/${id}`);
  if (contractId) await adminCtx.delete(`/api/contracts/${contractId}`);
  if (assistant?.id) await adminCtx.delete(`/api/users/${assistant.id}`);
  await adminCtx.dispose();
});

test.describe("Offizieller Nachweis zählt nur FIX-Schichten", () => {
  test("hours-balance zählt nur die FIX-Stunden als plannedHours", async () => {
    const row = await fetchBalanceRow();
    // Mit Entwürfen wären es 18h (8+6+4) — nur die FIX-Schicht darf zählen.
    expect(row.plannedHours).toBe(8);
    // valuedHours basieren ebenfalls nur auf der FIX-Schicht (8h zzgl.
    // etwaiger Zuschläge); die 6h+4h der Entwürfe dürfen nicht enthalten sein.
    expect(row.valuedHours).toBeGreaterThanOrEqual(8);
    expect(row.valuedHours).toBeLessThan(8 + 6);
  });

  test("PDF-Stundennachweis enthält nur die FIX-Schicht in den Schichtdetails", async ({
    page,
  }) => {
    await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto("/assistenten");
    await expect(page.getByRole("heading", { name: "Assistenten", exact: true })).toBeVisible();

    const card = page.getByTestId(`assistant-card-${assistant.id}`);
    await expect(card).toBeVisible();
    await card.getByTitle("Stundennachweis als PDF exportieren").click();

    // Dialog startet auf dem aktuellen Monat — direkt exportieren.
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Stundennachweis exportieren")).toBeVisible();
    await expect(dialog.getByText("1 Monat werden exportiert.")).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Als PDF exportieren" }).click();
    const download = await downloadPromise;

    const path = await download.path();
    expect(path, "Download-Datei nicht verfügbar").toBeTruthy();
    const raw = fs.readFileSync(path!, "latin1");

    expect(raw.startsWith("%PDF"), "Download ist kein PDF").toBe(true);
    // Die FIX-Schicht steht in der Detail-Tabelle …
    expect(raw, "FIX-Schicht fehlt im PDF").toContain(FIX_DATE_PDF);
    // … die Entwurfs-/Vorschlags-Schichten dürfen NIRGENDS im PDF auftauchen.
    expect(raw, "VORLAEUFIG-Schicht ist im PDF gelandet").not.toContain(DRAFT_DATE_PDF);
    expect(raw, "ANGEBOTEN-Schicht ist im PDF gelandet").not.toContain(OFFERED_DATE_PDF);
  });

  test("Positiv-Kontrolle: Entwurf -> FIX zählt sofort, ANGEBOTEN bleibt außen vor", async () => {
    const before = await fetchBalanceRow();

    const res = await adminCtx.patch(`/api/shifts/${draftShiftId}`, {
      data: { planningStatus: "FIX" },
    });
    expect(res.ok(), `Hochstufen auf FIX fehlgeschlagen (${res.status()})`).toBe(true);

    const after = await fetchBalanceRow();
    // 8h + 6h = 14h — die 4h-ANGEBOTEN-Schicht zählt weiterhin nicht (sonst 18).
    expect(after.plannedHours).toBe(14);
    // Auch die gewerteten Stunden steigen um die 6h des hochgestuften Entwurfs
    // (zzgl. etwaiger Zuschläge) — vorher waren sie also wirklich ausgeschlossen.
    expect(after.valuedHours - before.valuedHours).toBeGreaterThanOrEqual(6);
  });
});
