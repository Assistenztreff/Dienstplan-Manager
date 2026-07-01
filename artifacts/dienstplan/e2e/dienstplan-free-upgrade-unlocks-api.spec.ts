import { test, expect } from "@playwright/test";
import { registerFreeAccount, setAccountPlan, type FreeAccount } from "./helpers/teams";

/**
 * API-Test: Eine manuelle Premium-Freischaltung hebt die Free-Limits eines
 * maximal ausgereizten Kontos SOFORT auf (Task #225).
 *
 * Hintergrund: Premium wird ohne Stripe rein manuell freigeschaltet, indem
 * `users.plan = 'premium'` gesetzt wird (Operator-Dashboard). `getUserPlan`
 * liest den Plan bei JEDER Anfrage frisch aus der DB (kein Caching), daher soll
 * ein Upgrade ohne Re-Login/Neustart greifen. Es gab bisher keinen
 * automatisierten Test, dass der Upgrade-Pfad die Caps tatsaechlich anhebt —
 * eine Caching-Regression in `plan.ts`/`getUserPlan` koennte zahlende Kunden
 * weiter blockieren. Dieser Test sichert genau das ab:
 *
 * 1. Frisches Free-Dienstleister-Konto registrieren (startet garantiert Free).
 * 2. An die Free-Limits fahren: 6 Assistenten (maxAssistants), 7. → 403;
 *    2. Team (maxTeams) → 403; Schicht 2 Monate voraus (historyMonths) → 403.
 * 3. Konto direkt in der Test-DB auf `premium` heben (manuelle Freischaltung).
 * 4. OHNE Re-Login dieselben drei Aktionen erneut: jetzt 201 — die Caps sind
 *    sofort aufgehoben.
 *
 * Laeuft rein ueber die API gegen den isolierten Test-Stack.
 */

type LimitError = { code?: string; limit?: string };

/**
 * Liefert den 15. eines Monats relativ zum aktuellen Monat (offset 0 = aktuell,
 * 2 = uebernaechster Monat). Tag 15 ist robust gegen Monatslaengen/Zeitzonen.
 */
function monthDay(offset: number): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 15);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}-15`;
}

let acc: FreeAccount;
const createdUserIds: number[] = [];

test.beforeAll(async () => {
  // Dienstleister, damit auch maxTeams (POST /teams verlangt requireDienstleister)
  // im selben Konto getestet werden kann.
  acc = await registerFreeAccount("dienstleister", "upgrade-unlocks");
});

test.afterAll(async () => {
  const tryDelete = async (path: string) => {
    try {
      await acc.ctx.delete(path);
    } catch {
      /* ignore */
    }
  };
  // FK-sicher: erst Schichten, dann Nutzer, dann (zusaetzliche) Teams.
  try {
    const shiftsRes = await acc.ctx.get("/api/shifts");
    if (shiftsRes.ok()) {
      const shifts = (await shiftsRes.json()) as { id: number }[];
      for (const s of shifts) await tryDelete(`/api/shifts/${s.id}`);
    }
  } catch {
    /* ignore */
  }
  for (const id of createdUserIds) await tryDelete(`/api/users/${id}`);
  try {
    const teamsRes = await acc.ctx.get("/api/teams");
    if (teamsRes.ok()) {
      const teams = (await teamsRes.json()) as { id: number }[];
      for (const t of teams) await tryDelete(`/api/teams/${t.id}`);
    }
  } catch {
    /* ignore */
  }
  if (acc?.id) await tryDelete(`/api/users/${acc.id}`);
  await acc.ctx.dispose();
});

test("Premium-Freischaltung hebt maxAssistants/maxTeams/historyMonths sofort auf", async () => {
  const unique = Date.now();

  // --- Free-Phase: an die Limits fahren ---------------------------------

  // 6 Assistenten anlegen (= Free-Limit maxAssistants).
  for (let i = 0; i < 6; i++) {
    const res = await acc.ctx.post("/api/users", {
      data: {
        name: `E2E Assistent ${i}`,
        email: `e2e.upg.${unique}.${i}@dienstplan.test`,
        role: "assistant",
      },
    });
    expect(res.status(), `Assistent ${i + 1} sollte 201 liefern`).toBe(201);
    createdUserIds.push(((await res.json()) as { id: number }).id);
  }

  // 7. Assistent: am Free-Limit blockiert.
  const seventhFree = await acc.ctx.post("/api/users", {
    data: {
      name: "E2E Assistent 7",
      email: `e2e.upg.${unique}.6@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(seventhFree.status(), "7. Assistent sollte im Free-Tarif 403 liefern").toBe(403);
  expect(((await seventhFree.json()) as LimitError).limit).toBe("maxAssistants");

  // 2. Team: am Free-Limit (maxTeams = 1) blockiert (Registrierung legte bereits 1 an).
  const secondTeamFree = await acc.ctx.post("/api/teams", {
    data: { name: `E2E Zweites Team ${unique}` },
  });
  expect(secondTeamFree.status(), "2. Team sollte im Free-Tarif 403 liefern").toBe(403);
  expect(((await secondTeamFree.json()) as LimitError).limit).toBe("maxTeams");

  // Schicht 2 Monate voraus: am Free-Limit (historyMonths = 1) blockiert.
  const assistantForShift = createdUserIds[0];
  const farShift = () =>
    acc.ctx.post("/api/shifts", {
      data: {
        userId: assistantForShift,
        startTime: `${monthDay(2)}T08:00:00.000Z`,
        endTime: `${monthDay(2)}T16:00:00.000Z`,
        type: "active",
      },
    });
  const farShiftFree = await farShift();
  expect(farShiftFree.status(), "2 Monate voraus sollte im Free-Tarif 403 liefern").toBe(403);
  expect(((await farShiftFree.json()) as LimitError).limit).toBe("historyMonths");

  // --- Upgrade: manuelle Premium-Freischaltung direkt in der Test-DB -----
  setAccountPlan(acc.email, "premium");

  // --- Premium-Phase: dieselbe Session, dieselben Aktionen -> jetzt erlaubt -

  // 7. Assistent: jetzt erlaubt (Cap aufgehoben).
  const seventhPremium = await acc.ctx.post("/api/users", {
    data: {
      name: "E2E Assistent 7 premium",
      email: `e2e.upg.${unique}.6@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(seventhPremium.status(), "7. Assistent sollte nach Upgrade 201 liefern").toBe(201);
  createdUserIds.push(((await seventhPremium.json()) as { id: number }).id);

  // 2. Team: jetzt erlaubt.
  const secondTeamPremium = await acc.ctx.post("/api/teams", {
    data: { name: `E2E Zweites Team premium ${unique}` },
  });
  expect(secondTeamPremium.status(), "2. Team sollte nach Upgrade 201 liefern").toBe(201);

  // Schicht 2 Monate voraus: jetzt erlaubt.
  const farShiftPremium = await farShift();
  expect(farShiftPremium.status(), "2 Monate voraus sollte nach Upgrade 201 liefern").toBe(201);
});
