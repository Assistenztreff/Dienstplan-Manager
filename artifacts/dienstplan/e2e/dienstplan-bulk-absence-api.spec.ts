import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";
import { computeAnchorOffsetDay } from "@workspace/test-fixtures/anchor-dates";

/**
 * API-Tests fuer den Sammel-Endpunkt POST /api/shifts/bulk-absence (Task #715):
 * Abwesenheits-Zeitraeume werden in EINEM Request transaktional angelegt statt
 * Tag fuer Tag (Einzel-POSTs kosten ~Sekunden pro Tag durch die Urlaubskonto-
 * Fortschreibung; Netzwerkfehler hinterliessen Teil-Zeitraeume).
 *
 * Abgesichert wird:
 *  1. Mehrtaegiger Urlaub in einem Request; das Urlaubskonto wird EXAKT so
 *     fortgeschrieben wie bei N Einzel-POSTs (Kern-Invariante des Umbaus).
 *  2. Zeitraum ueber eine Monatsgrenze; Tage mit bestehender Abwesenheit
 *     desselben Typs werden UEBERSPRUNGEN und gemeldet (kein 409-Abbruch);
 *     komplett vorhandener Zeitraum -> createdCount 0.
 *  3. Rollback: Liegt EIN Urlaubstag ausserhalb des Vertragszeitraums
 *     (vacation_outside_contract), wird KEIN einziger Tag angelegt und das
 *     Urlaubskonto bleibt unveraendert (ganz oder gar nicht).
 *  4. Lohnausfallprinzip pro Tag: geplante Dienste am Abwesenheitstag werden
 *     geloescht, die Abwesenheit erbt deren Zeiten; Tage ohne Dienst bleiben
 *     ganztaegig. Abwesenheiten sind immer FIX.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

// Die Testdaten sind ueber viele (simulierte) Monate verteilt (kollisionsfrei
// je Test). Ein fruehrer Ansatz bildete jeden benutzten Kalendermonat (Feb,
// Maerz, Juni, ...) EINZELN auf sein naechstes zukuenftiges Vorkommen ab -
// das kann aber die chronologische Reihenfolge zwischen einem fruehen
// Monat (z. B. Vertragsbeginn im Maerz) und einem spaeteren abhaengigen
// Datum (z. B. Urlaub im Juni) INVERTIEREN, sobald "heute" zwischen den
// beiden realen Kalendermonaten liegt (z. B. im April: naechster Maerz faellt
// dann ins naechste Jahr, naechster Juni bleibt im aktuellen -> Maerz > Juni!).
// Das loest faelschlich vacation_outside_contract aus. Siehe
// .agents/memory/e2e-absence-date-anchor-pattern.md.
//
// Stattdessen: EIN Anker (heute + kleiner Puffer, 1. Tag des Monats), alle
// Testdaten als Monats-/Tages-OFFSET vom Anker (nie unabhaengig je Monat neu
// aufgeloest). Das haelt die relative Reihenfolge alle Testdaten IMMER
// stabil, unabhaengig davon, in welchem realen Kalendermonat die Suite
// laeuft.
//
// ACHTUNG (siehe .agents/memory/e2e-absence-date-anchor-pattern.md):
// `Date.UTC` wirft NIE bei einem ueberlaufenden Tag, sondern rollt ihn still
// in den Folgemonat (Tag 30 in einem 28-Tage-Monat -> 2. Tag des
// Folgemonats). Das verhindert zwar ungueltige Datumsobjekte, aber NICHT,
// dass zwei fuer unterschiedliche Monats-Offsets gedachte Tage auf denselben
// realen Kalendertag kollabieren (z. B. wenn der fruehere Offset zufaellig
// auf einen kurzen Februar faellt). Wer mehrere UNTERSCHEIDBARE Tage im
// selben Monats-Offset braucht, muss Tageszahlen <= 28 verwenden (jeder
// Kalendermonat hat mindestens 28 Tage) statt sich auf 29/30/31 zu
// verlassen. Die geteilte Formel + eine Kollisions-Regressionspruefung
// liegen in lib/test-fixtures/src/anchor-dates.(ts|test.ts).
const ANCHOR_BUFFER_MONTHS = 2;
const ANCHOR_YEAR = new Date().getUTCFullYear();
const ANCHOR_MONTH0 = new Date().getUTCMonth() + ANCHOR_BUFFER_MONTHS; // 0-basiert, darf > 11 sein

/** Datumsstring `YYYY-MM-DD` fuer `monthOffset` Kalendermonate ab dem Anker, am `day`. */
function offsetDay(monthOffset: number, day: number): string {
  return computeAnchorOffsetDay(ANCHOR_YEAR, ANCHOR_MONTH0, monthOffset, day);
}

// Vertrag beginnt bewusst NICHT am Anker-Monatsanfang selbst, sondern am
// Anker (Offset 0) - der Rollback-Test unten nutzt Offset -1 (VOR
// Vertragsbeginn), um den Ablehnungsfall testbar zu halten.
const CONTRACT_START = offsetDay(0, 1);

// Fuer die DST-Regressionstests wird bewusst ein ECHTER Kalendermonat (Maerz/
// Oktober) benoetigt, da die deutsche Zeitumstellung an einen realen Monat
// gebunden ist. Diese beiden Aufrufe haben KEINE Ordnungs-Abhaengigkeit zu
// CONTRACT_START/den anderen Testdaten (andere Abwesenheits-Typen, keine
// vacation_outside_contract-Pruefung) - unabhaengige Aufloesung ist hier
// unproblematisch; jeder Aufruf bleibt wegen des mind. 1-Monat-Puffers
// zwischen 1 und 12 Monate in der Zukunft (siehe forwardPlanningBlocked).
function nextRealCalendarMonthDay(month1based: number, day: number): string {
  const now = new Date();
  const nowIdx = now.getUTCFullYear() * 12 + now.getUTCMonth();
  let idx = now.getUTCFullYear() * 12 + (month1based - 1);
  while (idx < nowIdx + 1) idx += 12;
  const year = Math.floor(idx / 12);
  return new Date(Date.UTC(year, month1based - 1, day)).toISOString().split("T")[0]!;
}

// Letzter Sonntag eines Monats (dynamisch je Zieljahr berechnet, damit die
// DST-Regressionstests unten immer den tatsaechlichen Umstellungstag treffen).
function lastSundayOnOrBefore(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split("T")[0]!;
}

// Ganztaegige Zeiten, exakt wie das Frontend sie sendet (00:00–23:59 UTC).
// Explizites "Z" damit die Dauer immer ~23:59:59 betraegt — unabhaengig
// von der lokalen Zeitzone des Testrechners und von DST-Umstellungen.
function fullDay(day: string): { startTime: string; endTime: string } {
  return {
    startTime: `${day}T00:00:00.000Z`,
    endTime: `${day}T23:59:59.000Z`,
  };
}

type CreatedUser = { id: number };
type Contract = { id: number; vacationHoursUsed: number };
type Shift = {
  id: number;
  userId: number;
  type: string;
  startTime: string;
  endTime: string;
  planningStatus?: string | null;
};
type BulkResult = {
  createdCount: number;
  skippedCount: number;
  skippedDates: string[];
  shiftIds: number[];
};

let adminCtx: APIRequestContext;
let assistantId: number;
let contractId: number;

async function bulkAbsence(
  type: string,
  days: string[],
): Promise<{ status: number; body: BulkResult & { error?: string; code?: string } }> {
  const res = await adminCtx.post("/api/shifts/bulk-absence", {
    data: { userId: assistantId, type, days: days.map(fullDay) },
  });
  return {
    status: res.status(),
    body: (await res.json()) as BulkResult & { error?: string; code?: string },
  };
}

async function vacationHoursUsed(): Promise<number> {
  const res = await adminCtx.get(`/api/contracts?userId=${assistantId}`);
  expect(res.ok(), "GET /api/contracts fehlgeschlagen").toBe(true);
  const contracts = (await res.json()) as Contract[];
  const contract = contracts.find((c) => c.id === contractId);
  expect(contract, "Vertrag nicht gefunden").toBeTruthy();
  return contract!.vacationHoursUsed;
}

async function listAbsences(type: string): Promise<Shift[]> {
  const res = await adminCtx.get(`/api/shifts?type=${type}&userId=${assistantId}`);
  expect(res.ok(), `GET /api/shifts (${type}) fehlgeschlagen`).toBe(true);
  return ((await res.json()) as Shift[]).filter((s) => s.userId === assistantId);
}

async function deleteShift(id: number): Promise<void> {
  const res = await adminCtx.delete(`/api/shifts/${id}`);
  expect(res.ok(), `DELETE /api/shifts/${id} fehlgeschlagen`).toBe(true);
}

test.beforeAll(async () => {
  test.setTimeout(60_000);
  adminCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const loginRes = await adminCtx.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(loginRes.ok(), "Admin-Login fuer Setup fehlgeschlagen").toBe(true);

  const unique = Date.now();
  const userRes = await adminCtx.post("/api/users", {
    data: {
      name: `E2E Bulk Absence ${unique}`,
      email: `e2e.bulk.absence.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(userRes.ok(), `Anlegen der Assistenzkraft fehlgeschlagen (${userRes.status()})`).toBe(true);
  assistantId = ((await userRes.json()) as CreatedUser).id;

  const contractRes = await adminCtx.post("/api/contracts", {
    data: {
      userId: assistantId,
      startDate: CONTRACT_START,
      weeklyHours: 40,
      vacationDays: 30,
    },
  });
  expect(contractRes.ok(), `Anlegen des Vertrags fehlgeschlagen (${contractRes.status()})`).toBe(true);
  contractId = ((await contractRes.json()) as Contract).id;
});

test.afterAll(async () => {
  for (const type of ["vacation", "sick", "active"]) {
    const res = await adminCtx.get(`/api/shifts?type=${type}&userId=${assistantId}`);
    if (res.ok()) {
      const shifts = (await res.json()) as Shift[];
      for (const s of shifts.filter((s) => s.userId === assistantId)) {
        await adminCtx.delete(`/api/shifts/${s.id}`);
      }
    }
  }
  if (contractId) await adminCtx.delete(`/api/contracts/${contractId}`);
  if (assistantId) await adminCtx.delete(`/api/users/${assistantId}`);
  await adminCtx.dispose();
});

test("bucht einen mehrtaegigen Urlaubszeitraum in einem Request und das Urlaubskonto wie Einzel-Anlagen", async () => {
  // Einzel-POSTs mit Urlaubskonto-Fortschreibung dauern ~5s pro Tag.
  test.setTimeout(120_000);
  const days = [offsetDay(3, 15), offsetDay(3, 16), offsetDay(3, 17)];

  const baselineBulk = await vacationHoursUsed();
  const { status, body } = await bulkAbsence("vacation", days);
  expect(status, "Sammel-Anlage sollte 201 liefern").toBe(201);
  expect(body.createdCount).toBe(3);
  expect(body.skippedCount).toBe(0);
  expect(body.shiftIds).toHaveLength(3);
  expect((await listAbsences("vacation")).length).toBe(3);
  const deltaBulk = (await vacationHoursUsed()) - baselineBulk;
  expect(deltaBulk, "Sammel-Anlage muss Urlaubsstunden buchen").toBeGreaterThan(0);

  // Referenz: dieselben Tage als Einzel-POSTs muessen dieselbe Buchung ergeben.
  for (const id of body.shiftIds) await deleteShift(id);
  const baselineSingle = await vacationHoursUsed();
  for (const day of days) {
    const res = await adminCtx.post("/api/shifts", {
      data: { userId: assistantId, type: "vacation", ...fullDay(day) },
    });
    expect(res.status(), `Einzel-Urlaub ${day} sollte 201 liefern`).toBe(201);
  }
  const deltaSingle = (await vacationHoursUsed()) - baselineSingle;
  expect(deltaBulk, "Sammel-Buchung muss Einzel-Buchungen entsprechen").toBeCloseTo(deltaSingle, 2);

  // Aufraeumen fuer die Folgetests (Urlaubs-Bestand zuruecksetzen).
  for (const s of await listAbsences("vacation")) await deleteShift(s.id);
});

test("ueberspringt vorhandene Tage statt 409 und traegt ueber Monatsgrenzen ein", async () => {
  // Zeitraum ueber eine Kalendermonatsgrenze (Anker-Monat +6 -> +7).
  // Tage bewusst <= 28 im FRUEHEREN Monat (jeder Kalendermonat hat
  // mindestens 28 Tage, auch Februar in einem Gemeinjahr) und <= 2 im
  // SPAETEREN Monat: so bleibt jedes Datum garantiert im beabsichtigten
  // Monat, ohne `Date.UTC`-Ueberlauf. Ein Tag wie 29/30/31 wuerde bei einem
  // kurzen Monat (z. B. Anker-Monat +6 = Februar) in den Folgemonat
  // ueberlaufen und mit den "naechster Monat"-Tagen kollidieren — vier
  // vermeintlich verschiedene Tage wuerden auf nur zwei reale Kalendertage
  // zusammenfallen (siehe .agents/memory/e2e-absence-date-anchor-pattern.md).
  const firstRange = [
    offsetDay(6, 27),
    offsetDay(6, 28),
    offsetDay(7, 1),
    offsetDay(7, 2),
  ];
  const first = await bulkAbsence("sick", firstRange);
  expect(first.status).toBe(201);
  expect(first.body.createdCount).toBe(4);
  expect(first.body.skippedCount).toBe(0);

  // Erweiterter Zeitraum: nur der neue Tag wird angelegt, der Rest gemeldet.
  const second = await bulkAbsence("sick", [offsetDay(6, 26), ...firstRange]);
  expect(second.status).toBe(201);
  expect(second.body.createdCount).toBe(1);
  expect(second.body.skippedCount).toBe(4);
  expect(second.body.skippedDates.sort()).toEqual(firstRange);
  expect((await listAbsences("sick")).length).toBe(5);

  // Komplett vorhandener Zeitraum: nichts angelegt, alles gemeldet.
  const third = await bulkAbsence("sick", [offsetDay(6, 26), ...firstRange]);
  expect(third.status).toBe(201);
  expect(third.body.createdCount).toBe(0);
  expect(third.body.skippedCount).toBe(5);
  expect((await listAbsences("sick")).length).toBe(5);
});

test("legt bei Urlaub ausserhalb des Vertragszeitraums KEINEN einzigen Tag an", async () => {
  const baseline = await vacationHoursUsed();
  const existingVacations = (await listAbsences("vacation")).length;

  // Die ersten Tage liegen VOR dem Vertragsbeginn (CONTRACT_START, Anker-
  // Monat +0), die letzten dahinter — ohne Transaktion entstuende ein
  // Teil-Zeitraum ab dem Vertragsbeginn.
  const { status, body } = await bulkAbsence("vacation", [
    offsetDay(-1, 26),
    offsetDay(-1, 27),
    offsetDay(0, 2),
    offsetDay(0, 3),
  ]);
  expect(status, "Urlaub vor Vertragsbeginn sollte 400 liefern").toBe(400);
  expect(body.code).toBe("vacation_outside_contract");

  expect((await listAbsences("vacation")).length, "Kein Teil-Zeitraum").toBe(existingVacations);
  expect(await vacationHoursUsed(), "Urlaubskonto unveraendert").toBe(baseline);
});

test("zwei GLEICHZEITIGE identische Zeitraeume buchen jeden Tag nur einmal", async () => {
  // Doppelklick-Schutz: Ohne Advisory-Lock saehen beide Requests "Tag ist
  // frei" und buchten die Abwesenheit doppelt (inkl. doppeltem Urlaubsabzug).
  test.setTimeout(120_000);
  const days = [offsetDay(8, 16), offsetDay(8, 17)];
  const [a, b] = await Promise.all([
    bulkAbsence("sick", days),
    bulkAbsence("sick", days),
  ]);
  expect(a.status).toBe(201);
  expect(b.status).toBe(201);
  expect(a.body.createdCount + b.body.createdCount, "jeder Tag nur EINMAL angelegt").toBe(2);
  expect(a.body.skippedCount + b.body.skippedCount, "der langsamere ueberspringt beide Tage").toBe(2);

  const created = (await listAbsences("sick")).filter((s) =>
    days.some((d) => s.startTime.startsWith(d)),
  );
  expect(created.length).toBe(2);
});

test("ersetzt geplante Dienste am Abwesenheitstag und erbt deren Zeiten", async () => {
  const dayWithShift = offsetDay(7, 14);
  const dayWithout = offsetDay(7, 15);
  const shiftStart = new Date(`${dayWithShift}T08:00:00`).toISOString();
  const shiftEnd = new Date(`${dayWithShift}T14:00:00`).toISOString();
  const workRes = await adminCtx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "active",
      planningStatus: "FIX",
      startTime: shiftStart,
      endTime: shiftEnd,
    },
  });
  expect(workRes.status(), "Dienst anlegen sollte 201 liefern").toBe(201);
  const workShiftId = ((await workRes.json()) as Shift).id;

  const { status, body } = await bulkAbsence("sick", [dayWithShift, dayWithout]);
  expect(status).toBe(201);
  expect(body.createdCount).toBe(2);

  // Der geplante Dienst ist geloescht (Lohnausfallprinzip) ...
  const gone = await adminCtx.get(`/api/shifts/${workShiftId}`);
  expect(gone.status(), "Ersetzter Dienst muss geloescht sein").toBe(404);

  // ... die Abwesenheit traegt seine Zeiten; der Tag ohne Dienst bleibt ganztaegig.
  const sickShifts = await listAbsences("sick");
  const inherited = sickShifts.find((s) => s.startTime === shiftStart);
  expect(inherited, "Abwesenheit muss die Dienstzeiten erben").toBeTruthy();
  expect(inherited!.endTime).toBe(shiftEnd);
  expect(inherited!.planningStatus).toBe("FIX");
  const untouched = sickShifts.find(
    (s) => s.startTime === `${dayWithout}T00:00:00.000Z`,
  );
  expect(untouched, "Tag ohne Dienst bleibt ganztaegig").toBeTruthy();
});

// ── Regression: uebersprungene Tage behalten ihre Dienste ────────────────────
// Beim Bulk-Auftrag wird jeder Tag, an dem bereits eine Abwesenheit desselben
// Typs existiert, UEBERSPRUNGEN (skipped). Dabei duerfen geplante Arbeitsdienste
// an eben diesen Tagen NICHT geloescht werden — nur Dienste an den NEUEN Tagen
// werden ersetzt. Ohne den Fix wurden auch Dienste an uebersprungenen Tagen
// aus der ranges-weiten plannedWork-Abfrage gezogen und geloescht.

test("geplante Dienste an uebersprungenen Tagen bleiben erhalten", async () => {
  // Tag A: bereits eine Abwesenheit, zusaetzlich ein geplanter Dienst
  // Tag B: keine Abwesenheit, hat einen geplanten Dienst (soll ersetzt werden)
  // Tag C: keine Abwesenheit, kein Dienst (soll ganztaegig angelegt werden)
  const dayA = offsetDay(4, 10);
  const dayB = offsetDay(4, 11);
  const dayC = offsetDay(4, 12);

  // Bestehende Abwesenheit an Tag A anlegen
  const existingAbsRes = await adminCtx.post("/api/shifts", {
    data: { userId: assistantId, type: "sick", ...fullDay(dayA) },
  });
  expect(existingAbsRes.status(), "Bestehende Abwesenheit anlegen sollte 201 liefern").toBe(201);
  const existingAbsId = ((await existingAbsRes.json()) as { id: number }).id;

  // Geplanter Dienst an Tag A — wird uebersprungen, darf NICHT geloescht werden
  const shiftOnSkippedRes = await adminCtx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "active",
      planningStatus: "FIX",
      startTime: new Date(`${dayA}T08:00:00`).toISOString(),
      endTime: new Date(`${dayA}T14:00:00`).toISOString(),
    },
  });
  expect(shiftOnSkippedRes.status(), "Dienst an uebersprungsTag anlegen sollte 201 liefern").toBe(201);
  const shiftOnSkippedId = ((await shiftOnSkippedRes.json()) as { id: number }).id;

  // Geplanter Dienst an Tag B — wird NEU angelegt, muss geloescht werden
  const shiftOnNewRes = await adminCtx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "active",
      planningStatus: "FIX",
      startTime: new Date(`${dayB}T09:00:00`).toISOString(),
      endTime: new Date(`${dayB}T15:00:00`).toISOString(),
    },
  });
  expect(shiftOnNewRes.status(), "Dienst an neuem Tag anlegen sollte 201 liefern").toBe(201);
  const shiftOnNewId = ((await shiftOnNewRes.json()) as { id: number }).id;

  // Sammel-Anlage: Tag A wird uebersprungen (Abwesenheit existiert bereits),
  // Tag B und C werden neu angelegt.
  const { status, body } = await bulkAbsence("sick", [dayA, dayB, dayC]);
  expect(status, "Sammel-Anlage sollte 201 liefern").toBe(201);
  expect(body.skippedCount, "Tag A muss uebersprungen werden").toBe(1);
  expect(body.skippedDates, "Tag A muss in skippedDates stehen").toContain(dayA);
  expect(body.createdCount, "Tag B und C muessen neu angelegt werden").toBe(2);

  // Kern der Regression: Dienst an uebersprungsTag A bleibt erhalten
  const skippedShiftStillThere = await adminCtx.get(`/api/shifts/${shiftOnSkippedId}`);
  expect(
    skippedShiftStillThere.status(),
    "Dienst an uebersprungsTag darf NICHT geloescht worden sein",
  ).toBe(200);

  // Dienst an Tag B muss geloescht sein (Lohnausfallprinzip am neuen Tag)
  const replacedShiftGone = await adminCtx.get(`/api/shifts/${shiftOnNewId}`);
  expect(
    replacedShiftGone.status(),
    "Dienst am neu angelegten Tag muss geloescht sein",
  ).toBe(404);

  // Aufraeumen: bestehende Abwesenheit + verbliebener Dienst an Tag A
  await deleteShift(existingAbsId);
  await deleteShift(shiftOnSkippedId);
  for (const id of body.shiftIds) await deleteShift(id);
});

// ── Zeitumstellungs-Regressionstests (Task #756) ─────────────────────────────
// In Deutschland ist der Tag der Sommerzeit-Umstellung (letzter Sonntag im
// Maerz) 23 UTC-Stunden lang; der Tag der Winterzeit-Umstellung (letzter
// Sonntag im Oktober) 25 UTC-Stunden. Mit UTC-Konvention (T00:00:00.000Z bis
// T23:59:59.000Z) betraegt die Dauer immer ~23:59:59 — DST-neutral.

test("akzeptiert ganztaegige Abwesenheit am Winterzeit-Umstellungstag (letzter Sonntag im Oktober)", async () => {
  // Deutschland stellt am letzten Sonntag im Oktober auf Winterzeit um (CEST → CET).
  // Berliner Mitternacht-zu-Mitternacht = 25 UTC-Stunden, aber UTC-Konvention
  // liefert immer ~23:59:59 — keine falsche 24h-Ueberschreitung.
  const dst = lastSundayOnOrBefore(nextRealCalendarMonthDay(10, 31));
  const { status, body } = await bulkAbsence("freizeitausgleich", [dst]);
  expect(status, "Winterzeit-Umstellungstag sollte 201 liefern").toBe(201);
  expect(body.createdCount).toBe(1);
  // Aufraeumen: Der Zeitraum-Test unten deckt denselben Tag ab und wuerde ihn
  // sonst als bereits vorhanden ueberspringen (Reihenfolge-Abhaengigkeit).
  for (const id of body.shiftIds) await deleteShift(id);
});

test("akzeptiert ganztaegige Abwesenheit am Sommerzeit-Umstellungstag (letzter Sonntag im Maerz)", async () => {
  // Deutschland stellt am letzten Sonntag im Maerz auf Sommerzeit um (CET → CEST).
  // Berliner Mitternacht-zu-Mitternacht = 23 UTC-Stunden, UTC-Konvention
  // liefert weiterhin ~23:59:59 — kein falscher Kurztagfehler.
  const dst = lastSundayOnOrBefore(nextRealCalendarMonthDay(3, 31));
  const { status, body } = await bulkAbsence("freizeitausgleich", [dst]);
  expect(status, "Sommerzeit-Umstellungstag sollte 201 liefern").toBe(201);
  expect(body.createdCount).toBe(1);
  for (const id of body.shiftIds) await deleteShift(id);
});

test("akzeptiert Zeitraum ueber die Winterzeit-Umstellung hinweg", async () => {
  // Drei Tage rund um den Winterzeit-Umstellungstag; alle drei muessen angelegt werden.
  const dst = new Date(`${lastSundayOnOrBefore(nextRealCalendarMonthDay(10, 31))}T00:00:00Z`);
  const days = [-2, 0, 2].map(
    (offset) => new Date(dst.getTime() + offset * 86_400_000).toISOString().split("T")[0]!,
  );
  const { status, body } = await bulkAbsence("freizeitausgleich", days);
  expect(status, "Zeitraum ueber Winterzeitumstellung sollte 201 liefern").toBe(201);
  expect(body.createdCount).toBe(3);
});

test("lehnt Abwesenheit mit Start und Ende auf verschiedenen UTC-Tagen ab (25h Berliner Lokalzeit)", async () => {
  // Die UTC-Konvention verlangt, dass Start und Ende auf demselben UTC-Kalendertag
  // liegen (T00:00:00Z–T23:59:59Z). Ein Interval, das zwei UTC-Tage ueberspannt
  // (Berliner Lokalzeit-Mitternacht am Winterzeit-Umstellungstag = 22:00–23:00 UTC
  // zwei aufeinanderfolgende Tage, 25h), wird daher mit 400 abgelehnt.
  const winterDst = new Date(`${lastSundayOnOrBefore(nextRealCalendarMonthDay(10, 31))}T00:00:00Z`);
  const dayBeforeDst = new Date(winterDst.getTime() - 86_400_000).toISOString().split("T")[0]!;
  const dstDay = winterDst.toISOString().split("T")[0]!;
  const res = await adminCtx.post("/api/shifts/bulk-absence", {
    data: {
      userId: assistantId,
      type: "freistellung",
      days: [
        {
          startTime: `${dayBeforeDst}T22:00:00.000Z`, // 00:00 CEST (UTC+2)
          endTime: `${dstDay}T23:00:00.000Z`,   // 00:00 CET (UTC+1, naechster Tag)
        },
      ],
    },
  });
  expect(res.status(), "Interval ueber zwei UTC-Tage muss 400 liefern").toBe(400);
});
