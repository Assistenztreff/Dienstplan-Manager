import { test, expect, type APIRequestContext } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";
import {
  registerFreeAccount,
  deleteFreeAccount,
  FREE_ACCOUNT_PASSWORD,
  type FreeAccount,
} from "./helpers/teams";

/**
 * E2E-Hauptweg des Dienstgeruests (Kay-Entscheidung 01.09.2026).
 *
 * Das Geruest zeichnet im Monatsraster an jedem Tag, an dem ein Dienst des
 * Regelplans noch unbesetzt ist, eine ausgegraute Platzhalter-Pille. Der Platz
 * ist REINE ANZEIGE — es entsteht dabei keine Schicht, kein Datensatz, nichts,
 * was PDF-Export, Stundenliste oder Auswertung sehen wuerden.
 *
 * Geprueft wird die Kette, an der das steht:
 *  1. Ohne Regelplan sieht das Raster aus wie bisher (Bestandsschutz — genau
 *     das schuetzt alle uebrigen Specs davor, an diesem Feature zu scheitern).
 *  2. Mit `imRegelplan` erscheint an einem passenden Tag ein offener Platz.
 *  3. Ein Klick darauf oeffnet den Dienst-Dialog mit GENAU DIESEM Dienst und
 *     seinen Standardzeiten vorausgewaehlt.
 *  4. Ist der Platz besetzt, verschwindet er — und mit `standbySlot` haengt
 *     unter der besetzten Pille die flache Vertretungszeile.
 *  5. Auch das Smartphone-Raster zeigt das Geruest (ohne Dienstnamen, dafuer
 *     mit Beginn — bei ~48 px Pillenbreite passt nicht mehr).
 *
 * Eigenes, frisch registriertes Konto: ein Regelplan im gemeinsamen Seed-Team
 * wuerde in JEDEM parallel laufenden Raster-Spec Platzhalter einblenden.
 *
 * Datums-Anker: heute + 3 Tage. Free-Konten duerfen nur bis zum naechsten
 * Monat vorausplanen, ein fixes Datum wuerde ausserdem irgendwann verrotten
 * (siehe e2e/README.md).
 */

type ShiftModel = {
  id: number;
  name: string;
  defaultStartTime: string;
  defaultEndTime: string;
  sortOrder: number;
};

function isoTag(d: Date): string {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

// Anker: heute + 3 Tage. Faellt das auf die letzten Monatstage, weicht der
// Anker auf den 5. des Folgemonats aus — der Stichtag-Test braucht den Tag
// DANACH im selben Monatsraster, und ein Free-Konto darf bis zum naechsten
// Monat vorausplanen (weiter nicht).
const ANKER = (() => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + 3);
  if (d.getDate() > 20) {
    d.setMonth(d.getMonth() + 1, 5);
  }
  return d;
})();
const ZIEL_ISO = isoTag(ANKER);
const FOLGETAG_ISO = (() => {
  const d = new Date(ANKER);
  d.setDate(d.getDate() + 1);
  return isoTag(d);
})();

let acc: FreeAccount | undefined;
let ctx: APIRequestContext;
let dienstId: number;
let assistentId: number;
let assistentName: string;
const angelegteSchichten: number[] = [];

/** Setzt die Regelplan-Felder eines Dienstes (Anlegen scheitert am Free-Limit). */
async function setzeRegel(
  patch: { imRegelplan?: boolean; standbySlot?: boolean; validFrom?: string | null },
): Promise<void> {
  const res = await ctx.patch(`/api/shift-models/${dienstId}`, { data: patch });
  expect(res.ok(), `Dienst aktualisieren fehlgeschlagen (${res.status()})`).toBe(true);
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  acc = await registerFreeAccount("privat", "geruest");
  ctx = acc.ctx;

  const modelsRes = await ctx.get("/api/shift-models");
  expect(modelsRes.ok(), "Dienste lesen fehlgeschlagen").toBe(true);
  const models = (await modelsRes.json()) as ShiftModel[];
  expect(models.length, "Ein frisches Konto bringt Standard-Dienste mit").toBeGreaterThan(0);
  dienstId = models[0]!.id;

  // Alle Wochentage, damit der Zieltag unabhaengig vom Wochentag trifft, und
  // ein 8-Stunden-Fenster (kein 24h-Dienst) fuer die Zeitanzeige der Pille.
  const patch = await ctx.patch(`/api/shift-models/${dienstId}`, {
    data: {
      name: "E2E Regeldienst",
      defaultStartTime: "06:00",
      defaultEndTime: "14:00",
      defaultWeekdays: [1, 2, 3, 4, 5, 6, 7],
      imRegelplan: false,
      standbySlot: false,
      isActive: true,
    },
  });
  expect(patch.ok(), `Dienst vorbereiten fehlgeschlagen (${patch.status()})`).toBe(true);

  assistentName = `E2E Geruest Kraft ${Date.now()}`;
  const userRes = await ctx.post("/api/users", {
    data: {
      name: assistentName,
      email: `e2e.geruest.${Date.now()}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(userRes.ok(), `Assistenzkraft anlegen fehlgeschlagen (${userRes.status()})`).toBe(true);
  assistentId = ((await userRes.json()) as { id: number }).id;
});

test.afterAll(async () => {
  for (const id of angelegteSchichten) {
    try {
      await ctx.delete(`/api/shifts/${id}`);
    } catch {
      /* Aufraeumen darf den Lauf nicht kippen */
    }
  }
  await deleteFreeAccount(acc);
});

/** Desktop-Monatsraster ansteuern: Die Desktop-Standardansicht ist die
 *  TABELLE — das Raster muss wie in den uebrigen Raster-Specs explizit ueber
 *  den persistierten View-Schalter gewaehlt werden, BEVOR die Seite laedt. */
async function gotoDesktopRaster(page: import("@playwright/test").Page, iso: string): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => localStorage.setItem("dienstplan.desktopView", "grid"));
  await page.goto(`/dienstplan?date=${iso}`);
}

test.describe("Dienstgeruest im Monatsraster", () => {
  test.beforeEach(async ({ page }) => {
    await loginViaUi(page, acc!.email, FREE_ACCOUNT_PASSWORD);
  });

  test("ohne Regelplan bleibt das Raster leer, mit Regelplan erscheint der offene Platz", async ({
    page,
  }) => {
    await setzeRegel({ imRegelplan: false });
    await gotoDesktopRaster(page, ZIEL_ISO);

    // Mobil- und Desktop-Ansicht stehen BEIDE im DOM (nur eine ist sichtbar)
    // — alle Zugriffe deshalb auf den Desktop-Container eingegrenzt.
    const desktop = page.getByTestId("dienstplan-desktop");
    const platz = desktop.getByTestId(`day-slot-${ZIEL_ISO}-${dienstId}`);
    // Bestandsschutz: solange kein Dienst im Regelplan steht, zeichnet das
    // Raster keinen einzigen Platzhalter — deshalb sehen alle uebrigen Specs
    // von diesem Feature nichts.
    await expect(desktop.getByTestId("month-grid")).toBeVisible();
    await expect(platz).toHaveCount(0);

    await setzeRegel({ imRegelplan: true });
    await page.reload();
    await expect(platz).toBeVisible();
    await expect(platz).toContainText("E2E Regeldienst");
    await expect(platz).toContainText("06:00");
  });

  test("ein Klick auf den offenen Platz oeffnet den Dialog mit diesem Dienst", async ({ page }) => {
    await setzeRegel({ imRegelplan: true });
    await gotoDesktopRaster(page, ZIEL_ISO);

    await page
      .getByTestId("dienstplan-desktop")
      .getByTestId(`day-slot-${ZIEL_ISO}-${dienstId}`)
      .click();
    const dialog = page.getByTestId("shift-dialog");
    await expect(dialog).toBeVisible();
    // Der Dienst ist vorausgewaehlt — samt seiner Standardzeiten.
    await expect(dialog).toContainText("E2E Regeldienst");
    await expect(dialog.getByTestId("shift-dialog-start")).toHaveValue("06:00");
    await expect(dialog.getByTestId("shift-dialog-end")).toHaveValue("14:00");
  });

  test("besetzter Platz verschwindet, mit Vertretungsplatz kommt die flache Zeile", async ({
    page,
  }) => {
    await setzeRegel({ imRegelplan: true, standbySlot: true });

    const schichtRes = await ctx.post("/api/shifts", {
      data: {
        userId: assistentId,
        shiftModelId: dienstId,
        type: "work",
        startTime: `${ZIEL_ISO}T06:00:00`,
        endTime: `${ZIEL_ISO}T14:00:00`,
      },
    });
    expect(schichtRes.ok(), `Schicht anlegen fehlgeschlagen (${schichtRes.status()})`).toBe(true);
    const schichtId = ((await schichtRes.json()) as { id: number }).id;
    angelegteSchichten.push(schichtId);

    await gotoDesktopRaster(page, ZIEL_ISO);
    const desktop = page.getByTestId("dienstplan-desktop");

    // Der Platz ist besetzt — die Luecke ist zu, der Platzhalter weg.
    await expect(desktop.getByTestId(`day-chip-${schichtId}`)).toBeVisible();
    await expect(desktop.getByTestId(`day-slot-${ZIEL_ISO}-${dienstId}`)).toHaveCount(0);

    // Erst jetzt (Assistenz besetzt) haengt die Vertretungszeile darunter.
    const vertretung = desktop.getByTestId(`day-standby-${schichtId}`);
    await expect(vertretung).toBeVisible();
    await expect(vertretung).toContainText("Vertretung offen");

    // Ohne Vertretungsplatz verschwindet sie wieder.
    await setzeRegel({ standbySlot: false });
    await page.reload();
    await expect(desktop.getByTestId(`day-chip-${schichtId}`)).toBeVisible();
    await expect(vertretung).toHaveCount(0);

    // Wieder abraeumen: die folgenden Tests brauchen den Zieltag unbesetzt.
    const del = await ctx.delete(`/api/shifts/${schichtId}`);
    expect(del.ok(), `Schicht loeschen fehlgeschlagen (${del.status()})`).toBe(true);
    angelegteSchichten.splice(angelegteSchichten.indexOf(schichtId), 1);
  });

  test("das Smartphone-Raster zeigt den offenen Platz ohne Dienstnamen", async ({ page }) => {
    await setzeRegel({ imRegelplan: true });
    // Standard-Viewport der Suite ist 400x720 (Smartphone) — hier bewusst so
    // belassen: geprueft wird genau die eingeklappte Darstellung.
    await page.goto(`/dienstplan?date=${ZIEL_ISO}`);

    const platz = page
      .getByTestId("dienstplan-mobile")
      .getByTestId(`day-slot-${ZIEL_ISO}-${dienstId}`);
    await expect(platz).toBeVisible();
    // Kompaktzeit: volle Stunden ohne Minuten ("6\u201314") — "06:00\u201314:00" passt
    // bei ~48 px Pillenbreite schlicht nicht neben den Plus-Kreis.
    await expect(platz).toContainText("6\u201314");
    // Kein Dienstname: bei ~48 px Pillenbreite bliebe davon nichts Lesbares.
    await expect(platz).not.toContainText("E2E Regeldienst");
  });

  test("vor dem Stichtag bleibt der Platz aus", async ({ page }) => {
    // validFrom = Folgetag -> am Zieltag greift die Regel noch nicht, einen
    // Tag spaeter schon. Beide Tage liegen im selben Monatsraster.
    await setzeRegel({ imRegelplan: true, validFrom: FOLGETAG_ISO });
    await gotoDesktopRaster(page, ZIEL_ISO);

    const desktop = page.getByTestId("dienstplan-desktop");
    await expect(desktop.getByTestId("month-grid")).toBeVisible();
    await expect(desktop.getByTestId(`day-slot-${ZIEL_ISO}-${dienstId}`)).toHaveCount(0);
    await expect(desktop.getByTestId(`day-slot-${FOLGETAG_ISO}-${dienstId}`)).toBeVisible();

    await setzeRegel({ validFrom: null });
  });
});
