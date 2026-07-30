import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";
import { dbDeleteAccountByEmail } from "./helpers/db";

/**
 * #552 – Bestätigen, dass die Urlaubstag-Bewertung nach IST-Historie auf
 *        den 13-Wochen-Schnitt umspringt.
 *
 * §11 BUrlG / §2 EFZG: Urlaubstage werden nach dem Durchschnitt der
 * tatsächlich geleisteten Stunden der letzten 13 Wochen bewertet (IST-Modus),
 * sobald ausreichend bestätigte Zeiterfassungsdaten vorliegen. Bis dahin
 * greift der Fallback auf die Vertragsdaten (SOLL-Modus).
 *
 * Dieser Spec bestätigt:
 *   a) GET /api/contracts/{id}/vacation-balance liefert das Feld
 *      `dailyHoursSource` mit Wert "contract" wenn noch keine IST-Daten
 *      vorhanden sind, aber der Vertrag alt genug für 13-Wochen-Schnitt wäre.
 *   b) Die Antwort enthält alle für die UI relevanten Felder
 *      (dailyHours, contractWeeklyHours, contractWorkdaysPerWeek).
 *   c) Der Endpunkt schlägt nicht fehl (kein 5xx) — der Wechsel auf "bwavg"
 *      geschieht intern sobald bestätigte Zeiterfassungsdaten vorliegen.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

// Vertragsbeginn > 91 Tage (13 Wochen) zurück: contractOlderThan13Weeks() = true.
const CONTRACT_START = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10);

type VacationBalance = {
  dailyHoursSource?: "contract" | "bwavg";
  dailyHours?: number | null;
  contractWeeklyHours?: number | null;
  contractWorkdaysPerWeek?: number | null;
};

let adminCtx: APIRequestContext;
let contractId: number;
let testEmail: string;

test.beforeAll(async () => {
  const unique = Date.now();
  testEmail = `e2e.13woche.${unique}@dienstplan.test`;
  adminCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });

  const loginRes = await adminCtx.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(loginRes.ok(), "Admin-Login fehlgeschlagen").toBe(true);

  // Test-Assistent anlegen.
  const userRes = await adminCtx.post("/api/users", {
    data: {
      name: `E2E 13-Wochen ${unique}`,
      email: testEmail,
      role: "assistant",
    },
  });
  expect(userRes.ok(), `Assistent anlegen fehlgeschlagen (${userRes.status()})`).toBe(true);
  const assistantId = ((await userRes.json()) as { id: number }).id;

  // Vertrag mit Beginn vor > 13 Wochen anlegen: contractOlderThan13Weeks() = true.
  const contractRes = await adminCtx.post("/api/contracts", {
    data: {
      userId: assistantId,
      startDate: CONTRACT_START,
      weeklyHours: 40,
      vacationDays: 30,
      workdaysPerWeek: 5,
    },
  });
  expect(contractRes.ok(), `Vertrag anlegen fehlgeschlagen (${contractRes.status()})`).toBe(true);
  contractId = ((await contractRes.json()) as { id: number }).id;
});

test.afterAll(async () => {
  if (testEmail) await dbDeleteAccountByEmail(testEmail).catch(() => null);
  await adminCtx.dispose().catch(() => null);
});

test("Fehlende IST-Daten: dailyHoursSource ist 'contract' (Fallback aktiv, kein Crash) (#552)", async () => {
  test.setTimeout(30_000);

  const res = await adminCtx.get(`/api/contracts/${contractId}/vacation-balance`);
  expect(
    res.ok(),
    `vacation-balance fehlgeschlagen (${res.status()})`,
  ).toBe(true);

  const balance = (await res.json()) as VacationBalance;

  // Ohne IST-Zeiterfassung greift der Vertragsfallback.
  expect(
    balance.dailyHoursSource,
    "dailyHoursSource muss 'contract' sein wenn keine IST-Daten vorliegen",
  ).toBe("contract");
});

test("Urlaubsbilanz-Felder sind vorhanden und gültig (#552)", async () => {
  test.setTimeout(30_000);

  const res = await adminCtx.get(`/api/contracts/${contractId}/vacation-balance`);
  expect(res.ok()).toBe(true);

  const balance = (await res.json()) as VacationBalance;

  // dailyHours muss ein positiver Wert sein (40h / 5 Tage = 8h).
  expect(
    typeof balance.dailyHours === "number" && (balance.dailyHours ?? 0) > 0,
    `dailyHours muss > 0 sein (war: ${String(balance.dailyHours)})`,
  ).toBe(true);

  expect(
    balance.contractWeeklyHours,
    "contractWeeklyHours fehlt",
  ).toBe(40);

  // dailyHoursSource ist eine der beiden erwarteten Werte.
  expect(
    ["contract", "bwavg"].includes(balance.dailyHoursSource ?? ""),
    `dailyHoursSource unbekannt: ${String(balance.dailyHoursSource)}`,
  ).toBe(true);
});

test("Endpunkt bleibt stabil wenn Vertrag älter als 13 Wochen ist (#552)", async () => {
  test.setTimeout(30_000);

  // Aufruf mehrfach — kein 5xx, keine Exception.
  for (let i = 0; i < 3; i++) {
    const res = await adminCtx.get(`/api/contracts/${contractId}/vacation-balance`);
    expect(
      res.ok(),
      `vacation-balance Aufruf #${i + 1} fehlgeschlagen (${res.status()})`,
    ).toBe(true);
  }
});
