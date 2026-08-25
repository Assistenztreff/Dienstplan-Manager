import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";
import {
  BASE_URL,
  addTeamMemberViaDb,
  deleteFreeAccount,
  registerFreeAccount,
  setAccountPlan,
  type FreeAccount,
} from "./helpers/teams";

/**
 * API-Absicherung des Abwesenheiten-Selbstservice für Assistenzkräfte
 * (Menü-Neustrukturierung §3, seit #887 mit Bestätigungspflicht):
 *
 * Reine Assistenzkräfte (ohne Teamleiter-Rechte) dürfen Urlaub/Krank NICHT
 * mehr direkt über POST /api/shifts anlegen (403 absence_requires_request) —
 * die Selbsteintragung läuft ausschließlich über POST /api/absence-requests
 * (PENDING, erst nach Planer-Bestätigung wirksam). Für alle anderen Personen
 * bzw. Schichtarten bleibt POST /api/shifts unverändert 403. DELETE bleibt
 * AUSSCHLIESSLICH für eigene Abwesenheiten erlaubt, 404 statt Orakel sonst.
 */

test.describe.configure({ mode: "serial" });

let acc: FreeAccount;
let assistantCtx: APIRequestContext;
let assistantId: number;
let otherAssistantId: number;

/** Ganztägige Zeiten für einen festen Tag im Folgemonat (Free-Planungsfenster). */
function dayTimes(day: number): { startTime: string; endTime: string } {
  const base = new Date();
  const target = new Date(base.getFullYear(), base.getMonth() + 1, day);
  const key = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}-${String(
    target.getDate(),
  ).padStart(2, "0")}`;
  return {
    startTime: new Date(`${key}T00:00:00`).toISOString(),
    endTime: new Date(`${key}T23:59:59`).toISOString(),
  };
}

/** Antrags-Tag im selben Format wie AbsenceRequestInput.days. */
function requestDay(day: number): { startTime: string; endTime: string } {
  return dayTimes(day);
}

/** Ganztägiger Tag `monthsAhead` Monate in der Zukunft (für das historyMonths-Limit). */
function farFutureDay(monthsAhead: number, day: number): { startTime: string; endTime: string } {
  const base = new Date();
  const target = new Date(base.getFullYear(), base.getMonth() + monthsAhead, day);
  const key = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}-${String(
    target.getDate(),
  ).padStart(2, "0")}`;
  return {
    startTime: new Date(`${key}T00:00:00`).toISOString(),
    endTime: new Date(`${key}T23:59:59`).toISOString(),
  };
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  acc = await registerFreeAccount("privat", "absselbst");

  // Zwei Assistenzkräfte anlegen; die erste über den echten Einladungsflow
  // einloggen (Einladen ist Premium-gegated).
  async function createAssistant(label: string): Promise<number> {
    const res = await acc.ctx.post("/api/users", {
      data: {
        name: `E2E AbsSelbst ${label} ${Date.now()}`,
        email: `e2e.absselbst.${label}.${Date.now()}@dienstplan.test`,
        role: "assistant",
      },
    });
    expect(res.status(), `Assistenzkraft ${label} sollte 201 liefern`).toBe(201);
    return ((await res.json()) as { id: number }).id;
  }
  assistantId = await createAssistant("a");
  otherAssistantId = await createAssistant("b");

  await setAccountPlan(acc.email, "premium");
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

test("Direkter POST /api/shifts für eigenen Urlaub/Krank bleibt 403 (absence_requires_request, #887)", async () => {
  for (const type of ["vacation", "sick"] as const) {
    const res = await assistantCtx.post("/api/shifts", {
      data: { userId: assistantId, type, ...dayTimes(5) },
    });
    expect(res.status(), `${type}: direkte Selbsteintragung muss 403 bleiben`).toBe(403);
    const json = (await res.json()) as { code?: string };
    expect(json.code, `${type}: erwarteter Fehlercode`).toBe("absence_requires_request");
  }
});

test("Assistenzkraft kann Urlaub als Antrag stellen; nach Bestätigung entsteht die Schicht (löschbar)", async () => {
  const reqRes = await assistantCtx.post("/api/absence-requests", {
    data: { type: "vacation", days: [requestDay(5)] },
  });
  expect(reqRes.status(), `Antrag sollte 201 liefern (${await reqRes.text()})`).toBe(201);
  const created = (await reqRes.json()) as { id: number; status: string };
  expect(created.status).toBe("PENDING");

  // Vor Bestätigung existiert keine Schicht.
  const beforeList = await acc.ctx.get("/api/shifts?type=vacation&all=true");
  const beforeRows = (await beforeList.json()) as Array<{ userId: number }>;
  expect(
    beforeRows.some((r) => r.userId === assistantId),
    "Vor Bestätigung darf keine Schicht existieren",
  ).toBe(false);

  const approveRes = await acc.ctx.post(`/api/absence-requests/${created.id}/approve`);
  expect(approveRes.status(), `Bestätigung sollte 200 liefern (${await approveRes.text()})`).toBe(200);
  const approved = (await approveRes.json()) as { status: string; resultShiftIds: number[] };
  expect(approved.status).toBe("APPROVED");
  expect(approved.resultShiftIds.length).toBeGreaterThan(0);

  const shiftId = approved.resultShiftIds[0]!;
  const del = await assistantCtx.delete(`/api/shifts/${shiftId}`);
  expect(del.status(), "Eigene (bestätigte) Abwesenheit muss löschbar sein").toBe(204);
});

test("Assistenzkraft kann eigene Krankmeldung als Antrag stellen (201, PENDING)", async () => {
  const res = await assistantCtx.post("/api/absence-requests", {
    data: { type: "sick", days: [requestDay(6)] },
  });
  expect(res.status(), `Eigener Antrag sollte 201 liefern (${await res.text()})`).toBe(201);
  const json = (await res.json()) as { status: string; userId: number };
  expect(json.status).toBe("PENDING");
  expect(json.userId).toBe(assistantId);
});

test("Abwesenheit für eine ANDERE Person bleibt 403", async () => {
  const res = await assistantCtx.post("/api/shifts", {
    data: { userId: otherAssistantId, type: "vacation", ...dayTimes(7) },
  });
  expect(res.status(), "Fremd-Abwesenheit muss 403 bleiben").toBe(403);
});

test("Reguläre Dienste bleiben für Assistenzkräfte 403", async () => {
  const res = await assistantCtx.post("/api/shifts", {
    data: { userId: assistantId, type: "work", ...dayTimes(8) },
  });
  expect(res.status(), "Dienst-Anlage muss 403 bleiben").toBe(403);
});

test("DELETE auf fremde Abwesenheit antwortet 404 (kein ID-Orakel)", async () => {
  // Admin legt eine Abwesenheit für die ANDERE Assistenzkraft an.
  const res = await acc.ctx.post("/api/shifts", {
    data: { userId: otherAssistantId, type: "vacation", ...dayTimes(9) },
  });
  expect(res.status(), `Admin-Anlage sollte 201 liefern (${await res.text()})`).toBe(201);
  const foreignId = ((await res.json()) as { id: number }).id;

  const del = await assistantCtx.delete(`/api/shifts/${foreignId}`);
  expect(del.status(), "Fremde Abwesenheit muss 404 liefern").toBe(404);

  // Nachkontrolle: Eintrag existiert weiter (Admin-Sicht). all=true, da
  // dayTimes() bewusst in den FOLGEMONAT plant (Free-Planungsfenster) und
  // die Admin-Abfrage ohne userId sonst dem serverseitigen Default
  // (aktueller Kalendermonat) unterläge.
  const list = await acc.ctx.get("/api/shifts?type=vacation&all=true");
  const rows = (await list.json()) as Array<{ id: number }>;
  expect(rows.some((r) => r.id === foreignId), "Eintrag darf nicht gelöscht sein").toBe(true);
});

test("DELETE auf eigenen REGULÄREN Dienst bleibt 404", async () => {
  // Admin plant einen regulären Dienst für die eingeloggte Assistenzkraft.
  const res = await acc.ctx.post("/api/shifts", {
    data: { userId: assistantId, type: "work", ...dayTimes(10) },
  });
  expect(res.status(), `Admin-Dienst sollte 201 liefern (${await res.text()})`).toBe(201);
  const shiftId = ((await res.json()) as { id: number }).id;

  const del = await assistantCtx.delete(`/api/shifts/${shiftId}`);
  expect(del.status(), "Eigener Dienst darf NICHT löschbar sein (404)").toBe(404);
});

test("Mehr-Team-Assistenzkraft: Antrag mit expliziter teamId landet nach Bestätigung im richtigen Team", async () => {
  // Zweites Konto als Dienstleister registrieren (nur so ist die Standard-
  // Team-ID per API auslesbar, Memory e2e-team-id-discovery) und die
  // Assistenzkraft dort als ZWEITE Mitgliedschaft eintragen (DB-seitig, da
  // die Members-API mandantenübergreifende Adds bewusst ablehnt).
  const accB = await registerFreeAccount("dienstleister", "absselbstb");
  try {
    const teamsRes = await accB.ctx.get("/api/teams");
    expect(teamsRes.ok()).toBe(true);
    const teamB = ((await teamsRes.json()) as Array<{ id: number }>)[0];
    expect(teamB, "Konto B braucht ein Standard-Team").toBeTruthy();
    await addTeamMemberViaDb(teamB.id, assistantId);

    // Antrag MIT expliziter teamId (Team B) statt shiftModelId (die Antrags-
    // API kennt kein Schichtmodell mehr, s. CreateAbsenceRequestBody #887).
    const reqRes = await assistantCtx.post("/api/absence-requests", {
      data: { type: "vacation", teamId: teamB.id, days: [requestDay(15)] },
    });
    expect(reqRes.status(), `Antrag sollte 201 liefern (${await reqRes.text()})`).toBe(201);
    const created = (await reqRes.json()) as { id: number; teamId: number };
    expect(created.teamId).toBe(teamB.id);

    // Team-B-Admin bestätigt (Planer ihres eigenen Teams).
    const approveRes = await accB.ctx.post(`/api/absence-requests/${created.id}/approve`);
    expect(approveRes.status(), `Bestätigung sollte 200 liefern (${await approveRes.text()})`).toBe(
      200,
    );
    const approved = (await approveRes.json()) as { resultShiftIds: number[] };
    const shiftId = approved.resultShiftIds[0]!;

    // Kontrolle über beide Admin-Sichten: B sieht den Eintrag, A nicht.
    // all=true, da requestDay() bewusst in den Folgemonat plant.
    const listB = await accB.ctx.get("/api/shifts?type=vacation&all=true");
    const rowsB = (await listB.json()) as Array<{ id: number }>;
    expect(rowsB.some((r) => r.id === shiftId), "Eintrag muss in Team B liegen").toBe(true);
    const listA = await acc.ctx.get("/api/shifts?type=vacation&all=true");
    const rowsA = (await listA.json()) as Array<{ id: number }>;
    expect(rowsA.some((r) => r.id === shiftId), "Eintrag darf NICHT in Team A liegen").toBe(false);

    // Aufräumen: eigener Eintrag ist löschbar (Team B ∈ eigene Teams).
    const del = await assistantCtx.delete(`/api/shifts/${shiftId}`);
    expect(del.status()).toBe(204);
  } finally {
    await deleteFreeAccount(accB);
  }
});

test("GET /api/shifts bleibt für Assistenzkräfte auf die eigene Person gescopt", async () => {
  // Fixture über den Admin anlegen (Selbsteintragung ist seit #887 kein
  // direkter POST /api/shifts mehr, s. o.) — für den GET-Scoping-Test ist nur
  // relevant, dass eine eigene Zeile existiert.
  const created = await acc.ctx.post("/api/shifts", {
    data: { userId: assistantId, type: "vacation", ...dayTimes(11) },
  });
  expect(created.status(), `Admin-Anlage sollte 201 liefern (${await created.text()})`).toBe(201);

  const list = await assistantCtx.get("/api/shifts?type=vacation&all=true");
  expect(list.ok()).toBe(true);
  const rows = (await list.json()) as Array<{ userId: number }>;
  expect(rows.length, "Eigene Urlaube müssen sichtbar sein").toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.userId, "Nur eigene Einträge dürfen sichtbar sein").toBe(assistantId);
  }
});

test("Bestätigung eines Antrags respektiert weiterhin das historyMonths-Vorausplanungslimit (kein Umweg über Anträge)", async () => {
  // Ohne diesen Guard könnte eine Assistenzkraft beliebig weit in der
  // Zukunft liegende Tage beantragen und ein Planer sie per Bestätigung
  // anlegen lassen — obwohl POST /shifts/bulk-absence denselben Zeitraum
  // direkt mit 403 plan_limit_reached ablehnen würde. Das Konto ist zu
  // diesem Zeitpunkt (letzter Test vor afterAll) auf Free zurückgestuft,
  // damit historyMonths=1 (statt Premium=12) greift.
  await setAccountPlan(acc.email, "free");

  const reqRes = await assistantCtx.post("/api/absence-requests", {
    data: { type: "vacation", days: [farFutureDay(3, 10)] },
  });
  expect(reqRes.status(), `Antrag sollte 201 liefern (${await reqRes.text()})`).toBe(201);
  const created = (await reqRes.json()) as { id: number };

  const approveRes = await acc.ctx.post(`/api/absence-requests/${created.id}/approve`);
  expect(approveRes.status(), "Bestätigung muss am Free-Limit scheitern (403)").toBe(403);
  const body = (await approveRes.json()) as { code?: string; limit?: string };
  expect(body.code).toBe("plan_limit_reached");
  expect(body.limit).toBe("historyMonths");

  // Der Antrag bleibt PENDING (kein Teilerfolg) und ist über GET weiterhin
  // als solcher sichtbar — die Ablehnung darf ihn nicht stillschweigend
  // verändern.
  const listRes = await acc.ctx.get(`/api/absence-requests?status=PENDING`);
  const rows = (await listRes.json()) as Array<{ id: number; status: string }>;
  expect(rows.some((r) => r.id === created.id && r.status === "PENDING")).toBe(true);
});

test("Gleichzeitiges Bestätigen und Ablehnen desselben Antrags ergibt GENAU eine Entscheidung (Race, Code-Review #887)", async () => {
  // Zurück auf Premium, damit das historyMonths-Limit aus dem vorigen Test
  // hier nicht dazwischenfunkt.
  await setAccountPlan(acc.email, "premium");

  const reqRes = await assistantCtx.post("/api/absence-requests", {
    data: { type: "vacation", days: [requestDay(20)] },
  });
  expect(reqRes.status(), `Antrag sollte 201 liefern (${await reqRes.text()})`).toBe(201);
  const created = (await reqRes.json()) as { id: number };

  // Zwei sich widersprechende Entscheidungen gleichzeitig auslösen: ohne den
  // Advisory-Lock aus der Race-Fix könnten beide den Antrag als PENDING lesen
  // und sich gegenseitig überschreiben (Reject gewinnt den Datensatz, Approve
  // legt aber trotzdem Schichten an — oder umgekehrt).
  const [approveRes, rejectRes] = await Promise.all([
    acc.ctx.post(`/api/absence-requests/${created.id}/approve`),
    acc.ctx.post(`/api/absence-requests/${created.id}/reject`),
  ]);
  const statuses = [approveRes.status(), rejectRes.status()].sort();
  expect(statuses, "genau einer der beiden Aufrufe darf durchgehen (200), der andere 409").toEqual([
    200, 409,
  ]);

  const finalRes = await acc.ctx.get(`/api/absence-requests?status=PENDING`);
  const pending = (await finalRes.json()) as Array<{ id: number }>;
  expect(pending.some((r) => r.id === created.id), "Antrag darf nicht PENDING bleiben").toBe(false);

  if (approveRes.status() === 200) {
    // Approve hat gewonnen: es müssen tatsächlich Schichten entstanden sein,
    // und der Antrag muss final APPROVED sein (nicht durch reject überschrieben).
    const approved = (await approveRes.json()) as { status: string; resultShiftIds: number[] };
    expect(approved.status).toBe("APPROVED");
    expect(approved.resultShiftIds.length).toBeGreaterThan(0);
    const shiftId = approved.resultShiftIds[0]!;
    const list = await acc.ctx.get("/api/shifts?type=vacation&all=true");
    const rows = (await list.json()) as Array<{ id: number }>;
    expect(rows.some((r) => r.id === shiftId), "genehmigte Schicht muss existieren").toBe(true);
    await assistantCtx.delete(`/api/shifts/${shiftId}`);
  } else {
    // Reject hat gewonnen: approve muss leer ausgegangen sein — insbesondere
    // dürfen KEINE Schichten für diesen Zeitraum entstanden sein (das wäre
    // genau der im Review beschriebene "verwaiste Schicht trotz Ablehnung"-Bug).
    const approveBody = (await approveRes.json()) as { error?: string };
    expect(approveBody.error).toBe("Antrag wurde bereits bearbeitet");
    const list = await acc.ctx.get("/api/shifts?type=vacation&all=true");
    const rows = (await list.json()) as Array<{ userId: number; startTime: string }>;
    const day = requestDay(20).startTime.slice(0, 10);
    expect(
      rows.some((r) => r.userId === assistantId && r.startTime.startsWith(day)),
      "abgelehnter Antrag darf keine Schicht erzeugt haben",
    ).toBe(false);
  }
});
