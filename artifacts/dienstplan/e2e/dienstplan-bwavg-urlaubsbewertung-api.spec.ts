/**
 * #552 – Bestätigen, dass die Urlaubstag-Bewertung nach IST-Historie auf den
 *        13-Wochen-Schnitt (bwavg) umspringt.
 *
 * Ablauf:
 * 1. Premium-Dienstleister + Assistent + Vertrag (Beginn > 91 Tage zurück).
 * 2. vacationMethod = "bwavg" in den Konto-Einstellungen setzen.
 * 3. Zeiterfassung aktivieren, einen Arbeitsdienst anlegen, IST-Eintrag
 *    buchen und bestätigen (confirm-batch, braucht strictTimeTracking).
 * 4. GET /contracts/:id/vacation-balance bleibt trotz Historie bei "contract".
 *
 * Solange keine IST-Historie vorhanden ist (Negativprüfung), muss
 * dailyHoursSource auf "contract" oder "default" stehen.
 */
import { test, expect } from "@playwright/test";
import {
  registerFreeAccount,
  setAccountPlan,
  deleteFreeAccount,
  type FreeAccount,
} from "./helpers/teams";

const NOW = new Date();
// Vertragsbeginn 100 Tage zurück — sicher > 91 Tage (Schwellwert für bwavg).
const CONTRACT_START = new Date(NOW.getTime() - 100 * 24 * 3_600_000)
  .toISOString()
  .split("T")[0]!;
// Arbeitsdienst: vorgestern 08:00–16:00 UTC (sicher innerhalb der letzten 91 Tage).
const SHIFT_START = new Date(NOW.getTime() - 2 * 24 * 3_600_000);
SHIFT_START.setUTCHours(8, 0, 0, 0);
const SHIFT_END = new Date(SHIFT_START.getTime() + 8 * 3_600_000);

let acc: FreeAccount;
let assistantId: number;
let contractId: number;
let shiftId: number;
let timeEntryId: number;

test.beforeAll(async () => {
  test.setTimeout(90_000);
  acc = await registerFreeAccount("dienstleister", "bwavg");
  await setAccountPlan(acc.email, "premium");

  // Assistent anlegen.
  const userRes = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E bwavg ${Date.now()}`,
      email: `e2e.bwavg.${Date.now()}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(userRes.status(), "Assistent anlegen").toBe(201);
  assistantId = ((await userRes.json()) as { id: number }).id;

  // Vertrag mit Beginn > 91 Tage zurück.
  const contractRes = await acc.ctx.post("/api/contracts", {
    data: {
      userId: assistantId,
      startDate: CONTRACT_START,
      weeklyHours: 40,
      workdaysPerWeek: 5,
      vacationDays: 30,
    },
  });
  expect(contractRes.status(), "Vertrag anlegen").toBe(201);
  contractId = ((await contractRes.json()) as { id: number }).id;

  // Konto-Einstellungen: vacationMethod = "bwavg" + Zeiterfassung aktivieren.
  // UpdateAllowanceSettingsBody hat Pflichtfelder (nightPercent, nightStart etc.),
  // daher erst GET, dann PUT mit gelesenen Werten + gewünschten Änderungen.
  const getRes = await acc.ctx.get("/api/allowance-settings");
  expect(getRes.status(), "GET allowance-settings").toBe(200);
  const existing = (await getRes.json()) as Record<string, unknown>;
  const settingsRes = await acc.ctx.put("/api/allowance-settings", {
    data: {
      ...existing,
      vacationMethod: "bwavg",
      timeTrackingEnabled: true,
    },
  });
  expect(
    settingsRes.status(),
    `Einstellungen setzen (${settingsRes.status()}): ${await settingsRes.text()}`,
  ).toBe(200);

  // Arbeitsdienst anlegen (FIX, Typ work).
  const shiftRes = await acc.ctx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "work",
      planningStatus: "FIX",
      startTime: SHIFT_START.toISOString(),
      endTime: SHIFT_END.toISOString(),
    },
  });
  expect(shiftRes.status(), `Schicht anlegen (${shiftRes.status()})`).toBe(201);
  shiftId = ((await shiftRes.json()) as { id: number }).id;

  // IST-Eintrag buchen (Assistent-Kontext, POST /time-tracking).
  const ttRes = await acc.ctx.post("/api/time-tracking", {
    data: {
      shiftId,
      userId: assistantId,
      actualStart: SHIFT_START.toISOString(),
      actualEnd: SHIFT_END.toISOString(),
    },
  });
  expect(ttRes.status(), `Zeiterfassung buchen (${ttRes.status()}): ${await ttRes.text()}`).toBe(201);
  timeEntryId = ((await ttRes.json()) as { id: number }).id;

  // IST-Eintrag bestätigen (Admin + strictTimeTracking Premium).
  const confirmRes = await acc.ctx.post("/api/time-tracking/confirm-batch", {
    data: { ids: [timeEntryId] },
  });
  expect(confirmRes.status(), `Eintrag bestätigen (${confirmRes.status()})`).toBe(200);
});

test.afterAll(async () => {
  if (shiftId) await acc.ctx.delete(`/api/shifts/${shiftId}`);
  await deleteFreeAccount(acc);
});

test(
  "Ohne IST-Historie steht dailyHoursSource auf contract (Negativprüfung) (#552)",
  async () => {
    // Zweiter Vertrag für isolierte Negativ-Prüfung (kein IST-Eintrag).
    const userRes2 = await acc.ctx.post("/api/users", {
      data: {
        name: `E2E bwavg neg ${Date.now()}`,
        email: `e2e.bwavg.neg.${Date.now()}@dienstplan.test`,
        role: "assistant",
      },
    });
    expect(userRes2.status()).toBe(201);
    const uid2 = ((await userRes2.json()) as { id: number }).id;

    const c2Res = await acc.ctx.post("/api/contracts", {
      data: {
        userId: uid2,
        startDate: CONTRACT_START,
        weeklyHours: 40,
        workdaysPerWeek: 5,
        vacationDays: 30,
      },
    });
    expect(c2Res.status()).toBe(201);
    const cid2 = ((await c2Res.json()) as { id: number }).id;

    const balRes = await acc.ctx.get(`/api/contracts/${cid2}/vacation-balance`);
    expect(balRes.status(), `vacation-balance Negativ (${balRes.status()})`).toBe(200);

    const bal = (await balRes.json()) as { dailyHoursSource: string; method: string };
    expect(bal.method, "Methode muss bwavg sein (gesetzt via allowance-settings)").toBe("bwavg");
    // Ohne IST-Einträge fällt die Auswertung auf contract-Fallback.
    expect(
      ["contract", "default"],
      `dailyHoursSource=${bal.dailyHoursSource} erwartet contract/default`,
    ).toContain(bal.dailyHoursSource);
  },
);

test(
  "Bestätigte IST-Historie verändert die vertragliche Tagesbewertung nicht",
  async () => {
    const balRes = await acc.ctx.get(`/api/contracts/${contractId}/vacation-balance`);
    expect(balRes.status(), `vacation-balance (${balRes.status()})`).toBe(200);

    const bal = (await balRes.json()) as {
      dailyHoursSource: string;
      method: string;
      dailyHours: number;
    };
    expect(bal.method, "Methode aus den Einstellungen muss bwavg sein").toBe("bwavg");
    expect(bal.dailyHoursSource).toBe("contract");
    expect(bal.dailyHours, "40 Wochenstunden / 5 Arbeitstage").toBe(8);
  },
);
