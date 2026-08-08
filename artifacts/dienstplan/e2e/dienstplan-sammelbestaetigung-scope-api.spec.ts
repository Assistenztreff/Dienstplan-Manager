import { test, expect } from "@playwright/test";
import {
  enableTimeTracking,
  deleteFreeAccount,
  registerFreeAccount,
  setAccountPlan,
  type FreeAccount,
} from "./helpers/teams";

/**
 * API-Test (#443, Teil 1): SCHREIB-Seite der Sammelbestaetigung —
 * `POST /api/time-tracking/confirm-batch`.
 *
 * Die Einzel-Bestaetigung ist bereits per Tenant-Grenze abgesichert
 * (dienstplan-time-tracking-write-idor-api.spec.ts: confirm auf fremde Ist-Zeit
 * -> 404). Die Sammelbestaetigung nimmt hingegen eine ID-LISTE entgegen und darf
 * fremde IDs NICHT bestaetigen, sondern muss sie STILL ueberspringen:
 * - `confirmedCount` zaehlt nur die tatsaechlich (im eigenen Team-Scope)
 *   bestaetigten Eintraege,
 * - fremde Eintraege bleiben unveraendert `pending` (kein Zugriff),
 * - es gibt keinen Informations-Leak, welche fremden IDs existieren (kein 404
 *   pro ID, keine Fehlermeldung, nur der Zaehler).
 *
 * Eine Regression (z. B. Wegfall des `teamId ∈ allowedTeams`-Filters im
 * UPDATE-WHERE) wuerde es einem fremden Arbeitgeber erlauben, lohnrelevante
 * Ist-Zeiten anderer Konten in einem Rutsch zu bestaetigen.
 *
 * Aufbau:
 * - Arbeitgeber P (privat) mit Assistent + ZWEI offenen Ist-Zeiten im
 *   Standard-Team.
 * - Getrennter Arbeitgeber Q (privat) mit eigenem Assistenten + EINER offenen
 *   Ist-Zeit. Beide Konten werden auf Premium gehoben, da confirm-batch
 *   Premium-gegated ist (strictTimeTracking) — ohne Premium endete der Angriff
 *   schon am Plan-Gate (403) und bewiese nichts ueber die Tenant-Grenze.
 *
 * Geprueft (Done-Kriterien):
 * 1. Admin Q -> confirm-batch mit gemischter Liste [P1, P2, Q1]:
 *    confirmedCount = 1 (nur der eigene Eintrag Q1).
 * 2. Nachkontrolle P: beide P-Eintraege sind UNVERAENDERT `pending`
 *    (confirmedBy null) — der fremde Sammel-Angriff hat nichts bestaetigt.
 * 3. Nachkontrolle Q: der eigene Eintrag Q1 ist `confirmed`.
 *
 * Laeuft rein ueber die API gegen den isolierten Test-Stack.
 */

type TimeEntryRow = {
  id: number;
  status: string;
  confirmedBy: number | null;
};
type BatchResult = { confirmedCount: number };

let employerP: FreeAccount;
let employerQ: FreeAccount;

let pEntry1 = 0;
let pEntry2 = 0;
let qEntry1 = 0;

async function createAssistant(acc: FreeAccount, label: string): Promise<number> {
  const unique = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const res = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E BatchScope ${label} ${unique}`,
      email: `e2e.batchscope.${label}.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(res.status(), `Assistent (${label}) anlegen sollte 201 liefern`).toBe(201);
  return ((await res.json()) as { id: number }).id;
}

async function createTimeEntry(
  acc: FreeAccount,
  userId: number,
  start: string,
  end: string,
): Promise<number> {
  const res = await acc.ctx.post("/api/time-tracking", {
    data: { userId, actualStart: start, actualEnd: end },
  });
  expect(res.status(), "Ist-Zeit anlegen sollte 201 liefern").toBe(201);
  return ((await res.json()) as { id: number }).id;
}

test.beforeAll(async () => {
  test.setTimeout(120_000);

  // --- Arbeitgeber P mit Assistent + zwei offenen Ist-Zeiten ----------------
  // Premium VOR dem Aktivieren: der Schalter "Zeiterfassung aktivieren" ist im
  // Free-Tarif serverseitig gegen Aenderungen gesperrt ("timeTrackingSettings").
  employerP = await registerFreeAccount("privat", "batchscope-p");
  await setAccountPlan(employerP.email, "premium");
  await enableTimeTracking(employerP.ctx);
  const pAssistantId = await createAssistant(employerP, "p");
  pEntry1 = await createTimeEntry(
    employerP,
    pAssistantId,
    "2026-07-01T08:00:00.000Z",
    "2026-07-01T16:00:00.000Z",
  );
  pEntry2 = await createTimeEntry(
    employerP,
    pAssistantId,
    "2026-07-02T08:00:00.000Z",
    "2026-07-02T16:00:00.000Z",
  );

  // --- Getrennter Arbeitgeber Q mit eigenem Assistent + Ist-Zeit ------------
  employerQ = await registerFreeAccount("privat", "batchscope-q");
  await setAccountPlan(employerQ.email, "premium");
  await enableTimeTracking(employerQ.ctx);
  const qAssistantId = await createAssistant(employerQ, "q");
  qEntry1 = await createTimeEntry(
    employerQ,
    qAssistantId,
    "2026-07-03T08:00:00.000Z",
    "2026-07-03T16:00:00.000Z",
  );

  // Beide Konten sind von Anfang an Premium: confirm-batch ist
  // strictTimeTracking-gegated. So endet der Q-Angriff NICHT am Plan-Gate
  // (403), sondern beweist die Team-Scope-Grenze (stilles Ueberspringen
  // fremder IDs).
});

test.afterAll(async () => {
  await deleteFreeAccount(employerP);
  await deleteFreeAccount(employerQ);
});

test("confirm-batch mit gemischter Liste bestaetigt NUR eigene Eintraege (confirmedCount = 1)", async () => {
  const res = await employerQ.ctx.post("/api/time-tracking/confirm-batch", {
    data: { ids: [pEntry1, pEntry2, qEntry1] },
  });
  expect(res.status(), "confirm-batch sollte 200 liefern (Q ist Premium)").toBe(200);
  const body = (await res.json()) as BatchResult;
  expect(
    body.confirmedCount,
    "SICHERHEIT: nur der eigene Eintrag darf bestaetigt werden, fremde IDs still uebersprungen",
  ).toBe(1);
});

test("Nachkontrolle P: beide fremden Ist-Zeiten bleiben unveraendert pending", async () => {
  for (const id of [pEntry1, pEntry2]) {
    const res = await employerP.ctx.get(`/api/time-tracking/${id}`);
    expect(res.status(), `P-Eintrag ${id} muss noch existieren`).toBe(200);
    const body = (await res.json()) as TimeEntryRow;
    expect(
      body.status,
      "SICHERHEIT: fremder Sammel-Angriff darf P-Eintrag nicht bestaetigen",
    ).toBe("pending");
    expect(
      body.confirmedBy,
      "confirmedBy darf durch den fremden confirm-batch nicht gesetzt sein",
    ).toBeNull();
  }
});

test("Nachkontrolle Q: der eigene Eintrag ist bestaetigt (404 lag am Scope)", async () => {
  const res = await employerQ.ctx.get(`/api/time-tracking/${qEntry1}`);
  expect(res.status(), "Q-Eintrag muss noch existieren").toBe(200);
  const body = (await res.json()) as TimeEntryRow;
  expect(
    body.status,
    "Eigener Eintrag von Q muss durch confirm-batch bestaetigt sein",
  ).toBe("confirmed");
  expect(body.confirmedBy, "confirmedBy muss auf Q gesetzt sein").toBe(employerQ.id);
});
