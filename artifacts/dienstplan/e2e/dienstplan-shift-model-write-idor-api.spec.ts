import { test, expect } from "@playwright/test";
import {
  deleteFreeAccount,
  registerFreeAccount,
  type FreeAccount,
} from "./helpers/teams";

/**
 * API-Test (#443, Teil 2): SCHREIB-Seite der Schichtmodell-by-id-Operationen —
 * `PATCH /shift-models/:id` und `DELETE /shift-models/:id`.
 *
 * Es existiert bereits ein UI-naher IDOR-Test (dienstplan-shift-model-team-idor
 * .spec.ts) mit Dienstleister-Harness. Dieser Spec folgt dem Merge-Gate-Muster
 * (`*-api.spec.ts`) und beweist die Tenant-Grenze mit zwei komplett getrennten
 * privaten Free-Konten: Ein fremder Arbeitgeber Q darf ein Schichtmodell aus
 * Konto P weder aendern noch loeschen — laut Team-Scoping-Invariante muss beides
 * 404 liefern (kein 403, damit die Existenz fremder Modell-IDs nicht bestaetigt
 * wird). Eine Regression (Wegfall des `teamId ∈ allowedTeams`-Checks im
 * UPDATE/DELETE-WHERE) wuerde es erlauben, Wertungs-/Zuschlagsparameter fremder
 * Konten zu manipulieren oder Modelle fremder Mandanten zu loeschen.
 *
 * Aufbau:
 * - Beide Konten erhalten bei der Registrierung 5 Standard-Schichtmodelle
 *   (Seeding). Als Ziel dient eines der bereits vorhandenen Modelle von P —
 *   so bleiben beide Konten Free (kein maxShiftModels-Anlegen noetig).
 *
 * Geprueft (Done-Kriterien):
 * 1. Admin Q -> PATCH auf ein P-Modell: 404.
 * 2. Admin Q -> DELETE auf ein P-Modell: 404.
 * 3. Nachkontrolle P: das Modell existiert UNVERAENDERT weiter (Name wie zuvor).
 * 4. Positivkontrolle: P kann das EIGENE Modell aendern (200).
 *
 * Laeuft rein ueber die API gegen den isolierten Test-Stack.
 */

type ShiftModelRow = { id: number; name: string };

let employerP: FreeAccount;
let employerQ: FreeAccount;

let pModelId = 0;
let pModelName = "";

async function firstShiftModel(acc: FreeAccount): Promise<ShiftModelRow> {
  const res = await acc.ctx.get("/api/shift-models");
  expect(res.status(), "Schichtmodell-Liste sollte 200 liefern").toBe(200);
  const models = (await res.json()) as ShiftModelRow[];
  expect(models.length, "Registrierung seedet 5 Standard-Modelle").toBeGreaterThan(0);
  return models[0]!;
}

test.beforeAll(async () => {
  test.setTimeout(120_000);

  employerP = await registerFreeAccount("privat", "smwriteidor-p");
  const model = await firstShiftModel(employerP);
  pModelId = model.id;
  pModelName = model.name;

  employerQ = await registerFreeAccount("privat", "smwriteidor-q");
});

test.afterAll(async () => {
  await deleteFreeAccount(employerP);
  await deleteFreeAccount(employerQ);
});

test("Admin Q bekommt 404 beim PATCH auf ein fremdes Schichtmodell", async () => {
  const res = await employerQ.ctx.patch(`/api/shift-models/${pModelId}`, {
    data: { name: `gehackt ${Date.now()}` },
  });
  expect(
    res.status(),
    "SICHERHEIT: PATCH auf fremdes Tenant-Modell muss 404 liefern (Team-Scoping-Invariante)",
  ).toBe(404);
});

test("Admin Q bekommt 404 beim DELETE auf ein fremdes Schichtmodell", async () => {
  const res = await employerQ.ctx.delete(`/api/shift-models/${pModelId}`);
  expect(
    res.status(),
    "SICHERHEIT: DELETE auf fremdes Tenant-Modell muss 404 liefern (Team-Scoping-Invariante)",
  ).toBe(404);
});

test("Nachkontrolle P: das Modell existiert unveraendert weiter", async () => {
  const model = await firstShiftModel(employerP);
  expect(model.id, "Modell darf durch den fremden DELETE-Versuch nicht verschwinden").toBe(pModelId);
  expect(
    model.name,
    "Name darf durch den fremden PATCH-Versuch nicht veraendert sein",
  ).toBe(pModelName);
});

test("Positivkontrolle: Admin P kann das eigene Modell aendern (200)", async () => {
  const newName = `E2E SM-WriteIdor geaendert ${Date.now()}`;
  const res = await employerP.ctx.patch(`/api/shift-models/${pModelId}`, {
    data: { name: newName },
  });
  expect(res.status(), "Eigenes Modell muss per PATCH aenderbar sein").toBe(200);
  const body = (await res.json()) as ShiftModelRow;
  expect(body.name, "PATCH muss den neuen Namen persistieren").toBe(newName);
});
