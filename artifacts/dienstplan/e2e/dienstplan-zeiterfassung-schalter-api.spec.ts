import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import {
  BASE_URL,
  deleteFreeAccount,
  registerFreeAccount,
  setAccountPlan,
  type FreeAccount,
} from "./helpers/teams";

/**
 * API-Test für den konto-weiten Schalter „Zeiterfassung aktivieren"
 * (allowance_settings.time_tracking_enabled, Standard AUS).
 *
 * Deckt ab (Done-Kriterien der Aufgabe):
 * - Default AUS: neues Konto hat timeTrackingEnabled=false, Schreibrouten der
 *   Zeiterfassung (POST/PATCH/DELETE/confirm/confirm-batch) antworten 403 mit
 *   code "time_tracking_disabled" und deutscher Meldung; GET bleibt offen.
 * - PUT /allowance-settings mit timeTrackingEnabled=true schaltet um: alle
 *   Schreibrouten funktionieren wieder; erneutes Ausschalten blockt wieder,
 *   bestehende Ist-Zeiten bleiben unangetastet lesbar.
 * - GET /time-tracking-status: Admin sieht die eigene Einstellung, die
 *   Assistenzkraft den effektiven Zustand ihres Arbeitgebers.
 */

let acc: FreeAccount;
let assistantId = 0;
let assistantCtx: APIRequestContext | undefined;
let entryId = 0;

interface ErrorBody {
  error?: string;
  code?: string;
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  acc = await registerFreeAccount("privat", "ttschalter");

  // Assistent im Standard-Team anlegen (für Einträge + Status-Sicht).
  const userRes = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E TT-Schalter Assistent ${Date.now()}`,
      email: `e2e.ttschalter.${Date.now()}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(userRes.status(), "Assistent sollte 201 liefern").toBe(201);
  assistantId = ((await userRes.json()) as { id: number }).id;

  // Premium: confirm/confirm-batch sind strictTimeTracking-gegated — das
  // Plan-Gate soll in diesem Spec NICHT der Grund für 403 sein. Außerdem
  // braucht der Einladungsflow (Assistenten-Login) Premium.
  await setAccountPlan(acc.email, "premium");

  // Assistenten-Login über den echten Einladungsflow.
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

/** Schaltet die Zeiterfassung des Kontos um, ohne Zuschlags-Werte zu verändern. */
async function setTimeTracking(enabled: boolean): Promise<void> {
  const getRes = await acc.ctx.get("/api/allowance-settings");
  expect(getRes.ok()).toBe(true);
  const s = (await getRes.json()) as {
    nightPercent: number;
    nightStart: string;
    nightEnd: string;
    sundayPercent: number;
    holidayPercent: number;
  };
  const putRes = await acc.ctx.put("/api/allowance-settings", {
    data: {
      nightPercent: s.nightPercent,
      nightStart: s.nightStart,
      nightEnd: s.nightEnd,
      sundayPercent: s.sundayPercent,
      holidayPercent: s.holidayPercent,
      timeTrackingEnabled: enabled,
    },
  });
  expect(putRes.ok(), `PUT allowance-settings sollte 200 liefern (${putRes.status()})`).toBe(true);
  const body = (await putRes.json()) as { timeTrackingEnabled: boolean };
  expect(body.timeTrackingEnabled).toBe(enabled);
}

function timeEntryPayload(day: string): { data: Record<string, unknown> } {
  return {
    data: {
      userId: assistantId,
      actualStart: `${day}T08:00:00.000Z`,
      actualEnd: `${day}T16:00:00.000Z`,
    },
  };
}

async function expectDisabled(resPromise: Promise<import("@playwright/test").APIResponse>): Promise<void> {
  const res = await resPromise;
  expect(res.status()).toBe(403);
  const body = (await res.json()) as ErrorBody;
  expect(body.code).toBe("time_tracking_disabled");
  expect(body.error, "Deutsche Fehlermeldung erwartet").toContain("Zeiterfassung");
}

test("Default AUS: frisches Konto hat timeTrackingEnabled=false und Status enabled=false", async () => {
  const settingsRes = await acc.ctx.get("/api/allowance-settings");
  expect(settingsRes.ok()).toBe(true);
  const settings = (await settingsRes.json()) as { timeTrackingEnabled: boolean };
  expect(settings.timeTrackingEnabled, "Standard muss AUS sein").toBe(false);

  const statusRes = await acc.ctx.get("/api/time-tracking-status");
  expect(statusRes.status()).toBe(200);
  expect(((await statusRes.json()) as { enabled: boolean }).enabled).toBe(false);
});

test("AUS: POST /time-tracking wird mit 403 time_tracking_disabled abgelehnt", async () => {
  await expectDisabled(acc.ctx.post("/api/time-tracking", timeEntryPayload("2026-07-01")));
});

test("AUS: confirm-batch wird mit 403 time_tracking_disabled abgelehnt, GET-Liste bleibt offen", async () => {
  await expectDisabled(
    acc.ctx.post("/api/time-tracking/confirm-batch", {
      data: { ids: [99999999], confirmedBy: acc.id },
    }),
  );
  const listRes = await acc.ctx.get("/api/time-tracking");
  expect(listRes.status(), "GET bleibt bei AUS erlaubt").toBe(200);
});

test("PUT schaltet EIN: POST/PATCH/confirm funktionieren wieder", async () => {
  await setTimeTracking(true);

  const statusRes = await acc.ctx.get("/api/time-tracking-status");
  expect(((await statusRes.json()) as { enabled: boolean }).enabled).toBe(true);

  const createRes = await acc.ctx.post("/api/time-tracking", timeEntryPayload("2026-07-02"));
  expect(createRes.status(), "POST muss nach dem Einschalten klappen").toBe(201);
  entryId = ((await createRes.json()) as { id: number }).id;

  const patchRes = await acc.ctx.patch(`/api/time-tracking/${entryId}`, {
    data: { actualEnd: "2026-07-02T17:00:00.000Z" },
  });
  expect(patchRes.status(), "PATCH muss nach dem Einschalten klappen").toBe(200);

  const confirmRes = await acc.ctx.patch(`/api/time-tracking/${entryId}/confirm`, {
    data: { status: "confirmed", confirmedBy: acc.id },
  });
  expect(confirmRes.status(), "Bestätigen muss nach dem Einschalten klappen").toBe(200);
});

test("Assistenzkraft sieht den effektiven Zustand des Arbeitgebers", async () => {
  // Arbeitgeber hat eingeschaltet (voriger Test) -> Assistent sieht enabled=true.
  const onRes = await assistantCtx!.get("/api/time-tracking-status");
  expect(onRes.status()).toBe(200);
  expect(((await onRes.json()) as { enabled: boolean }).enabled).toBe(true);

  // Assistenten haben weiterhin KEINEN Zugriff auf die Roh-Einstellungen.
  const settingsRes = await assistantCtx!.get("/api/allowance-settings");
  expect(settingsRes.status(), "Roh-Einstellungen bleiben Admin-only").toBe(403);
});

test("Wieder AUS: PATCH/DELETE/confirm blocken, Eintrag bleibt lesbar erhalten", async () => {
  await setTimeTracking(false);

  await expectDisabled(
    acc.ctx.patch(`/api/time-tracking/${entryId}`, {
      data: { actualEnd: "2026-07-02T18:00:00.000Z" },
    }),
  );
  await expectDisabled(
    acc.ctx.patch(`/api/time-tracking/${entryId}/confirm`, {
      data: { status: "rejected", confirmedBy: acc.id },
    }),
  );
  await expectDisabled(acc.ctx.delete(`/api/time-tracking/${entryId}`));

  // Bestehende Daten bleiben unangetastet und lesbar.
  const listRes = await acc.ctx.get("/api/time-tracking");
  expect(listRes.status()).toBe(200);
  const entries = (await listRes.json()) as { id: number; status: string }[];
  const entry = entries.find((e) => e.id === entryId);
  expect(entry, "Bestehender Eintrag bleibt erhalten").toBeTruthy();
  expect(entry!.status, "Bestätigter Status bleibt unangetastet").toBe("confirmed");

  // Assistent sieht den ausgeschalteten Zustand des Arbeitgebers.
  const offRes = await assistantCtx!.get("/api/time-tracking-status");
  expect(((await offRes.json()) as { enabled: boolean }).enabled).toBe(false);
});
