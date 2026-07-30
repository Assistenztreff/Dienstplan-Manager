import { test, expect } from "@playwright/test";
import {
  registerFreeAccount,
  setAccountPlan,
  deleteFreeAccount,
  type FreeAccount,
} from "./helpers/teams";

/**
 * API-Test #651: Die "neuen" Abrechnungskategorien (Kind krank, Urlaubsabgeltung,
 * Pausen) müssen in der Balance-Antwort mit den richtigen Kennzahlen erscheinen.
 * Die Gesamtübersichts-Matrix auf /auswertungen blendet diese Zeilen ein, sobald
 * die zugehörigen Felder > 0 sind — dieser Test sichert die Daten-Pipeline ab.
 *
 * Geprüft (GET /api/dashboard/hours-balance):
 * - kindKrankTage = 1  (ein kind_krank-Eintrag im Monat)
 * - pausenzeitStunden > 0  (Arbeitsdienst mit pauseMinutes)
 * - urlaubsabgeltungEuro > 0  (urlaubsabgeltung-Eintrag + Stundenlohn gesetzt)
 *
 * Warum Premium: urlaubsabgeltungEuro erfordert einen Stundenlohn, der nur im
 * Premium-Personalblatt gesetzt werden kann (advancedPersonnelFile).
 *
 * Die Gesamt-Matrix zeigt für jede dieser Kennzahlen > 0 eine eigene Zeile
 * (matrix-row-kindKrank, matrix-row-pausen, matrix-row-urlaubsabgeltung).
 * Sind die Felder 0, verschwindet die Zeile — dieser Test verhindert eine
 * stille Regression, bei der die Felder plötzlich immer 0 wären.
 */

const NOW = new Date();
/** Vormonat: sichere Datenbasis, unabhängig vom heutigen Tag. */
const TARGET = new Date(NOW.getFullYear(), NOW.getMonth() - 1, 1);
const YEAR = TARGET.getFullYear();
const MONTH = TARGET.getMonth() + 1;
const MM = String(MONTH).padStart(2, "0");

/** Hilfsfunktion: Ganztags-Zeitstempel (Frontend-Konvention 00:00–23:59). */
function fullDay(day: number): { startTime: string; endTime: string } {
  const d = String(day).padStart(2, "0");
  return {
    startTime: `${YEAR}-${MM}-${d}T00:00:00.000Z`,
    endTime: `${YEAR}-${MM}-${d}T23:59:00.000Z`,
  };
}

/** Arbeitsdienst mit Pausen-Minuten: 08:00–16:00 = 8h brutto */
const WORK_START = `${YEAR}-${MM}-10T08:00:00.000Z`;
const WORK_END = `${YEAR}-${MM}-10T16:00:00.000Z`;
const PAUSE_MINUTES = 30;
const HOURLY_WAGE = 15;

let acc: FreeAccount;
let teamId: number;
let assistantId: number;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  acc = await registerFreeAccount("dienstleister", "matrix-kategorien");
  await setAccountPlan(acc.email, "premium");

  const teamsRes = await acc.ctx.get("/api/teams");
  expect(teamsRes.ok()).toBe(true);
  const teams = (await teamsRes.json()) as Array<{ id: number }>;
  teamId = teams[0]!.id;

  // Assistenzkraft mit Stundenlohn anlegen.
  const suffix = Date.now();
  const userRes = await acc.ctx.post("/api/users", {
    data: {
      name: `Matrix Kategorien ${suffix}`,
      email: `matrix-kat-${suffix}@e2e.test`,
      password: "matrix1234567",
      role: "assistant",
    },
  });
  expect(userRes.status(), "Assistenzkraft anlegen").toBe(201);
  assistantId = (await userRes.json()).id as number;

  // Stundenlohn setzen (Premium-Feature, nötig für urlaubsabgeltungEuro).
  const wageRes = await acc.ctx.patch(`/api/users/${assistantId}`, {
    data: { hourlyWage: HOURLY_WAGE },
  });
  expect(wageRes.ok(), "Stundenlohn setzen").toBe(true);

  // Vertrag: 40h/5d → ganztägige Abwesenheit = 8h.
  const contractRes = await acc.ctx.post("/api/contracts", {
    data: {
      userId: assistantId,
      startDate: `${YEAR}-01-01`,
      weeklyHours: 40,
      vacationDays: 30,
    },
  });
  expect(contractRes.status(), "Vertrag anlegen").toBe(201);

  // teamId wird serverseitig aus dem Kontext der Assistenzkraft aufgelöst.
  // Arbeitsdienst mit Pausenminuten (→ pausenzeitStunden > 0).
  const workRes = await acc.ctx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "work",
      startTime: WORK_START,
      endTime: WORK_END,
      planningStatus: "FIX",
      pauseMinutes: PAUSE_MINUTES,
    },
  });
  expect(workRes.status(), "Arbeitsdienst anlegen").toBe(201);

  // Kind-krank-Eintrag (→ kindKrankTage = 1).
  const kindKrankRes = await acc.ctx.post("/api/shifts", {
    data: { userId: assistantId, type: "kind_krank", ...fullDay(12) },
  });
  expect(kindKrankRes.status(), "Kind-krank anlegen").toBe(201);

  // Urlaubsabgeltung-Eintrag (→ urlaubsabgeltungEuro > 0 wegen Stundenlohn).
  const urlaubsabgeltungRes = await acc.ctx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "urlaubsabgeltung",
      ...fullDay(14),
    },
  });
  expect(urlaubsabgeltungRes.status(), "Urlaubsabgeltung anlegen").toBe(201);
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

test("Neue Matrix-Kategorien liefern korrekte Kennzahlen in der Balance (#651)", async () => {
  const balanceRes = await acc.ctx.get("/api/dashboard/hours-balance", {
    params: { month: MONTH, year: YEAR },
  });
  expect(
    balanceRes.ok(),
    `Balance-Abfrage fehlgeschlagen (${balanceRes.status()})`,
  ).toBe(true);

  const rows = (await balanceRes.json()) as Array<Record<string, unknown>>;
  const b = Array.isArray(rows)
    ? rows.find((r) => r.userId === assistantId)
    : rows;
  if (!b) throw new Error(`Kein Balance-Row für assistantId=${assistantId} gefunden`);

  // --- Kind krank (matrix-row-kindKrank) ------------------------------------
  expect(
    b.kindKrankTage,
    "kindKrankTage muss 1 sein (ein kind_krank-Eintrag im Monat)",
  ).toBe(1);

  // --- Pausen (matrix-row-pausen) ------------------------------------------
  expect(
    Number(b.pausenzeitStunden),
    "pausenzeitStunden muss > 0 sein (Arbeitsdienst mit 30 Pausenminuten = 0.5h)",
  ).toBeGreaterThan(0);
  // 30 min = 0.5 h
  expect(b.pausenzeitStunden).toBe(0.5);

  // --- Urlaubsabgeltung (matrix-row-urlaubsabgeltung) ----------------------
  // urlaubsabgeltungEuro = Stundenlohn × valuedHours (8h/Tag bei 40h/5d).
  expect(
    Number(b.urlaubsabgeltungEuro),
    "urlaubsabgeltungEuro muss > 0 sein (Urlaubsabgeltung × Stundenlohn)",
  ).toBeGreaterThan(0);
  // 15 €/h × 8h = 120 €
  expect(b.urlaubsabgeltungEuro).toBe(HOURLY_WAGE * 8);

  // Regressions-Guard: alle drei Felder müssen im Response vorhanden sein.
  for (const field of ["kindKrankTage", "pausenzeitStunden", "urlaubsabgeltungEuro"]) {
    expect(field in b, `Feld '${field}' muss im Balance-Response existieren`).toBe(true);
  }
});
