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
 * (Menü-Neustrukturierung §3):
 *
 * Reine Assistenzkräfte (ohne Teamleiter-Rechte) dürfen über POST /api/shifts
 * AUSSCHLIESSLICH eigene Abwesenheiten (vacation/sick) anlegen und über
 * DELETE /api/shifts/:id AUSSCHLIESSLICH eigene Abwesenheiten entfernen.
 * Alles andere bleibt 403 (POST) bzw. 404 (DELETE, kein ID-Orakel).
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

test("Assistenzkraft kann eigenen Urlaub anlegen (201) und wieder löschen (204)", async () => {
  const res = await assistantCtx.post("/api/shifts", {
    data: { userId: assistantId, type: "vacation", ...dayTimes(5) },
  });
  expect(res.status(), `Eigener Urlaub sollte 201 liefern (${await res.text()})`).toBe(201);
  const shiftId = ((await res.json()) as { id: number }).id;

  const del = await assistantCtx.delete(`/api/shifts/${shiftId}`);
  expect(del.status(), "Eigene Abwesenheit muss löschbar sein").toBe(204);
});

test("Assistenzkraft kann eigene Krankmeldung anlegen (201)", async () => {
  const res = await assistantCtx.post("/api/shifts", {
    data: { userId: assistantId, type: "sick", ...dayTimes(6) },
  });
  expect(res.status(), `Eigene Krankmeldung sollte 201 liefern (${await res.text()})`).toBe(201);
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

  // Nachkontrolle: Eintrag existiert weiter (Admin-Sicht).
  const list = await acc.ctx.get("/api/shifts?type=vacation");
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

test("Mehr-Team-Assistenzkraft: Schichtmodell lenkt die Abwesenheit ins richtige Team", async () => {
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

    // Schichtmodell aus Team B holen (die 5 geseedeten Standard-Dienste).
    const modelsRes = await accB.ctx.get("/api/shift-models");
    expect(modelsRes.ok()).toBe(true);
    const modelB = ((await modelsRes.json()) as Array<{ id: number }>)[0];
    expect(modelB, "Team B braucht ein Schichtmodell").toBeTruthy();

    // Abwesenheit OHNE teamId, aber mit Team-B-Modell → muss in Team B landen
    // (nicht im ersten Mitglieds-Team A).
    const res = await assistantCtx.post("/api/shifts", {
      data: {
        userId: assistantId,
        type: "vacation",
        shiftModelId: modelB.id,
        ...dayTimes(15),
      },
    });
    expect(res.status(), `Anlage sollte 201 liefern (${await res.text()})`).toBe(201);
    const shiftId = ((await res.json()) as { id: number }).id;

    // Kontrolle über beide Admin-Sichten: B sieht den Eintrag, A nicht.
    const listB = await accB.ctx.get("/api/shifts?type=vacation");
    const rowsB = (await listB.json()) as Array<{ id: number }>;
    expect(rowsB.some((r) => r.id === shiftId), "Eintrag muss in Team B liegen").toBe(true);
    const listA = await acc.ctx.get("/api/shifts?type=vacation");
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
  // Eigenes Fixture: Der Urlaub aus Test 1 wurde dort wieder gelöscht.
  const created = await assistantCtx.post("/api/shifts", {
    data: { userId: assistantId, type: "vacation", ...dayTimes(11) },
  });
  expect(created.status(), `Eigener Urlaub sollte 201 liefern (${await created.text()})`).toBe(201);

  const list = await assistantCtx.get("/api/shifts?type=vacation");
  expect(list.ok()).toBe(true);
  const rows = (await list.json()) as Array<{ userId: number }>;
  expect(rows.length, "Eigene Urlaube müssen sichtbar sein").toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.userId, "Nur eigene Einträge dürfen sichtbar sein").toBe(assistantId);
  }
});
