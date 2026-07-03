import { test, expect } from "@playwright/test";
import {
  deleteFreeAccount,
  registerFreeAccount,
  setAccountPlan,
  type FreeAccount,
} from "./helpers/teams";

/**
 * API-Test (Task: Kalender-Export darf keine fremden Team-Dienste preisgeben):
 * Der ICS-Export (`GET /calendar-export`) liefert für Admins alle FIX-Schichten
 * im ERLAUBTEN Team-Scope. Ein Regressionsfehler im Scoping (z. B. fehlendes
 * `inArray(teamId, teamScope)` in `buildIcs` oder ein kaputtes
 * `resolveReadTeamScope`) würde Dienste inkl. Assistenten-Namen FREMDER Konten
 * in den Kalender-Download leaken — ein stiller PII-Leak.
 *
 * Aufbau: Zwei getrennte, frisch registrierte Premium-Konten A und B mit je
 * einem Assistenten und je einer FIX-Schicht (Erkennung über die stabile
 * `UID:shift-<id>@dienstplan-app`-Zeile im ICS).
 *
 * Geprüft (Done-Kriterien):
 * 1. Export von Konto A enthält die eigene FIX-Schicht, aber NIE das VEVENT
 *    von Konto B — und umgekehrt (symmetrisch, gegen Vertauschungs-Bugs).
 * 2. Der Assistenten-NAME von B taucht nirgends im Export von A auf
 *    (SUMMARY enthält den Namen — der eigentliche PII-Leak).
 * 3. Export mit fremdem `?teamId=` liefert 403 (analog zu den übrigen
 *    Domänen-Routen); Positiv-Kontrolle: der EIGENE `?teamId=` liefert 200
 *    mit der eigenen Schicht (beweist, dass der 403 wirklich am fremden Team
 *    hängt und nicht an einer generellen teamId-Ablehnung).
 */

type CreatedShift = { id: number; planningStatus: string };

/** Liefert einen Tag im aktuellen Monat (robust gegen Monatslängen/Zeitzonen). */
function currentMonthDay(day: number): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}-${String(day).padStart(2, "0")}`;
}

function uidOf(shiftId: number): string {
  return `UID:shift-${shiftId}@dienstplan-app`;
}

interface AccountSetup {
  account: FreeAccount;
  assistantName: string;
  shiftId: number;
  teamId: number;
}

let a: AccountSetup;
let b: AccountSetup;

/**
 * Registriert ein frisches Konto, schaltet es auf Premium (calendarSync ist
 * Premium-gegated), legt einen Assistenten mit eindeutigem Namen und eine
 * FIX-Schicht an. Konto-Typ `dienstleister`, damit die eigene Team-ID über
 * GET /teams ermittelt werden kann (für `privat`-Konten gesperrt; die
 * Schicht-DTOs geben `teamId` bewusst nicht heraus). Das Scoping des Exports
 * ist für beide Konto-Typen identisch.
 */
async function setupAccount(label: string, day: string): Promise<AccountSetup> {
  const account = await registerFreeAccount("dienstleister", label);
  setAccountPlan(account.email, "premium");

  const teamsRes = await account.ctx.get("/api/teams");
  expect(teamsRes.status(), `GET /teams (${label}) sollte 200 liefern`).toBe(200);
  const teams = (await teamsRes.json()) as Array<{ id: number }>;
  expect(teams.length, `Registrierung (${label}) muss ein Standard-Team anlegen`).toBe(1);
  const teamId = teams[0].id;

  const unique = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const assistantName = `E2E KalIso ${label} ${unique}`;
  const assistantRes = await account.ctx.post("/api/users", {
    data: {
      name: assistantName,
      email: `e2e.kaliso.${label}.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(assistantRes.status(), `Assistent (${label}) anlegen sollte 201 liefern`).toBe(201);
  const assistantId = ((await assistantRes.json()) as { id: number }).id;

  const shiftRes = await account.ctx.post("/api/shifts", {
    data: {
      userId: assistantId,
      startTime: `${day}T08:00:00.000Z`,
      endTime: `${day}T16:00:00.000Z`,
      type: "active",
      planningStatus: "FIX",
    },
  });
  expect(shiftRes.status(), `Schicht (${label}) anlegen sollte 201 liefern`).toBe(201);
  const shift = (await shiftRes.json()) as CreatedShift;
  // Guard: Nur FIX-Schichten landen im Export — würde der Status gestrippt,
  // bewiese der Test nichts (die Schicht fehlte dann aus dem falschen Grund).
  expect(shift.planningStatus, "planningStatus muss FIX sein").toBe("FIX");

  return { account, assistantName, shiftId: shift.id, teamId };
}

/** Holt den ICS-Export über die Session des übergebenen Kontos. */
async function fetchExportIcs(setup: AccountSetup, query = ""): Promise<string> {
  const res = await setup.account.ctx.get(`/api/calendar-export${query}`);
  expect(res.status(), `Export${query} sollte 200 liefern`).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/calendar");
  const ics = await res.text();
  expect(ics).toContain("BEGIN:VCALENDAR");
  return ics;
}

test.beforeAll(async () => {
  // Sequenziell (nicht Promise.all): setAccountPlan/execSync sind nicht
  // parallel-sicher und die Konten sollen deterministisch entstehen.
  a = await setupAccount("kaliso-a", currentMonthDay(10));
  b = await setupAccount("kaliso-b", currentMonthDay(11));
  // Sanity: Zwei getrennte Konten MÜSSEN getrennte Standard-Teams haben —
  // sonst prüfte der Test Isolation innerhalb EINES Teams (wertlos).
  expect(a.teamId, "Konten dürfen nicht dasselbe Team teilen").not.toBe(b.teamId);
});

test.afterAll(async () => {
  await deleteFreeAccount(a?.account);
  await deleteFreeAccount(b?.account);
});

test("Export von Konto A enthält nie das VEVENT oder den Assistenten-Namen von Konto B", async () => {
  const ics = await fetchExportIcs(a);
  expect(ics, "Eigene FIX-Schicht fehlt im Export von A").toContain(uidOf(a.shiftId));
  expect(ics, "PII-LEAK: Schicht von B im Export von A").not.toContain(uidOf(b.shiftId));
  expect(ics, "PII-LEAK: Assistenten-Name von B im Export von A").not.toContain(b.assistantName);
});

test("Export von Konto B enthält nie das VEVENT oder den Assistenten-Namen von Konto A", async () => {
  const ics = await fetchExportIcs(b);
  expect(ics, "Eigene FIX-Schicht fehlt im Export von B").toContain(uidOf(b.shiftId));
  expect(ics, "PII-LEAK: Schicht von A im Export von B").not.toContain(uidOf(a.shiftId));
  expect(ics, "PII-LEAK: Assistenten-Name von A im Export von B").not.toContain(a.assistantName);
});

test("Export mit fremdem ?teamId= liefert 403, eigener ?teamId= funktioniert", async () => {
  // Fremdes Team: 403, KEIN ICS-Inhalt (kein Datenabfluss über den Fehlerpfad).
  const foreign = await a.account.ctx.get(`/api/calendar-export?teamId=${b.teamId}`);
  expect(foreign.status(), "Fremdes teamId muss 403 liefern").toBe(403);
  const foreignBody = await foreign.text();
  expect(foreignBody, "403-Antwort darf kein ICS enthalten").not.toContain("BEGIN:VCALENDAR");
  expect(foreignBody, "403-Antwort darf keine Schicht von B enthalten").not.toContain(
    uidOf(b.shiftId),
  );

  // Positiv-Kontrolle: das EIGENE teamId liefert 200 mit der eigenen Schicht —
  // der 403 oben hängt also wirklich an der Team-Fremdheit.
  const own = await fetchExportIcs(a, `?teamId=${a.teamId}`);
  expect(own, "Eigene FIX-Schicht fehlt beim eigenen teamId-Filter").toContain(uidOf(a.shiftId));
  expect(own, "PII-LEAK: Schicht von B trotz eigenem teamId-Filter").not.toContain(
    uidOf(b.shiftId),
  );
});
