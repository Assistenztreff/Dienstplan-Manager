import { test, expect } from "@playwright/test";
import {
  enableTimeTracking,
  deleteFreeAccount,
  registerFreeAccount,
  type FreeAccount,
} from "./helpers/teams";

/**
 * API-Test: Kein Fehler-Orakel beim ANLEGEN von Ist-Zeiten —
 * `POST /time-tracking` mit `shiftId`.
 *
 * Analog zum Muster-Spec fuer POST /shifts
 * (dienstplan-shifts-create-idor-api.spec.ts): Berechtigungs-Checks muessen
 * VOR inhaltlichen Pruefungen laufen. Vor der Korrektur liefen beim
 * shiftId-Pfad die Ownership-Pruefung (403 shift_not_owned) und die
 * Doppelbuchungs-Pruefung (409 shift_already_booked) VOR dem Team-Scope-Check.
 * Ein fremder Arbeitgeber Q konnte damit per Statuscode ausspaehen:
 * - ob eine Schicht-ID existiert (404 vs. 403/409),
 * - ob eine fremde Schicht einem bestimmten Nutzer gehoert (403 vs. 409),
 * - ob fuer eine fremde Schicht bereits eine Ist-Zeit erfasst ist (409).
 * Erwartet ist jetzt fuer JEDE teamfremde shiftId einheitlich 404 — identisch
 * zur Antwort fuer nicht existierende IDs (kein Existenz-/Zustands-Orakel).
 *
 * Aufbau:
 * - Arbeitgeber P (privat, Zeiterfassung an) mit Assistent, Schicht und
 *   bereits erfasster Ist-Zeit auf dieser Schicht (Duplikats-Zustand).
 * - Getrennter Arbeitgeber Q (privat, Zeiterfassung an) mit eigenem
 *   Assistenten + eigener Schicht.
 *
 * Geprueft (Done-Kriterien):
 * 1. Q -> POST /time-tracking mit P's shiftId + eigenem userId: 404
 *    (NICHT 403 shift_not_owned — kein Zuordnungs-Orakel).
 * 2. Q -> POST /time-tracking mit P's shiftId + P's Assistenten-userId
 *    (Schicht bereits gebucht): 404 (NICHT 409 shift_already_booked —
 *    kein Buchungsstand-Orakel), keine Codes/Daten im Body.
 * 3. Q -> POST /time-tracking mit nicht existierender shiftId: ebenfalls 404
 *    mit identischer Meldung (fremd und inexistent sind ununterscheidbar).
 * 4. Positivkontrolle: Q bucht die EIGENE Schicht (201); erneutes Buchen
 *    derselben Schicht liefert weiterhin 409 (Verhalten fuer Berechtigte
 *    unveraendert).
 * 5. Nachkontrolle P: es bleibt bei genau EINER Ist-Zeit auf P's Schicht.
 *
 * Laeuft rein ueber die API gegen den isolierten Test-Stack.
 */

const P_START = "2026-07-06T08:00:00.000Z";
const P_END = "2026-07-06T16:00:00.000Z";
const Q_START = "2026-07-07T08:00:00.000Z";
const Q_END = "2026-07-07T16:00:00.000Z";

let employerP: FreeAccount;
let employerQ: FreeAccount;

let pAssistantId = 0;
let qAssistantId = 0;
let pShiftId = 0;
let qShiftId = 0;

async function createAssistant(acc: FreeAccount, label: string): Promise<number> {
  const unique = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const res = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E TtCreateOracle ${label} ${unique}`,
      email: `e2e.ttcreateoracle.${label}.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(res.status(), `Assistent (${label}) anlegen sollte 201 liefern`).toBe(201);
  return ((await res.json()) as { id: number }).id;
}

async function createShift(
  acc: FreeAccount,
  userId: number,
  start: string,
  end: string,
): Promise<number> {
  const res = await acc.ctx.post("/api/shifts", {
    data: { userId, startTime: start, endTime: end, type: "active" },
  });
  expect(res.status(), "Schicht anlegen sollte 201 liefern").toBe(201);
  return ((await res.json()) as { id: number }).id;
}

test.beforeAll(async () => {
  test.setTimeout(120_000);

  // --- Arbeitgeber P: Assistent + Schicht + bereits gebuchte Ist-Zeit -------
  employerP = await registerFreeAccount("privat", "ttcreateoracle-p");
  await enableTimeTracking(employerP.ctx);
  pAssistantId = await createAssistant(employerP, "p");
  pShiftId = await createShift(employerP, pAssistantId, P_START, P_END);
  const pEntryRes = await employerP.ctx.post("/api/time-tracking", {
    data: {
      userId: pAssistantId,
      shiftId: pShiftId,
      actualStart: P_START,
      actualEnd: P_END,
    },
  });
  expect(
    pEntryRes.status(),
    "Ist-Zeit (P) auf der eigenen Schicht sollte 201 liefern",
  ).toBe(201);

  // --- Getrennter Arbeitgeber Q: eigener Assistent + eigene Schicht ---------
  employerQ = await registerFreeAccount("privat", "ttcreateoracle-q");
  await enableTimeTracking(employerQ.ctx);
  qAssistantId = await createAssistant(employerQ, "q");
  qShiftId = await createShift(employerQ, qAssistantId, Q_START, Q_END);
});

test.afterAll(async () => {
  await deleteFreeAccount(employerP);
  await deleteFreeAccount(employerQ);
});

test("POST /time-tracking mit fremder shiftId + eigenem userId liefert 404 (kein Zuordnungs-Orakel)", async () => {
  const res = await employerQ.ctx.post("/api/time-tracking", {
    data: {
      userId: qAssistantId,
      shiftId: pShiftId,
      actualStart: P_START,
      actualEnd: P_END,
    },
  });
  expect(
    res.status(),
    "SICHERHEIT: teamfremde shiftId muss 404 liefern — NICHT 403 shift_not_owned (verriete, dass die Schicht existiert und wem sie NICHT gehoert)",
  ).toBe(404);
  const body = await res.text();
  expect(body, "Antwort darf den Ownership-Code nicht enthalten").not.toContain(
    "shift_not_owned",
  );
});

test("POST /time-tracking mit fremder, bereits gebuchter shiftId liefert 404 (kein Buchungsstand-Orakel)", async () => {
  // P's Schicht ist bereits mit einer Ist-Zeit belegt: Liefe die
  // Doppelbuchungs-Pruefung vor dem Team-Scope-Check, kaeme hier ein 409
  // shift_already_booked zurueck — ein Orakel ueber den Buchungsstand
  // teamfremder Schichten.
  const res = await employerQ.ctx.post("/api/time-tracking", {
    data: {
      userId: pAssistantId,
      shiftId: pShiftId,
      actualStart: P_START,
      actualEnd: P_END,
    },
  });
  expect(
    res.status(),
    "SICHERHEIT: bereits gebuchte teamfremde Schicht muss 404 liefern — NICHT 409 shift_already_booked",
  ).toBe(404);
  const body = await res.text();
  expect(body, "Antwort darf den Duplikats-Code nicht enthalten").not.toContain(
    "shift_already_booked",
  );
});

test("Fremde und nicht existierende shiftId sind ununterscheidbar (identische 404-Antwort)", async () => {
  const foreignRes = await employerQ.ctx.post("/api/time-tracking", {
    data: {
      userId: qAssistantId,
      shiftId: pShiftId,
      actualStart: P_START,
      actualEnd: P_END,
    },
  });
  const missingRes = await employerQ.ctx.post("/api/time-tracking", {
    data: {
      userId: qAssistantId,
      shiftId: 99_999_999,
      actualStart: P_START,
      actualEnd: P_END,
    },
  });
  expect(missingRes.status(), "Nicht existierende shiftId muss 404 liefern").toBe(404);
  expect(
    await foreignRes.text(),
    "SICHERHEIT: fremde und inexistente shiftId muessen dieselbe Antwort liefern (kein Existenz-Orakel)",
  ).toBe(await missingRes.text());
});

test("Positivkontrolle: eigene Schicht buchbar (201), erneutes Buchen weiterhin 409", async () => {
  const first = await employerQ.ctx.post("/api/time-tracking", {
    data: {
      userId: qAssistantId,
      shiftId: qShiftId,
      actualStart: Q_START,
      actualEnd: Q_END,
    },
  });
  expect(
    first.status(),
    "Eigene Schicht muss buchbar sein — die 404 lagen am Scope",
  ).toBe(201);

  const second = await employerQ.ctx.post("/api/time-tracking", {
    data: {
      userId: qAssistantId,
      shiftId: qShiftId,
      actualStart: Q_START,
      actualEnd: Q_END,
    },
  });
  expect(
    second.status(),
    "Doppelbuchung der EIGENEN Schicht muss weiterhin 409 liefern (Verhalten fuer Berechtigte unveraendert)",
  ).toBe(409);
  expect(await second.text()).toContain("shift_already_booked");
});

test("Nachkontrolle P: weiterhin genau eine Ist-Zeit auf P's Schicht", async () => {
  const res = await employerP.ctx.get(`/api/time-tracking?userId=${pAssistantId}`);
  expect(res.status(), "P muss seine Ist-Zeiten lesen koennen").toBe(200);
  const rows = (await res.json()) as { shiftId: number | null }[];
  expect(
    rows.filter((r) => r.shiftId === pShiftId).length,
    "SICHERHEIT: Durch die Fremd-Angriffe darf keine zusaetzliche Ist-Zeit auf P's Schicht entstanden sein",
  ).toBe(1);
});
