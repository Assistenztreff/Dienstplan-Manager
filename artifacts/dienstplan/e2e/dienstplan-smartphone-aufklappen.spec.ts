import { test, expect, type Page } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";
import {
  registerFreeAccount,
  deleteFreeAccount,
  FREE_ACCOUNT_PASSWORD,
  type FreeAccount,
} from "./helpers/teams";

/**
 * E2E-Test für das Smartphone-Monatsraster (Arbeitsanweisung 16.08.2026,
 * Punkt 3, Task #836).
 *
 * Der frühere Auf-/Zuklapp-Umschalter ist ersatzlos entfallen: das Smartphone
 * zeigt jetzt DAUERHAFT die einzeilige Kurz-Pille (vormals „aufgeklappt").
 * Neu gegenüber der alten Kurz-Pille: das Status-Icon ist jetzt IMMER
 * sichtbar (auch „Bestätigt", nicht mehr nur bei Abweichung), und
 * Abwesenheiten erscheinen als kurzer Kategorie-Text statt als Farbstreifen.
 *
 * Geprüft (mobil 400px):
 * 1. Kein Umschalter mehr vorhanden — die Pillen-Ansicht ist der einzige
 *    Smartphone-Zustand.
 * 2. Einzeilige Kurz-Pillen mit INITIALEN; Status-Icon immer sichtbar
 *    (Bestätigt/Entwurf), Vertretung/Krankheit als zusätzliche Icons im
 *    Kombinationsfall. Klick auf eine Pille öffnet den Schichtdialog dieser
 *    Assistenzkraft.
 * 3. Abwesenheiten als kurzer Gesamtzahl-Text ("<N> Abw.") in Schwarz statt
 *    als Streifen oder Kategorie-Aufzählung (Arbeitsanweisung 17.08.2026,
 *    Punkt 7).
 * 4. Zellen-Kopfzeile (3.4): Datum links, Plus rechts; der Zellenklick wählt
 *    nur und scrollt zur Tagesleiste, nur das Plus öffnet den Anlege-Dialog.
 *
 * Aufbau: frisches Free-Konto mit einer Assistenzkraft, drei Diensten an Tag A
 * (2× FIX + 1× VORLAEUFIG/Vertretung), einem Urlaub an Tag B und einem
 * Krank+Dienst-Kombinationsfall an Tag C (feste Monatsmitte-Tage).
 * Cleanup über deleteFreeAccount (SQL).
 */

test.use({ viewport: { width: 400, height: 700 } });

const now = new Date();
const pad2 = (n: number) => String(n).padStart(2, "0");
// Feste Tage in der Monatsmitte: immer im aktuellen Monat, keine Monatsrolle.
const DAY_A = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-12`;
const DAY_B = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-13`;
// Tag C (Task #726): Dienst + Krank-Abwesenheit derselben Assistenzkraft am
// selben Tag → die Dienst-Pille muss das rote Krankheits-Icon zeigen.
const DAY_C = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-14`;

let acc: FreeAccount;
let shiftIdFix: number;
let shiftIdDraft: number;
let shiftIdAusfall: number;

async function login(page: Page): Promise<void> {
  await loginViaUi(page, acc.email, FREE_ACCOUNT_PASSWORD);
}

test.beforeAll(async () => {
  acc = await registerFreeAccount("privat", "aufklappen");

  const user = await acc.ctx.post("/api/users", {
    data: {
      name: "E2E Aufklapp Assistentin",
      email: `e2e.aufklappen.assist.${Date.now()}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(user.status(), `Assistenzkraft anlegen (${user.status()})`).toBe(201);
  const assistantId = ((await user.json()) as { id: number }).id;

  // Drei Dienste an Tag A: bestätigt + Entwurf (zugleich Vertretung — der
  // Kombinationsfall muss BEIDE Icons zeigen) + bestätigt. Die Smartphone-
  // Ansicht darf nur zwei Pillen und anschließend „+1 weitere“ zeigen.
  for (const [start, end, planningStatus] of [
    ["06:00", "12:00", "FIX"],
    ["13:00", "18:00", "VORLAEUFIG"],
    ["19:00", "23:00", "FIX"],
  ] as const) {
    const res = await acc.ctx.post("/api/shifts", {
      data: {
        userId: assistantId,
        type: "active",
        startTime: `${DAY_A}T${start}:00.000Z`,
        endTime: `${DAY_A}T${end}:00.000Z`,
        planningStatus,
        isVertretung: planningStatus === "VORLAEUFIG",
      },
    });
    expect(res.status(), `Dienst ${start} anlegen (${res.status()})`).toBe(201);
    if (planningStatus === "FIX") {
      // Nur die ERSTE FIX-Schicht merken: die dritte (19–23 Uhr) fällt durch
      // das Zwei-Pillen-Limit aus der Smartphone-Zelle heraus.
      shiftIdFix ||= ((await res.json()) as { id: number }).id;
    } else {
      shiftIdDraft = ((await res.json()) as { id: number }).id;
    }
  }

  // Urlaub an Tag B (Kategorie geplant → gelber Text).
  const vac = await acc.ctx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "vacation",
      startTime: `${DAY_B}T00:00:00.000Z`,
      endTime: `${DAY_B}T23:59:00.000Z`,
      planningStatus: "FIX",
    },
  });
  expect(vac.status(), `Urlaub anlegen (${vac.status()})`).toBe(201);

  // Tag C (Task #726): Krank-Abwesenheit ZUERST, danach wird ein Dienst auf
  // denselben Tag geplant. (Umgekehrt ginge es nicht: Eine neue Abwesenheit
  // "überschreibt" serverseitig alle an dem Tag bereits geplanten Dienste —
  // Primary-Lookup-Ersetzung in POST /shifts. Der Warnfall entsteht also genau
  // dann, wenn ein Dienst auf einen Tag mit bestehender Krankmeldung fällt.)
  const sick = await acc.ctx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "sick",
      startTime: `${DAY_C}T00:00:00.000Z`,
      endTime: `${DAY_C}T23:59:00.000Z`,
      planningStatus: "FIX",
    },
  });
  expect(sick.status(), `Krank-Abwesenheit an Tag C anlegen (${sick.status()})`).toBe(201);
  const ausfallShift = await acc.ctx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "active",
      startTime: `${DAY_C}T08:00:00.000Z`,
      endTime: `${DAY_C}T14:00:00.000Z`,
      planningStatus: "FIX",
    },
  });
  expect(ausfallShift.status(), `Dienst an Tag C anlegen (${ausfallShift.status()})`).toBe(201);
  shiftIdAusfall = ((await ausfallShift.json()) as { id: number }).id;
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

test("Smartphone-Dauerzustand: kein Umschalter mehr, Kurz-Pillen mit immer sichtbarem Status-Icon", async ({
  page,
}) => {
  await login(page);
  await page.goto("./dienstplan");
  const mobile = page.getByTestId("dienstplan-mobile");
  // Kaltstart/Netzwerklast: erst auf die befüllte Zelle warten, bevor die
  // Pillen-Details geprüft werden (sonst flackert die Zusicherung während
  // die Monatsdaten noch laden, vgl. Skeleton-Platzhalter).
  await expect(mobile.getByTestId(`day-chip-${shiftIdFix}`)).toBeVisible({ timeout: 15_000 });

  // Arbeitsanweisung 16.08.2026 Punkt 3: der Umschalter ist ersatzlos
  // entfallen — es gibt nur noch den einen Pillen-Zustand.
  await expect(
    page.getByTestId("toggle-mobile-expand"),
    "Der Auf-/Zuklapp-Umschalter darf nicht mehr existieren",
  ).toHaveCount(0);
  await expect(
    mobile.getByTestId(`day-bars-${DAY_A}`),
    "Die alten Mini-Balken (eingeklappter Zustand) sind entfallen",
  ).toHaveCount(0);

  // Kurz-Pillen: kein separates Namensfeld mehr (Arbeitsanweisung 17.08.2026
  // Punkt 4, nach Messung korrigiert — bei ~48px Pillenbreite kollabiert ein
  // zusätzliches Namensfeld neben Avatar + Icons auf 0px); die 19×19px-
  // Avatar-Initialen sind die einzige Personen-Kennung.
  const pill = mobile.getByTestId(`day-chip-${shiftIdFix}`);
  await expect(pill).toBeVisible();
  await expect(pill, "Die Pille zeigt die Initialen der Assistenzkraft im Avatar").toContainText("EA");

  // Neu (16.08.2026): das Status-Icon ist IMMER sichtbar, auch „Bestätigt“.
  await expect(
    pill.locator('[data-status-badge="confirmed"]'),
    "Bestätigte Dienste zeigen jetzt dauerhaft das Bestätigt-Icon",
  ).toBeVisible();
  await expect(
    pill.locator('[data-status-badge="clock"]'),
    "Die Uhrzeitzeile gibt es in der Smartphone-Zelle weiterhin nicht",
  ).toHaveCount(0);

  const draftPill = mobile.getByTestId(`day-chip-${shiftIdDraft}`);
  const draftBadge = draftPill.locator('[data-status-badge="draft"][aria-label="Entwurf"]');
  await expect(draftBadge, "Entwurf-Dienste zeigen das Entwurf-Icon").toBeVisible();
  await expect(draftBadge).toHaveCSS("width", "12px");
  await expect(draftBadge).toHaveCSS("height", "12px");
  await expect(
    draftPill.locator('[data-status-badge="vertretung"]'),
    "Vertretung + Entwurf zeigen BEIDE Icons in der Kurz-Pille",
  ).toBeVisible();
  await expect(
    draftPill.locator('[data-status-badge="confirmed"]'),
    "Ein Entwurf zeigt kein Bestätigt-Icon",
  ).toHaveCount(0);

  // Task #726/#835: Dienst an Tag C, dessen Assistenzkraft am selben Tag krank
  // ist, zeigt zusätzlich das rote Krankheits-Icon (medizinisches Kreuz);
  // Dienste ohne Ausfall (Tag A) nicht.
  const ausfallPill = mobile.getByTestId(`day-chip-${shiftIdAusfall}`);
  const krankBadge = ausfallPill.locator(
    '[data-status-badge="krank"][aria-label="Ausfall: Assistenzkraft abwesend"]',
  );
  await expect(krankBadge, "Krank am Diensttag → Krankheits-Icon an der Dienst-Pille").toBeVisible();
  await expect(krankBadge).toHaveCSS("width", "12px");
  await expect(krankBadge).toHaveCSS("height", "12px");
  await expect(
    ausfallPill.locator('[data-status-badge="confirmed"]'),
    "Der Ausfall-Kombinationsfall bleibt zusätzlich als bestätigt markiert",
  ).toBeVisible();
  await expect(
    pill.locator('[data-status-badge="krank"]'),
    "Ohne Abwesenheit der eingeplanten Assistenzkraft gibt es kein Krankheits-Icon",
  ).toHaveCount(0);

  // Geometrieprüfung (Arbeitsanweisung 17.08.2026 Punkt 4): es gibt kein
  // separates Namensfeld mehr, das abschneiden könnte — die Avatar-Initialen
  // (immer 1–2 Zeichen) sind die einzige Personen-Kennung. Prüfen, dass der
  // Avatar auch im Kombinationsfall (zwei/drei Icons) selbst nicht kollabiert.
  for (const id of [shiftIdFix, shiftIdDraft, shiftIdAusfall]) {
    const avatar = mobile.getByTestId(`day-chip-${id}`).locator("span[aria-hidden='true'].rounded-full");
    const box = await avatar.boundingBox();
    expect(box?.width ?? 0, `Avatar der Pille ${id} muss vollständig sichtbar sein`).toBeGreaterThanOrEqual(18);
  }

  // Zwei-Pillen-Limit: die dritte FIX-Schicht an Tag A fällt hinter „+1“.
  await expect(
    mobile
      .getByTestId(`day-cell-${DAY_A}`)
      .locator('[data-testid^="day-chip-"]:not([data-testid^="day-chip-label-"])'),
    "Höchstens zwei Pillen sind sichtbar",
  ).toHaveCount(2);
  await expect(mobile.getByTestId(`day-more-${DAY_A}`)).toHaveText("+1");

  // Klick auf die Pille öffnet den Schichtdialog genau dieser Assistenzkraft
  // (Edit-Modus: das Nutzerfeld ist ein deaktiviertes Input mit dem Namen).
  await pill.click();
  const dialog = page.getByTestId("shift-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Schicht bearbeiten" })).toBeVisible();
  await expect(dialog.locator('[data-testid="shift-dialog-user"]')).toHaveValue(
    "E2E Aufklapp Assistentin",
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("Abwesenheiten erscheinen als schwarzer Gesamtzahl-Text statt als Streifen", async ({ page }) => {
  await login(page);
  await page.goto("./dienstplan");
  const mobile = page.getByTestId("dienstplan-mobile");
  const absenceText = mobile.getByTestId(`day-absence-text-${DAY_B}`);
  // Kaltstart/Netzwerklast: erst auf den befüllten Text warten (s. o.).
  await expect(absenceText).toBeVisible({ timeout: 15_000 });

  await expect(
    mobile.getByTestId(`day-strip-${DAY_B}`),
    "Die alten Abwesenheitsstreifen sind entfallen",
  ).toHaveCount(0);

  // Arbeitsanweisung 17.08.2026 Punkt 7: eine Gesamtzahl aller Abwesenheits-
  // Einträge des Tages statt der Kategorie-Aufzählung — Tag B hat genau einen
  // Urlaubseintrag.
  await expect(absenceText, "Urlaub an Tag B erscheint als Gesamtzahl-Text").toHaveText("1 Abw.");
  await expect(
    absenceText,
    "Der Text ist schwarz statt kategoriefarben (#151515)",
  ).toHaveCSS("color", "rgb(21, 21, 21)");
});

test("Zellen-Kopfzeile: Zellenklick wählt nur und scrollt, nur das Plus öffnet den Anlege-Dialog", async ({
  page,
}) => {
  await login(page);
  await page.goto("./dienstplan");
  const mobile = page.getByTestId("dienstplan-mobile");

  const cellA = mobile.getByTestId(`day-cell-${DAY_A}`);
  // Kaltstart/Netzwerklast: erst auf den befüllten Tag warten (s. o.).
  await expect(mobile.getByTestId(`day-add-${DAY_A}`)).toBeVisible({ timeout: 15_000 });
  // Klickpunkt in der Datums-Kopfzeile: seit dem Dauerzustand (16.08.2026)
  // beginnen die Kurz-Pillen direkt UNTER der Kopfzeile ohne Zwischenraum —
  // y=8 trifft sicher das Datums-Badge und nicht die erste Pille darunter.
  await cellA.click({ position: { x: 12, y: 8 } });
  await expect(cellA).toHaveAttribute("data-selected", "true");
  await expect(mobile.getByTestId("day-detail-header")).toContainText("12.");
  await expect(
    mobile.getByTestId("day-detail-panel"),
    "Der Tap auf eine Zelle muss zur Tagesleiste scrollen (3.3)",
  ).toBeInViewport();
  await expect(
    page.getByTestId("shift-dialog"),
    "Der Zellenklick darf keinen Dialog öffnen (3.4)",
  ).toHaveCount(0);

  // Nur das Plus öffnet den Anlege-Dialog.
  await mobile.getByTestId(`day-add-${DAY_A}`).click();
  await expect(page.getByTestId("shift-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("shift-dialog")).toHaveCount(0);
});
