import { test, expect } from "@playwright/test";
import {
  enableTimeTracking,
  deleteFreeAccount,
  registerFreeAccount,
  setAccountPlan,
  type FreeAccount,
} from "./helpers/teams";

/**
 * API-Test: Tenant-Grenze der Sammelbestätigung —
 * `POST /time-tracking/confirm-batch`.
 *
 * Die Einzelbestätigung ist bereits abgesichert
 * (dienstplan-time-tracking-write-idor-api.spec.ts: confirm auf fremde
 * Ist-Zeit -> 404). Hier geht es um die BATCH-Variante: IDs außerhalb des
 * erlaubten Team-Scopes müssen STILL übersprungen werden — der Aufrufer
 * erfährt über `confirmedCount` nur, wie viele der IDs tatsächlich bestätigt
 * wurden, aber NICHT, welche fremden IDs existieren (kein Informations-Leak
 * per Fehlermeldung). Eine Regression (z. B. Wegfall des
 * `teamId ∈ enabledTeams`-Filters im UPDATE-WHERE) würde es einem fremden
 * Arbeitgeber erlauben, lohnrelevante Ist-Zeiten anderer Konten massenhaft zu
 * bestätigen.
 *
 * Aufbau (Muster: dienstplan-time-tracking-write-idor-api.spec.ts):
 * - Arbeitgeber P (privat, free) mit Assistent + offener Ist-Zeit.
 * - Getrennter Arbeitgeber Q (privat, per Test-DB auf Premium gehoben —
 *   strictTimeTracking ist Premium-gegated, sonst endet der Angriff am
 *   Plan-Gate statt an der Tenant-Grenze) mit eigenem Assistenten + zwei
 *   offenen Ist-Zeiten.
 *
 * Geprueft (Done-Kriterien):
 * 1. Q ruft confirm-batch mit GEMISCHTER Liste auf (eigene IDs + fremde
 *    P-ID + nicht existierende ID): 200, confirmedCount = 2 (nur die
 *    eigenen), Antwort enthält KEINE Hinweise auf die fremde ID.
 * 2. Nachkontrolle P: die P-Ist-Zeit ist weiterhin pending, confirmedBy null.
 * 3. Nachkontrolle Q: die eigenen Einträge sind bestätigt (belegt, dass der
 *    Batch grundsätzlich funktioniert — die 0-Wirkung auf P lag am Scope).
 * 4. Wiederholung mit AUSSCHLIESSLICH fremder ID: 200, confirmedCount = 0
 *    (stilles Überspringen, kein 404/403-Orakel über fremde IDs).
 *
 * Laeuft rein ueber die API gegen den isolierten Test-Stack.
 */

type TimeEntryRow = {
  id: number;
  status: string;
  confirmedBy: number | null;
};

let employerP: FreeAccount;
let employerQ: FreeAccount;

let pEntryId = 0;
let qEntryId1 = 0;
let qEntryId2 = 0;

async function createAssistant(acc: FreeAccount, label: string): Promise<number> {
  const unique = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const res = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E BatchIdor ${label} ${unique}`,
      email: `e2e.batchidor.${label}.${unique}@dienstplan.test`,
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

  // --- Arbeitgeber P mit Assistent + offener Ist-Zeit -----------------------
  employerP = await registerFreeAccount("privat", "batchidor-p");
  await enableTimeTracking(employerP.ctx);
  const pAssistantId = await createAssistant(employerP, "p");
  pEntryId = await createTimeEntry(
    employerP,
    pAssistantId,
    "2026-07-06T08:00:00.000Z",
    "2026-07-06T16:00:00.000Z",
  );

  // --- Getrennter Arbeitgeber Q mit eigenem Assistent + zwei Ist-Zeiten -----
  employerQ = await registerFreeAccount("privat", "batchidor-q");
  await enableTimeTracking(employerQ.ctx);
  const qAssistantId = await createAssistant(employerQ, "q");
  qEntryId1 = await createTimeEntry(
    employerQ,
    qAssistantId,
    "2026-07-07T08:00:00.000Z",
    "2026-07-07T16:00:00.000Z",
  );
  qEntryId2 = await createTimeEntry(
    employerQ,
    qAssistantId,
    "2026-07-08T08:00:00.000Z",
    "2026-07-08T16:00:00.000Z",
  );

  // Q auf Premium heben (strictTimeTracking-Gate), damit die Batch-Route
  // erreicht wird und der Test die TENANT-Grenze beweist, nicht das Plan-Gate.
  await setAccountPlan(employerQ.email, "premium");
});

test.afterAll(async () => {
  await deleteFreeAccount(employerP);
  await deleteFreeAccount(employerQ);
});

test("Gemischte ID-Liste: fremde ID wird still übersprungen, confirmedCount zählt nur eigene", async () => {
  const res = await employerQ.ctx.post("/api/time-tracking/confirm-batch", {
    data: { ids: [qEntryId1, pEntryId, qEntryId2, 99_999_999] },
  });
  expect(
    res.status(),
    "confirm-batch mit gemischter Liste muss 200 liefern (kein Fehler-Orakel über fremde IDs)",
  ).toBe(200);
  const body = (await res.json()) as { confirmedCount: number };
  expect(
    body.confirmedCount,
    "SICHERHEIT: Nur die beiden EIGENEN Einträge dürfen bestätigt werden — die fremde P-ID und die Phantasie-ID müssen still übersprungen werden",
  ).toBe(2);
  const raw = JSON.stringify(body);
  expect(
    raw,
    "Antwort darf die fremde ID nicht erwähnen (kein Informations-Leak)",
  ).not.toContain(String(pEntryId));
});

test("Nachkontrolle P: fremder Eintrag bleibt unbestätigt (pending, confirmedBy null)", async () => {
  const res = await employerP.ctx.get(`/api/time-tracking/${pEntryId}`);
  expect(res.status(), "P-Eintrag muss weiterhin existieren").toBe(200);
  const body = (await res.json()) as TimeEntryRow;
  expect(
    body.status,
    "SICHERHEIT: Der fremde Batch-Versuch darf den P-Eintrag nicht bestätigt haben",
  ).toBe("pending");
  expect(
    body.confirmedBy,
    "confirmedBy darf durch den fremden Batch-Versuch nicht gesetzt sein",
  ).toBeNull();
});

test("Nachkontrolle Q: eigene Einträge sind bestätigt (Batch funktioniert grundsätzlich)", async () => {
  for (const id of [qEntryId1, qEntryId2]) {
    const res = await employerQ.ctx.get(`/api/time-tracking/${id}`);
    expect(res.status(), `Q-Eintrag ${id} muss lesbar sein`).toBe(200);
    const body = (await res.json()) as TimeEntryRow;
    expect(
      body.status,
      `Q-Eintrag ${id} muss durch den Batch bestätigt sein — sonst hätte der Test nichts über die Tenant-Grenze bewiesen`,
    ).toBe("confirmed");
    expect(body.confirmedBy, "confirmedBy muss auf den Q-Admin zeigen").toBe(employerQ.id);
  }
});

test("Nur fremde ID: 200 mit confirmedCount 0 (kein 404/403-Orakel)", async () => {
  const res = await employerQ.ctx.post("/api/time-tracking/confirm-batch", {
    data: { ids: [pEntryId] },
  });
  expect(
    res.status(),
    "SICHERHEIT: Auch eine rein fremde Liste darf keinen Fehlerstatus liefern, der die Existenz der ID verrät",
  ).toBe(200);
  const body = (await res.json()) as { confirmedCount: number };
  expect(body.confirmedCount, "Fremde ID darf nicht bestätigt werden").toBe(0);

  // Der P-Eintrag muss weiterhin unberührt sein.
  const check = await employerP.ctx.get(`/api/time-tracking/${pEntryId}`);
  const checkBody = (await check.json()) as TimeEntryRow;
  expect(checkBody.status, "P-Eintrag bleibt pending").toBe("pending");
});
