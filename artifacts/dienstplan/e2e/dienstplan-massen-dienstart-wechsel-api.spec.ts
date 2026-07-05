import { test, expect } from "@playwright/test";
import { TeamTestHarness } from "./helpers/teams";

/**
 * API-E2E-Beweis (#368): Der „Massen-Dienstart-Wechsel" — das gleichzeitige
 * Ändern des Schichtmodells mehrerer Schichten in einem Zug — hält die
 * bewerteten Stunden UND die Zuschlagsberechnung korrekt und „verrutscht" nicht
 * (keine Vermischung zwischen Schichten, keine Auswirkung auf nicht geänderte
 * Schichten).
 *
 * Die Massenbearbeitung (`bulk-edit-dialog.tsx`) besitzt KEINEN Batch-Endpunkt:
 * sie feuert je Ziel-Schicht ein `PATCH /api/shifts/:id` mit dem Body
 * `{ type: "work", shiftModelId, force: true }`. Dieser Test bildet exakt diese
 * Schleife nach und prüft danach den echten Server-Pfad (storeShiftMetrics beim
 * PATCH + Aggregation im hours-balance-Handler).
 *
 * Warum wechselt sich beim Modell-Wechsel überhaupt etwas?
 * - `valuationPercent` des Modells steuert die BEWERTETEN Stunden
 *   (valuedHours = Brutto-Stunden × valuationPercent/100). Modell A wertet mit
 *   100 %, Modell B mit 50 % — der Wechsel MUSS valuedHours je Schicht halbieren.
 * - Die Zuschlags-Roh-Stunden (nacht/sonntag/feiertag) hängen NUR an den Zeiten
 *   (+ Nachtfenster/Bundesland), nicht am Modell — sie MÜSSEN unverändert
 *   bleiben. Die Zuschlags-Prozente werden ohnehin erst beim Abruf angewandt.
 * - `compensationType` (regular vs. percentage) unterscheidet die beiden Modelle
 *   zusätzlich (erfüllt „unterschiedliche Vergütungstypen"); er steuert nur die
 *   Geld-Berechnung (basePay) und ist bewusst NICHT Teil der Stunden-/Zuschlags-
 *   Assertions dieses Specs.
 *
 * Team-Kontext: Der Test läuft als der (privat-)Setup-Admin und nutzt dessen
 * bei der Registrierung angelegtes „Standard-Team". Alle Schreibzugriffe lassen
 * `teamId` weg — `resolveWriteTeamId` fällt für ein Konto mit genau einem Team
 * auf dieses zurück (derselbe dokumentierte Pfad wie in `registerFreeAccount`).
 * Der Konto-Typ ist nach der Registrierung fixiert und NICHT per API änderbar,
 * daher wird bewusst KEIN Dienstleister-Wechsel/kein eigenes Team angelegt. Das
 * Standard-Team kann weitere Assistenten enthalten, deshalb wird die
 * hours-balance-Zeile strikt über die userId des Test-Assistenten gefiltert (nie
 * über rows.length) — fremde Assistenten beeinflussen die eigene Zeile nicht.
 *
 * Fester Monat Oktober 2026 (keine „aktueller Monat"-Flakes):
 * - Eigene Zuschlags-Prozente + Nachtfenster VOR dem Anlegen setzen, im Cleanup
 *   wiederherstellen (pro Konto gespeichert).
 * - Zwei Schichtmodelle:
 *   - Modell A „Regeldienst"  — valuationPercent 100, compensationType regular
 *   - Modell B „Bereitschaft" — valuationPercent 50,  compensationType percentage
 * - Drei FIX-Arbeitsschichten auf Modell A, je genau ein Zuschlags-Topf:
 *   - Nacht    Mi 07.10. 20:00 → Do 08.10. 06:00 (Nachtstunden > 0)
 *   - Sonntag  So 04.10. 08:00-16:00            (Sonntagsstunden > 0)
 *   - Feiertag Sa 03.10. 08:00-14:00            (Tag der Deutschen Einheit)
 * - Eine KONTROLL-Schicht (Di 06.10. 08:00-16:00, ohne Zuschlag) bleibt bewusst
 *   auf Modell A: Sie darf sich durch den Massen-Wechsel der drei anderen NICHT
 *   verändern (Beweis gegen „verrutschen").
 */

const YEAR = 2026;
const MONTH = 10;

const NIGHT_PERCENT = 30;
const SUNDAY_PERCENT = 60;
const HOLIDAY_PERCENT = 90;

const MODEL_A_VALUATION = 100;
const MODEL_B_VALUATION = 50;

const round2 = (n: number) => Math.round(n * 100) / 100;

interface StoredShiftMetrics {
  shiftModelId: number | null;
  valuedHours: number;
  nightHours: number;
  sundayHours: number;
  holidayHours: number;
}

interface BalanceRow {
  userId: number;
  plannedHours: number;
  valuedHours: number;
  nightHours: number;
  nightSurchargeHours: number;
  sundayHours: number;
  sundaySurchargeHours: number;
  holidayHours: number;
  holidaySurchargeHours: number;
  nightPercent: number;
  sundayPercent: number;
  holidayPercent: number;
}

let h: TeamTestHarness;
let assistantA: number;
let modelA: number;
let modelB: number;
let nightShiftId: number;
let sundayShiftId: number;
let holidayShiftId: number;
let controlShiftId: number;
let originalAllowance: Record<string, unknown> | null = null;

// Direkt (nicht über den Harness) angelegte Schichten/Modelle müssen manuell
// abgeräumt werden, sonst blockieren sie später das Team (shifts/shift_models
// referenzieren teams.id OHNE Cascade). Reihenfolge im afterAll: erst Schichten,
// dann Modelle, dann h.cleanup() (Nutzer).
const createdShiftIds: number[] = [];
const createdModelIds: number[] = [];

async function createWorkShift(
  day: string,
  startTime: string,
  endTime: string,
  shiftModelId: number,
): Promise<number> {
  // Kein teamId: resolveWriteTeamId fällt auf das einzige Team des Admins zurück.
  const res = await h.ctx.post("/api/shifts", {
    data: { userId: assistantA, startTime, endTime, type: "work", shiftModelId },
  });
  expect(res.ok(), `Arbeitsschicht ${day} anlegen fehlgeschlagen (${res.status()})`).toBe(true);
  const id = ((await res.json()) as { id: number }).id;
  createdShiftIds.push(id);
  return id;
}

async function createModel(
  name: string,
  valuationPercent: number,
  compensationType: "regular" | "percentage",
  extra: Record<string, unknown> = {},
): Promise<number> {
  const res = await h.ctx.post("/api/shift-models", {
    data: { name, valuationPercent, compensationType, ...extra },
  });
  expect(res.ok(), `Schichtmodell ${name} anlegen fehlgeschlagen (${res.status()})`).toBe(true);
  const id = ((await res.json()) as { id: number }).id;
  createdModelIds.push(id);
  return id;
}

async function fetchStoredMetrics(shiftId: number): Promise<StoredShiftMetrics> {
  const res = await h.ctx.get(`/api/shifts/${shiftId}`);
  expect(res.ok(), `Schicht ${shiftId} laden fehlgeschlagen (${res.status()})`).toBe(true);
  const body = (await res.json()) as Partial<StoredShiftMetrics>;
  return {
    shiftModelId: body.shiftModelId ?? null,
    valuedHours: body.valuedHours ?? 0,
    nightHours: body.nightHours ?? 0,
    sundayHours: body.sundayHours ?? 0,
    holidayHours: body.holidayHours ?? 0,
  };
}

/** hours-balance des Test-Assistenten (strikt über userId gefiltert). */
async function fetchBalanceRow(): Promise<BalanceRow> {
  const res = await h.ctx.get(`/api/dashboard/hours-balance?month=${MONTH}&year=${YEAR}`);
  expect(res.ok(), `hours-balance fehlgeschlagen (${res.status()})`).toBe(true);
  const rows = (await res.json()) as BalanceRow[];
  const row = rows.find((r) => r.userId === assistantA);
  expect(row, "hours-balance-Zeile des Test-Assistenten fehlt").toBeTruthy();
  return row!;
}

/** Massenbearbeitung nachbilden: je Schicht ein PATCH mit dem neuen Modell. */
async function bulkChangeModel(shiftIds: number[], shiftModelId: number): Promise<void> {
  for (const id of shiftIds) {
    const res = await h.ctx.patch(`/api/shifts/${id}`, {
      data: { type: "work", shiftModelId, force: true },
    });
    expect(res.ok(), `Massen-Modellwechsel für Schicht ${id} fehlgeschlagen (${res.status()})`).toBe(
      true,
    );
  }
}

test.beforeAll(async () => {
  // Kaltstart des isolierten Stacks kann die 30s-Default sprengen.
  test.setTimeout(120_000);

  h = await TeamTestHarness.login();

  const getRes = await h.ctx.get("/api/allowance-settings");
  expect(getRes.ok(), "Zuschlags-Einstellungen laden fehlgeschlagen").toBe(true);
  originalAllowance = (await getRes.json()) as Record<string, unknown>;
  const putRes = await h.ctx.put("/api/allowance-settings", {
    data: {
      nightPercent: NIGHT_PERCENT,
      sundayPercent: SUNDAY_PERCENT,
      holidayPercent: HOLIDAY_PERCENT,
      nightStart: "22:00",
      nightEnd: "06:00",
    },
  });
  expect(putRes.ok(), "Zuschlags-Einstellungen setzen fehlgeschlagen").toBe(true);

  // Assistent im Standard-Team des Admins (kein teamId -> Fallback greift, POST
  // /users legt zugleich die Team-Mitgliedschaft an).
  assistantA = await h.createUser({ role: "assistant" });

  // Zwei bewusst unterschiedliche Modelle: verschiedene Bewertung (Stunden) UND
  // verschiedener Vergütungstyp.
  modelA = await createModel("E2E Regeldienst", MODEL_A_VALUATION, "regular");
  modelB = await createModel("E2E Bereitschaft", MODEL_B_VALUATION, "percentage", {
    compensationPercent: 50,
  });

  // Drei FIX-Arbeitsschichten (Default-Status FIX) auf Modell A, je ein Topf.
  nightShiftId = await createWorkShift(
    "2026-10-07",
    "2026-10-07T20:00:00.000Z",
    "2026-10-08T06:00:00.000Z",
    modelA,
  );
  sundayShiftId = await createWorkShift(
    "2026-10-04",
    "2026-10-04T08:00:00.000Z",
    "2026-10-04T16:00:00.000Z",
    modelA,
  );
  holidayShiftId = await createWorkShift(
    "2026-10-03",
    "2026-10-03T08:00:00.000Z",
    "2026-10-03T14:00:00.000Z",
    modelA,
  );

  // Kontroll-Schicht ohne Zuschlag, bleibt auf Modell A (Beweis: der
  // Massen-Wechsel der anderen drei darf sie NICHT anfassen).
  controlShiftId = await createWorkShift(
    "2026-10-06",
    "2026-10-06T08:00:00.000Z",
    "2026-10-06T16:00:00.000Z",
    modelA,
  );
});

test.afterAll(async () => {
  for (const id of createdShiftIds) {
    try {
      await h.ctx.delete(`/api/shifts/${id}`);
    } catch {
      /* ignore */
    }
  }
  for (const id of createdModelIds) {
    try {
      await h.ctx.delete(`/api/shift-models/${id}`);
    } catch {
      /* ignore */
    }
  }
  if (originalAllowance) {
    try {
      await h.ctx.put("/api/allowance-settings", {
        data: {
          nightPercent: originalAllowance.nightPercent,
          sundayPercent: originalAllowance.sundayPercent,
          holidayPercent: originalAllowance.holidayPercent,
          nightStart: originalAllowance.nightStart,
          nightEnd: originalAllowance.nightEnd,
        },
      });
    } catch {
      /* Best effort — Cleanup darf nicht am Restore scheitern. */
    }
  }
  await h.cleanup();
});

test.describe("Massen-Dienstart-Wechsel: Stunden & Zuschläge bleiben korrekt", () => {
  test("bewertet Stunden je Schicht neu, behält Zuschlags-Roh-Stunden und verrutscht nichts", async () => {
    // --- VORHER: alle drei + Kontrolle auf Modell A (100 %). ---
    const nightBefore = await fetchStoredMetrics(nightShiftId);
    const sundayBefore = await fetchStoredMetrics(sundayShiftId);
    const holidayBefore = await fetchStoredMetrics(holidayShiftId);
    const controlBefore = await fetchStoredMetrics(controlShiftId);

    // Sanity: jede Fixture trifft ihren Topf wirklich, sonst „beweist" der Test
    // die Erhaltung an 0-Werten.
    expect(nightBefore.nightHours).toBeGreaterThan(0);
    expect(sundayBefore.sundayHours).toBeGreaterThan(0);
    expect(holidayBefore.holidayHours).toBeGreaterThan(0);
    // Bei 100 % Bewertung sind bewertete = Brutto-Stunden.
    const nightGross = nightBefore.valuedHours;
    const sundayGross = sundayBefore.valuedHours;
    const holidayGross = holidayBefore.valuedHours;
    expect(nightGross).toBeGreaterThan(0);

    // Aggregat VORHER: hours-balance summiert die gespeicherten Roh-Kennzahlen.
    const before = await fetchBalanceRow();
    const expectedValuedBefore =
      nightBefore.valuedHours +
      sundayBefore.valuedHours +
      holidayBefore.valuedHours +
      controlBefore.valuedHours;
    expect(before.valuedHours).toBeCloseTo(round2(expectedValuedBefore), 2);
    expect(before.nightHours).toBeCloseTo(round2(nightBefore.nightHours), 2);
    expect(before.sundayHours).toBeCloseTo(round2(sundayBefore.sundayHours), 2);
    expect(before.holidayHours).toBeCloseTo(round2(holidayBefore.holidayHours), 2);
    expect(before.nightSurchargeHours).toBeCloseTo(
      round2((nightBefore.nightHours * NIGHT_PERCENT) / 100),
      2,
    );
    expect(before.sundaySurchargeHours).toBeCloseTo(
      round2((sundayBefore.sundayHours * SUNDAY_PERCENT) / 100),
      2,
    );
    expect(before.holidaySurchargeHours).toBeCloseTo(
      round2((holidayBefore.holidayHours * HOLIDAY_PERCENT) / 100),
      2,
    );

    // --- MASSEN-WECHSEL: die DREI Zuschlags-Schichten auf Modell B (50 %). ---
    await bulkChangeModel([nightShiftId, sundayShiftId, holidayShiftId], modelB);

    // --- NACHHER je Schicht: Modell gewechselt, valuedHours halbiert,
    //     Zuschlags-Roh-Stunden IDENTISCH. ---
    const nightAfter = await fetchStoredMetrics(nightShiftId);
    const sundayAfter = await fetchStoredMetrics(sundayShiftId);
    const holidayAfter = await fetchStoredMetrics(holidayShiftId);

    for (const [beforeMetrics, after, gross] of [
      [nightBefore, nightAfter, nightGross],
      [sundayBefore, sundayAfter, sundayGross],
      [holidayBefore, holidayAfter, holidayGross],
    ] as const) {
      expect(after.shiftModelId).toBe(modelB);
      // Neu bewertet: Brutto × 50 %.
      expect(after.valuedHours).toBeCloseTo(round2((gross * MODEL_B_VALUATION) / 100), 2);
      // Zuschlags-Roh-Stunden hängen nur an den Zeiten -> unverändert.
      expect(after.nightHours).toBeCloseTo(beforeMetrics.nightHours, 2);
      expect(after.sundayHours).toBeCloseTo(beforeMetrics.sundayHours, 2);
      expect(after.holidayHours).toBeCloseTo(beforeMetrics.holidayHours, 2);
    }

    // Beweis gegen „verrutschen": jede Schicht behält NUR ihren eigenen Topf,
    // es sickert nichts von einer in die andere.
    expect(nightAfter.sundayHours).toBeCloseTo(0, 2);
    expect(nightAfter.holidayHours).toBeCloseTo(0, 2);
    expect(sundayAfter.nightHours).toBeCloseTo(0, 2);
    expect(sundayAfter.holidayHours).toBeCloseTo(0, 2);
    expect(holidayAfter.nightHours).toBeCloseTo(0, 2);
    expect(holidayAfter.sundayHours).toBeCloseTo(0, 2);

    // Kontroll-Schicht: NICHT im Massen-Wechsel -> komplett unverändert.
    const controlAfter = await fetchStoredMetrics(controlShiftId);
    expect(controlAfter.shiftModelId).toBe(modelA);
    expect(controlAfter.valuedHours).toBeCloseTo(controlBefore.valuedHours, 2);
    expect(controlAfter.nightHours).toBeCloseTo(controlBefore.nightHours, 2);
    expect(controlAfter.sundayHours).toBeCloseTo(controlBefore.sundayHours, 2);
    expect(controlAfter.holidayHours).toBeCloseTo(controlBefore.holidayHours, 2);

    // --- Aggregat NACHHER: valuedHours der drei halbiert, Kontrolle unverändert;
    //     Zuschlags-Stunden + Prozente unverändert. ---
    const after = await fetchBalanceRow();
    const expectedValuedAfter =
      nightAfter.valuedHours +
      sundayAfter.valuedHours +
      holidayAfter.valuedHours +
      controlAfter.valuedHours;
    expect(after.valuedHours).toBeCloseTo(round2(expectedValuedAfter), 2);
    // Konkret: die bewerteten Stunden MÜSSEN gesunken sein (Bewertung 100 -> 50).
    expect(after.valuedHours).toBeLessThan(before.valuedHours);

    // Zuschläge (Roh-Stunden, Prozente, berechnete Zuschlagsstunden) BLEIBEN.
    expect(after.nightHours).toBeCloseTo(before.nightHours, 2);
    expect(after.sundayHours).toBeCloseTo(before.sundayHours, 2);
    expect(after.holidayHours).toBeCloseTo(before.holidayHours, 2);
    expect(after.nightPercent).toBe(before.nightPercent);
    expect(after.sundayPercent).toBe(before.sundayPercent);
    expect(after.holidayPercent).toBe(before.holidayPercent);
    expect(after.nightSurchargeHours).toBeCloseTo(before.nightSurchargeHours, 2);
    expect(after.sundaySurchargeHours).toBeCloseTo(before.sundaySurchargeHours, 2);
    expect(after.holidaySurchargeHours).toBeCloseTo(before.holidaySurchargeHours, 2);
    // Geplante (Brutto-)Stunden ändern sich durch einen Modell-Wechsel nie.
    expect(after.plannedHours).toBeCloseTo(before.plannedHours, 2);
  });
});
