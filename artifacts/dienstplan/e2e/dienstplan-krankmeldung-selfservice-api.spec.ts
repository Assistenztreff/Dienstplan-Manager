import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";
import {
  BASE_URL,
  deleteFreeAccount,
  registerFreeAccount,
  setAccountPlan,
  type FreeAccount,
} from "./helpers/teams";

/**
 * API-Absicherung der Schnell-Krankmeldung aus der App (Aufgabe #828, seit
 * #887 mit Bestätigungspflicht):
 *
 * Die KrankmeldungDialog-Komponente ruft für Assistenzkräfte
 * POST /api/absence-requests (type: "sick") auf, statt direkt Schichten
 * anzulegen — der direkte Sammelauftrag POST /api/shifts/bulk-absence bleibt
 * für die Selbsteintragung von Urlaub/Krank gesperrt (403
 * absence_requires_request, s. dienstplan-abwesenheiten-selbstservice-api).
 * Erst die Bestätigung eines Planers (POST /absence-requests/:id/approve)
 * legt über dieselbe Sammel-Logik (runBulkAbsenceCreation) die Schichten an —
 * inkl. der bestehenden Übersprung-Toleranz für bereits vorhandene Tage
 * (kein 409, kein Duplikat).
 */

test.describe.configure({ mode: "serial" });

let acc: FreeAccount;
let assistantCtx: APIRequestContext;
let assistantId: number;
let otherAssistantId: number;

/** Ganztägige UTC-Kalendertage ab `startDay` (YYYY-MM-DD), wie
 *  KrankmeldungDialog.buildDays() sie an die API schickt. */
function days(startDay: string, count: number): Array<{ startTime: string; endTime: string }> {
  const out: Array<{ startTime: string; endTime: string }> = [];
  const cursor = new Date(`${startDay}T00:00:00.000Z`);
  for (let i = 0; i < count; i++) {
    const dayStr = cursor.toISOString().split("T")[0]!;
    out.push({ startTime: `${dayStr}T00:00:00.000Z`, endTime: `${dayStr}T23:59:59.999Z` });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/** Fester, weit in der Zukunft liegender Starttag — kollisionsfrei je Testlauf. */
function futureDay(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().split("T")[0]!;
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  acc = await registerFreeAccount("privat", "krankbulk");
  // Einladen ist Premium-gegated.
  await setAccountPlan(acc.email, "premium");

  async function createAssistant(label: string): Promise<number> {
    const res = await acc.ctx.post("/api/users", {
      data: {
        name: `E2E KrankBulk ${label} ${Date.now()}`,
        email: `e2e.krankbulk.${label}.${Date.now()}@dienstplan.test`,
        role: "assistant",
      },
    });
    expect(res.status(), `Assistenzkraft ${label} sollte 201 liefern`).toBe(201);
    return ((await res.json()) as { id: number }).id;
  }
  assistantId = await createAssistant("a");
  otherAssistantId = await createAssistant("b");

  const inviteRes = await acc.ctx.post(`/api/users/${assistantId}/invite`);
  expect(inviteRes.ok(), `Einladung sollte klappen (${inviteRes.status()})`).toBe(true);
  const token = ((await inviteRes.json()) as { token: string }).token;
  assistantCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const setPwRes = await assistantCtx.post("/api/auth/set-password", {
    data: { token, password: "assistent1234" },
  });
  expect(setPwRes.ok(), `set-password sollte 200 liefern (${setPwRes.status()})`).toBe(true);
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
  try {
    await assistantCtx?.dispose();
  } catch {
    /* ignore */
  }
});

test("Direkter POST /api/shifts/bulk-absence für eigene Krankmeldung bleibt 403 (absence_requires_request, #887)", async () => {
  const range = days(futureDay(20), 5);
  const res = await assistantCtx.post("/api/shifts/bulk-absence", {
    data: { userId: assistantId, type: "sick", days: range },
  });
  expect(res.status(), "direkter Sammelauftrag muss für Selbsteintragung 403 bleiben").toBe(403);
  const json = (await res.json()) as { code?: string };
  expect(json.code).toBe("absence_requires_request");
});

test("Assistenzkraft kann Mehrtages-Krankmeldung als Antrag stellen; Bestätigung legt alle Schichten an", async () => {
  const range = days(futureDay(20), 5);
  const reqRes = await assistantCtx.post("/api/absence-requests", {
    data: { type: "sick", days: range },
  });
  const reqText = await reqRes.text();
  expect(reqRes.status(), `Antrag sollte 201 liefern (${reqText})`).toBe(201);
  const created = JSON.parse(reqText) as { id: number; status: string };
  expect(created.status).toBe("PENDING");

  const approveRes = await acc.ctx.post(`/api/absence-requests/${created.id}/approve`);
  const approveText = await approveRes.text();
  expect(approveRes.status(), `Bestätigung sollte 200 liefern (${approveText})`).toBe(200);
  const approved = JSON.parse(approveText) as { status: string; resultShiftIds: number[] };
  expect(approved.status).toBe("APPROVED");
  expect(approved.resultShiftIds, "Alle 5 Tage sollten angelegt werden").toHaveLength(5);

  const list = await acc.ctx.get(`/api/shifts?type=sick&userId=${assistantId}&all=true`);
  const rows = (await list.json()) as Array<{ id: number; userId: number; type: string }>;
  for (const id of approved.resultShiftIds) {
    const row = rows.find((r) => r.id === id);
    expect(row, `Schicht ${id} sollte existieren`).toBeTruthy();
    expect(row!.userId).toBe(assistantId);
    expect(row!.type).toBe("sick");
  }

  // Aufräumen.
  for (const id of approved.resultShiftIds) {
    await acc.ctx.delete(`/api/shifts/${id}`).catch(() => {});
  }
});

test("Ein zweiter, überlappender Antrag überspringt beim Bestätigen bereits vorhandene Tage (kein Duplikat)", async () => {
  const range = days(futureDay(40), 3);

  const first = await assistantCtx.post("/api/absence-requests", {
    data: { type: "sick", days: range },
  });
  expect(first.status()).toBe(201);
  const firstCreated = (await first.json()) as { id: number };
  const firstApprove = await acc.ctx.post(`/api/absence-requests/${firstCreated.id}/approve`);
  expect(firstApprove.status(), `Erste Bestätigung sollte 200 liefern (${await firstApprove.text()})`).toBe(
    200,
  );
  const firstApproved = (await firstApprove.json()) as { resultShiftIds: number[] };
  expect(firstApproved.resultShiftIds).toHaveLength(3);

  // Zweiter Antrag für DIESELBEN Tage (z. B. erneuter Dialog-Aufruf) — die
  // Bestätigung darf nicht scheitern und keine Duplikate erzeugen; die
  // Sammel-Logik überspringt bereits vorhandene Krankheitstage still.
  const second = await assistantCtx.post("/api/absence-requests", {
    data: { type: "sick", days: range },
  });
  expect(second.status()).toBe(201);
  const secondCreated = (await second.json()) as { id: number };
  const secondApprove = await acc.ctx.post(`/api/absence-requests/${secondCreated.id}/approve`);
  expect(
    secondApprove.status(),
    `Zweite Bestätigung sollte weiterhin 200 liefern (${await secondApprove.text()})`,
  ).toBe(200);
  const secondApproved = (await secondApprove.json()) as { resultShiftIds: number[] };
  expect(secondApproved.resultShiftIds, "Keine Duplikate: 0 neu angelegt").toHaveLength(0);

  // Insgesamt dürfen weiterhin nur 3 Krankheitstage existieren (keine Dubletten).
  const all = await acc.ctx.get(`/api/shifts?type=sick&userId=${assistantId}&all=true`);
  const rows = (await all.json()) as Array<{ id: number; userId: number }>;
  expect(rows.filter((r) => r.userId === assistantId)).toHaveLength(3);

  // Aufräumen.
  for (const row of rows) {
    await acc.ctx.delete(`/api/shifts/${row.id}`).catch(() => {});
  }
});

test("Sammel-Krankmeldung für eine ANDERE Person bleibt 403 (Selbstservice-Grenze wie beim Einzel-POST)", async () => {
  const range = days(futureDay(60), 2);
  const res = await assistantCtx.post("/api/shifts/bulk-absence", {
    data: { userId: otherAssistantId, type: "sick", days: range },
  });
  expect(res.status(), "Fremd-Krankmeldung per Sammelauftrag muss 403 bleiben").toBe(403);
});

test("Reguläre Dienste bleiben über den Sammel-Absence-Endpunkt abgelehnt (Schema-Grenze)", async () => {
  const range = days(futureDay(70), 2);
  const res = await assistantCtx.post("/api/shifts/bulk-absence", {
    data: { userId: assistantId, type: "work", days: range },
  });
  expect(res.status(), "type=work ist im Absence-Schema ungültig (400)").toBe(400);
});
