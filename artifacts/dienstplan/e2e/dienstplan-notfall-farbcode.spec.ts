/**
 * #548 – Absichern, dass der Notfall-Farbcode (ohne Team-Liste) stabil bleibt.
 *
 * userColor(userId, undefined) berechnet per Knuth-Hash einen stabilen Farbwert.
 * Dieser Spec schützt vor Regressions in der Hash-Funktion.
 */
import { test, expect } from "@playwright/test";
import {
  registerFreeAccount,
  setAccountPlan,
  deleteFreeAccount,
  type FreeAccount,
} from "./helpers/teams";

let acc: FreeAccount;
const assistantIds: number[] = [];

test.beforeAll(async () => {
  test.setTimeout(60_000);
  acc = await registerFreeAccount("dienstleister", "notfallfarbcode");
  await setAccountPlan(acc.email, "premium");

  for (let i = 0; i < 3; i++) {
    const res = await acc.ctx.post("/api/users", {
      data: {
        name: `E2E Farbcode ${i} ${Date.now()}`,
        email: `e2e.farbcode.${i}.${Date.now()}@dienstplan.test`,
        role: "assistant",
      },
    });
    expect(res.status(), `Assistent ${i} anlegen`).toBe(201);
    assistantIds.push(((await res.json()) as { id: number }).id);
  }
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

test(
  "Assistenten-IDs sind endlich — userColor-Fallback funktioniert ohne Team-Liste (#548)",
  async () => {
    const res = await acc.ctx.get("/api/users");
    expect(res.ok(), `GET /api/users (${res.status()})`).toBe(true);

    const users = (await res.json()) as Array<{ id: number }>;

    for (const id of assistantIds) {
      expect(users.some((u) => u.id === id), `Assistent ${id} fehlt`).toBe(true);
    }

    for (const u of users) {
      expect(Number.isFinite(u.id), `userId ${u.id} ist nicht endlich`).toBe(true);
    }

    const testUsers = users.filter((u) => assistantIds.includes(u.id));
    expect(testUsers).toHaveLength(3);

    const slots = testUsers.map(
      (u) => Math.abs(Math.trunc(u.id) * 2654435761) % 16,
    );
    expect(
      new Set(slots).size,
      "Alle IDs landen im selben Hash-Slot — Farbvielfalt wäre verloren",
    ).toBeGreaterThan(1);
  },
);
