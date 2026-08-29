import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";
import { registerFreeAccount, deleteFreeAccount, type FreeAccount } from "./helpers/teams";

/**
 * API-Test: Ein bereits von der Assistenzkraft bestätigter Dienst (FIX) fällt
 * bei einer nachträglichen inhaltlichen Änderung (Zeit/Assistent/Modell/Pause)
 * auf ANGEBOTEN zurück und muss erneut bestätigt werden.
 *
 * Hintergrund: Ohne diesen Rückfall gölte eine geänderte Zeit stillschweigend
 * als bestätigt, ohne dass die Assistenzkraft davon erfährt. Der wichtigste
 * Fall ist T1b: Der Bearbeiten-Dialog sendet `planningStatus` IMMER mit,
 * vorbelegt mit dem ALTEN Wert — ein mitgesendeter, unveränderter Status ist
 * also keine bewusste Entscheidung und darf den Rückfall NICHT verhindern.
 *
 * NUR FÜR KÜNFTIGE DIENSTE (Kay-Entscheidung 28.08.2026): Bei einem bereits
 * gearbeiteten Dienst gilt die Korrektur sofort und der Dienst bleibt FIX —
 * eine schwebende Rückbestätigung wäre arbeitszeitrechtlich schlechter als
 * eine dokumentierte Änderung mit Widerspruchsrecht. Der vergangene Fall
 * steht in dienstplan-korrektur-kreislauf-api.spec.ts.
 *
 * Datumsfest: die Testtage werden RELATIV zu heute berechnet. Vorher standen
 * hier feste Juni-Tage — die Spec war dadurch nur im ersten Halbjahr grün und
 * ab Juli rot, weil ihre Dienste in die Vergangenheit rutschten und dort
 * (korrekterweise) nicht mehr zurückfallen. Dieselbe Zeitbombe wie in der
 * Abwesenheitskalender-Spec.
 *
 * Läuft rein über die API gegen den isolierten Test-Stack (kein UI nötig, da
 * der Rückfall serverseitig in PATCH /api/shifts/:id greift).
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

/** Kalendertag `tageVoraus` Tage in der ZUKUNFT, als YYYY-MM-DD. */
function kuenftigerTag(tageVoraus: number): string {
  const d = new Date();
  d.setDate(d.getDate() + tageVoraus);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const WORK_DAY = kuenftigerTag(20);
const VACATION_DAY = kuenftigerTag(21);

type Shift = { id: number; planningStatus: string; endTime: string };

let acc: FreeAccount;
let assistantId: number;
let workShiftId: number;
let vacationShiftId: number;

async function fetchShift(ctx: APIRequestContext, id: number): Promise<Shift> {
  const res = await ctx.get(`/api/shifts/${id}`);
  expect(res.ok(), `GET /api/shifts/${id} fehlgeschlagen (${res.status()})`).toBe(true);
  return (await res.json()) as Shift;
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  acc = await registerFreeAccount("privat", "dienstaenderung");

  const assistantRes = await acc.ctx.post("/api/users", {
    data: {
      name: "E2E Dienstaenderung Assistent",
      email: `e2e.dienstaenderung.assistent.${Date.now()}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(assistantRes.status(), "Assistent anlegen fehlgeschlagen").toBe(201);
  assistantId = ((await assistantRes.json()) as { id: number }).id;

  // Arbeitsdienst, verbindlich bestätigt (FIX ist der Default beim Anlegen).
  const workRes = await acc.ctx.post("/api/shifts", {
    data: {
      userId: assistantId,
      startTime: `${WORK_DAY}T08:00:00.000Z`,
      endTime: `${WORK_DAY}T16:00:00.000Z`,
      type: "active",
    },
  });
  expect(workRes.status(), "Arbeitsdienst anlegen fehlgeschlagen").toBe(201);
  const workShift = (await workRes.json()) as Shift;
  workShiftId = workShift.id;
  expect(workShift.planningStatus, "Neu angelegter Dienst muss FIX sein").toBe("FIX");

  // Abwesenheit (Urlaub) — bleibt laut Anweisung IMMER FIX.
  const vacationRes = await acc.ctx.post("/api/shifts", {
    data: {
      userId: assistantId,
      startTime: `${VACATION_DAY}T00:00:00.000Z`,
      endTime: `${VACATION_DAY}T23:59:59.000Z`,
      type: "vacation",
    },
  });
  expect(vacationRes.status(), "Urlaubstag anlegen fehlgeschlagen").toBe(201);
  vacationShiftId = ((await vacationRes.json()) as Shift).id;
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

test("T1 — Zeitänderung eines FIX-Dienstes fällt auf ANGEBOTEN zurück", async () => {
  const patchRes = await acc.ctx.patch(`/api/shifts/${workShiftId}`, {
    data: { endTime: `${WORK_DAY}T17:00:00.000Z` },
  });
  expect(patchRes.ok(), `PATCH fehlgeschlagen (${patchRes.status()})`).toBe(true);
  const updated = (await patchRes.json()) as Shift;
  expect(updated.planningStatus, "Zeitänderung muss FIX -> ANGEBOTEN zurückfallen lassen").toBe(
    "ANGEBOTEN",
  );
  expect((await fetchShift(acc.ctx, workShiftId)).planningStatus).toBe("ANGEBOTEN");
});

test("T1b — Rückfall greift auch, wenn der Dialog den unveränderten alten Status mitsendet", async () => {
  // Dienst zunächst wieder verbindlich stellen (echte, bewusste Bestätigung:
  // ANGEBOTEN -> FIX, keine Zeitfelder im selben Request).
  const reconfirm = await acc.ctx.patch(`/api/shifts/${workShiftId}`, {
    data: { planningStatus: "FIX", force: true },
  });
  expect(reconfirm.ok(), `Erneute Bestätigung fehlgeschlagen (${reconfirm.status()})`).toBe(true);
  expect(((await reconfirm.json()) as Shift).planningStatus).toBe("FIX");

  // Bearbeiten-Dialog-Verhalten: Zeitänderung UND der (unveränderte) alte
  // Status "FIX" werden im selben Body mitgesendet. Ohne den Rückfall wäre
  // dieser Fall im Test grün, aber in der Oberfläche wirkungslos.
  const patchRes = await acc.ctx.patch(`/api/shifts/${workShiftId}`, {
    data: { endTime: `${WORK_DAY}T18:00:00.000Z`, planningStatus: "FIX" },
  });
  expect(patchRes.ok(), `PATCH fehlgeschlagen (${patchRes.status()})`).toBe(true);
  const updated = (await patchRes.json()) as Shift;
  expect(
    updated.planningStatus,
    "Mitgesendeter, unveränderter Status darf den Rückfall nicht verhindern",
  ).toBe("ANGEBOTEN");
  expect((await fetchShift(acc.ctx, workShiftId)).planningStatus).toBe("ANGEBOTEN");
});

test("T2 — kein Rückfall, wenn nur die Notiz geändert wird", async () => {
  // Dienst wieder verbindlich stellen (echte Bestätigung, keine Zeitfelder).
  const reconfirm = await acc.ctx.patch(`/api/shifts/${workShiftId}`, {
    data: { planningStatus: "FIX", force: true },
  });
  expect(reconfirm.ok(), `Erneute Bestätigung fehlgeschlagen (${reconfirm.status()})`).toBe(true);
  expect(((await reconfirm.json()) as Shift).planningStatus).toBe("FIX");

  const patchRes = await acc.ctx.patch(`/api/shifts/${workShiftId}`, {
    data: { notes: "Nur eine Notiz" },
  });
  expect(patchRes.ok(), `PATCH fehlgeschlagen (${patchRes.status()})`).toBe(true);
  const updated = (await patchRes.json()) as Shift;
  expect(updated.planningStatus, "Reine Notiz-Änderung darf den Status nicht anfassen").toBe(
    "FIX",
  );
  expect((await fetchShift(acc.ctx, workShiftId)).planningStatus).toBe("FIX");
});

test("T3 — kein Rückfall bei Abwesenheiten (bleiben immer FIX)", async () => {
  const before = await fetchShift(acc.ctx, vacationShiftId);
  expect(before.planningStatus, "Urlaubstag muss FIX angelegt worden sein").toBe("FIX");

  const patchRes = await acc.ctx.patch(`/api/shifts/${vacationShiftId}`, {
    data: { endTime: `${VACATION_DAY}T23:59:00.000Z` },
  });
  expect(patchRes.ok(), `PATCH fehlgeschlagen (${patchRes.status()})`).toBe(true);
  const updated = (await patchRes.json()) as Shift;
  expect(updated.planningStatus, "Abwesenheiten bleiben immer FIX").toBe("FIX");
  expect((await fetchShift(acc.ctx, vacationShiftId)).planningStatus).toBe("FIX");
});
