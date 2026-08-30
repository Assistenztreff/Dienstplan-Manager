import { test, expect } from "@playwright/test";
import { deleteFreeAccount, registerFreeAccount, setAccountPlan, type FreeAccount } from "./helpers/teams";
import { dbReadDeletionArchives } from "./helpers/db";

/**
 * Der LÖSCH-WORKFLOW einer Assistenzkraft (Stufe 5).
 *
 * Die Regel in Worten:
 *   1. Eine Assistenzkraft MIT aufbewahrungspflichtigen Daten lässt sich nicht
 *      einfach löschen — ohne Archiv antwortet der Server mit 409.
 *   2. Das Archiv erzeugt der SERVER aus der Datenbank und liefert dieselben
 *      Bytes als Download. Es enthält Stundenliste, Zeiterfassung,
 *      Stundenkonto, Lohnauswertung, Änderungshistorie und Verträge.
 *   3. Danach geht das Löschen — und das Archiv überlebt die Person.
 *   4. Ein Konto OHNE solche Daten braucht kein Archiv: ein Export-Ritual für
 *      ein leeres Konto wäre reine Schikane.
 *
 * Warum das so gebaut ist (Kay-Entscheidung, Option B): echtes Löschen bleibt
 * möglich — eine Kontenliste voller "inaktiv seit 2024"-Karteileichen will
 * niemand. Aber eine Warnung mit Export-Knopf lässt sich wegklicken, deshalb
 * ist die Sperre serverseitig und nicht nur in der Oberfläche.
 *
 * Datumsfest: die Dienste liegen auf festen Tagen des Vormonats, und geprüft
 * wird nie gegen "heute".
 */

test.describe.configure({ mode: "serial" });

let acc: FreeAccount;

function monatsTag(monateZurueck: number, tagImMonat: number): Date {
  const heute = new Date();
  return new Date(heute.getFullYear(), heute.getMonth() - monateZurueck, tagImMonat);
}

function dienstAn(tag: Date, vonStunde: number, bisStunde: number) {
  const iso = (stunde: number) =>
    new Date(tag.getFullYear(), tag.getMonth(), tag.getDate(), stunde, 0, 0).toISOString();
  return { startTime: iso(vonStunde), endTime: iso(bisStunde) };
}

async function assistenzkraftAnlegen(kennung: string): Promise<number> {
  const res = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E Loesch ${kennung} ${Date.now()}`,
      email: `e2e.loesch.${kennung}.${Date.now()}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(res.status(), `Assistenzkraft sollte 201 liefern (${await res.text()})`).toBe(201);
  return ((await res.json()) as { id: number }).id;
}

async function fixDienst(userId: number, tag: Date): Promise<number> {
  const res = await acc.ctx.post("/api/shifts", {
    data: {
      userId,
      type: "work",
      planningStatus: "FIX",
      shiftModelId: null,
      ...dienstAn(tag, 8, 16),
    },
  });
  expect(res.status(), `Dienst-Anlage sollte 201 liefern (${await res.text()})`).toBe(201);
  return ((await res.json()) as { id: number }).id;
}

test.beforeAll(async () => {
  test.setTimeout(180_000);
  acc = await registerFreeAccount("privat", "loeschwf");
  // Premium: vergangene Monate liegen ausserhalb des Free-Planungsfensters.
  await setAccountPlan(acc.email, "premium");
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

test("ohne Archiv verweigert der Server das Loeschen einer Assistenzkraft mit Diensten", async () => {
  test.setTimeout(120_000);
  const userId = await assistenzkraftAnlegen("mitdaten");
  await fixDienst(userId, monatsTag(1, 15));

  const del = await acc.ctx.delete(`/api/users/${userId}`);
  expect(del.status(), "Loeschen ohne Archiv muss 409 sein").toBe(409);
  expect(((await del.json()) as { code?: string }).code).toBe("deletion_archive_required");

  // Und die Person ist noch da.
  const nachher = await acc.ctx.get(`/api/users/${userId}`);
  expect(nachher.ok(), "Das Konto darf nach dem abgelehnten Loeschen nicht weg sein").toBe(true);
});

test("das Archiv enthaelt alle aufbewahrungspflichtigen Tabellen und laesst sich danach loeschen", async () => {
  test.setTimeout(180_000);
  const userId = await assistenzkraftAnlegen("archiv");
  const tag = monatsTag(1, 16);
  const shiftId = await fixDienst(userId, tag);

  // Eine Korrektur, damit die Aenderungshistorie im Archiv nicht leer ist.
  const patch = await acc.ctx.patch(`/api/shifts/${shiftId}`, { data: dienstAn(tag, 8, 18) });
  expect(patch.status(), await patch.text()).toBe(200);

  const archivRes = await acc.ctx.post(`/api/users/${userId}/deletion-archive`);
  expect(archivRes.status(), `Archiv sollte 200 liefern (${archivRes.status()})`).toBe(200);
  expect(archivRes.headers()["content-type"]).toContain("application/zip");
  expect(
    archivRes.headers()["content-disposition"],
    "Der Browser braucht einen Dateinamen zum Ablegen",
  ).toContain(".zip");
  expect(
    archivRes.headers()["x-deletion-archive-id"],
    "Die Archiv-ID gehoert in die Antwort",
  ).toBeTruthy();

  const buf = await archivRes.body();
  expect(buf.byteLength, "Ein leeres Archiv waere kein Nachweis").toBeGreaterThan(200);
  // ZIP-Signatur: jede ZIP beginnt mit "PK".
  expect(buf.subarray(0, 2).toString("latin1")).toBe("PK");

  // Die Dateinamen stehen unkomprimiert im ZIP-Verzeichnis und sind deshalb
  // direkt im Rohpuffer sichtbar — reicht als Inhalts-Nachweis ohne Entpacker.
  const inhalt = buf.toString("latin1");
  for (const datei of [
    "00-hinweis.txt",
    "10-stundenliste.csv",
    "20-zeiterfassung.csv",
    "30-stundenkonto.csv",
    "40-lohnauswertung.csv",
    "50-aenderungen.csv",
    "60-vertraege.csv",
  ]) {
    expect(inhalt, `Im Archiv fehlt ${datei}`).toContain(datei);
  }

  // Jetzt geht das Loeschen.
  const del = await acc.ctx.delete(`/api/users/${userId}`);
  expect(del.status(), `Loeschen mit Archiv sollte 204 liefern (${await del.text()})`).toBe(204);

  const nachher = await acc.ctx.get(`/api/users/${userId}`);
  expect(nachher.status(), "Das Konto ist wirklich weg").toBe(404);
});

test("das Archiv einer anderen Person schaltet das Loeschen nicht frei", async () => {
  test.setTimeout(180_000);
  const userId = await assistenzkraftAnlegen("einmal");
  await fixDienst(userId, monatsTag(1, 17));

  expect((await acc.ctx.post(`/api/users/${userId}/deletion-archive`)).status()).toBe(200);
  expect((await acc.ctx.delete(`/api/users/${userId}`)).status()).toBe(204);

  // Zweite Person, gleiche Lage, aber ohne eigenes Archiv. Das Archiv der
  // ersten liegt weiterhin in der Datenbank — es darf ihr trotzdem nicht den
  // Weg freimachen.
  const zweiteId = await assistenzkraftAnlegen("zweite");
  await fixDienst(zweiteId, monatsTag(1, 18));
  const del2 = await acc.ctx.delete(`/api/users/${zweiteId}`);
  expect(del2.status(), "Ein fremdes Archiv darf kein Loeschen freischalten").toBe(409);
});

test("das Archiv ueberlebt die geloeschte Person und ist als verbraucht gestempelt", async () => {
  test.setTimeout(180_000);
  const userId = await assistenzkraftAnlegen("ueberlebt");
  await fixDienst(userId, monatsTag(1, 19));

  const archivRes = await acc.ctx.post(`/api/users/${userId}/deletion-archive`);
  expect(archivRes.status(), await archivRes.text()).toBe(200);
  const geliefert = (await archivRes.body()).byteLength;

  // Vor dem Loeschen: Archiv da, aber noch nicht verbraucht.
  const vorher = await dbReadDeletionArchives(userId);
  expect(vorher, "Der Export muss eine Archiv-Zeile hinterlassen").toHaveLength(1);
  expect(vorher[0]!.deletedAt, "Vor dem Loeschen ist das Archiv unverbraucht").toBeNull();
  expect(
    vorher[0]!.tatsaechlicheGroesse,
    "Die abgelegten Bytes muessen exakt die sein, die der Planer heruntergeladen hat",
  ).toBe(geliefert);

  expect((await acc.ctx.delete(`/api/users/${userId}`)).status()).toBe(204);
  expect((await acc.ctx.get(`/api/users/${userId}`)).status()).toBe(404);

  // Nach dem Loeschen: Person weg, Archiv samt Inhalt da, als verbraucht
  // gestempelt. Genau das ist die Zusage von Stufe 5 — der Nachweis
  // ueberlebt, das Konto nicht. Und der Stempel ist es, der ein zweites
  // Loeschen mit demselben Archiv ausschliesst.
  const nachher = await dbReadDeletionArchives(userId);
  expect(nachher, "Das Archiv darf mit der Person NICHT verschwinden").toHaveLength(1);
  expect(nachher[0]!.tatsaechlicheGroesse).toBe(geliefert);
  expect(nachher[0]!.deletedAt, "Ein verwendetes Archiv muss gestempelt sein").not.toBeNull();
  expect(nachher[0]!.fileName).toMatch(/\.zip$/);
});

test("ein Konto ohne aufbewahrungspflichtige Daten braucht kein Archiv", async () => {
  test.setTimeout(120_000);
  const userId = await assistenzkraftAnlegen("leer");
  const del = await acc.ctx.delete(`/api/users/${userId}`);
  expect(
    del.status(),
    `Ein leeres Konto muss ohne Export-Ritual loeschbar bleiben (${await del.text()})`,
  ).toBe(204);
});
