import { test, expect } from "@playwright/test";
import {
  registerFreeAccount,
  setAccountPlan,
  deleteFreeAccount,
  type FreeAccount,
} from "./helpers/teams";

/**
 * API-Test: Der Schalter „Mit Vertretungen planen“.
 *
 * Kay-Entscheidung 30.08.2026: Ob mit Vertretungen geplant wird, ist eine
 * Grundsatzentscheidung des Teams — keine, die zu jedem einzelnen Dienst neu
 * getroffen wird. Im Drei-Schicht-Modell hat das Vertretungs-Feld den
 * Schicht-Dialog nur aufgebläht und wurde übersehen. Der Schalter steht
 * deshalb einmal in den Einstellungen, direkt über der Vertretungsvergütung,
 * zu der er gehört.
 *
 * Geprüft wird die Zusicherung des Servers:
 *   1. Ein frisches Konto startet AUS — die App fängt ohne dieses Feld an.
 *   2. Der Schalter lässt sich setzen und kommt genauso zurück.
 *   3. Er ist Team-Override-fähig wie die Vertretungsvergütung darunter:
 *      ein Team kann mit Vertretungen planen, während das Konto es nicht tut.
 *      Genau das braucht ein Dienstleister, der ein Drei-Schicht-Team und ein
 *      Ein-Personen-Team nebeneinander führt.
 *   4. Der Override ist entfernbar; danach greift wieder der Konto-Wert.
 */

type Settings = {
  vertretungEnabled: boolean;
  isOverride: boolean;
  teamId: number | null;
  // Die fuenf Zuschlagsfelder, die PUT als Pflicht verlangt (s. schreibe()).
  nightPercent: number;
  nightStart: string;
  nightEnd: string;
  sundayPercent: number;
  holidayPercent: number;
};

let acc: FreeAccount;
let teamId = 0;

test.beforeAll(async () => {
  acc = await registerFreeAccount("dienstleister", "vertretung-schalter");
  // Premium: ein zweites Team liegt über dem Free-Limit maxTeams = 1.
  await setAccountPlan(acc.email, "premium");
  const teamRes = await acc.ctx.post("/api/teams", {
    data: { name: `E2E Vertretung Team ${Date.now()}` },
  });
  expect(teamRes.status(), await teamRes.text()).toBe(201);
  teamId = ((await teamRes.json()) as { id: number }).id;
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
 * Setzt den Schalter — auf demselben Weg wie das Einstellungs-Formular.
 *
 * PUT /allowance-settings ist ein VOLL-Ersetzen, kein Teil-Update: Die fuenf
 * Zuschlagsfelder sind im Schema Pflicht, und die Route schreibt den ganzen
 * Satz teamOverridable-Werte. Ein Aufruf mit nur `vertretungEnabled` waere
 * deshalb 400 — und wuerde ausserdem einen Weg testen, den die App gar nicht
 * geht. Der Helper liest daher erst den aktuellen Stand des jeweiligen Scopes
 * und schickt ihn unveraendert mit, genau wie das Formular.
 */
async function schreibe(wert: boolean, scopeTeamId?: number): Promise<Settings> {
  const url =
    scopeTeamId === undefined
      ? "/api/allowance-settings"
      : `/api/allowance-settings?teamId=${scopeTeamId}`;
  const aktuell = await lies(scopeTeamId);
  const res = await acc.ctx.put(url, {
    data: {
      nightPercent: aktuell.nightPercent,
      nightStart: aktuell.nightStart,
      nightEnd: aktuell.nightEnd,
      sundayPercent: aktuell.sundayPercent,
      holidayPercent: aktuell.holidayPercent,
      vertretungEnabled: wert,
    },
  });
  expect(res.ok(), `${url}: ${await res.text()}`).toBe(true);
  return (await res.json()) as Settings;
}

test("ein frisches Konto plant ohne Vertretungen", async () => {
  const settings = await lies();
  expect(
    settings.vertretungEnabled,
    "Die App startet ohne das Vertretungs-Feld — wer es braucht, schaltet es an",
  ).toBe(false);
});

test("der Schalter laesst sich setzen und kommt genauso zurueck", async () => {
  expect((await schreibe(true)).vertretungEnabled).toBe(true);
  expect((await lies()).vertretungEnabled, "Der Wert muss die Antwort ueberleben").toBe(true);

  expect((await schreibe(false)).vertretungEnabled).toBe(false);
  expect((await lies()).vertretungEnabled).toBe(false);
});

test("ein Team kann mit Vertretungen planen, waehrend das Konto es nicht tut", async () => {
  // Ausgangslage: Konto AUS.
  await schreibe(false);
  expect((await lies()).vertretungEnabled).toBe(false);

  // Ohne eigenen Override erbt das Team den Konto-Wert.
  const geerbt = await lies(teamId);
  expect(geerbt.isOverride, "Vor dem Setzen gibt es keinen eigenen Team-Wert").toBe(false);
  expect(geerbt.vertretungEnabled, "Ohne Override gilt der Konto-Wert").toBe(false);

  // Jetzt der Override.
  const gesetzt = await schreibe(true, teamId);
  expect(gesetzt.isOverride).toBe(true);
  expect(gesetzt.vertretungEnabled).toBe(true);
  expect((await lies(teamId)).vertretungEnabled, "Das Team plant mit Vertretungen").toBe(true);

  // Gegenprobe: das Konto ist davon unberuehrt geblieben. Ohne diese Zeile
  // wuerde der Test auch dann gruen, wenn der Server den Team-Wert in die
  // Konto-Zeile schreibt — also genau die Multi-Tenant-Vermischung, die die
  // Override-Kette verhindern soll.
  expect(
    (await lies()).vertretungEnabled,
    "Ein Team-Override darf den Konto-Wert nicht mitziehen",
  ).toBe(false);
});

test("der Team-Override laesst sich entfernen, danach gilt wieder der Konto-Wert", async () => {
  await schreibe(true);
  await schreibe(false, teamId);
  expect((await lies(teamId)).vertretungEnabled).toBe(false);

  const del = await acc.ctx.delete(`/api/allowance-settings?teamId=${teamId}`);
  expect(del.status(), await del.text()).toBe(204);

  const danach = await lies(teamId);
  expect(danach.isOverride, "Nach dem Loeschen gibt es keinen eigenen Team-Wert mehr").toBe(false);
  expect(danach.vertretungEnabled, "Das Team faellt auf den Konto-Wert (AN) zurueck").toBe(true);
});
