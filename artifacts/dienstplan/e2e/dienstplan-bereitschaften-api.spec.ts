import { test, expect } from "@playwright/test";
import {
  registerFreeAccount,
  setAccountPlan,
  deleteFreeAccount,
  type FreeAccount,
} from "./helpers/teams";

/**
 * API-Test #564: Bereitschafts-Dienste ("Bereitschaft"-Schichtmodell) müssen
 * in der Stunden-Balance als `bereitschaftenAnzahl` und `bereitschaftsStunden`
 * erscheinen — damit eine stille Regression in der Balance-Berechnung sofort
 * auffällt.
 *
 * Die Bereitschaft wird über das Standard-Schichtmodell "Bereitschaft"
 * identifiziert (`modelName === "Bereitschaft"` in dashboard-hours-balance.ts).
 * Das Modell wird bei jeder Konto-Registrierung automatisch angelegt.
 *
 * Aufbau:
 * - Frisches Dienstleister-Konto mit einer Assistenzkraft und einem Vertrag.
 * - Ein verbindlicher (FIX) Bereitschafts-Dienst im Vormonat.
 *
 * Geprüft:
 * - GET /api/dashboard/hours-balance liefert bereitschaftenAnzahl = 1.
 * - bereitschaftsStunden = Schichtlänge in Stunden (12 h für 08:00–20:00).
 * - Alle anderen Bereitschafts-Felder existieren im Response (Regressions-Guard).
 */

const NOW = new Date();
/** Vormonat — sicher abgeschlossen, kein Rauschen durch heutige Änderungen. */
const TARGET = new Date(NOW.getFullYear(), NOW.getMonth() - 1, 1);
const YEAR = TARGET.getFullYear();
const MONTH = TARGET.getMonth() + 1;
const SHIFT_DAY = `${YEAR}-${String(MONTH).padStart(2, "0")}-15`;
const SHIFT_START = `${SHIFT_DAY}T08:00:00.000Z`;
const SHIFT_END = `${SHIFT_DAY}T20:00:00.000Z`;
/** Erwartete Brutto-Stunden der 08:00–20:00-Schicht. */
const EXPECTED_HOURS = 12;

let acc: FreeAccount;
let teamId: number;
let assistantId: number;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  acc = await registerFreeAccount("dienstleister", "bereitschaft");
  await setAccountPlan(acc.email, "premium");

  // Standard-Team ermitteln.
  const teamsRes = await acc.ctx.get("/api/teams");
  expect(teamsRes.ok(), "Teams-Abfrage muss erfolgreich sein").toBe(true);
  const teams = (await teamsRes.json()) as Array<{ id: number }>;
  teamId = teams[0]!.id;

  // Assistenzkraft anlegen.
  const suffix = Date.now();
  const userRes = await acc.ctx.post("/api/users", {
    data: {
      name: `Bereitschaft Assi ${suffix}`,
      email: `bereitschaft-assi-${suffix}@e2e.test`,
      password: "bereitschaft1234",
      role: "assistant",
    },
  });
  expect(userRes.status(), "Assistenzkraft anlegen").toBe(201);
  assistantId = (await userRes.json()).id as number;

  // Vertrag für den Vormonat anlegen.
  const contractRes = await acc.ctx.post("/api/contracts", {
    data: {
      userId: assistantId,
      startDate: `${YEAR}-01-01`,
      weeklyHours: 40,
      vacationDays: 30,
    },
  });
  expect(contractRes.status(), "Vertrag anlegen").toBe(201);

  // Bereitschafts-Schichtmodell finden (wird bei Registrierung geseedet).
  const modelsRes = await acc.ctx.get("/api/shift-models");
  expect(modelsRes.ok(), "Schichtmodelle abfragen").toBe(true);
  const models = (await modelsRes.json()) as Array<{
    id: number;
    name: string;
    defaultType?: string;
    type?: string;
  }>;
  const bereitschaftModel = models.find((m) => m.name === "Bereitschaft");
  if (!bereitschaftModel) {
    throw new Error(
      `Standard-Schichtmodell 'Bereitschaft' nicht gefunden. Vorhandene Modelle: ${models.map((m) => m.name).join(", ")}`,
    );
  }

  // Der Schichttyp aus dem Modell ableiten (Fallback: "standby", das ist der
  // typische Typ für Bereitschaftsdienste).
  const bereitschaftType = bereitschaftModel.defaultType ?? bereitschaftModel.type ?? "standby";

  // FIX-Bereitschaftsdienst im Vormonat anlegen.
  // teamId wird serverseitig aus dem Kontext der Assistenzkraft aufgelöst.
  const shiftRes = await acc.ctx.post("/api/shifts", {
    data: {
      userId: assistantId,
      shiftModelId: bereitschaftModel.id,
      type: bereitschaftType,
      startTime: SHIFT_START,
      endTime: SHIFT_END,
      planningStatus: "FIX",
    },
  });
  expect(
    shiftRes.status(),
    `Bereitschafts-Dienst anlegen (${shiftRes.status()}: ${await shiftRes.text()})`,
  ).toBe(201);
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

test("Bereitschaft erscheint korrekt in GET /api/dashboard/hours-balance (#564)", async () => {
  const balanceRes = await acc.ctx.get("/api/dashboard/hours-balance", {
    params: { month: MONTH, year: YEAR },
  });
  expect(
    balanceRes.ok(),
    `Balance-Abfrage fehlgeschlagen (${balanceRes.status()})`,
  ).toBe(true);

  const rows = (await balanceRes.json()) as Array<Record<string, unknown>>;
  const balance = Array.isArray(rows)
    ? rows.find((r) => r.userId === assistantId)
    : rows;
  if (!balance) throw new Error(`Kein Balance-Row für assistantId=${assistantId} gefunden`);

  // --- Bereitschafts-Kennzahlen ---
  expect(
    balance.bereitschaftenAnzahl,
    "bereitschaftenAnzahl muss genau 1 sein (ein FIX-Bereitschafts-Dienst)",
  ).toBe(1);

  expect(
    balance.bereitschaftsStunden,
    `bereitschaftsStunden muss ${EXPECTED_HOURS} sein (08:00–20:00 = 12h)`,
  ).toBe(EXPECTED_HOURS);

  // Regressions-Guard: alle bereitschaftsbezogenen Felder müssen im Response vorhanden sein.
  expect(
    "bereitschaftenAnzahl" in balance,
    "Feld bereitschaftenAnzahl muss im Balance-Response existieren",
  ).toBe(true);
  expect(
    "bereitschaftsStunden" in balance,
    "Feld bereitschaftsStunden muss im Balance-Response existieren",
  ).toBe(true);
});
