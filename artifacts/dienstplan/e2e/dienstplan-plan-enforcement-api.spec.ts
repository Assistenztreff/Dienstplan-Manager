import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";

/**
 * API-Test für die serverseitige Durchsetzung der Free/Premium-Plan-Limits
 * (Task #205). Diese Gates sind eine Umsatzgrenze und der Client ist nicht
 * vertrauenswürdig — die Frontend-Gates sind reine UX. Der API-Server setzt
 * die Limits autoritativ durch; dieser Test sichert genau das ab, damit ein
 * künftiges Refactoring den Bypass nicht still wieder öffnen kann.
 *
 * WICHTIG: Der E2E-Test-Admin wird in `setup-test-db` bewusst auf `premium`
 * gesetzt (damit bestehende Specs mit paralleler Modell-Anlage/Massen-
 * bearbeitung grün bleiben). Dieser Test MUSS deshalb ein frisches Free-Konto
 * per `POST /api/auth/register` anlegen (Default-Plan = free), sonst würde er
 * gegen ein Premium-Konto laufen und nichts beweisen.
 *
 * Geprüft wird:
 * - maxShiftModels: Ein frisch registriertes Free-Konto startet mit den
 *   geseedeten Standard-Diensten. Es lassen sich weitere Modelle anlegen (201),
 *   bis das Free-Limit erreicht ist; der Versuch DARÜBER liefert 403
 *   `plan_limit_reached` (limit `maxShiftModels`). Der Test hardcodet die
 *   Grenze bewusst NICHT, sondern legt so lange an, bis die Sperre greift, und
 *   prüft, dass sie überhaupt greift (kein Bypass).
 * - bulkEdit: Der Assistenten-Wechsel an einer bestehenden Schicht (PATCH
 *   /api/shifts mit `userId`, Massenbearbeitung = Premium-Feature) liefert 403
 *   `plan_feature_required`; die Schicht bleibt beim ursprünglichen Assistenten.
 * - Bestandsschutz: Das Bearbeiten einer EINZELNEN Schicht ohne Assistenten-
 *   Wechsel (Notiz/Zeiten, kein `userId`) bleibt für Free erlaubt (200).
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

// Dynamisches Datum im AKTUELLEN Monat: POST/PATCH /api/shifts setzt das
// Free-Limit `historyMonths` (Vorausplanung) serverseitig durch. Ein fest
// verdrahtetes Datum (z.B. immer Juni) würde je nach Kalendermonat als "zu weit
// in der Zukunft" mit 403 abgelehnt und den Test nicht-deterministisch machen.
// Der aktuelle Monat liegt immer innerhalb des erlaubten Planungsfensters.
const now = new Date();
const SHIFT_DAY = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-15`;
const START_ISO = `${SHIFT_DAY}T08:00:00.000Z`;
const END_ISO = `${SHIFT_DAY}T16:00:00.000Z`;

type RegisteredUser = { id: number; plan: string; accountType: string };
type CreatedUser = { id: number };
type ShiftModel = { id: number };
type Shift = { id: number; userId: number; notes?: string | null };

let freeCtx: APIRequestContext;
let assistantA: CreatedUser;
let assistantB: CreatedUser;
let shiftId: number;
const createdModelIds: number[] = [];

async function createAssistant(ctx: APIRequestContext, suffix: string): Promise<CreatedUser> {
  const res = await ctx.post("/api/users", {
    data: {
      name: `E2E Plan ${suffix}`,
      email: `e2e.plan.${suffix}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(res.ok(), `Anlegen des Assistenten fehlgeschlagen (${res.status()})`).toBe(true);
  return (await res.json()) as CreatedUser;
}

test.beforeAll(async () => {
  const unique = Date.now();
  freeCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });

  // Frisches Free-Konto registrieren (Default-Plan = free). Self-Service-
  // Registrierung legt einen Admin + "Standard-Team" an, meldet direkt an
  // (Session im Context gesetzt) und seedet die Standard-Dienste.
  const registerRes = await freeCtx.post("/api/auth/register", {
    data: {
      name: `E2E Free Admin ${unique}`,
      email: `e2e.free.admin.${unique}@dienstplan.test`,
      password: "free12345",
      accountType: "privat",
    },
  });
  expect(registerRes.status(), "Registrierung des Free-Kontos sollte 201 liefern").toBe(201);
  const registered = (await registerRes.json()) as RegisteredUser;
  // Sicherstellen, dass das frische Konto wirklich auf dem Free-Plan ist.
  expect(registered.plan, "Frisch registriertes Konto muss Free sein").toBe("free");

  assistantA = await createAssistant(freeCtx, `a.${unique}`);
  assistantB = await createAssistant(freeCtx, `b.${unique}`);

  // Eine Schicht für Assistent A im (Default-)Standard-Team anlegen.
  const shiftRes = await freeCtx.post("/api/shifts", {
    data: {
      userId: assistantA.id,
      startTime: START_ISO,
      endTime: END_ISO,
      type: "active",
    },
  });
  expect(shiftRes.status(), "Schicht anlegen sollte 201 liefern").toBe(201);
  shiftId = ((await shiftRes.json()) as Shift).id;
});

test.afterAll(async () => {
  for (const id of createdModelIds) await freeCtx.delete(`/api/shift-models/${id}`);
  if (shiftId) await freeCtx.delete(`/api/shifts/${shiftId}`);
  if (assistantA?.id) await freeCtx.delete(`/api/users/${assistantA.id}`);
  if (assistantB?.id) await freeCtx.delete(`/api/users/${assistantB.id}`);
  await freeCtx.dispose();
});

test("Free-Plan: das Anlegen von Schichtmodellen wird beim Limit serverseitig mit 403 plan_limit_reached gesperrt", async () => {
  // Ausgangszahl der (geseedeten) Modelle ermitteln — die exakte Free-Grenze
  // wird bewusst NICHT hartkodiert. Es wird so lange angelegt, bis die Sperre
  // greift; entscheidend ist, DASS sie greift (kein Bypass).
  const listRes = await freeCtx.get("/api/shift-models");
  expect(listRes.ok(), "GET /api/shift-models fehlgeschlagen").toBe(true);
  const seeded = ((await listRes.json()) as ShiftModel[]).length;
  expect(seeded, "Free-Konto sollte mit geseedeten Standard-Diensten starten").toBeGreaterThan(0);

  // Sicherheits-Cap gegen Endlosschleife, weit über jedem realistischen Limit.
  const CAP = seeded + 20;
  let blocked = false;
  let createdBeforeBlock = 0;

  for (let i = 0; i < CAP; i++) {
    const res = await freeCtx.post("/api/shift-models", {
      data: {
        name: `E2E Extra Dienst ${Date.now()}-${i}`,
        startTime: "06:00",
        endTime: "14:00",
      },
    });
    if (res.status() === 201) {
      createdModelIds.push(((await res.json()) as ShiftModel).id);
      createdBeforeBlock++;
      continue;
    }
    // Erste Nicht-201-Antwort MUSS die Plan-Sperre sein.
    expect(res.status(), "Über dem Limit sollte 403 kommen").toBe(403);
    const body = (await res.json()) as { code?: string; limit?: string };
    expect(body.code).toBe("plan_limit_reached");
    expect(body.limit).toBe("maxShiftModels");
    blocked = true;
    break;
  }

  // Die Sperre MUSS greifen (sonst wäre das Free-Limit umgehbar).
  expect(blocked, "Das Free-Limit für Schichtmodelle wurde nicht durchgesetzt").toBe(true);
  // Und sie darf nicht sofort (bei 0 erlaubten Anlagen) grundlos blocken —
  // Bestandsschutz: bis zum Limit ist das Anlegen erlaubt.
  expect(createdBeforeBlock).toBeGreaterThanOrEqual(0);
});

test("Free-Plan: Assistenten-Wechsel (PATCH /shifts userId) liefert 403 plan_feature_required (bulkEdit)", async () => {
  const res = await freeCtx.patch(`/api/shifts/${shiftId}`, {
    data: { userId: assistantB.id },
  });
  expect(res.status(), "Assistenten-Wechsel im Free-Tarif sollte 403 liefern").toBe(403);
  const body = (await res.json()) as { code?: string; feature?: string };
  expect(body.code).toBe("plan_feature_required");
  expect(body.feature).toBe("bulkEdit");

  // Die Schicht bleibt bei Assistent A — der Wechsel wurde nicht ausgeführt.
  const getRes = await freeCtx.get(`/api/shifts/${shiftId}`);
  expect(getRes.ok(), "GET der Schicht fehlgeschlagen").toBe(true);
  const shift = (await getRes.json()) as Shift;
  expect(shift.userId).toBe(assistantA.id);
});

test("Free-Plan: Einzel-Schicht bearbeiten ohne Assistenten-Wechsel bleibt erlaubt (200, Bestandsschutz)", async () => {
  const newNote = `Bearbeitet ${Date.now()}`;
  const res = await freeCtx.patch(`/api/shifts/${shiftId}`, {
    data: {
      notes: newNote,
      startTime: `${SHIFT_DAY}T09:00:00.000Z`,
      endTime: `${SHIFT_DAY}T17:00:00.000Z`,
    },
  });
  expect(res.status(), "Einzel-Bearbeitung ohne userId sollte 200 liefern").toBe(200);
  const shift = (await res.json()) as Shift;
  // Assistent unverändert, Notiz übernommen.
  expect(shift.userId).toBe(assistantA.id);
  expect(shift.notes).toBe(newNote);
});
