import { test, expect } from "@playwright/test";
import {
  deleteFreeAccount,
  registerFreeAccount,
  setAccountPlan,
  type FreeAccount,
} from "./helpers/teams";

/**
 * API-Regressionstest: Die NEUEN Abrechnungskategorien werden in
 * GET /dashboard/hours-balance dauerhaft korrekt gerechnet.
 *
 * Festgeschriebenes Verhalten (siehe replit.md "Neue Abrechnungskategorien"):
 * - kind_krank / abgesagt_an: UNBEZAHLT — reine Info-Kennzahlen
 *   (kindKrankTage, abgesagtArbeitnehmerStunden). Zaehlen NICHT in
 *   Soll/Erfuellt/Grundlohn/totalPay.
 * - freistellung / abgesagt_ag: BEZAHLT wie Krankheit — Lohnfortzahlung in
 *   Erfuellt (totalFulfilledHours) UND Grundlohn (basePay), eigene Spalten
 *   (freistellungTage/-Stunden, abgesagtArbeitgeberStunden).
 * - urlaubsabgeltung: NUR Euro-Wert (Stundenlohn x valuedHours) als eigene
 *   Position (urlaubsabgeltungEuro), fliesst NICHT in totalPay ein.
 * - isVertretung / pauseMinutes: Info-Felder an Arbeitsdiensten
 *   (vertretungenAnzahl/-Stunden, pausenzeitStunden); Stunden zaehlen normal,
 *   Pausen reduzieren NICHTS. Server setzt beide bei Abwesenheits-Typen zurueck.
 *
 * Aufbau: frisches Premium-Privat-Konto, Assistent mit Stundenlohn 20 EUR,
 * Vertrag 40h/Woche (=> ganztaegige Abwesenheiten werden mit 8h bewertet).
 * Fester Monat November 2026, nur Werktage Mo-Fr (kein Sonntag, kein
 * bundesweiter Feiertag, Arbeitsdienst tagsueber) — Zuschlaege sind bewusst 0,
 * damit die Grundlohn-Rechnung exakt vorhersagbar ist.
 *
 * Erwartungswerte werden aus den GESPEICHERTEN valuedHours der Eintraege
 * (GET /api/shifts/:id) abgeleitet — keine Duplikation der Bewertungs-Engine.
 */

const YEAR = 2026;
const MONTH = 11;
const WAGE = 20;

// November 2026: 1. = Sonntag => 9.-13. Mo-Fr, 16. = Montag.
const WORK_START = "2026-11-09T08:00:00.000Z"; // Arbeitsdienst Mo 8h
const WORK_END = "2026-11-09T16:00:00.000Z";
const KIND_KRANK_DAY = "2026-11-10"; // Di
const ABGESAGT_AN_DAY = "2026-11-11"; // Mi
const FREISTELLUNG_DAY = "2026-11-12"; // Do
const ABGESAGT_AG_DAY = "2026-11-13"; // Fr
const URLAUBSABGELTUNG_DAY = "2026-11-16"; // Mo

const PAUSE_MINUTES = 30;

// Ganztaegiger Abwesenheitseintrag, exakt wie das Frontend ihn sendet.
function fullDayTimes(day: string): { startTime: string; endTime: string } {
  return {
    startTime: new Date(`${day}T00:00:00`).toISOString(),
    endTime: new Date(`${day}T23:59:59`).toISOString(),
  };
}

interface StoredShift {
  id: number;
  type: string;
  valuedHours?: number | null;
  isVertretung?: boolean;
  pauseMinutes?: number;
}

interface BalanceRow {
  userId: number;
  plannedHours: number;
  valuedHours: number;
  totalFulfilledHours: number;
  balance: number;
  nightSurchargeHours: number;
  sundaySurchargeHours: number;
  holidaySurchargeHours: number;
  // Neue Kategorien:
  vertretungenAnzahl: number;
  vertretungsStunden: number;
  pausenzeitStunden: number;
  kindKrankTage: number;
  freistellungTage: number;
  freistellungStunden: number;
  abgesagtArbeitgeberStunden: number;
  abgesagtArbeitnehmerStunden: number;
  urlaubsabgeltungEuro: number;
  // Geld:
  hourlyWage: number | null;
  basePay: number | null;
  nightSurchargePay: number | null;
  sundaySurchargePay: number | null;
  holidaySurchargePay: number | null;
  totalPay: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

let acc: FreeAccount;
let assistantId = 0;
const shiftIds: Record<string, number> = {};

async function createShift(data: Record<string, unknown>): Promise<StoredShift> {
  const res = await acc.ctx.post("/api/shifts", { data });
  expect(res.status(), `Schicht anlegen fehlgeschlagen (${res.status()})`).toBe(201);
  return (await res.json()) as StoredShift;
}

async function fetchShift(id: number): Promise<StoredShift> {
  const res = await acc.ctx.get(`/api/shifts/${id}`);
  expect(res.ok(), `GET /api/shifts/${id} fehlgeschlagen (${res.status()})`).toBe(true);
  return (await res.json()) as StoredShift;
}

async function fetchBalanceRow(): Promise<BalanceRow> {
  const res = await acc.ctx.get(`/api/dashboard/hours-balance?month=${MONTH}&year=${YEAR}`);
  expect(res.ok(), `hours-balance fehlgeschlagen (${res.status()})`).toBe(true);
  const rows = (await res.json()) as BalanceRow[];
  const row = rows.find((r) => r.userId === assistantId);
  expect(row, "Zeile des Assistenten erwartet").toBeTruthy();
  return row!;
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  acc = await registerFreeAccount("privat", "neukat");
  await setAccountPlan(acc.email, "premium");

  // Assistent mit Stundenlohn im Standard-Team (teamId weggelassen ->
  // resolveWriteTeamId-Fallback).
  const userRes = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E NeuKat Assistent ${Date.now()}`,
      email: `e2e.neukat.assistent.${Date.now()}@dienstplan.test`,
      role: "assistant",
      hourlyWage: WAGE,
    },
  });
  expect(userRes.status(), "Assistent sollte 201 liefern").toBe(201);
  assistantId = ((await userRes.json()) as { id: number }).id;

  // Vertrag 40h/Woche ab Jahresbeginn => ganztaegige Abwesenheiten = 8h.
  const contractRes = await acc.ctx.post("/api/contracts", {
    data: { userId: assistantId, startDate: `${YEAR}-01-01`, weeklyHours: 40, vacationDays: 30 },
  });
  expect(contractRes.status(), "Vertrag sollte 201 liefern").toBe(201);

  // Arbeitsdienst (FIX) mit Vertretungs-Markierung und unbezahlter Pause.
  const work = await createShift({
    userId: assistantId,
    type: "work",
    planningStatus: "FIX",
    startTime: WORK_START,
    endTime: WORK_END,
    isVertretung: true,
    pauseMinutes: PAUSE_MINUTES,
  });
  shiftIds.work = work.id;

  // Neue Kategorien als ganztaegige Eintraege (Frontend-Konvention 00:00-23:59).
  for (const [key, type, day] of [
    ["kindKrank", "kind_krank", KIND_KRANK_DAY],
    ["abgesagtAn", "abgesagt_an", ABGESAGT_AN_DAY],
    ["freistellung", "freistellung", FREISTELLUNG_DAY],
    ["abgesagtAg", "abgesagt_ag", ABGESAGT_AG_DAY],
    ["urlaubsabgeltung", "urlaubsabgeltung", URLAUBSABGELTUNG_DAY],
  ] as const) {
    const created = await createShift({
      userId: assistantId,
      type,
      ...fullDayTimes(day),
      // Info-Felder duerfen an Abwesenheits-Typen NICHT haengenbleiben —
      // der Server muss sie zuruecksetzen (hier bewusst mitgesendet).
      isVertretung: true,
      pauseMinutes: 45,
    });
    shiftIds[key] = created.id;
  }
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

test("Server setzt Vertretung/Pause bei Abwesenheits-Typen zurueck, behaelt sie am Arbeitsdienst", async () => {
  const work = await fetchShift(shiftIds.work);
  expect(work.isVertretung, "Arbeitsdienst muss Vertretung behalten").toBe(true);
  expect(work.pauseMinutes, "Arbeitsdienst muss Pausenminuten behalten").toBe(PAUSE_MINUTES);

  for (const key of ["kindKrank", "abgesagtAn", "freistellung", "abgesagtAg", "urlaubsabgeltung"]) {
    const stored = await fetchShift(shiftIds[key]);
    expect(stored.isVertretung ?? false, `${key}: isVertretung muss zurueckgesetzt sein`).toBe(false);
    expect(stored.pauseMinutes ?? 0, `${key}: pauseMinutes muss zurueckgesetzt sein`).toBe(0);
  }
});

test("Neue Kategorien erscheinen korrekt in GET /dashboard/hours-balance", async () => {
  // Erwartungswerte aus den GESPEICHERTEN Kennzahlen ableiten.
  const work = await fetchShift(shiftIds.work);
  const kindKrank = await fetchShift(shiftIds.kindKrank);
  const abgesagtAn = await fetchShift(shiftIds.abgesagtAn);
  const freistellung = await fetchShift(shiftIds.freistellung);
  const abgesagtAg = await fetchShift(shiftIds.abgesagtAg);
  const urlaubsabgeltung = await fetchShift(shiftIds.urlaubsabgeltung);

  const workHours = work.valuedHours ?? 0;
  const freistellungStd = freistellung.valuedHours ?? 0;
  const abgesagtAgStd = abgesagtAg.valuedHours ?? 0;
  const abgesagtAnStd = abgesagtAn.valuedHours ?? 0;
  const urlaubsabgeltungStd = urlaubsabgeltung.valuedHours ?? 0;

  // Ganztaegige Eintraege muessen mit den Tages-Soll-Stunden bewertet sein
  // (40h/5 = 8h) — sonst testet der Rest ins Leere.
  expect(workHours).toBe(8);
  for (const [name, val] of [
    ["freistellung", freistellungStd],
    ["abgesagt_ag", abgesagtAgStd],
    ["abgesagt_an", abgesagtAnStd],
    ["urlaubsabgeltung", urlaubsabgeltungStd],
    ["kind_krank", kindKrank.valuedHours ?? 0],
  ] as const) {
    expect(val, `${name} muss gewertete Tages-Stunden tragen`).toBe(8);
  }

  const row = await fetchBalanceRow();

  // --- Info-Spalten der neuen Kategorien ---
  expect(row.kindKrankTage, "Kind-krank-Tage").toBe(1);
  expect(row.abgesagtArbeitnehmerStunden, "AN-abgesagt-Stunden").toBe(round2(abgesagtAnStd));
  expect(row.freistellungTage, "Freistellungs-Tage").toBe(1);
  expect(row.freistellungStunden, "Freistellungs-Stunden").toBe(round2(freistellungStd));
  expect(row.abgesagtArbeitgeberStunden, "AG-abgesagt-Stunden").toBe(round2(abgesagtAgStd));
  expect(row.vertretungenAnzahl, "Nur der Arbeitsdienst ist Vertretung").toBe(1);
  expect(row.vertretungsStunden, "Vertretungs-Stunden = Roh-Dauer des Dienstes").toBe(8);
  expect(row.pausenzeitStunden, "Pausenzeit nur vom Arbeitsdienst").toBe(
    round2(PAUSE_MINUTES / 60)
  );

  // --- Soll/Erfuellt: unbezahlte Typen zaehlen NICHT, bezahlte als Lohnfortzahlung ---
  // Soll = nur der Arbeitsdienst (ganztaegige Abwesenheiten ohne ersetzten
  // Dienst zaehlen nicht zum Soll). Pausen reduzieren die Stunden NICHT.
  expect(row.plannedHours, "Soll = nur Arbeitsdienst").toBe(8);
  expect(row.valuedHours, "Gewertete Arbeitsstunden").toBe(round2(workHours));
  expect(row.totalFulfilledHours, "Erfuellt = Arbeit + Freistellung + AG-abgesagt").toBe(
    round2(workHours + freistellungStd + abgesagtAgStd)
  );
  expect(row.balance).toBe(round2(workHours + freistellungStd + abgesagtAgStd - 8));

  // --- Geld: basePay enthaelt bezahlte Kategorien, urlaubsabgeltung NUR als
  // eigene Euro-Position ausserhalb von totalPay, unbezahlte gar nicht ---
  expect(row.hourlyWage).toBeCloseTo(WAGE, 2);
  const expectedBase = round2(WAGE * (workHours + freistellungStd + abgesagtAgStd));
  expect(row.basePay, "Grundlohn = Arbeit + Freistellung + AG-abgesagt").toBe(expectedBase);
  // Keine Zuschlaege im Aufbau (Werktage, tagsueber, ganztaegige Abwesenheiten).
  expect(row.nightSurchargeHours).toBe(0);
  expect(row.sundaySurchargeHours).toBe(0);
  expect(row.holidaySurchargeHours).toBe(0);
  expect(row.nightSurchargePay).toBe(0);
  expect(row.sundaySurchargePay).toBe(0);
  expect(row.holidaySurchargePay).toBe(0);
  expect(row.totalPay, "totalPay OHNE Urlaubsabgeltung").toBe(expectedBase);
  expect(row.urlaubsabgeltungEuro, "Urlaubsabgeltung = Lohn x Stunden").toBe(
    round2(WAGE * urlaubsabgeltungStd)
  );
});
