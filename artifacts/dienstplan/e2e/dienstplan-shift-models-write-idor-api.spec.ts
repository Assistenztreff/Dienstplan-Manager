import { test, expect } from "@playwright/test";
import {
  deleteFreeAccount,
  registerFreeAccount,
  type FreeAccount,
} from "./helpers/teams";

/**
 * API-Test: KONTO-übergreifende Tenant-Grenze der Schichtmodelle —
 * `PATCH /shift-models/:id` und `DELETE /shift-models/:id`.
 *
 * Der bestehende dienstplan-shift-model-team-idor.spec.ts prüft die Grenze
 * mit einem geseedeten Admin OHNE Teams; er läuft aber NICHT im Merge-Check
 * (Namensmuster). Dieser Spec beweist die Invariante zwischen zwei komplett
 * getrennten ARBEITGEBER-Konten (jeweils mit eigenem Standard-Team) und läuft
 * als *-api.spec.ts im Merge-Gate mit. Eine Regression (Wegfall des
 * `teamId ∈ allowedTeams`-Filters im UPDATE/DELETE-WHERE) würde es einem
 * fremden Arbeitgeber erlauben, Wertungs-/Vergütungsparameter fremder Dienste
 * zu manipulieren oder Modelle fremder Konten zu löschen.
 *
 * Aufbau:
 * - Arbeitgeber P und Q (privat, free), je frisch registriert. Die
 *   Registrierung seedet 5 Standard-Schichtmodelle im Standard-Team —
 *   die Specs greifen je ein geseedetes Modell ab (kein Anlegen nötig,
 *   Free startet AM maxShiftModels-Limit).
 *
 * Geprueft (Done-Kriterien):
 * 1. Q -> PATCH auf ein P-Modell (name/valuationPercent): 404, keine Daten
 *    in der Antwort.
 * 2. Q -> DELETE auf ein P-Modell: 404.
 * 3. Nachkontrolle P: Modell existiert UNVERAENDERT (Name, valuationPercent,
 *    isActive) in der gescopten Liste.
 * 4. Positivkontrolle: P kann das EIGENE Modell aendern (200).
 * 5. Positivkontrolle: Q kann das EIGENE Modell aendern (200) — belegt, dass
 *    die 404 am Scope lag, nicht an einem Defekt der Q-Session.
 *
 * Laeuft rein ueber die API gegen den isolierten Test-Stack.
 */

type ShiftModelRow = {
  id: number;
  name: string;
  valuationPercent: number;
  isActive: boolean;
};

let employerP: FreeAccount;
let employerQ: FreeAccount;

let pModel: ShiftModelRow;
let qModel: ShiftModelRow;

async function firstSeededModel(acc: FreeAccount): Promise<ShiftModelRow> {
  const res = await acc.ctx.get("/api/shift-models");
  expect(res.status(), "Schichtmodell-Liste muss lesbar sein").toBe(200);
  const models = (await res.json()) as ShiftModelRow[];
  expect(
    models.length,
    "Registrierung muss Standard-Schichtmodelle geseedet haben",
  ).toBeGreaterThan(0);
  return models[0]!;
}

test.beforeAll(async () => {
  test.setTimeout(120_000);

  employerP = await registerFreeAccount("privat", "smwriteidor-p");
  pModel = await firstSeededModel(employerP);

  employerQ = await registerFreeAccount("privat", "smwriteidor-q");
  qModel = await firstSeededModel(employerQ);
});

test.afterAll(async () => {
  await deleteFreeAccount(employerP);
  await deleteFreeAccount(employerQ);
});

test("Admin Q bekommt 404 beim PATCH auf ein fremdes Schichtmodell", async () => {
  const res = await employerQ.ctx.patch(`/api/shift-models/${pModel.id}`, {
    data: { name: `gehackt ${Date.now()}`, valuationPercent: 1 },
  });
  expect(
    res.status(),
    "SICHERHEIT: PATCH auf fremdes Konto-Schichtmodell muss 404 liefern (Team-Scoping-Invariante)",
  ).toBe(404);
  const body = await res.text();
  expect(body, "404-Antwort darf keine Modelldaten enthalten").not.toContain(
    "valuationPercent",
  );
});

test("Admin Q bekommt 404 beim DELETE auf ein fremdes Schichtmodell", async () => {
  const res = await employerQ.ctx.delete(`/api/shift-models/${pModel.id}`);
  expect(
    res.status(),
    "SICHERHEIT: DELETE auf fremdes Konto-Schichtmodell muss 404 liefern (Team-Scoping-Invariante)",
  ).toBe(404);
});

test("Nachkontrolle P: Modell existiert unveraendert weiter", async () => {
  const res = await employerP.ctx.get("/api/shift-models");
  expect(res.status(), "P-Modelle muessen lesbar bleiben").toBe(200);
  const models = (await res.json()) as ShiftModelRow[];
  const found = models.find((m) => m.id === pModel.id);
  expect(found, "P-Modell muss nach den Fremd-Angriffen noch existieren").toBeTruthy();
  expect(
    found!.name,
    "Name darf durch den fremden PATCH-Versuch nicht veraendert sein",
  ).toBe(pModel.name);
  expect(
    found!.valuationPercent,
    "valuationPercent darf durch den fremden PATCH-Versuch nicht veraendert sein",
  ).toBe(pModel.valuationPercent);
  expect(
    found!.isActive,
    "isActive darf durch den fremden DELETE-Versuch (Soft-Delete-Pfad) nicht veraendert sein",
  ).toBe(pModel.isActive);
});

test("Positivkontrolle: Admin P kann das eigene Modell aendern (200)", async () => {
  const newName = `E2E SM P geaendert ${Date.now()}`;
  const res = await employerP.ctx.patch(`/api/shift-models/${pModel.id}`, {
    data: { name: newName },
  });
  expect(res.status(), "Eigenes Modell muss per PATCH aenderbar sein").toBe(200);
  const body = (await res.json()) as ShiftModelRow;
  expect(body.name, "PATCH muss den neuen Namen persistieren").toBe(newName);
});

test("Positivkontrolle: Admin Q kann das eigene Modell aendern (404 lag am Scope)", async () => {
  const newName = `E2E SM Q geaendert ${Date.now()}`;
  const res = await employerQ.ctx.patch(`/api/shift-models/${qModel.id}`, {
    data: { name: newName },
  });
  expect(res.status(), "Eigenes Modell von Q muss per PATCH aenderbar sein").toBe(200);
  const body = (await res.json()) as ShiftModelRow;
  expect(body.name, "PATCH muss den neuen Namen persistieren").toBe(newName);
});
