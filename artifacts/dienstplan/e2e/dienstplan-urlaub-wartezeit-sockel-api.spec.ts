import { test, expect } from "@playwright/test";
import { TeamTestHarness } from "./helpers/teams";

/**
 * API-Beweis (Task #881, § 4 BUrlG): der garantierte Urlaubssockel entsteht
 * in den ersten 6 vollen Beschäftigungsmonaten nur anteilig (1/12 je vollem
 * Monat seit Vertragsbeginn, Anniversary-Zählung ab startDate — NICHT nach
 * Kalendermonaten). Ab dem 6. vollen Monat gilt sofort der volle
 * Jahresanspruch für den Rest des Kalenderjahres. Die Berechnung ist rein
 * aus Vertragsbeginn + Stichtag abgeleitet (nichts gespeichert), gilt also
 * automatisch auch rückwirkend für bereits bestehende Verträge.
 *
 * Abgesichert wird über GET /api/contracts/:id/vacation-balance
 * (vacationSockelHours):
 * - Eintritt vor < 6 vollen Monaten -> Sockel anteilig (Bruchteil < 1).
 * - Eintritt vor >= 6 vollen Monaten -> voller Sockel (kein Abschlag mehr).
 * - Alter Bestandsvertrag (Eintritt vor Jahren) -> unverändert voller Sockel.
 */

function firstOfMonthMonthsAgo(monthsAgo: number): string {
  const now = new Date();
  // Tag=1, damit die Anniversary-Bedingung (aktueller Tag >= Starttag)
  // unabhängig vom Testlauf-Zeitpunkt immer erfüllt ist.
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1));
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${d.getUTCFullYear()}-${mm}-01`;
}

// 30 Urlaubstage / 5 Tage-Woche * 40h = 240h voller Sockel (Default-Ops).
const FULL_SOCKEL_HOURS = 240;

let h: TeamTestHarness;
let teamId: number;
let newHireUser: number;
let seniorUser: number;
let legacyUser: number;
let newHireContract: number;
let seniorContract: number;
let legacyContract: number;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  h = await TeamTestHarness.login();
  await h.becomeDienstleister();
  teamId = await h.createTeam("E2E Wartezeit-Sockel");

  newHireUser = await h.createUser({ teamId, role: "assistant" });
  seniorUser = await h.createUser({ teamId, role: "assistant" });
  legacyUser = await h.createUser({ teamId, role: "assistant" });

  // Frisch: Eintritt vor genau 2 vollen Monaten -> Faktor 2/12.
  newHireContract = await h.createContract(teamId, newHireUser, {
    vacationDays: 30,
    weeklyHours: 40,
    startDate: firstOfMonthMonthsAgo(2),
  });
  // Eintritt vor 8 vollen Monaten (> 6) -> voller Sockel.
  seniorContract = await h.createContract(teamId, seniorUser, {
    vacationDays: 30,
    weeklyHours: 40,
    startDate: firstOfMonthMonthsAgo(8),
  });
  // Bestandsvertrag mit Eintritt vor Jahren -> unverändert voller Sockel
  // (Bestandsschutz, keine Regression durch die neue Wartezeit-Logik).
  legacyContract = await h.createContract(teamId, legacyUser, {
    vacationDays: 30,
    weeklyHours: 40,
    startDate: "2015-01-01",
  });
});

test.afterAll(async () => {
  await h.cleanup();
});

test("frisch eingestellte Assistenzkraft (< 6 Monate) bekommt nur den anteiligen Sockel", async () => {
  const res = await h.ctx.get(`/api/contracts/${newHireContract}/vacation-balance`);
  expect(res.ok(), `Bilanz-Abruf fehlgeschlagen (${res.status()})`).toBe(true);
  const body = (await res.json()) as { vacationSockelHours: number };
  // 2 volle Monate seit Eintritt -> 240h * 2/12 = 40h.
  expect(body.vacationSockelHours).toBeCloseTo((FULL_SOCKEL_HOURS * 2) / 12, 1);
  expect(body.vacationSockelHours).toBeLessThan(FULL_SOCKEL_HOURS);
});

test("nach Ablauf der 6-Monats-Wartezeit steht sofort der volle Sockel zur Verfügung", async () => {
  const res = await h.ctx.get(`/api/contracts/${seniorContract}/vacation-balance`);
  expect(res.ok(), `Bilanz-Abruf fehlgeschlagen (${res.status()})`).toBe(true);
  const body = (await res.json()) as { vacationSockelHours: number };
  expect(body.vacationSockelHours).toBe(FULL_SOCKEL_HOURS);
});

test("Bestandsverträge mit langjährigem Eintritt bleiben beim vollen Sockel", async () => {
  const res = await h.ctx.get(`/api/contracts/${legacyContract}/vacation-balance`);
  expect(res.ok(), `Bilanz-Abruf fehlgeschlagen (${res.status()})`).toBe(true);
  const body = (await res.json()) as { vacationSockelHours: number };
  expect(body.vacationSockelHours).toBe(FULL_SOCKEL_HOURS);
});
