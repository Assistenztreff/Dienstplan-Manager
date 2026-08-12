import { test, expect } from "@playwright/test";
import {
  enableTimeTracking,
  deleteFreeAccount,
  registerFreeAccount,
  setAccountPlan,
  type FreeAccount,
} from "./helpers/teams";

/**
 * API-Test: Leere PATCH-Anfragen an /time-tracking/:id dürfen keinen 500 auslösen.
 *
 * Hintergrund: Drizzle wirft eine Exception, wenn .set({}) mit einem leeren
 * Objekt aufgerufen wird (kein SQL-UPDATE ohne SET-Klausel). Schickt ein
 * Client eine Änderung, bei der nach der Zod-Validierung kein einziges
 * speicherbares Feld übrig bleibt, muss die Route mit 400 antworten —
 * nicht mit 500.
 *
 * Geprüft:
 * 1. PATCH mit leerem Body → 400 (kein 500).
 * 2. PATCH mit ausschließlich unbekannten Feldern → 400.
 * 3. Positivkontrolle: PATCH mit mindestens einem gültigen Feld → 200.
 * 4. Nachkontrolle: Eintrag bleibt nach den Fehlschlägen unverändert.
 */

type TimeEntryRow = {
  id: number;
  actualStart: string;
  actualEnd: string;
  actualHours: number;
  status: string;
};

const START = "2026-08-01T08:00:00.000Z";
const END = "2026-08-01T16:00:00.000Z";

let employer: FreeAccount;
let assistantId = 0;
let entryId = 0;

test.beforeAll(async () => {
  test.setTimeout(120_000);

  employer = await registerFreeAccount("privat", "tt-emptyupdate");
  await setAccountPlan(employer.email, "premium");
  await enableTimeTracking(employer.ctx);

  // Assistent anlegen
  const unique = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const userRes = await employer.ctx.post("/api/users", {
    data: {
      name: `E2E TtEmptyUpdate ${unique}`,
      email: `e2e.ttemptyupdate.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(userRes.status(), "Assistent anlegen sollte 201 liefern").toBe(201);
  assistantId = ((await userRes.json()) as { id: number }).id;

  // Ist-Zeit anlegen
  const entryRes = await employer.ctx.post("/api/time-tracking", {
    data: { userId: assistantId, actualStart: START, actualEnd: END },
  });
  expect(entryRes.status(), "Ist-Zeit anlegen sollte 201 liefern").toBe(201);
  entryId = ((await entryRes.json()) as { id: number }).id;
});

test.afterAll(async () => {
  await deleteFreeAccount(employer);
});

test("PATCH mit leerem Body liefert 400, nicht 500", async () => {
  const res = await employer.ctx.patch(`/api/time-tracking/${entryId}`, {
    data: {},
  });
  expect(
    res.status(),
    "Leerer PATCH-Body darf keinen Server-Fehler (500) auslösen — erwartet 400",
  ).toBe(400);
  const body = await res.json() as { error?: string };
  expect(body.error, "400-Antwort muss eine Fehlermeldung enthalten").toBeTruthy();
});

test("PATCH mit ausschließlich unbekannten Feldern liefert 400, nicht 500", async () => {
  const res = await employer.ctx.patch(`/api/time-tracking/${entryId}`, {
    data: { unknownField: "wert", anotherUnknown: 42 },
  });
  expect(
    res.status(),
    "PATCH ohne gültige Felder darf keinen Server-Fehler (500) auslösen — erwartet 400",
  ).toBe(400);
});

test("Positivkontrolle: PATCH mit gültigem Feld liefert 200", async () => {
  const res = await employer.ctx.patch(`/api/time-tracking/${entryId}`, {
    data: { notes: "Testnotiz" },
  });
  expect(res.status(), "Gültiger PATCH muss 200 liefern").toBe(200);
  const body = (await res.json()) as { notes?: string | null };
  expect(body.notes).toBe("Testnotiz");
});

test("Nachkontrolle: Ist-Zeit ist nach fehlgeschlagenen PATCHes unveraendert", async () => {
  const res = await employer.ctx.get(`/api/time-tracking/${entryId}`);
  expect(res.status(), "GET nach fehlgeschlagenen PATCHes muss 200 liefern").toBe(200);
  const body = (await res.json()) as TimeEntryRow;
  expect(body.id).toBe(entryId);
  expect(
    new Date(body.actualStart).toISOString(),
    "actualStart darf durch leere PATCHes nicht verändert worden sein",
  ).toBe(START);
  expect(
    new Date(body.actualEnd).toISOString(),
    "actualEnd darf durch leere PATCHes nicht verändert worden sein",
  ).toBe(END);
  expect(
    Number(body.actualHours),
    "actualHours muss unveraendert 8 sein",
  ).toBe(8);
});
