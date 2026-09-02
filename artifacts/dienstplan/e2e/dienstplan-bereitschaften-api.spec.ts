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
 * Die Bereitschaft wird ueber den NAMEN des Schichtmodells identifiziert
 * (`modelName === "Bereitschaft"` in dashboard-hours-balance.ts) — nicht über
 * ein Flag. Der Test legt das Modell deshalb selbst an, statt sich auf die
 * Seed-Liste zu verlassen (die seit 30.08.2026 nur noch die Teamsitzung
 * enthält).
 *
 * Aufbau:
 * - Frisches Dienstleister-Konto mit einer Assistenzkraft und einem Vertrag.
 * - Ein selbst angelegtes Schichtmodell "Bereitschaft".
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

  // Bereitschafts-Schichtmodell ANLEGEN, nicht suchen. Bis zum 30.08.2026 kam
  // "Bereitschaft" als einer von fünf Standard-Diensten aus der Registrierung;
  // seitdem seedet ein neues Team nur noch die Teamsitzung. Ein Test, der auf
  // ein geseedetes Modell wartet, misst damit die Seed-Liste statt der Sache,
  // um die es hier geht: dass die Auswertung einen Dienst NAMENS "Bereitschaft"
  // als Bereitschaft zählt (`modelName === "Bereitschaft"` in
  // dashboard-hours-balance.ts). Der Name ist die Zusicherung — also stellt der
  // Test ihn selbst her.
  const modelRes = await acc.ctx.post("/api/shift-models", {
    data: {
      name: "Bereitschaft",
      color: "teal",
      valuationPercent: 100,
      defaultStartTime: "08:00",
      defaultEndTime: "14:00",
      defaultWeekdays: [6, 7],
      compensationType: "regular",
    },
  });
  expect(
    modelRes.status(),
    `Bereitschafts-Schichtmodell anlegen (${await modelRes.text()})`,
  ).toBe(201);
  const bereitschaftModel = (await modelRes.json()) as { id: number; name: string };
  expect(bereitschaftModel.name, "Der Name ist das Erkennungsmerkmal der Auswertung").toBe(
    "Bereitschaft",
  );

  // Schichttyp für Bereitschaftsdienste.
  const bereitschaftType = "standby";

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
