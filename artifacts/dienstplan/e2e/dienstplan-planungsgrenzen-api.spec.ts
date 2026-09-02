import { test, expect } from "@playwright/test";
import {
  registerFreeAccount,
  setAccountPlan,
  deleteFreeAccount,
  type FreeAccount,
} from "./helpers/teams";

/**
 * API-Test: Die Grenzen der automatischen Planung (Etappe 2, 02.09.2026).
 *
 * Dienste am Stück und Ruhezeit stehen AM TEAM, nicht im Browser. Kays
 * Entscheidung: Die Werte sind eine Absprache des Teams, keine Ansichtssache
 * eines Geräts — wer Dreierblöcke einstellt, soll das nicht auf jedem Rechner
 * neu tun, und die nächste planende Person soll dieselbe Regel vorfinden.
 *
 * Geprüft:
 *   1. Startwerte: 1 Dienst am Stück, 11 h Ruhezeit (ArbZG-Regelfall).
 *   2. Setzen und Wiederlesen.
 *   3. Team-Override ohne Vermischung mit dem Konto-Wert — ein Dienstleister
 *      führt oft ein Drei-Schicht-Team neben einem Ein-Personen-Team.
 */

type Settings = {
  planungBlockLaenge: number;
  planungRuhezeitStunden: number;
  isOverride: boolean;
  nightPercent: number;
  nightStart: string;
  nightEnd: string;
  sundayPercent: number;
  holidayPercent: number;
};

let acc: FreeAccount;
let teamId = 0;

test.beforeAll(async () => {
  acc = await registerFreeAccount("dienstleister", "planungsgrenzen");
  await setAccountPlan(acc.email, "premium");
  const res = await acc.ctx.post("/api/teams", {
    data: { name: `E2E Planungsgrenzen ${Date.now()}` },
  });
  expect(res.status(), await res.text()).toBe(201);
  teamId = ((await res.json()) as { id: number }).id;
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

async function lies(scopeTeamId?: number): Promise<Settings> {
  const url =
    scopeTeamId === undefined
      ? "/api/allowance-settings"
      : `/api/allowance-settings?teamId=${scopeTeamId}`;
  const res = await acc.ctx.get(url);
  expect(res.ok(), `${url}: ${await res.text()}`).toBe(true);
  return (await res.json()) as Settings;
}

/**
 * PUT ist ein VOLL-Ersetzen — die fünf Zuschlagsfelder sind Pflicht. Der
 * Helper liest erst den aktuellen Stand und schickt ihn mit, wie das Formular.
 */
async function schreibe(
  werte: { planungBlockLaenge?: number; planungRuhezeitStunden?: number },
  scopeTeamId?: number,
): Promise<Settings> {
  const url =
    scopeTeamId === undefined
      ? "/api/allowance-settings"
      : `/api/allowance-settings?teamId=${scopeTeamId}`;
  const a = await lies(scopeTeamId);
  const res = await acc.ctx.put(url, {
    data: {
      nightPercent: a.nightPercent,
      nightStart: a.nightStart,
      nightEnd: a.nightEnd,
      sundayPercent: a.sundayPercent,
      holidayPercent: a.holidayPercent,
      planungBlockLaenge: werte.planungBlockLaenge ?? a.planungBlockLaenge,
      planungRuhezeitStunden: werte.planungRuhezeitStunden ?? a.planungRuhezeitStunden,
    },
  });
  expect(res.ok(), `${url}: ${await res.text()}`).toBe(true);
  return (await res.json()) as Settings;
}

test("Startwerte: täglich wechseln, 11 Stunden Ruhezeit", async () => {
  const s = await lies();
  expect(s.planungBlockLaenge, "1 = jeden Tag die nächste Person").toBe(1);
  expect(s.planungRuhezeitStunden, "11 h ist der gesetzliche Regelfall").toBe(11);
});

test("die Werte lassen sich setzen und kommen genauso zurück", async () => {
  const gesetzt = await schreibe({ planungBlockLaenge: 3, planungRuhezeitStunden: 9 });
  expect(gesetzt.planungBlockLaenge).toBe(3);
  expect(gesetzt.planungRuhezeitStunden).toBe(9);

  const gelesen = await lies();
  expect(gelesen.planungBlockLaenge, "Der Wert muss die Antwort überleben").toBe(3);
  expect(gelesen.planungRuhezeitStunden).toBe(9);
});

test("ein Team plant in Dreierblöcken, während das Konto täglich wechselt", async () => {
  await schreibe({ planungBlockLaenge: 1, planungRuhezeitStunden: 11 });

  const geerbt = await lies(teamId);
  expect(geerbt.isOverride, "Vor dem Setzen gibt es keinen eigenen Team-Wert").toBe(false);
  expect(geerbt.planungBlockLaenge, "Ohne Override gilt der Konto-Wert").toBe(1);

  const gesetzt = await schreibe({ planungBlockLaenge: 3 }, teamId);
  expect(gesetzt.isOverride).toBe(true);
  expect(gesetzt.planungBlockLaenge).toBe(3);

  // Gegenprobe: Ohne sie würde der Test auch dann grün, wenn der Server den
  // Team-Wert in die Konto-Zeile schreibt — genau die Vermischung, die die
  // Override-Kette verhindern soll.
  expect(
    (await lies()).planungBlockLaenge,
    "Ein Team-Override darf den Konto-Wert nicht mitziehen",
  ).toBe(1);
});
