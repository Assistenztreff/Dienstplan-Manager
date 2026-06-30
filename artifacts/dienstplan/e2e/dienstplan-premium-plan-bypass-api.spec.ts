import { test, expect } from "@playwright/test";
import { TeamTestHarness } from "./helpers/teams";

/**
 * API-Test: Ein PREMIUM-Konto umgeht alle drei serverseitig durchgesetzten
 * Free-Limits (maxAssistants = 6, maxTeams = 1, historyMonths = 1).
 *
 * Hintergrund (#220): Die Free-Gates in POST /users, POST /teams und POST
 * /shifts liefern fuer Free-Konten 403 `plan_limit_reached` (abgedeckt durch die
 * `dienstplan-free-*-api`-Specs). Die andere Haelfte des Vertrags — dass ein
 * bezahltes Premium-Konto NICHT von diesen Limits getroffen wird — war bisher
 * nur implizit (alle uebrigen Specs laufen als Premium-Admin) und nirgends
 * explizit abgesichert. Ein Refactor koennte die Gates versehentlich auch auf
 * Premium ausweiten und damit zahlende Kunden aussperren. Dieser Test sichert
 * den Bypass automatisiert ab.
 *
 * Der Setup-Admin (`admin@dienstplan.local`) wird von `setup-test-db` bewusst
 * auf `plan = 'premium'` gehoben; `getUserPlan` liest den Plan frisch aus der DB.
 * Die `TeamTestHarness` loggt diesen Admin ein, schaltet ihn auf
 * `dienstleister` (fuer das Team-Anlegen) und raeumt am Ende FK-sicher auf.
 *
 * Laeuft rein ueber die API gegen den isolierten Test-Stack.
 */

/**
 * Liefert den 15. eines Monats relativ zum aktuellen Monat (offset 0 = aktuell,
 * 2 = uebernaechster Monat). Tag 15 ist robust gegen Monatslaengen und
 * Zeitzonen-Verschiebungen an Monatsgrenzen.
 */
function monthDay(offset: number): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 15);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}-15`;
}

let h: TeamTestHarness;

test.beforeAll(async () => {
  h = await TeamTestHarness.login();
  // POST /teams verlangt requireDienstleister.
  await h.becomeDienstleister();
});

test.afterAll(async () => {
  await h.cleanup();
});

test("Premium-Konto umgeht maxTeams: ein zweites Team wird angelegt (Free-Limit = 1)", async () => {
  // Free wuerde bereits beim 2. Team mit 403 maxTeams blockieren. Beide createTeam
  // verlangen intern 201/ok — gelingt beides, ist das Limit fuer Premium aufgehoben.
  const teamA = await h.createTeam("E2E Premium Team A");
  const teamB = await h.createTeam("E2E Premium Team B");
  expect(teamA, "Team A sollte angelegt werden").toBeGreaterThan(0);
  expect(teamB, "Team B (2.) sollte fuer Premium ohne 403 angelegt werden").toBeGreaterThan(0);
  expect(teamB).not.toBe(teamA);
});

test("Premium-Konto umgeht maxAssistants: mehr als 6 Assistenten werden angelegt (Free-Limit = 6)", async () => {
  const teamA = await h.createTeam("E2E Premium Assi Team");

  // Free wuerde den 7. Assistenten mit 403 maxAssistants blockieren. Sieben
  // erfolgreiche Anlagen (createUser verlangt intern 201/ok) beweisen den Bypass.
  const ids: number[] = [];
  for (let i = 0; i < 7; i++) {
    const id = await h.createUser({ teamId: teamA, role: "assistant" });
    ids.push(id);
  }
  expect(ids.length, "Premium sollte alle 7 Assistenten anlegen koennen").toBe(7);
  expect(new Set(ids).size, "Alle Assistenten-IDs sollten eindeutig sein").toBe(7);
});

test("Premium-Konto umgeht historyMonths: eine Schicht 2 Monate voraus wird angelegt (Free-Limit = 1)", async () => {
  const teamA = await h.createTeam("E2E Premium Shift Team");
  const userId = await h.createUser({ teamId: teamA, role: "assistant" });

  // Free wuerde eine Schicht 2 Monate voraus mit 403 historyMonths blockieren
  // (erlaubt nur aktuellen + naechsten Monat). createShift verlangt intern 201/ok.
  const shiftId = await h.createShift(teamA, userId, monthDay(2));
  expect(shiftId, "Schicht 2 Monate voraus sollte fuer Premium angelegt werden").toBeGreaterThan(0);
});
