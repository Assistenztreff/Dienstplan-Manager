import { execSync } from "node:child_process";
import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";
import {
  dbSetShiftPartialAbsence,
  dbResetDataMigrationMarker,
} from "./helpers/db";

/**
 * API-Tests fuer halbtaegigen Urlaub (Task #862): POST /api/shifts/bulk-absence
 * akzeptiert fuer EINEN Tag echte Uhrzeiten statt nur des Ganztages-Fallbacks
 * (00:00–23:59). Ein Tageseintrag mit echten Uhrzeiten wird NICHT wie ein
 * ganztaegiger Eintrag behandelt:
 *
 *  1. Zeiten werden 1:1 uebernommen (kein Erben von Dienstzeiten).
 *  2. Nur Dienste, die sich ECHT zeitlich ueberschneiden, werden ersetzt
 *     (Lohnausfallprinzip) — ein Dienst ausserhalb des Zeitfensters bleibt
 *     unberuehrt (anders als beim ganztaegigen Fall, der den ganzen Tag
 *     beansprucht).
 *  3. Ein neuer Dienst, der sich mit dem halbtaegigen Urlaub ueberschneidet,
 *     wird mit 409 abgelehnt (echte Kollisionspruefung, anders als bei
 *     ganztaegigem Urlaub, der nie kollidiert).
 *  4. DELETE des halbtaegigen Urlaubs erstattet nur die anteiligen Stunden
 *     (kein voller Vertragstag).
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

// Anker statt Fixjahr: der Vertragsbeginn liegt auf "heute + 1 Monat, Tag 1"
// und alle Testtage werden als Monats-Offset ab diesem Anker ausgedrueckt
// (nicht als fixer Kalendermonat). Das haelt die relative Abfolge (Vertrag
// vor den Testtagen) UND den Gesamtzeitraum dauerhaft innerhalb des
// 12-Monats-Vorausplanungs-Limits — unabhaengig davon, in welchem realen
// Monat der Lauf stattfindet (s. .agents/memory/e2e-absence-date-anchor-pattern.md).
const ANCHOR = new Date();
ANCHOR.setUTCMonth(ANCHOR.getUTCMonth() + 1, 1);
ANCHOR.setUTCHours(0, 0, 0, 0);

function monthOffset(monthsAfterAnchor: number, day: number): string {
  const d = new Date(ANCHOR);
  d.setUTCMonth(d.getUTCMonth() + monthsAfterAnchor, day);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

const CONTRACT_START = monthOffset(0, 1);

/** UTC-Zeitstempel — dieselbe Konvention, in der Abwesenheiten gespeichert werden. */
function iso(day: string, hhmm: string): string {
  return `${day}T${hhmm}:00.000Z`;
}

// Testtage lagen urspruenglich im Mai bei Vertragsbeginn Januar (4 Monate
// nach Vertragsbeginn) — dieser Offset bleibt erhalten, nur relativ zum Anker.
function dayString(day: number): string {
  return monthOffset(4, day);
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
  replacedShiftIds: number[];
};

let adminCtx: APIRequestContext;
let assistantId: number;
let contractId: number;

async function bulkAbsenceRange(
  type: string,
  days: { startTime: string; endTime: string }[],
): Promise<{ status: number; body: BulkResult & { error?: string; code?: string } }> {
  const res = await adminCtx.post("/api/shifts/bulk-absence", {
    data: { userId: assistantId, type, days },
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

async function listShifts(type: string): Promise<Shift[]> {
  const res = await adminCtx.get(`/api/shifts?type=${type}&userId=${assistantId}`);
  expect(res.ok(), `GET /api/shifts (${type}) fehlgeschlagen`).toBe(true);
  return ((await res.json()) as Shift[]).filter((s) => s.userId === assistantId);
}

async function deleteShift(id: number): Promise<void> {
  const res = await adminCtx.delete(`/api/shifts/${id}`);
  expect(res.ok(), `DELETE /api/shifts/${id} fehlgeschlagen`).toBe(true);
}

async function cleanupAllShifts(): Promise<void> {
  for (const type of ["vacation", "sick", "active"]) {
    for (const s of await listShifts(type)) {
      await adminCtx.delete(`/api/shifts/${s.id}`);
    }
  }
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
      name: `E2E Halbtag Urlaub ${unique}`,
      email: `e2e.halbtag.urlaub.${unique}@dienstplan.test`,
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
  await cleanupAllShifts();
  if (contractId) await adminCtx.delete(`/api/contracts/${contractId}`);
  if (assistantId) await adminCtx.delete(`/api/users/${assistantId}`);
  await adminCtx.dispose();
});

test.afterEach(async () => {
  await cleanupAllShifts();
});

test("legt Halbtags-Urlaub mit den exakt gewaehlten Uhrzeiten an (kein Ganztages-Fallback)", async () => {
  const day = dayString(11);
  const { status, body } = await bulkAbsenceRange("vacation", [
    { startTime: iso(day, "13:00"), endTime: iso(day, "17:00") },
  ]);
  expect(status, "Halbtags-Urlaub sollte 201 liefern").toBe(201);
  expect(body.createdCount).toBe(1);

  const vacations = await listShifts("vacation");
  expect(vacations).toHaveLength(1);
  expect(vacations[0]!.startTime).toBe(iso(day, "13:00"));
  expect(vacations[0]!.endTime).toBe(iso(day, "17:00"));
});

test("Dienst ausserhalb des Urlaubsfensters bleibt am selben Tag bestehen (Koexistenz)", async () => {
  const day = dayString(12);
  const morningRes = await adminCtx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "active",
      planningStatus: "FIX",
      startTime: iso(day, "08:00"),
      endTime: iso(day, "12:00"),
    },
  });
  expect(morningRes.status(), "Vormittags-Dienst anlegen sollte 201 liefern").toBe(201);
  const morningId = ((await morningRes.json()) as Shift).id;

  const { status, body } = await bulkAbsenceRange("vacation", [
    { startTime: iso(day, "13:00"), endTime: iso(day, "17:00") },
  ]);
  expect(status).toBe(201);
  expect(body.createdCount).toBe(1);
  expect(body.replacedShiftIds).not.toContain(morningId);

  const stillThere = await adminCtx.get(`/api/shifts/${morningId}`);
  expect(stillThere.status(), "Dienst ausserhalb des Zeitfensters muss erhalten bleiben").toBe(200);
});

test("Dienst, der sich ECHT mit dem Urlaubsfenster ueberschneidet, wird ersetzt (Lohnausfallprinzip)", async () => {
  const day = dayString(13);
  const overlapRes = await adminCtx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "active",
      planningStatus: "FIX",
      startTime: iso(day, "10:00"),
      endTime: iso(day, "14:00"),
    },
  });
  expect(overlapRes.status(), "Ueberlappenden Dienst anlegen sollte 201 liefern").toBe(201);
  const overlapId = ((await overlapRes.json()) as Shift).id;

  const { status, body } = await bulkAbsenceRange("vacation", [
    { startTime: iso(day, "13:00"), endTime: iso(day, "17:00") },
  ]);
  expect(status).toBe(201);
  expect(body.createdCount).toBe(1);
  expect(body.replacedShiftIds).toContain(overlapId);

  const gone = await adminCtx.get(`/api/shifts/${overlapId}`);
  expect(gone.status(), "Ueberlappender Dienst muss ersetzt (geloescht) worden sein").toBe(404);

  // Der halbtaegige Urlaub uebernimmt NICHT die Zeiten des ersetzten Dienstes
  // (10-14), sondern behaelt die vom Nutzer gewaehlten Zeiten (13-17) —
  // anders als beim ganztaegigen Fall (dort wird geerbt).
  const vacations = await listShifts("vacation");
  expect(vacations[0]!.startTime).toBe(iso(day, "13:00"));
  expect(vacations[0]!.endTime).toBe(iso(day, "17:00"));
});

test("Regression: Einzel-POST /api/shifts behaelt bei Halbtags-Urlaub die gewaehlten Uhrzeiten (kein Zeiten-Erben vom ersetzten Dienst)", async () => {
  const day = dayString(16);
  const overlapRes = await adminCtx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "active",
      planningStatus: "FIX",
      startTime: iso(day, "10:00"),
      endTime: iso(day, "14:00"),
    },
  });
  expect(overlapRes.status(), "Ueberlappenden Dienst anlegen sollte 201 liefern").toBe(201);
  const overlapId = ((await overlapRes.json()) as Shift).id;

  const vacationRes = await adminCtx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "vacation",
      startTime: iso(day, "13:00"),
      endTime: iso(day, "17:00"),
    },
  });
  expect(vacationRes.status(), "Einzel-POST Halbtags-Urlaub sollte 201 liefern").toBe(201);
  const created = (await vacationRes.json()) as Shift;

  // Der Einzel-Pfad muss sich wie der Bulk-Pfad verhalten: die vom Nutzer
  // gewaehlten Uhrzeiten (13-17) bleiben erhalten, statt die Zeiten des
  // ersetzten Dienstes (10-14) zu erben.
  expect(created.startTime).toBe(iso(day, "13:00"));
  expect(created.endTime).toBe(iso(day, "17:00"));

  const gone = await adminCtx.get(`/api/shifts/${overlapId}`);
  expect(gone.status(), "Ueberlappender Dienst muss ersetzt (geloescht) worden sein").toBe(404);
});

test("ein neuer Dienst, der den bestehenden Halbtags-Urlaub ueberschneidet, wird mit 409 abgelehnt", async () => {
  const day = dayString(14);
  const { status: vacStatus } = await bulkAbsenceRange("vacation", [
    { startTime: iso(day, "13:00"), endTime: iso(day, "17:00") },
  ]);
  expect(vacStatus).toBe(201);

  const conflictRes = await adminCtx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "active",
      planningStatus: "FIX",
      startTime: iso(day, "15:00"),
      endTime: iso(day, "19:00"),
    },
  });
  expect(conflictRes.status(), "Dienst ueber Halbtags-Urlaub sollte 409 liefern").toBe(409);

  // Dienst, der ausserhalb des Urlaubsfensters liegt, bleibt weiterhin erlaubt.
  const okRes = await adminCtx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "active",
      planningStatus: "FIX",
      startTime: iso(day, "17:00"),
      endTime: iso(day, "19:00"),
    },
  });
  expect(okRes.status(), "Dienst direkt nach dem Urlaubsende sollte 201 liefern").toBe(201);
});

test("DELETE eines Halbtags-Urlaubs erstattet nur die anteiligen Stunden (kein voller Vertragstag)", async () => {
  const day = dayString(15);
  const baseline = await vacationHoursUsed();

  const { status, body } = await bulkAbsenceRange("vacation", [
    { startTime: iso(day, "13:00"), endTime: iso(day, "17:00") },
  ]);
  expect(status).toBe(201);
  const afterCreate = await vacationHoursUsed();
  const bookedHalfDay = afterCreate - baseline;
  expect(bookedHalfDay, "Halbtags-Urlaub soll ~4h buchen, nicht den vollen Vertragstag (8h)").toBeCloseTo(4, 1);

  await deleteShift(body.shiftIds[0]!);
  const afterDelete = await vacationHoursUsed();
  expect(afterDelete, "Loeschen muss die anteiligen Stunden vollstaendig erstatten").toBeCloseTo(baseline, 2);
});

test("Regression: ganztaegiger Urlaub verhaelt sich weiterhin wie bisher (erbt Dienstzeiten, kollidiert nie)", async () => {
  const day = dayString(18);
  const workRes = await adminCtx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "active",
      planningStatus: "FIX",
      startTime: iso(day, "08:00"),
      endTime: iso(day, "14:00"),
    },
  });
  expect(workRes.status()).toBe(201);
  const workId = ((await workRes.json()) as Shift).id;

  const { status, body } = await bulkAbsenceRange("vacation", [
    { startTime: `${day}T00:00:00.000Z`, endTime: `${day}T23:59:59.000Z` },
  ]);
  expect(status).toBe(201);
  expect(body.createdCount).toBe(1);
  expect(body.replacedShiftIds).toContain(workId);

  const vacations = await listShifts("vacation");
  expect(vacations[0]!.startTime, "Ganztaegiger Urlaub erbt weiterhin Dienstzeiten").toBe(iso(day, "08:00"));
  expect(vacations[0]!.endTime).toBe(iso(day, "14:00"));

  // Ganztaegiger Urlaub kollidiert weiterhin nicht mit neuen Diensten.
  const laterRes = await adminCtx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "active",
      planningStatus: "FIX",
      startTime: iso(day, "18:00"),
      endTime: iso(day, "20:00"),
    },
  });
  expect(laterRes.status(), "Ganztaegiger Urlaub darf weiterhin keine Kollision ausloesen").toBe(201);
});

test("Regression: geerbte Uhrzeiten eines ganztaegigen Urlaubs loesen KEINE Kollision aus (isPartialAbsence)", async () => {
  // Reproduziert den zuvor bei der Code-Review gefundenen Fehler: Ein
  // ganztaegiger Urlaub, der ueber das Lohnausfallprinzip die echten
  // Uhrzeiten eines ersetzten Dienstes erbt (hier 08:00-14:00), sieht anhand
  // der reinen Uhrzeiten wie ein bewusst gewaehlter Halbtags-Urlaub aus.
  // Die Kollisionspruefung darf sich davon NICHT taeuschen lassen: ein neuer
  // Dienst, der zeitlich MIT dem geerbten Fenster ueberlappt (09:00-12:00,
  // liegt vollstaendig innerhalb von 08:00-14:00), muss trotzdem erfolgreich
  // angelegt werden koennen, weil der Urlaub laut isPartialAbsence=false
  // ganztaegig ist und komplett von der Kollisionspruefung ausgenommen wird.
  const day = dayString(19);
  const workRes = await adminCtx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "active",
      planningStatus: "FIX",
      startTime: iso(day, "08:00"),
      endTime: iso(day, "14:00"),
    },
  });
  expect(workRes.status()).toBe(201);
  const workId = ((await workRes.json()) as Shift).id;

  const { status, body } = await bulkAbsenceRange("vacation", [
    { startTime: `${day}T00:00:00.000Z`, endTime: `${day}T23:59:59.000Z` },
  ]);
  expect(status).toBe(201);
  expect(body.replacedShiftIds).toContain(workId);

  const vacations = await listShifts("vacation");
  expect(vacations[0]!.startTime, "Ganztaegiger Urlaub erbt weiterhin Dienstzeiten").toBe(iso(day, "08:00"));
  expect(vacations[0]!.endTime).toBe(iso(day, "14:00"));

  // Der neue Dienst ueberlappt zeitlich VOLLSTAENDIG mit den geerbten
  // Urlaubs-Uhrzeiten (09-12 liegt innerhalb von 08-14) — vor dem Fix haette
  // das faelschlich 409 ausgeloest, weil isPlainFullDay(08:00,14:00) false
  // ist und die alte Pruefung den Urlaub deshalb als "teilweise" behandelte.
  const overlappingRes = await adminCtx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "active",
      planningStatus: "FIX",
      startTime: iso(day, "09:00"),
      endTime: iso(day, "12:00"),
    },
  });
  expect(
    overlappingRes.status(),
    "Ganztaegiger Urlaub mit geerbten Uhrzeiten darf keine falsche Kollision ausloesen",
  ).toBe(201);
});

test("Backfill: Bestands-Halbtags-Urlaub ohne is_partial_absence-Flag wird nachgezogen und kollidiert danach wieder korrekt", async () => {
  // Reproduziert die zweite bei der Code-Review gefundene Regression: Die
  // Spalte is_partial_absence hat den Default `false`. Ein VOR der Spalte
  // angelegter Halbtags-Urlaub (echte Teil-Tag-Uhrzeiten, aber Flag=false,
  // hier simuliert per direktem DB-Zugriff) wuerde sonst faelschlich wie
  // ganztaegig behandelt: keine Kollision mehr mit neuen Diensten. Die
  // Backfill-Migration (scripts/backfill-partial-absence-flag) muss solche
  // Bestandszeilen anhand ihrer echten (nicht-ganztaegigen) Uhrzeiten auf
  // is_partial_absence=true nachziehen und damit das alte, uhrzeiten-basierte
  // Verhalten wiederherstellen.
  //
  // Der Backfill ist bewusst ein GENAU-EINMAL-Lauf pro Datenbank (Einmal-
  // Marker in `data_migrations`, s. Docstring in
  // backfill-partial-absence-flag.ts) — eine reine WHERE-Bedingung wuerde bei
  // jedem erneuten Aufruf frisch angelegte, bewusst ganztaegige Abwesenheiten
  // mit geerbten Uhrzeiten faelschlich als Teil-Tag umklassifizieren. Die
  // private Test-DB bleibt aber ueber viele Testlaeufe hinweg bestehen (s.
  // Memory private-test-dbs) — ohne Reset waere der Marker ab dem zweiten
  // Lauf dieses Specs bereits vergeben und jeder weitere Skriptaufruf ein
  // garantiertes No-op. Genau wie der echte Bestands-DB-Test
  // (backfill-partial-absence-flag.bestands-db.db.test.ts) muss dieses Spec
  // den Marker deshalb VOR dem Aufruf entfernen, um eine echte Bestands-DB
  // "von vor #862" nachzubilden.
  const day = dayString(20);
  const { status: vacStatus, body } = await bulkAbsenceRange("vacation", [
    { startTime: iso(day, "13:00"), endTime: iso(day, "17:00") },
  ]);
  expect(vacStatus).toBe(201);
  const shiftId = body.shiftIds[0]!;

  // Bestandszustand simulieren: Flag zurueck auf den Spalten-Default `false`,
  // obwohl die Uhrzeiten (13-17) klar nicht ganztaegig sind.
  await dbSetShiftPartialAbsence(shiftId, false);

  const beforeBackfillRes = await adminCtx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "active",
      planningStatus: "FIX",
      startTime: iso(day, "15:00"),
      endTime: iso(day, "19:00"),
    },
  });
  expect(
    beforeBackfillRes.status(),
    "Vor dem Backfill zeigt sich die Regression: Bestandszeile mit Flag=false kollidiert faelschlich nicht",
  ).toBe(201);
  if (beforeBackfillRes.ok()) {
    await deleteShift(((await beforeBackfillRes.json()) as Shift).id);
  }

  // Marker zuruecksetzen, BEVOR der Backfill laeuft: die private Test-DB
  // ueberlebt viele Testlaeufe, und der Einmal-Marker aus einem frueheren
  // Lauf dieses Specs (oder eines anderen Aufrufs des Skripts) wuerde den
  // Backfill sonst zu einem garantierten No-op machen (s. Kommentar oben).
  await dbResetDataMigrationMarker("backfill-partial-absence-flag");

  const env: NodeJS.ProcessEnv = { ...process.env };
  if (process.env.E2E_TEST_DATABASE_URL) {
    // APP_DATABASE_URL hat in normalize-db-url.ts Vorrang vor DATABASE_URL —
    // ohne diesen Override wuerde das Skript trotz DATABASE_URL-Override
    // gegen die Staging-DB laufen (s. Memory staging-prod-db-split).
    env.DATABASE_URL = process.env.E2E_TEST_DATABASE_URL;
    env.APP_DATABASE_URL = process.env.E2E_TEST_DATABASE_URL;
  }
  execSync("pnpm --filter @workspace/scripts run backfill-partial-absence-flag", {
    env,
    stdio: "pipe",
  });

  const vacations = await listShifts("vacation");
  const backfilled = vacations.find((s) => s.id === shiftId) as
    | (Shift & { isPartialAbsence?: boolean })
    | undefined;
  expect(backfilled, "Halbtags-Urlaub nach Backfill nicht mehr auffindbar").toBeTruthy();
  expect(
    backfilled!.isPartialAbsence,
    "Backfill muss is_partial_absence anhand der echten Uhrzeiten auf true setzen",
  ).toBe(true);

  const afterBackfillRes = await adminCtx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "active",
      planningStatus: "FIX",
      startTime: iso(day, "15:00"),
      endTime: iso(day, "19:00"),
    },
  });
  expect(
    afterBackfillRes.status(),
    "Nach dem Backfill muss die Kollisionspruefung wieder korrekt greifen",
  ).toBe(409);
});
