import { test, expect } from "@playwright/test";
import {
  registerFreeAccount,
  setAccountPlan,
  deleteFreeAccount,
  enableTimeTracking,
  type FreeAccount,
} from "./helpers/teams";

/**
 * Monatsabschluss mit Nachberechnung (Soft-Close) — direkt gegen die API:
 *
 * - POST /month-closings friert die Lohnauswertung eines VERGANGENEN Monats
 *   als append-only Referenz ein; auch der laufende Monat ist (vorzeitig)
 *   abschließbar — nur ZUKÜNFTIGE Monate sind blockiert (400 month_not_closable).
 * - GET /month-closings liefert Status + Historie + Anzahl offener
 *   IST-Einträge (Plausibilitätswarnung).
 * - GET /month-closings/diff liefert die Nachberechnung: NUR Assistenzkräfte,
 *   deren Stunden/Geld vom eingefrorenen Stand abweichen. Erneuter Abschluss
 *   ersetzt die Referenz (Diff wieder leer), die Historie bleibt.
 * - Premium-Gate wie die Lohnauswertung (advancedAnalytics): Free-Konto → 403.
 *
 * Frisches Konto (Standard-Team via Registrierung), fester Monat März des
 * laufenden Jahres — strikt vergangen, keine Monatswechsel-Flakes.
 */

const YEAR = new Date().getFullYear();
const MONTH = 3; // März: liegt im Jahresverlauf immer strikt vor "heute"? Nein —
// im Januar/Februar nicht. Deshalb: bei Bedarf ins Vorjahr ausweichen.
const now = new Date();
const CLOSABLE_YEAR = now.getMonth() + 1 > MONTH ? YEAR : YEAR - 1;

type Meta = { id: number; closedByName: string; closedAt: string };
type Status = { closed: boolean; latest?: Meta; history: Meta[]; pendingTimeEntries: number };
type DiffRow = {
  userId: number;
  reportedHours: number;
  currentHours: number;
  diffHours: number;
};
type Diff = { closed: boolean; closedAt?: string; rows: DiffRow[] };

let acc: FreeAccount;
let assistantId: number;

function fixShift(day: string, startHour: number, endHour: number) {
  return {
    userId: assistantId,
    type: "work",
    planningStatus: "FIX",
    force: true,
    startTime: new Date(`${day}T${String(startHour).padStart(2, "0")}:00:00`).toISOString(),
    endTime: new Date(`${day}T${String(endHour).padStart(2, "0")}:00:00`).toISOString(),
  };
}

const q = `month=${MONTH}&year=${CLOSABLE_YEAR}`;

async function getStatus(): Promise<Status> {
  const res = await acc.ctx.get(`/api/month-closings?${q}`);
  expect(res.ok(), `GET month-closings fehlgeschlagen (${res.status()})`).toBe(true);
  return (await res.json()) as Status;
}

async function getDiff(): Promise<Diff> {
  const res = await acc.ctx.get(`/api/month-closings/diff?${q}`);
  expect(res.ok(), `GET diff fehlgeschlagen (${res.status()})`).toBe(true);
  return (await res.json()) as Diff;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  acc = await registerFreeAccount("privat", "monatsabschluss");
  await setAccountPlan(acc.email, "premium");
  await enableTimeTracking(acc.ctx);

  const userRes = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E Abschluss Assistent ${Date.now()}`,
      email: `e2e.monatsabschluss.assist.${Date.now()}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(userRes.ok(), `Assistent anlegen fehlgeschlagen (${userRes.status()})`).toBe(true);
  assistantId = ((await userRes.json()) as { id: number }).id;

  // Eine FIX-Schicht im Abschlussmonat: 8h am 10.
  const shiftRes = await acc.ctx.post("/api/shifts", {
    data: fixShift(`${CLOSABLE_YEAR}-03-10`, 8, 16),
  });
  expect(shiftRes.status(), `Schicht anlegen (${shiftRes.status()})`).toBe(201);
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

test("Free-Konto: Monatsabschluss ist Premium-gegated (403)", async () => {
  const freeAcc = await registerFreeAccount("privat", "monatsabschluss-free");
  try {
    const res = await freeAcc.ctx.get(`/api/month-closings?${q}`);
    expect(res.status(), "Free-Konto muss 403 erhalten").toBe(403);
    const post = await freeAcc.ctx.post("/api/month-closings", {
      data: { month: MONTH, year: CLOSABLE_YEAR },
    });
    expect(post.status(), "Free-Konto darf nicht abschließen").toBe(403);
  } finally {
    await deleteFreeAccount(freeAcc);
  }
});

test("zukünftiger Monat ist nicht abschließbar (400 month_not_closable)", async () => {
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const res = await acc.ctx.post("/api/month-closings", {
    data: { month: next.getMonth() + 1, year: next.getFullYear() },
  });
  expect(res.status()).toBe(400);
  const body = (await res.json()) as { code?: string };
  expect(body.code).toBe("month_not_closable");
});

test("laufender Monat ist vorzeitig abschließbar (201)", async () => {
  const res = await acc.ctx.post("/api/month-closings", {
    data: { month: now.getMonth() + 1, year: now.getFullYear() },
  });
  expect(res.status(), `Vorzeitiger Abschluss (${res.status()})`).toBe(201);
  const statusRes = await acc.ctx.get(
    `/api/month-closings?month=${now.getMonth() + 1}&year=${now.getFullYear()}`,
  );
  expect(statusRes.ok()).toBe(true);
  const status = (await statusRes.json()) as Status;
  expect(status.closed).toBe(true);
});

test("Status vor Abschluss: offen, leere Historie", async () => {
  const status = await getStatus();
  expect(status.closed).toBe(false);
  expect(status.history).toEqual([]);
  const diff = await getDiff();
  expect(diff.closed).toBe(false);
  expect(diff.rows).toEqual([]);
});

test("offene IST-Einträge erscheinen als Plausibilitätszahl", async () => {
  const entryRes = await acc.ctx.post("/api/time-tracking", {
    data: {
      userId: assistantId,
      actualStart: new Date(`${CLOSABLE_YEAR}-03-10T08:00:00`).toISOString(),
      actualEnd: new Date(`${CLOSABLE_YEAR}-03-10T15:00:00`).toISOString(),
    },
  });
  expect(entryRes.status(), `IST-Eintrag anlegen (${entryRes.status()})`).toBe(201);
  const entry = (await entryRes.json()) as { id: number; status: string };
  // Frisches Konto: Auto-Genehmigung ist per Default AUS → Eintrag offen.
  expect(entry.status).toBe("pending");
  const status = await getStatus();
  expect(status.pendingTimeEntries).toBeGreaterThanOrEqual(1);
});

test("Abschluss friert die Auswertung ein; Diff danach leer", async () => {
  const res = await acc.ctx.post("/api/month-closings", {
    data: { month: MONTH, year: CLOSABLE_YEAR },
  });
  expect(res.status(), `Abschließen (${res.status()})`).toBe(201);

  const status = await getStatus();
  expect(status.closed).toBe(true);
  expect(status.history).toHaveLength(1);
  expect(status.latest?.closedByName).toContain("E2E monatsabschluss");

  const diff = await getDiff();
  expect(diff.closed).toBe(true);
  expect(diff.closedAt).toBeTruthy();
  expect(diff.rows).toEqual([]);
});

test("Änderung nach Abschluss erscheint als Nachberechnung", async () => {
  // Weitere FIX-Schicht (4h am 12.) NACH dem Abschluss.
  const res = await acc.ctx.post("/api/shifts", {
    data: fixShift(`${CLOSABLE_YEAR}-03-12`, 9, 13),
  });
  expect(res.status(), `Nachtrag anlegen (${res.status()})`).toBe(201);

  const diff = await getDiff();
  expect(diff.closed).toBe(true);
  expect(diff.rows).toHaveLength(1);
  const row = diff.rows[0];
  expect(row.userId).toBe(assistantId);
  expect(row.diffHours).toBeCloseTo(4, 1);
  expect(row.currentHours).toBeCloseTo(row.reportedHours + 4, 1);
});

test("erneuter Abschluss ersetzt die Referenz, Historie bleibt", async () => {
  const res = await acc.ctx.post("/api/month-closings", {
    data: { month: MONTH, year: CLOSABLE_YEAR },
  });
  expect(res.status(), `Erneut abschließen (${res.status()})`).toBe(201);

  const status = await getStatus();
  expect(status.closed).toBe(true);
  expect(status.history).toHaveLength(2);

  const diff = await getDiff();
  expect(diff.rows).toEqual([]);
});
