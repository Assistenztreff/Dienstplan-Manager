import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";
import { dbDeleteAccountByEmail } from "./helpers/db";

/**
 * Bestätigen, dass eine 13-Wochen-IST-Historie die vertragliche Bewertung
 * eines Urlaubstags nicht mehr verändert.
 *
 * Der Zeitfaktor folgt der ausfallenden Arbeitszeit: ohne konkreten Dienst
 * gilt Wochenstunden / Arbeitstage pro Woche. Die letzten 13 Wochen dürfen
 * ausschließlich eine optionale Jahresend-Prognose speisen.
 *
 * Dieser Spec bestätigt:
 *   a) GET /api/contracts/{id}/vacation-balance liefert das Feld
 *      `dailyHoursSource` mit Wert "contract" wenn noch keine IST-Daten
 *      vorhanden sind, auch wenn der Vertrag älter als 13 Wochen ist.
 *   b) Die Antwort enthält alle für die UI relevanten Felder
 *      (dailyHours, contractWeeklyHours, contractWorkdaysPerWeek).
 *   c) Der Endpunkt schlägt nicht fehl und bleibt unabhängig von IST-Historie
 *      bei der Vertragsquelle.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

// Vertragsbeginn > 91 Tage zurück: Prognose wäre grundsätzlich verfügbar.
const CONTRACT_START = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10);

type VacationBalance = {
  contractId?: number;
  dailyHoursSource?: "contract" | "default";
  dailyHours?: number | null;
  contractWeeklyHours?: number | null;
  contractWorkdaysPerWeek?: number | null;
  vacationForecastEnabled?: boolean;
  avgWeeklyHours?: number | null;
  vacationForecastHours?: number | null;
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

  // Die 13-Wochen-Prognose ist strikt von der Tagesbewertung getrennt.
  expect(balance.dailyHoursSource).toBe("contract");
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

test("Ausgeschaltete 13-Wochen-Prognose liefert keine Prognosewerte", async () => {
  const settingsRes = await adminCtx.get("/api/allowance-settings");
  expect(settingsRes.ok()).toBe(true);
  const settings = (await settingsRes.json()) as Record<string, unknown>;

  try {
    const disableRes = await adminCtx.put("/api/allowance-settings", {
      data: { ...settings, vacationForecastEnabled: false },
    });
    expect(
      disableRes.ok(),
      `Prognose ausschalten fehlgeschlagen (${disableRes.status()}): ${await disableRes.text()}`,
    ).toBe(true);

    const balanceRes = await adminCtx.get(
      `/api/contracts/${contractId}/vacation-balance`,
    );
    expect(balanceRes.ok()).toBe(true);
    const balance = (await balanceRes.json()) as VacationBalance;
    expect(balance.vacationForecastEnabled).toBe(false);
    expect(balance.avgWeeklyHours).toBeNull();
    expect(balance.vacationForecastHours).toBeNull();

    const batchRes = await adminCtx.get("/api/vacation-balances");
    expect(batchRes.ok()).toBe(true);
    const batch = (await batchRes.json()) as VacationBalance[];
    const batchBalance = batch.find((item) => item.contractId === contractId);
    expect(batchBalance, "Eigener Vertrag fehlt in der Sammelbilanz").toBeDefined();
    expect(batchBalance?.vacationForecastEnabled).toBe(false);
    expect(batchBalance?.avgWeeklyHours).toBeNull();
    expect(batchBalance?.vacationForecastHours).toBeNull();
  } finally {
    const restoreRes = await adminCtx.put("/api/allowance-settings", {
      data: { ...settings, vacationForecastEnabled: true },
    });
    expect(restoreRes.ok(), "Prognose-Schalter konnte nicht wiederhergestellt werden").toBe(
      true,
    );
  }
});
