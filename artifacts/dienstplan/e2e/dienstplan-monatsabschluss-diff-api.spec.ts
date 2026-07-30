/**
 * #597 – Beweisen, dass der Assistenten-Export dieselbe Nachberechnung zeigt
 *        wie die Auswertung.
 *
 * Ablauf:
 * 1. Premium-Dienstleister + Assistent + Vertrag + FIX-Schicht.
 * 2. POST /month-closings — friert den aktuellen Monat ein.
 * 3. Weitere FIX-Schicht anlegen (ändert die Stundenbilanz).
 * 4. GET /month-closings/diff — muss eine Zeile mit diffHours != 0 liefern.
 */
import { test, expect } from "@playwright/test";
import {
  registerFreeAccount,
  setAccountPlan,
  deleteFreeAccount,
  type FreeAccount,
} from "./helpers/teams";

const NOW = new Date();
const MONTH = NOW.getUTCMonth() + 1;
const YEAR = NOW.getUTCFullYear();
const MM = String(MONTH).padStart(2, "0");

// Zwei feste Tage im Monat, sicher vor Monatsende und ohne Überschneidung.
// Beide werden im selben Monat/Jahr platziert; MONTH/YEAR wird aus NOW ermittelt.
const SHIFT_DAY_1 = 5;
const SHIFT_DAY_2 = 6;

const makeShiftTimes = (day: number) => {
  const start = new Date(
    `${YEAR}-${MM}-${String(day).padStart(2, "0")}T06:00:00.000Z`,
  );
  const end = new Date(start.getTime() + 8 * 3_600_000);
  return { startTime: start.toISOString(), endTime: end.toISOString() };
};

let acc: FreeAccount;
let assistantId: number;
let shift1Id: number;
let shift2Id: number;

test.beforeAll(async () => {
  test.setTimeout(90_000);
  acc = await registerFreeAccount("dienstleister", "monatsabschluss");
  await setAccountPlan(acc.email, "premium");

  const userRes = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E Abschluss ${Date.now()}`,
      email: `e2e.abschluss.${Date.now()}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(userRes.status()).toBe(201);
  assistantId = ((await userRes.json()) as { id: number }).id;

  await acc.ctx.post("/api/contracts", {
    data: {
      userId: assistantId,
      startDate: `${YEAR}-01-01`,
      weeklyHours: 40,
      vacationDays: 30,
    },
  });

  // Erste FIX-Schicht (wird in den Abschluss eingefroren).
  const s1Res = await acc.ctx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "work",
      planningStatus: "FIX",
      ...makeShiftTimes(SHIFT_DAY_1),
    },
  });
  expect(s1Res.status(), `Schicht 1 anlegen (${s1Res.status()})`).toBe(201);
  shift1Id = ((await s1Res.json()) as { id: number }).id;
});

test.afterAll(async () => {
  if (shift1Id) await acc.ctx.delete(`/api/shifts/${shift1Id}`);
  if (shift2Id) await acc.ctx.delete(`/api/shifts/${shift2Id}`);
  await deleteFreeAccount(acc);
});

test(
  "Monatsabschluss einfrieren und Nachberechnung nach neuer Schicht prüfen (#597)",
  async () => {
    // Schritt 1: Monatsabschluss für den aktuellen Monat erstellen.
    const closeRes = await acc.ctx.post("/api/month-closings", {
      data: { month: MONTH, year: YEAR },
    });
    expect(
      closeRes.status(),
      `POST /month-closings (${closeRes.status()}): ${await closeRes.text()}`,
    ).toBe(201);

    const closingMeta = (await closeRes.json()) as {
      id: number;
      month: number;
      year: number;
      closedAt: string;
    };
    expect(closingMeta.month).toBe(MONTH);
    expect(closingMeta.year).toBe(YEAR);

    // GET /month-closings muss `closed: true` melden.
    const statusRes = await acc.ctx.get(
      `/api/month-closings?month=${MONTH}&year=${YEAR}`,
    );
    expect(statusRes.status()).toBe(200);
    const status = (await statusRes.json()) as { closed: boolean };
    expect(status.closed, "Abschluss muss als geschlossen gemeldet werden").toBe(true);

    // Schritt 2: Zweite FIX-Schicht anlegen — verändert die Stundenbilanz.
    const s2Res = await acc.ctx.post("/api/shifts", {
      data: {
        userId: assistantId,
        type: "work",
        planningStatus: "FIX",
        ...makeShiftTimes(SHIFT_DAY_2),
      },
    });
    expect(s2Res.status(), `Schicht 2 anlegen (${s2Res.status()})`).toBe(201);
    shift2Id = ((await s2Res.json()) as { id: number }).id;

    // Schritt 3: Nachberechnung muss diffHours > 0 zeigen.
    const diffRes = await acc.ctx.get(
      `/api/month-closings/diff?month=${MONTH}&year=${YEAR}`,
    );
    expect(diffRes.status(), `GET /month-closings/diff (${diffRes.status()})`).toBe(200);

    const diff = (await diffRes.json()) as {
      closed: boolean;
      closedAt: string;
      rows: Array<{
        userId: number;
        diffHours: number;
        reportedHours: number;
        currentHours: number;
      }>;
    };
    expect(diff.closed, "Diff muss als geschlossen markiert sein").toBe(true);
    expect(diff.rows.length, "Mindestens eine Zeile mit Änderung erwartet").toBeGreaterThan(0);

    const assistantRow = diff.rows.find((r) => r.userId === assistantId);
    expect(assistantRow, `Zeile für Assistent ${assistantId} fehlt im Diff`).toBeDefined();
    expect(
      assistantRow!.diffHours,
      "diffHours muss > 0 sein (neue Schicht erhöht Stunden)",
    ).toBeGreaterThan(0);
    expect(assistantRow!.currentHours).toBeGreaterThan(assistantRow!.reportedHours);
  },
);

test(
  "Ohne Abschluss liefert /diff closed=false und leere rows (#597)",
  async () => {
    // Frisches Konto ohne Abschluss.
    const fresh = await registerFreeAccount("dienstleister", "nodiff");
    await setAccountPlan(fresh.email, "premium");

    const res = await fresh.ctx.get(
      `/api/month-closings/diff?month=${MONTH}&year=${YEAR}`,
    );
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { closed: boolean; rows: unknown[] };
    expect(body.closed).toBe(false);
    expect(body.rows).toHaveLength(0);

    await deleteFreeAccount(fresh);
  },
);
