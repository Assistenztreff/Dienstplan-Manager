import { test, expect } from "@playwright/test";
import {
  deleteFreeAccount,
  registerFreeAccount,
  type FreeAccount,
} from "./helpers/teams";

/**
 * API-Test: Tenant-Grenze beim ANLEGEN von Schichten — `POST /shifts`.
 *
 * Die Schreib-Seite bestehender Schichten ist abgesichert
 * (dienstplan-shifts-write-idor-api.spec.ts: PATCH/DELETE -> 404). Hier geht
 * es um die ANLAGE: Ein fremder Arbeitgeber Q darf
 * 1. keine Schicht in ein fremdes Team hinein anlegen (`teamId` außerhalb des
 *    eigenen Scopes -> 403 via resolveWriteTeamId), und
 * 2. keinen teamfremden `userId` in ein EIGENES Team verknüpfen
 *    (Member-of-Team-Invariante -> 403) — sonst würde die 201-Antwort den
 *    fremden Nutzer joinen und dessen PII (E-Mail, Telefon, Adresse) leaken;
 *    zudem erschiene er dauerhaft in Q's gescopten Listen.
 * Zusätzlich: Die Scope-Checks müssen VOR der Überschneidungsprüfung laufen —
 * sonst könnte ein Angreifer über 409-Antworten die Schichtzeiten fremder
 * Nutzer ausspähen (Orakel). Der Angriff mit teamfremdem userId wird deshalb
 * bewusst auf einen Zeitraum gelegt, der mit einer existierenden P-Schicht
 * ÜBERLAPPT: erwartet ist 403 (Scope), NICHT 409 (Leak).
 *
 * Aufbau:
 * - Arbeitgeber P als DIENSTLEISTER (nur die können GET /teams — so erfährt
 *   der Test die Standard-Team-ID, die DTOs sonst nicht liefern) mit
 *   Assistent + bestehender Schicht.
 * - Getrennter Arbeitgeber Q (privat) mit eigenem Assistenten.
 *
 * Geprueft (Done-Kriterien):
 * 1. Q -> POST /shifts mit P's teamId (eigener Assistent): 403, keine
 *    Schicht entsteht in P's Team.
 * 2. Q -> POST /shifts ins eigene Standard-Team mit P's Assistenten-userId
 *    (überlappend zu P's Schicht): 403 — kein 409-Zeiten-Orakel, keine PII.
 * 3. Nachkontrolle P: keine fremde Schicht im P-Team entstanden.
 * 4. Positivkontrolle: Q kann fuer den EIGENEN Assistenten im eigenen Team
 *    eine Schicht anlegen (201) — die 403 lagen am Scope.
 *
 * Laeuft rein ueber die API gegen den isolierten Test-Stack.
 */

type ShiftRow = { id: number; userId: number };

// Aktueller Monat: Free darf im aktuellen + naechsten Monat planen.
const now = new Date();
const DAY = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-15`;
const P_START = `${DAY}T08:00:00.000Z`;
const P_END = `${DAY}T16:00:00.000Z`;

let employerP: FreeAccount;
let employerQ: FreeAccount;

let pTeamId = 0;
let pAssistantId = 0;
let qAssistantId = 0;

async function createAssistant(acc: FreeAccount, label: string): Promise<number> {
  const unique = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const res = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E ShiftCreateIdor ${label} ${unique}`,
      email: `e2e.shiftcreateidor.${label}.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(res.status(), `Assistent (${label}) anlegen sollte 201 liefern`).toBe(201);
  return ((await res.json()) as { id: number }).id;
}

test.beforeAll(async () => {
  test.setTimeout(120_000);

  // --- Arbeitgeber P (dienstleister, damit GET /teams die Team-ID liefert) --
  employerP = await registerFreeAccount("dienstleister", "shiftcreateidor-p");
  const teamsRes = await employerP.ctx.get("/api/teams");
  expect(teamsRes.status(), "P muss seine Teams lesen koennen").toBe(200);
  const teams = (await teamsRes.json()) as { id: number }[];
  expect(teams.length, "Registrierung muss ein Standard-Team angelegt haben").toBeGreaterThan(0);
  pTeamId = teams[0]!.id;

  pAssistantId = await createAssistant(employerP, "p");
  const pShiftRes = await employerP.ctx.post("/api/shifts", {
    data: { userId: pAssistantId, startTime: P_START, endTime: P_END, type: "active" },
  });
  expect(pShiftRes.status(), "Schicht (P) anlegen sollte 201 liefern").toBe(201);

  // --- Getrennter Arbeitgeber Q mit eigenem Assistenten ---------------------
  employerQ = await registerFreeAccount("privat", "shiftcreateidor-q");
  qAssistantId = await createAssistant(employerQ, "q");
});

test.afterAll(async () => {
  await deleteFreeAccount(employerP);
  await deleteFreeAccount(employerQ);
});

test("POST /shifts mit fremder teamId liefert 403 (kein Anlegen in fremde Teams)", async () => {
  const res = await employerQ.ctx.post("/api/shifts", {
    data: {
      userId: qAssistantId,
      teamId: pTeamId,
      startTime: `${DAY}T18:00:00.000Z`,
      endTime: `${DAY}T22:00:00.000Z`,
      type: "active",
    },
  });
  expect(
    res.status(),
    "SICHERHEIT: POST /shifts in ein fremdes Team muss 403 liefern (resolveWriteTeamId)",
  ).toBe(403);
});

test("POST /shifts mit teamfremdem userId liefert 403 — auch bei Ueberlappung (kein 409-Zeiten-Orakel)", async () => {
  // Bewusst ueberlappend zu P's Schicht (P_START/P_END): Wuerde die
  // Ueberschneidungspruefung VOR den Scope-Checks laufen, kaeme hier ein 409
  // mit den Schichtzeiten des fremden Assistenten zurueck (Leak).
  const res = await employerQ.ctx.post("/api/shifts", {
    data: {
      userId: pAssistantId,
      startTime: `${DAY}T09:00:00.000Z`,
      endTime: `${DAY}T15:00:00.000Z`,
      type: "active",
    },
  });
  expect(
    res.status(),
    "SICHERHEIT: teamfremder userId muss 403 liefern (Member-of-Team-Invariante) — NICHT 409 mit fremden Schichtzeiten",
  ).toBe(403);
  const body = await res.text();
  expect(
    body,
    "Antwort darf keine Schichtzeiten des fremden Nutzers enthalten (Orakel-Schutz)",
  ).not.toContain("conflicts");
  expect(body, "Antwort darf keine PII des fremden Nutzers enthalten").not.toContain(
    "@dienstplan.test",
  );
});

test("Nachkontrolle P: keine fremde Schicht im P-Team entstanden", async () => {
  const res = await employerP.ctx.get(`/api/shifts?teamId=${pTeamId}`);
  expect(res.status(), "P muss seine Schichten lesen koennen").toBe(200);
  const rows = (await res.json()) as ShiftRow[];
  expect(
    rows.filter((s) => s.userId === qAssistantId).length,
    "SICHERHEIT: In P's Team darf keine Schicht fuer Q's Assistenten existieren",
  ).toBe(0);
  expect(
    rows.filter((s) => s.userId === pAssistantId).length,
    "P's eigene Schicht muss genau einmal existieren (kein Duplikat durch den Angriff)",
  ).toBe(1);
});

test("Positivkontrolle: Q kann fuer den eigenen Assistenten eine Schicht anlegen (201)", async () => {
  const res = await employerQ.ctx.post("/api/shifts", {
    data: {
      userId: qAssistantId,
      startTime: `${DAY}T08:00:00.000Z`,
      endTime: `${DAY}T12:00:00.000Z`,
      type: "active",
    },
  });
  expect(
    res.status(),
    "Eigener Assistent im eigenen Team muss anlegbar sein — die 403 lagen am Scope",
  ).toBe(201);
  const body = (await res.json()) as ShiftRow;
  expect(body.userId).toBe(qAssistantId);
});
