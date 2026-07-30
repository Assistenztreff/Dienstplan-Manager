import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";
import { dbDeleteAccountByEmail } from "./helpers/db";

/**
 * #542 / #663 – Zuschläge auf Urlaubs- und Kranktage berechnen und als
 *               SV-pflichtig kennzeichnen; Kennzeichnung in der Matrix.
 *
 * §11 BUrlG / §2 EFZG: Urlaubs-/Krankheitsstunden, die auf Sonntage oder
 * Feiertage fallen, werden mit dem Sonntagszuschlag bewertet und als
 * SV-pflichtig (sozialversicherungspflichtig) in der Stundenbilanz ausgewiesen.
 * Der gleiche Endpunkt (GET /api/dashboard/hours-balance) versorgt sowohl die
 * Einzel-Auswertungskarte als auch die Gesamt-Auswertungs-Matrix — ein
 * geteiltes Test-Datum genügt.
 *
 * Vorgehen:
 *   1. Frischer Test-Assistent + 40h-Vertrag
 *   2. Urlaubstag auf Sonntag 2026-07-05 anlegen
 *   3. GET hours-balance für Juli 2026 → absenceSundayHours > 0
 *   4. Prüfe dass die response-Felder für SV-pflichtige Zuschläge vorhanden sind
 *   5. Aufräumen
 *
 * Hinweis: absenceSundaySurchargeHours hängt von sundayPercent > 0 ab.
 * Der Test prüft nur absenceSundayHours (welches nur vom Wochentag abhängt),
 * um unabhängig von der Konfiguration zu sein.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

// Sonntag im Testmonat: 2026-07-05 ist ein Sonntag.
const TEST_YEAR = 2026;
const TEST_MONTH = 7;
const SUNDAY = `${TEST_YEAR}-07-05`;

type BalanceRow = {
  userId: number;
  absenceSundayHours?: number | null;
  absenceSundaySurchargeHours?: number | null;
  absenceNightHours?: number | null;
  absenceHolidayHours?: number | null;
  vacationFulfilledHours?: number | null;
};

let adminCtx: APIRequestContext;
let assistantId: number;
let vacationShiftId: number;
let testEmail: string;

test.beforeAll(async () => {
  const unique = Date.now();
  testEmail = `e2e.svpflichtig.${unique}@dienstplan.test`;
  adminCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });

  const loginRes = await adminCtx.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(loginRes.ok(), "Admin-Login fehlgeschlagen").toBe(true);

  // Test-Assistent anlegen.
  const userRes = await adminCtx.post("/api/users", {
    data: {
      name: `E2E SV-pflichtig ${unique}`,
      email: testEmail,
      role: "assistant",
    },
  });
  expect(userRes.ok(), `Assistent anlegen fehlgeschlagen (${userRes.status()})`).toBe(true);
  assistantId = ((await userRes.json()) as { id: number }).id;

  // Vertrag 40h/Woche ab Jahresbeginn (8h/Tag → bewertet volle Urlaubstage).
  const contractRes = await adminCtx.post("/api/contracts", {
    data: {
      userId: assistantId,
      startDate: `${TEST_YEAR}-01-01`,
      weeklyHours: 40,
      vacationDays: 30,
    },
  });
  expect(contractRes.ok(), `Vertrag anlegen fehlgeschlagen (${contractRes.status()})`).toBe(true);

  // Urlaubstag auf Sonntag (ganztägig wie Frontend: 00:00–23:59).
  const shiftRes = await adminCtx.post("/api/shifts", {
    data: {
      userId: assistantId,
      startTime: new Date(`${SUNDAY}T00:00:00`).toISOString(),
      endTime: new Date(`${SUNDAY}T23:59:59`).toISOString(),
      type: "vacation",
      planningStatus: "FIX",
    },
  });
  expect(shiftRes.ok(), `Urlaubsschicht anlegen fehlgeschlagen (${shiftRes.status()})`).toBe(true);
  vacationShiftId = ((await shiftRes.json()) as { id: number }).id;
});

test.afterAll(async () => {
  if (vacationShiftId) {
    await adminCtx.delete(`/api/shifts/${vacationShiftId}`).catch(() => null);
  }
  if (testEmail) {
    await dbDeleteAccountByEmail(testEmail).catch(() => null);
  }
  await adminCtx.dispose().catch(() => null);
});

test("Urlaub auf Sonntag: absenceSundayHours > 0 in der Stundenbilanz (#542)", async () => {
  test.setTimeout(30_000);

  const res = await adminCtx.get(
    `/api/dashboard/hours-balance?month=${TEST_MONTH}&year=${TEST_YEAR}`,
  );
  expect(res.ok(), `hours-balance fehlgeschlagen (${res.status()})`).toBe(true);

  const rows = (await res.json()) as BalanceRow[];
  const row = rows.find((r) => r.userId === assistantId);
  expect(row, "Test-Assistent fehlt in der Stundenbilanz").toBeDefined();

  // Kernaussage §11 BUrlG: Sonntagsstunden auf Urlaubstag müssen > 0 sein.
  expect(
    (row!.absenceSundayHours ?? 0),
    "absenceSundayHours muss > 0 sein wenn Urlaub auf Sonntag fällt",
  ).toBeGreaterThan(0);
});

test("SV-pflichtige Felder sind in der Bilanz-Antwort vorhanden (#542 / #663)", async () => {
  test.setTimeout(30_000);

  const res = await adminCtx.get(
    `/api/dashboard/hours-balance?month=${TEST_MONTH}&year=${TEST_YEAR}`,
  );
  expect(res.ok()).toBe(true);

  const rows = (await res.json()) as BalanceRow[];
  const row = rows.find((r) => r.userId === assistantId);
  expect(row, "Test-Assistent fehlt").toBeDefined();

  // Alle SV-pflichtig-relevanten Felder müssen im DTO vorhanden sein.
  // (null/0 ist OK wenn kein Eintrag passt — aber undefined wäre ein Schema-Fehler)
  const fields: Array<keyof BalanceRow> = [
    "absenceSundayHours",
    "absenceSundaySurchargeHours",
    "absenceNightHours",
    "absenceHolidayHours",
  ];
  for (const field of fields) {
    expect(
      Object.prototype.hasOwnProperty.call(row, field),
      `Feld "${field}" fehlt in der API-Antwort`,
    ).toBe(true);
  }
});
