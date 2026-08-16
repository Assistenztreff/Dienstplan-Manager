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
 * API-Absicherung der Schnell-Krankmeldung aus der App (Aufgabe #828):
 *
 * Die KrankmeldungDialog-Komponente ruft für Assistenzkräfte
 * POST /api/shifts/bulk-absence (type: "sick") auf, statt N sequenzieller
 * Einzel-POSTs — anders als das Selbstservice-Formular unter /abwesenheiten
 * (dienstplan-abwesenheiten-selbstservice-api.spec.ts), das den Einzel-POST
 * nutzt. Dieser Sammel-Pfad war bisher nur für ADMIN-Aufrufe abgedeckt
 * (dienstplan-bulk-absence-typen-api.spec.ts), nicht für den
 * Assistenten-Selbstservice-Zweig (Authz-Gleichlauf zum Einzel-POST).
 *
 * Zusätzlich: bei einer erfolgreichen Selbst-Krankmeldung (type sick,
 * nicht-privilegiert, mind. ein Tag angelegt) löst die Route
 * fire-and-forget eine E-Mail an den Team-Eigentümer aus
 * (sendSickLeaveNotification in shifts.ts). Das darf die Antwort weder
 * verzögern noch scheitern lassen — insbesondere im Testbetrieb ganz ohne
 * RESEND_API_KEY (isEmailEnabled()=false, mailer.ts überspringt still).
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

test("Assistenzkraft kann eigene Mehrtages-Krankmeldung per Sammelauftrag anlegen (201)", async () => {
  const range = days(futureDay(20), 5);
  const res = await assistantCtx.post("/api/shifts/bulk-absence", {
    data: { userId: assistantId, type: "sick", days: range },
  });
  const bodyText = await res.text();
  expect(res.status(), `Sammel-Krankmeldung sollte 201 liefern (${bodyText})`).toBe(201);
  const body = JSON.parse(bodyText) as {
    createdCount: number;
    shifts: Array<{ id: number; userId: number; type: string }>;
  };
  expect(body.createdCount, "Alle 5 Tage sollten neu angelegt werden").toBe(5);
  expect(body.shifts).toHaveLength(5);
  for (const shift of body.shifts) {
    expect(shift.userId, "Alle Einträge müssen der Assistenzkraft gehören").toBe(assistantId);
    expect(shift.type, "Alle Einträge müssen Typ sick tragen").toBe("sick");
  }

  // Aufräumen.
  for (const shift of body.shifts) {
    await acc.ctx.delete(`/api/shifts/${shift.id}`).catch(() => {});
  }
});

test("Bereits eingetragene Krankheitstage werden beim erneuten Absenden übersprungen, nicht dupliziert", async () => {
  const range = days(futureDay(40), 3);

  const first = await assistantCtx.post("/api/shifts/bulk-absence", {
    data: { userId: assistantId, type: "sick", days: range },
  });
  expect(first.status(), `Erste Anlage sollte 201 liefern (${await first.text()})`).toBe(201);
  const firstBody = (await first.json()) as { createdCount: number };
  expect(firstBody.createdCount).toBe(3);

  // Erneutes Absenden für denselben Zeitraum (z. B. Doppel-Klick oder erneuter
  // Dialog-Aufruf für überlappende Tage) darf NICHT scheitern und NICHT
  // duplizieren — die Route überspringt bereits vorhandene Tage tolerant.
  const second = await assistantCtx.post("/api/shifts/bulk-absence", {
    data: { userId: assistantId, type: "sick", days: range },
  });
  expect(second.status(), `Wiederholte Anlage sollte weiterhin 201 liefern (${await second.text()})`).toBe(
    201,
  );
  const secondBody = (await second.json()) as { createdCount: number; skippedCount: number };
  expect(secondBody.createdCount, "Keine Duplikate: 0 neu angelegt").toBe(0);
  expect(secondBody.skippedCount, "Alle 3 Tage waren bereits krank gemeldet").toBe(3);

  // Insgesamt dürfen weiterhin nur 3 Krankheitstage existieren (keine Dubletten).
  const all = await acc.ctx.get(`/api/shifts?type=sick&userId=${assistantId}`);
  expect(all.ok()).toBe(true);
  const rows = (await all.json()) as Array<{ id: number; userId: number }>;
  expect(rows.filter((r) => r.userId === assistantId)).toHaveLength(3);

  // Aufräumen: alle in diesem Test angelegten sick-Einträge löschen.
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
