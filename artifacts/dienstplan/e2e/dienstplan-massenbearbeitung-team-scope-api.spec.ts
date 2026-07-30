/**
 * #550 – Bestätigen, dass auch die Massenbearbeitung nur Team-Mitglieder zur
 *        Auswahl anbietet.
 *
 * PATCH /api/shifts/:id mit userId im Body ist der Massenbearbeitungs-Pfad
 * (Assistenten-Wechsel). Drei Invarianten:
 *   A) Ohne Premium → 403 plan_feature_required (bulkEdit)
 *   B) Mit Premium + teamfremdem Nutzer → 403 "Nutzer gehört nicht zu diesem Team"
 *   C) Mit Premium + Team-Mitglied → 200
 */
import { test, expect } from "@playwright/test";
import {
  registerFreeAccount,
  setAccountPlan,
  deleteFreeAccount,
  type FreeAccount,
} from "./helpers/teams";

const NOW = new Date();
const YEAR = NOW.getUTCFullYear();
const MM = String(NOW.getUTCMonth() + 1).padStart(2, "0");
const SHIFT_START = `${YEAR}-${MM}-10T08:00:00.000Z`;
const SHIFT_END = `${YEAR}-${MM}-10T16:00:00.000Z`;

let acc: FreeAccount;
let assistant1Id: number;
let assistant2Id: number;
let shiftId: number;
let foreignUserId: number;
let foreignAcc: FreeAccount;

test.beforeAll(async () => {
  test.setTimeout(90_000);
  acc = await registerFreeAccount("dienstleister", "massenbearb");
  await setAccountPlan(acc.email, "premium");

  // Zwei Assistenten im selben Team anlegen.
  const a1Res = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E Massenbearb A1 ${Date.now()}`,
      email: `e2e.massenbearb.a1.${Date.now()}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(a1Res.status()).toBe(201);
  assistant1Id = ((await a1Res.json()) as { id: number }).id;

  const a2Res = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E Massenbearb A2 ${Date.now()}`,
      email: `e2e.massenbearb.a2.${Date.now()}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(a2Res.status()).toBe(201);
  assistant2Id = ((await a2Res.json()) as { id: number }).id;

  for (const uid of [assistant1Id, assistant2Id]) {
    await acc.ctx.post("/api/contracts", {
      data: {
        userId: uid,
        startDate: `${YEAR}-01-01`,
        weeklyHours: 40,
        vacationDays: 30,
      },
    });
  }

  // Schicht für Assistent 1 anlegen.
  const sRes = await acc.ctx.post("/api/shifts", {
    data: {
      userId: assistant1Id,
      type: "work",
      planningStatus: "FIX",
      startTime: SHIFT_START,
      endTime: SHIFT_END,
    },
  });
  expect(sRes.status(), `Schicht anlegen (${sRes.status()})`).toBe(201);
  shiftId = ((await sRes.json()) as { id: number }).id;

  // Fremdes Konto mit eigenem Nutzer (teamfremder Nutzer).
  foreignAcc = await registerFreeAccount("dienstleister", "massenbearb-foreign");
  await setAccountPlan(foreignAcc.email, "premium");
  const fRes = await foreignAcc.ctx.post("/api/users", {
    data: {
      name: `E2E Fremder ${Date.now()}`,
      email: `e2e.massenbearb.fremder.${Date.now()}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(fRes.status()).toBe(201);
  foreignUserId = ((await fRes.json()) as { id: number }).id;
});

test.afterAll(async () => {
  if (shiftId) await acc.ctx.delete(`/api/shifts/${shiftId}`);
  await deleteFreeAccount(acc);
  await deleteFreeAccount(foreignAcc);
});

test(
  "A) Free-Konto: Assistenten-Wechsel via PATCH mit userId → 403 bulkEdit (#550)",
  async () => {
    const freeAcc = await registerFreeAccount("dienstleister", "massenbearb-free");
    const freeA = await freeAcc.ctx.post("/api/users", {
      data: {
        name: `E2E Free Assistent ${Date.now()}`,
        email: `e2e.massenbearb.free.${Date.now()}@dienstplan.test`,
        role: "assistant",
      },
    });
    const freeAId = ((await freeA.json()) as { id: number }).id;
    await freeAcc.ctx.post("/api/contracts", {
      data: {
        userId: freeAId,
        startDate: `${YEAR}-01-01`,
        weeklyHours: 40,
        vacationDays: 30,
      },
    });
    const freeShiftRes = await freeAcc.ctx.post("/api/shifts", {
      data: {
        userId: freeAId,
        type: "work",
        planningStatus: "FIX",
        startTime: SHIFT_START,
        endTime: SHIFT_END,
      },
    });
    const freeShiftId = ((await freeShiftRes.json()) as { id: number }).id;

    const freeA2 = await freeAcc.ctx.post("/api/users", {
      data: {
        name: `E2E Free A2 ${Date.now()}`,
        email: `e2e.massenbearb.free2.${Date.now()}@dienstplan.test`,
        role: "assistant",
      },
    });
    const freeA2Id = ((await freeA2.json()) as { id: number }).id;

    const res = await freeAcc.ctx.patch(`/api/shifts/${freeShiftId}`, {
      data: { userId: freeA2Id },
    });
    expect(res.status(), "Free-Plan muss bulkEdit blockieren").toBe(403);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("plan_feature_required");

    await freeAcc.ctx.delete(`/api/shifts/${freeShiftId}`);
    await deleteFreeAccount(freeAcc);
  },
);

test(
  "B) Premium + teamfremder Nutzer → 403 Nutzer gehört nicht zu diesem Team (#550)",
  async () => {
    const res = await acc.ctx.patch(`/api/shifts/${shiftId}`, {
      data: { userId: foreignUserId },
    });
    expect(
      res.status(),
      `Teamfremder Nutzer muss 403 geben (${res.status()}: ${await res.text()})`,
    ).toBe(403);
  },
);

test(
  "C) Premium + Team-Mitglied → Assistenten-Wechsel erfolgreich (#550)",
  async () => {
    const res = await acc.ctx.patch(`/api/shifts/${shiftId}`, {
      data: { userId: assistant2Id },
    });
    expect(
      res.status(),
      `Wechsel auf Team-Mitglied muss 200 geben (${res.status()}: ${await res.text()})`,
    ).toBe(200);
    const updated = (await res.json()) as { userId: number };
    expect(updated.userId).toBe(assistant2Id);
  },
);
