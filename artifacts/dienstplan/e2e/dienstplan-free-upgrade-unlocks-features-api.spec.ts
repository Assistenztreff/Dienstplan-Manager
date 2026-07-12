import { test, expect } from "@playwright/test";
import {
  deleteFreeAccount,
  registerFreeAccount,
  setAccountPlan,
  type FreeAccount,
} from "./helpers/teams";

/**
 * API-Test: Eine manuelle Premium-Freischaltung hebt auch die beiden NICHT-
 * numerischen Free-Sperren sofort auf (Task #234):
 *   - `maxShiftModels` (Free = 5): das Anlegen eines weiteren Dienstes über dem
 *     Limit,
 *   - das Premium-Feature `bulkEdit`: der Assistenten-Wechsel an einer
 *     bestehenden Schicht via PATCH /api/shifts (Body mit `userId`).
 *
 * Hintergrund: Task #225 sicherte bereits ab, dass ein Upgrade die drei
 * numerischen Caps (maxAssistants/maxTeams/historyMonths) sofort aufhebt. Diese
 * beiden bezahlten Fähigkeiten waren dagegen NICHT durch einen Upgrade-Test
 * gedeckt. Da `getUserPlan`/`userHasFeature` den Plan bei JEDER Anfrage frisch
 * aus der DB liest (kein Caching), soll die manuelle Freischaltung
 * (`users.plan = 'premium'`, Operator-Dashboard) ohne Re-Login/Neustart greifen.
 * Eine Caching-/Enforcement-Regression könnte zahlende Kunden weiter blockieren
 * — dieser Test sichert genau das ab:
 *
 * 1. Frisches Free-Dienstleister-Konto registrieren (startet garantiert Free,
 *    inkl. 5 geseedeter Standard-Dienste = genau am Free-Limit maxShiftModels).
 * 2. Free-Phase: 6. Dienst → 403;
 *    Schicht für Assistent A anlegen, per PATCH auf Assistent B tauschen → 403
 *    plan_feature_required (bulkEdit).
 * 3. Konto direkt in der Test-DB auf `premium` heben (manuelle Freischaltung).
 * 4. OHNE Re-Login dieselben Aktionen erneut: 6. Dienst → 201, PATCH-Wechsel →
 *    200 — beide Sperren sind sofort aufgehoben.
 *
 * Läuft rein über die API gegen den isolierten Test-Stack.
 */

type LimitError = { code?: string; limit?: string; feature?: string };

/** Liefert den 15. des aktuellen Monats (robust gegen Monatslängen/Zeitzonen). */
function currentMonthDay(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}-15`;
}

let acc: FreeAccount;
const createdUserIds: number[] = [];
let assistantA = 0;
let assistantB = 0;
let shiftId = 0;

test.beforeAll(async () => {
  // Dienstleister genügt; für dieses Spec ist der Konto-Typ nicht entscheidend,
  // wir bleiben aber konsistent mit dem numerischen Upgrade-Spec (#225).
  acc = await registerFreeAccount("dienstleister", "upgrade-features");
});

test.afterAll(async () => {
  // Konto + alle besessenen Teams inkl. Schichten/Dienste/Assistenten werden
  // per SQL-Bereinigung entfernt (DELETE /api/users scheitert am Team-FK-Baum).
  await deleteFreeAccount(acc);
});

test("Premium-Freischaltung hebt maxShiftModels und bulkEdit sofort auf", async () => {
  const unique = Date.now();

  // --- Free-Phase: an die Sperren fahren --------------------------------

  // Registrierung seedet 5 Standard-Dienste — genau das Free-Limit
  // (maxShiftModels = 5); ein 6. Dienst ist im Free-Tarif blockiert.
  const seededRes = await acc.ctx.get("/api/shift-models");
  expect(seededRes.ok(), "GET /api/shift-models fehlgeschlagen").toBe(true);
  const seeded = (await seededRes.json()) as { id: number }[];
  expect(seeded.length, "Neues Free-Konto sollte mit 5 Standard-Diensten starten").toBe(5);

  const fifthFree = await acc.ctx.post("/api/shift-models", {
    data: { name: "Ein Dienst zu viel", valuationPercent: 100 },
  });
  expect(fifthFree.status(), "6. Dienst sollte im Free-Tarif 403 liefern").toBe(403);
  const fifthFreeBody = (await fifthFree.json()) as LimitError;
  expect(fifthFreeBody.code).toBe("plan_limit_reached");
  expect(fifthFreeBody.limit).toBe("maxShiftModels");

  // Zwei Assistenten anlegen (beide Mitglied im Standard-Team via POST /users),
  // damit der bulkEdit-Assistenten-Wechsel getestet werden kann.
  const createAssistant = async (i: number): Promise<number> => {
    const res = await acc.ctx.post("/api/users", {
      data: {
        name: `E2E Assistent ${i}`,
        email: `e2e.upgf.${unique}.${i}@dienstplan.test`,
        role: "assistant",
      },
    });
    expect(res.status(), `Assistent ${i} sollte 201 liefern`).toBe(201);
    const id = ((await res.json()) as { id: number }).id;
    createdUserIds.push(id);
    return id;
  };
  assistantA = await createAssistant(0);
  assistantB = await createAssistant(1);

  // Schicht für Assistent A im aktuellen Monat anlegen (kein historyMonths-Gate).
  const day = currentMonthDay();
  const shiftRes = await acc.ctx.post("/api/shifts", {
    data: {
      userId: assistantA,
      startTime: `${day}T08:00:00.000Z`,
      endTime: `${day}T16:00:00.000Z`,
      type: "active",
    },
  });
  expect(shiftRes.status(), "Schicht für Assistent A sollte 201 liefern").toBe(201);
  shiftId = ((await shiftRes.json()) as { id: number }).id;

  // Assistenten-Wechsel (bulkEdit) per PATCH: im Free-Tarif blockiert.
  const swapFree = await acc.ctx.patch(`/api/shifts/${shiftId}`, {
    data: { userId: assistantB },
  });
  expect(swapFree.status(), "Assistenten-Wechsel sollte im Free-Tarif 403 liefern").toBe(403);
  const swapFreeBody = (await swapFree.json()) as LimitError;
  expect(swapFreeBody.code).toBe("plan_feature_required");
  expect(swapFreeBody.feature).toBe("bulkEdit");

  // --- Upgrade: manuelle Premium-Freischaltung direkt in der Test-DB -----
  await setAccountPlan(acc.email, "premium");

  // --- Premium-Phase: dieselbe Session, dieselben Aktionen -> jetzt erlaubt -

  // 6. Dienst: jetzt erlaubt (Limit aufgehoben).
  const fifthPremium = await acc.ctx.post("/api/shift-models", {
    data: { name: "Sechster Dienst premium", valuationPercent: 100 },
  });
  expect(fifthPremium.status(), "6. Dienst sollte nach Upgrade 201 liefern").toBe(201);

  // Assistenten-Wechsel: jetzt erlaubt (bulkEdit freigeschaltet).
  const swapPremium = await acc.ctx.patch(`/api/shifts/${shiftId}`, {
    data: { userId: assistantB },
  });
  expect(swapPremium.status(), "Assistenten-Wechsel sollte nach Upgrade 200 liefern").toBe(200);
  const swapped = (await swapPremium.json()) as { userId: number };
  expect(swapped.userId, "Schicht sollte nun Assistent B zugeordnet sein").toBe(assistantB);
});
