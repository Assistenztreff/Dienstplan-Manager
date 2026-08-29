import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";
import { BASE_URL, deleteFreeAccount, registerFreeAccount, setAccountPlan, type FreeAccount } from "./helpers/teams";

/**
 * Der KORREKTUR-KREISLAUF von Anfang bis Ende (Kay-Tests 28./29.08.2026).
 *
 * Das Regelwerk in Worten:
 *   1. Der Planer korrigiert einen vergangenen, bestätigten Dienst — das gilt
 *      SOFORT, ohne Rückbestätigung.
 *   2. Die Assistenzkraft sieht den Hinweis und hat genau EINEN Weg zu
 *      widersprechen: "Zeit korrigieren" (POST /shifts/:id/deviation).
 *   3. Solange diese Meldung offen ist, geht keine zweite (409).
 *   4. Ist sie erledigt (angenommen ODER zurückgewiesen), ist der Fall zu —
 *      ES SEI DENN, der Planer korrigiert DANACH erneut. Dann ist es ein
 *      neuer Sachverhalt und die Meldung ist wieder möglich.
 *
 * Warum dieser Test existiert: Regel 4 wurde am 28.08.2026 nur im Server
 * gebaut, das Frontend prüfte weiter "gibt es überhaupt eine Meldung?" — der
 * Knopf blieb für immer weg. Die Regel liegt seitdem an EINER Stelle
 * (@workspace/shift-defaults/deviation-rules, unit-getestet); dieser Test
 * beweist, dass die echte HTTP-Kette sich auch so verhält.
 */

test.describe.configure({ mode: "serial" });

let acc: FreeAccount;
let assistantCtx: APIRequestContext;
let assistantId: number;

/** Zeitfenster an einem Tag, der `tageZurueck` Tage in der VERGANGENHEIT liegt. */
function vergangenerDienst(tageZurueck: number, vonStunde = 8, bisStunde = 16) {
  const tag = new Date();
  tag.setDate(tag.getDate() - tageZurueck);
  const iso = (stunde: number) =>
    new Date(
      tag.getFullYear(),
      tag.getMonth(),
      tag.getDate(),
      stunde,
      0,
      0,
    ).toISOString();
  return { startTime: iso(vonStunde), endTime: iso(bisStunde) };
}

/** Legt einen vergangenen, bestätigten (FIX) Arbeitsdienst der Assistenzkraft an. */
async function fixDienstAnlegen(tageZurueck: number): Promise<number> {
  const res = await acc.ctx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "work",
      planningStatus: "FIX",
      shiftModelId: null,
      ...vergangenerDienst(tageZurueck),
    },
  });
  expect(res.status(), `Dienst-Anlage sollte 201 liefern (${await res.text()})`).toBe(201);
  return ((await res.json()) as { id: number }).id;
}

/** Die Assistenzkraft meldet eine abweichende Zeit ("Zeit korrigieren"). */
function meldeZeit(shiftId: number, tageZurueck: number, vonStunde: number, bisStunde: number) {
  return assistantCtx.post(`/api/shifts/${shiftId}/deviation`, {
    data: vergangenerDienst(tageZurueck, vonStunde, bisStunde),
  });
}

test.beforeAll(async () => {
  test.setTimeout(180_000);
  acc = await registerFreeAccount("privat", "korrkreis");
  // Premium: Einladungsflow (echter Login der Assistenzkraft) ist gegated, und
  // vergangene Dienste liegen ausserhalb des Free-Planungsfensters.
  await setAccountPlan(acc.email, "premium");

  const createRes = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E KorrKreis ${Date.now()}`,
      email: `e2e.korrkreis.${Date.now()}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(createRes.status(), `Assistenzkraft sollte 201 liefern (${await createRes.text()})`).toBe(201);
  assistantId = ((await createRes.json()) as { id: number }).id;

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

test("Planer-Korrektur an einem vergangenen FIX-Dienst gilt sofort und landet in der Historie", async () => {
  const shiftId = await fixDienstAnlegen(3);

  const patch = await acc.ctx.patch(`/api/shifts/${shiftId}`, {
    data: vergangenerDienst(3, 8, 18),
  });
  expect(patch.status(), `Korrektur sollte 200 liefern (${await patch.text()})`).toBe(200);

  // Sofort wirksam: der Dienst bleibt FIX und faellt NICHT auf ANGEBOTEN
  // zurueck (Kay-Entscheidung 28.08.2026 — keine Rueckbestaetigung).
  const nachher = (await (await acc.ctx.get(`/api/shifts/${shiftId}`)).json()) as {
    planningStatus: string;
    endTime: string;
  };
  expect(nachher.planningStatus, "Vergangene Korrektur darf nicht zurueckfallen").toBe("FIX");
  expect(new Date(nachher.endTime).getHours()).toBe(18);

  // Und sie ist als Aenderung des Planers dokumentiert.
  const changes = (await (await acc.ctx.get("/api/shifts/changes")).json()) as Array<{
    shiftId: number;
    changeSource: string;
  }>;
  const eintrag = changes.find((c) => c.shiftId === shiftId);
  expect(eintrag, "Korrektur muss in der Aenderungshistorie stehen").toBeTruthy();
  expect(eintrag!.changeSource).toBe("planner_edit");
});

test("Der volle Kreislauf: melden → zweite Meldung blockiert → angenommen → zu → erneute Korrektur oeffnet wieder", async () => {
  test.setTimeout(120_000);
  const shiftId = await fixDienstAnlegen(4);

  // Planer korrigiert.
  const patch1 = await acc.ctx.patch(`/api/shifts/${shiftId}`, { data: vergangenerDienst(4, 8, 18) });
  expect(patch1.status(), await patch1.text()).toBe(200);

  // 1) Assistenzkraft meldet die tatsaechliche Zeit.
  const melde1 = await meldeZeit(shiftId, 4, 8, 17);
  expect(melde1.status(), `Erste Meldung sollte 201 liefern (${await melde1.text()})`).toBe(201);

  // 2) Zweite Meldung, solange die erste offen ist -> 409.
  const melde2 = await meldeZeit(shiftId, 4, 8, 16);
  expect(melde2.status(), "Zweite Meldung bei offener Meldung muss 409 sein").toBe(409);

  // 3) Planer nimmt an — der gemeldete Wert uebernimmt den Dienst.
  const accept = await acc.ctx.post(`/api/shifts/${shiftId}/deviation/accept`);
  expect(accept.status(), `Annehmen sollte 200 liefern (${await accept.text()})`).toBe(200);
  const uebernommen = (await (await acc.ctx.get(`/api/shifts/${shiftId}`)).json()) as {
    endTime: string;
  };
  expect(new Date(uebernommen.endTime).getHours(), "Gemeldete Zeit muss uebernommen sein").toBe(17);

  // 4) Erledigt ist erledigt: keine weitere Meldung zum selben Stand.
  const melde3 = await meldeZeit(shiftId, 4, 8, 15);
  expect(melde3.status(), "Nach Annahme darf nicht erneut gemeldet werden").toBe(409);

  // 5) Der Planer korrigiert DANACH erneut -> neuer Sachverhalt.
  const patch2 = await acc.ctx.patch(`/api/shifts/${shiftId}`, { data: vergangenerDienst(4, 8, 20) });
  expect(patch2.status(), await patch2.text()).toBe(200);

  // 6) Jetzt ist die Meldung wieder moeglich. GENAU DAS war der Fehler vom
  //    28.08.2026 (Kay-Test, Punkt 4): der Knopf kam nie zurueck.
  const melde4 = await meldeZeit(shiftId, 4, 8, 19);
  expect(
    melde4.status(),
    `Nach erneuter Planer-Korrektur muss wieder gemeldet werden koennen (${await melde4.text()})`,
  ).toBe(201);
});

test("Auch nach einem WIDERSPRUCH oeffnet erst die naechste Planer-Korrektur den Melde-Weg wieder", async () => {
  test.setTimeout(120_000);
  const shiftId = await fixDienstAnlegen(5);
  const patch1 = await acc.ctx.patch(`/api/shifts/${shiftId}`, { data: vergangenerDienst(5, 8, 18) });
  expect(patch1.status(), await patch1.text()).toBe(200);

  expect((await meldeZeit(shiftId, 5, 8, 17)).status()).toBe(201);

  const dispute = await acc.ctx.post(`/api/shifts/${shiftId}/deviation/dispute`, {
    data: { reason: "Zeiten stimmen mit dem Einsatzprotokoll nicht ueberein." },
  });
  expect(dispute.status(), `Widerspruch sollte 200 liefern (${await dispute.text()})`).toBe(200);

  const erneut = await meldeZeit(shiftId, 5, 8, 16);
  expect(erneut.status(), "Nach Widerspruch ist der Fall zu").toBe(409);

  const patch2 = await acc.ctx.patch(`/api/shifts/${shiftId}`, { data: vergangenerDienst(5, 8, 19) });
  expect(patch2.status(), await patch2.text()).toBe(200);

  const nachKorrektur = await meldeZeit(shiftId, 5, 8, 18);
  expect(
    nachKorrektur.status(),
    `Nach der naechsten Planer-Korrektur muss wieder gemeldet werden koennen (${await nachKorrektur.text()})`,
  ).toBe(201);
});

test("Nicht meldefaehige Dienste werden sauber abgewiesen (Zukunft, nicht bestaetigt, fremd)", async () => {
  // Zukunft: der Dienst ist noch nicht vorbei.
  const morgen = new Date();
  morgen.setDate(morgen.getDate() + 1);
  const iso = (stunde: number) =>
    new Date(morgen.getFullYear(), morgen.getMonth(), morgen.getDate(), stunde, 0, 0).toISOString();
  const zukunftRes = await acc.ctx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "work",
      planningStatus: "FIX",
      shiftModelId: null,
      startTime: iso(8),
      endTime: iso(16),
    },
  });
  expect(zukunftRes.status(), await zukunftRes.text()).toBe(201);
  const zukunftId = ((await zukunftRes.json()) as { id: number }).id;
  const zukunftMeldung = await assistantCtx.post(`/api/shifts/${zukunftId}/deviation`, {
    data: { startTime: iso(8), endTime: iso(15) },
  });
  expect(zukunftMeldung.status(), "Kuenftiger Dienst ist nicht meldefaehig").toBe(400);
  expect(((await zukunftMeldung.json()) as { code?: string }).code).toBe("deviation_not_past");

  // Nicht bestaetigt: ein vergangener Dienst im Status ANGEBOTEN.
  const angebotenRes = await acc.ctx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "work",
      planningStatus: "ANGEBOTEN",
      shiftModelId: null,
      ...vergangenerDienst(6),
    },
  });
  expect(angebotenRes.status(), await angebotenRes.text()).toBe(201);
  const angebotenId = ((await angebotenRes.json()) as { id: number }).id;
  const angebotenMeldung = await meldeZeit(angebotenId, 6, 8, 15);
  expect(angebotenMeldung.status(), "Nur bestaetigte Dienste sind meldefaehig").toBe(400);
  expect(((await angebotenMeldung.json()) as { code?: string }).code).toBe("deviation_invalid_shift");

  // Fremder Dienst: 404 statt eines ID-Orakels.
  const fremd = await assistantCtx.post("/api/shifts/999999999/deviation", {
    data: vergangenerDienst(7),
  });
  expect(fremd.status(), "Fremde/unbekannte ID darf nichts verraten").toBe(404);
});
