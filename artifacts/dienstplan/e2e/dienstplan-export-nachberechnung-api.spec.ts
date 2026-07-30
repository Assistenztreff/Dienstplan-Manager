import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";
import { dbDeleteAccountByEmail } from "./helpers/db";

/**
 * #597 – Beweisen, dass der Assistenten-Export dieselbe Nachberechnung zeigt
 *        wie die Auswertung.
 *
 * Das Auswertungs-Dashboard und der PDF-Sammelnachweis (StatementExportDialog)
 * rufen denselben Endpunkt auf: GET /api/dashboard/hours-balance. Beide übergeben
 * identische Parameter für Monat/Jahr und userId; der Export lädt zusätzlich den
 * Vormonat als "Nachberechnung" (Übertrags-Balance). Dieser Test sichert ab, dass:
 *
 *   a) Beide Aufrufe für denselben Monat dieselbe Balance zurückgeben
 *      (Idempotenz des Endpunkts).
 *   b) Der Vormonat-Aufruf (für die Nachberechnung) auch eine konsistente
 *      Antwort liefert.
 *   c) Kritische Felder (balance, totalFulfilledHours, plannedHours) sind
 *      nie NaN oder undefined — was auf Berechnungsfehler hindeutet.
 *
 * Kein Duplicate der Berechnungslogik: expected-Werte werden aus dem ersten
 * API-Aufruf abgeleitet, der zweite muss dasselbe zurückgeben.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

const YEAR = new Date().getFullYear();
const MONTH = 9; // September: 2 Werktage als Fixture, keine Bundesfeiertage

type BalanceRow = {
  userId: number;
  balance: number;
  totalFulfilledHours: number;
  plannedHours: number;
  vacationDaysTaken: number;
  sickHours: number;
};

let adminCtx: APIRequestContext;
let assistantId: number;
let shiftId: number;
let testEmail: string;

test.beforeAll(async () => {
  const unique = Date.now();
  testEmail = `e2e.nachberechnung.${unique}@dienstplan.test`;
  adminCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });

  const loginRes = await adminCtx.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(loginRes.ok(), "Admin-Login fehlgeschlagen").toBe(true);

  // Test-Assistent anlegen.
  const userRes = await adminCtx.post("/api/users", {
    data: {
      name: `E2E Nachberechnung ${unique}`,
      email: testEmail,
      role: "assistant",
    },
  });
  expect(userRes.ok(), `Assistent anlegen fehlgeschlagen (${userRes.status()})`).toBe(true);
  assistantId = ((await userRes.json()) as { id: number }).id;

  // 40h/Woche-Vertrag ab Jahresbeginn.
  const contractRes = await adminCtx.post("/api/contracts", {
    data: {
      userId: assistantId,
      startDate: `${YEAR}-01-01`,
      weeklyHours: 40,
      vacationDays: 30,
    },
  });
  expect(contractRes.ok(), `Vertrag anlegen fehlgeschlagen (${contractRes.status()})`).toBe(true);

  // Schicht im Auswertungsmonat: Dienstag 16. September (Werktag, kein Feiertag).
  const shiftRes = await adminCtx.post("/api/shifts", {
    data: {
      userId: assistantId,
      startTime: new Date(`${YEAR}-09-16T08:00:00`).toISOString(),
      endTime: new Date(`${YEAR}-09-16T16:00:00`).toISOString(),
      type: "work",
      planningStatus: "FIX",
    },
  });
  expect(shiftRes.ok(), `Schicht anlegen fehlgeschlagen (${shiftRes.status()})`).toBe(true);
  shiftId = ((await shiftRes.json()) as { id: number }).id;
});

test.afterAll(async () => {
  if (shiftId) await adminCtx.delete(`/api/shifts/${shiftId}`).catch(() => null);
  if (testEmail) await dbDeleteAccountByEmail(testEmail).catch(() => null);
  await adminCtx.dispose().catch(() => null);
});

test("Zwei identische hours-balance-Abfragen liefern dieselbe Balance (#597)", async () => {
  test.setTimeout(30_000);

  async function fetchRow(): Promise<BalanceRow> {
    const res = await adminCtx.get(
      `/api/dashboard/hours-balance?month=${MONTH}&year=${YEAR}`,
    );
    expect(res.ok(), `hours-balance fehlgeschlagen (${res.status()})`).toBe(true);
    const rows = (await res.json()) as BalanceRow[];
    const row = rows.find((r) => r.userId === assistantId);
    expect(row, "Assistent fehlt in der Bilanz").toBeDefined();
    return row!;
  }

  const row1 = await fetchRow();
  const row2 = await fetchRow();

  // Idempotenz: zweite Anfrage muss identisch zur ersten sein.
  expect(row2.balance, "balance weicht zwischen zwei Aufrufen ab").toBe(row1.balance);
  expect(row2.totalFulfilledHours).toBe(row1.totalFulfilledHours);
  expect(row2.plannedHours).toBe(row1.plannedHours);
});

test("Kein NaN oder undefined in kritischen Balance-Feldern (#597)", async () => {
  test.setTimeout(30_000);

  const res = await adminCtx.get(
    `/api/dashboard/hours-balance?month=${MONTH}&year=${YEAR}`,
  );
  expect(res.ok()).toBe(true);
  const rows = (await res.json()) as BalanceRow[];
  const row = rows.find((r) => r.userId === assistantId);
  expect(row, "Assistent fehlt").toBeDefined();

  const criticalFields: Array<keyof BalanceRow> = [
    "balance",
    "totalFulfilledHours",
    "plannedHours",
    "vacationDaysTaken",
    "sickHours",
  ];
  for (const field of criticalFields) {
    const val = row![field];
    expect(
      typeof val === "number" && !Number.isNaN(val),
      `Feld "${field}" ist kein gültiger Zahlenwert (war: ${String(val)})`,
    ).toBe(true);
  }
});

test("Vormonat-Abruf (Nachberechnung) liefert konsistente Daten (#597)", async () => {
  test.setTimeout(30_000);

  // Der StatementExportDialog ruft den Vormonat als "Nachberechnung" ab.
  const prevMonth = MONTH - 1; // August
  const res = await adminCtx.get(
    `/api/dashboard/hours-balance?month=${prevMonth}&year=${YEAR}`,
  );
  expect(res.ok(), `Vormonat hours-balance fehlgeschlagen (${res.status()})`).toBe(true);

  const rows = (await res.json()) as BalanceRow[];
  // Assistent hat keine Schichten im Vormonat → Eintrag mit 0-Werten oder gar kein Eintrag.
  // Kein Fehler 5xx darf auftreten.
  const row = rows.find((r) => r.userId === assistantId);
  if (row) {
    expect(Number.isNaN(row.balance), "balance im Vormonat ist NaN").toBe(false);
    expect(Number.isNaN(row.totalFulfilledHours), "totalFulfilledHours ist NaN").toBe(false);
  }
  // Kein Eintrag im Vormonat ist auch korrekt (0 Stunden = kein Row oder Row mit 0en).
});
