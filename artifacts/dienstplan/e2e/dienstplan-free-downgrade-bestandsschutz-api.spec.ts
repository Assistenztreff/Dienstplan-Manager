import { test, expect } from "@playwright/test";
import {
  deleteFreeAccount,
  registerFreeAccount,
  setAccountPlan,
  type FreeAccount,
} from "./helpers/teams";

/**
 * API-Test: Ein Rückstufen von Premium auf Free (z.B. nach ausgebliebener
 * Zahlung) darf bereits vorhandene Daten NIEMALS ausblenden, sperren oder
 * löschen (Bestandsschutz, Task #235).
 *
 * Hintergrund: Die verbindliche Regel in `entitlements.ts` besagt, dass
 * Free-Limits AUSSCHLIESSLICH das Anlegen von NEUEM beschränken. Wird ein
 * maximal ausgereiztes Premium-Konto auf Free zurückgestuft — zusätzliche
 * Teams, der 7.+ Assistent, weit voraus geplante Schichten, zusätzliche
 * Schichtmodelle — müssen alle diese Bestandsdaten voll sichtbar und editierbar
 * bleiben; nur das Anlegen von MEHR wird geblockt. Bisher gab es dafür keinen
 * automatisierten Test: Eine Regression, die eine Limit-Prüfung
 * (`isWithinLimit`) versehentlich in einen Anzeige-Filter verwandelt, könnte
 * die Daten zahlender Kunden verschwinden lassen. Genau das sichert dieser Test:
 *
 * 1. Frisches Free-Dienstleister-Konto registrieren, sofort auf Premium heben.
 * 2. Als Premium über alle vier Free-Caps hinaus aufbauen: 2. Team (maxTeams),
 *    >6 Assistenten (maxAssistants), Schicht 2 Monate voraus (historyMonths),
 *    >5 Schichtmodelle (maxShiftModels).
 * 3. Konto direkt in der Test-DB auf `free` zurückstufen.
 * 4. Bestandsschutz: JEDE bestehende Zeile wird weiterhin von der zuständigen
 *    GET-Route geliefert UND ist weiterhin PATCH-bar.
 * 5. Neu-Anlage über jedem Limit wird mit 403 `plan_limit_reached` abgelehnt.
 *
 * Läuft rein über die API gegen den isolierten Test-Stack.
 */

type LimitError = { code?: string; limit?: string };
type Entity = { id: number };

/**
 * Liefert den 15. eines Monats relativ zum aktuellen Monat (offset 0 = aktuell,
 * 2 = übernächster Monat). Tag 15 ist robust gegen Monatslängen/Zeitzonen.
 */
function monthDay(offset: number): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 15);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}-15`;
}

let acc: FreeAccount;

// Während der Premium-Phase aufgebaute Bestandsdaten (über den Free-Caps).
let teamIds: number[] = [];
let assistantIds: number[] = [];
let farShiftId = 0;
let shiftModelIds: number[] = [];

test.beforeAll(async () => {
  const unique = Date.now();

  // Dienstleister-Konto, damit auch maxTeams (POST /teams verlangt
  // requireDienstleister) im selben Konto geprüft werden kann.
  acc = await registerFreeAccount("dienstleister", "downgrade-bestandsschutz");

  // --- Sofort auf Premium heben (manuelle Freischaltung nachstellen) --------
  setAccountPlan(acc.email, "premium");

  // --- Als Premium über alle Free-Caps hinaus aufbauen ----------------------

  // Ausgangs-Team der Registrierung ("Standard-Team") einsammeln.
  const teamsRes = await acc.ctx.get("/api/teams");
  expect(teamsRes.ok(), "GET /api/teams fehlgeschlagen").toBe(true);
  teamIds = ((await teamsRes.json()) as Entity[]).map((t) => t.id);
  expect(teamIds.length, "Konto sollte mit genau 1 Team starten").toBe(1);

  // Zweites Team (über maxTeams = 1).
  const teamRes = await acc.ctx.post("/api/teams", {
    data: { name: `E2E Downgrade Team 2 ${unique}` },
  });
  expect(teamRes.status(), "2. Team sollte als Premium 201 liefern").toBe(201);
  teamIds.push(((await teamRes.json()) as Entity).id);

  // 7 Assistenten (über maxAssistants = 6). Ohne teamId -> Standard-Team.
  for (let i = 0; i < 7; i++) {
    const userRes = await acc.ctx.post("/api/users", {
      data: {
        name: `E2E Downgrade Assistent ${i}`,
        email: `e2e.downgrade.${unique}.${i}@dienstplan.test`,
        role: "assistant",
      },
    });
    expect(userRes.status(), `Assistent ${i + 1} sollte als Premium 201 liefern`).toBe(201);
    assistantIds.push(((await userRes.json()) as Entity).id);
  }

  // Schicht 2 Monate voraus (über historyMonths = 1).
  const shiftRes = await acc.ctx.post("/api/shifts", {
    data: {
      userId: assistantIds[0],
      startTime: `${monthDay(2)}T08:00:00.000Z`,
      endTime: `${monthDay(2)}T16:00:00.000Z`,
      type: "active",
    },
  });
  expect(shiftRes.status(), "Schicht 2 Monate voraus sollte als Premium 201 liefern").toBe(201);
  farShiftId = ((await shiftRes.json()) as Entity).id;

  // Über maxShiftModels = 5 hinaus: Registrierung seedet 5 Standard-Dienste;
  // zwei eigene ergeben 7 Bestands-Modelle (> Free-Limit 5).
  for (let i = 0; i < 2; i++) {
    const modelRes = await acc.ctx.post("/api/shift-models", {
      data: { name: `E2E Downgrade Dienst ${unique}-${i}`, valuationPercent: 100 },
    });
    expect(modelRes.status(), `Eigener Dienst ${i + 1} sollte als Premium 201 liefern`).toBe(201);
    shiftModelIds.push(((await modelRes.json()) as Entity).id);
  }

  // --- Rückstufung: Konto direkt in der Test-DB auf Free ---------------------
  setAccountPlan(acc.email, "free");
});

test.afterAll(async () => {
  // Konto + alle besessenen Teams inkl. Schichten/Dienste/Assistenten werden
  // per SQL-Bereinigung entfernt (DELETE /api/users scheitert am Team-FK-Baum).
  await deleteFreeAccount(acc);
});

test("Bestandsschutz: alle über den Free-Caps angelegten Zeilen bleiben nach dem Downgrade sichtbar", async () => {
  // Teams: beide (Standard + 2.) werden weiterhin geliefert.
  const teamsRes = await acc.ctx.get("/api/teams");
  expect(teamsRes.ok(), "GET /api/teams fehlgeschlagen").toBe(true);
  const teams = (await teamsRes.json()) as Entity[];
  for (const id of teamIds) {
    expect(teams.some((t) => t.id === id), `Team ${id} sollte nach Downgrade sichtbar bleiben`).toBe(true);
  }

  // Assistenten: alle 7 (über maxAssistants = 6) bleiben in der Liste.
  const usersRes = await acc.ctx.get("/api/users");
  expect(usersRes.ok(), "GET /api/users fehlgeschlagen").toBe(true);
  const users = (await usersRes.json()) as Entity[];
  for (const id of assistantIds) {
    expect(users.some((u) => u.id === id), `Assistent ${id} sollte nach Downgrade sichtbar bleiben`).toBe(true);
  }

  // Schicht 2 Monate voraus (über historyMonths = 1) bleibt sichtbar.
  const shiftsRes = await acc.ctx.get("/api/shifts");
  expect(shiftsRes.ok(), "GET /api/shifts fehlgeschlagen").toBe(true);
  const shifts = (await shiftsRes.json()) as Entity[];
  expect(
    shifts.some((s) => s.id === farShiftId),
    "Weit voraus geplante Schicht sollte nach Downgrade sichtbar bleiben",
  ).toBe(true);

  // Schichtmodelle: alle 7 (über maxShiftModels = 5) bleiben sichtbar.
  const modelsRes = await acc.ctx.get("/api/shift-models");
  expect(modelsRes.ok(), "GET /api/shift-models fehlgeschlagen").toBe(true);
  const models = (await modelsRes.json()) as Entity[];
  expect(models.length, "Alle 7 Schichtmodelle sollten nach Downgrade sichtbar bleiben").toBe(7);
  for (const id of shiftModelIds) {
    expect(models.some((m) => m.id === id), `Modell ${id} sollte nach Downgrade sichtbar bleiben`).toBe(true);
  }
});

test("Bestandsschutz: alle über den Free-Caps angelegten Zeilen bleiben nach dem Downgrade editierbar", async () => {
  // Team umbenennen (2. Team, über maxTeams).
  const teamRes = await acc.ctx.patch(`/api/teams/${teamIds[1]}`, {
    data: { name: "E2E Downgrade Team umbenannt" },
  });
  expect(teamRes.status(), "PATCH eines Bestands-Teams sollte 200 liefern").toBe(200);

  // Assistent umbenennen (7., über maxAssistants).
  const userRes = await acc.ctx.patch(`/api/users/${assistantIds[6]}`, {
    data: { name: "E2E Downgrade Assistent umbenannt" },
  });
  expect(userRes.status(), "PATCH eines Bestands-Assistenten sollte 200 liefern").toBe(200);

  // Weit voraus geplante Schicht editieren OHNE sie zu verschieben (kein
  // startTime im Body -> historyMonths greift bewusst nicht).
  const shiftRes = await acc.ctx.patch(`/api/shifts/${farShiftId}`, {
    data: { planningStatus: "FIX" },
  });
  expect(shiftRes.status(), "PATCH einer weit voraus geplanten Schicht sollte 200 liefern").toBe(200);

  // Schichtmodell editieren (7., über maxShiftModels).
  const modelRes = await acc.ctx.patch(`/api/shift-models/${shiftModelIds[1]}`, {
    data: { name: "E2E Downgrade Dienst umbenannt" },
  });
  expect(modelRes.status(), "PATCH eines Bestands-Schichtmodells sollte 200 liefern").toBe(200);
});

test("Nach dem Downgrade wird die Neu-Anlage über jedem Free-Limit mit 403 plan_limit_reached blockiert", async () => {
  const unique = Date.now();

  // maxTeams: ein WEITERES Team (bereits 2 vorhanden) -> 403.
  const teamRes = await acc.ctx.post("/api/teams", {
    data: { name: `E2E Downgrade Team zu viel ${unique}` },
  });
  expect(teamRes.status(), "Weiteres Team sollte im Free-Tarif 403 liefern").toBe(403);
  const teamBody = (await teamRes.json()) as LimitError;
  expect(teamBody.code).toBe("plan_limit_reached");
  expect(teamBody.limit).toBe("maxTeams");

  // maxAssistants: ein WEITERER Assistent (bereits 7 vorhanden) -> 403.
  const userRes = await acc.ctx.post("/api/users", {
    data: {
      name: "E2E Downgrade Assistent zu viel",
      email: `e2e.downgrade.extra.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(userRes.status(), "Weiterer Assistent sollte im Free-Tarif 403 liefern").toBe(403);
  const userBody = (await userRes.json()) as LimitError;
  expect(userBody.code).toBe("plan_limit_reached");
  expect(userBody.limit).toBe("maxAssistants");

  // historyMonths: eine NEUE Schicht 2 Monate voraus -> 403.
  // Anderer Assistent als die Bestands-Schicht, damit nicht vorher die
  // Überschneidungsprüfung (409) greift und die historyMonths-Prüfung maskiert.
  const shiftRes = await acc.ctx.post("/api/shifts", {
    data: {
      userId: assistantIds[1],
      startTime: `${monthDay(2)}T10:00:00.000Z`,
      endTime: `${monthDay(2)}T18:00:00.000Z`,
      type: "active",
    },
  });
  expect(shiftRes.status(), "Neue Schicht 2 Monate voraus sollte im Free-Tarif 403 liefern").toBe(403);
  const shiftBody = (await shiftRes.json()) as LimitError;
  expect(shiftBody.code).toBe("plan_limit_reached");
  expect(shiftBody.limit).toBe("historyMonths");

  // maxShiftModels: ein WEITERES Modell (bereits 7 vorhanden) -> 403.
  const modelRes = await acc.ctx.post("/api/shift-models", {
    data: { name: `E2E Downgrade Dienst zu viel ${unique}`, valuationPercent: 100 },
  });
  expect(modelRes.status(), "Weiteres Schichtmodell sollte im Free-Tarif 403 liefern").toBe(403);
  const modelBody = (await modelRes.json()) as LimitError;
  expect(modelBody.code).toBe("plan_limit_reached");
  expect(modelBody.limit).toBe("maxShiftModels");
});
