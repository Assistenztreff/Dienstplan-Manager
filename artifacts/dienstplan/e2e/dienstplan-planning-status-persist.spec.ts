import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";
import { loginViaUi } from "./helpers/auth";

/**
 * Absicherung, dass der Planungsstatus (VORLAEUFIG = Entwurf, ANGEBOTEN =
 * Vorschlag, FIX = verbindlich) beim Speichern WIRKLICH erhalten bleibt
 * (Task: Planungsstatus-Persistenz).
 *
 * Hintergrund: Neue Felder gehören zu einer bekannten Fehlerklasse — sie
 * werden still verschluckt, wenn (a) der API-Server nach Codegen/`db push`
 * nicht neu gestartet wurde (stale Zod strippt unbekannte Felder), (b) der
 * Eintrag im SHIFT_SELECT der Route fehlt (Feld wird gespeichert, aber nie
 * zurückgegeben) oder (c) ein Route-/Schema-Umbau das Feld aus dem
 * Insert/Update-Payload verliert. Dieser Test prüft deshalb IMMER den
 * Round-Trip über die Datenbank (frischer GET nach jedem Schreiben) statt
 * nur die unmittelbare Response.
 *
 * Geprüft wird:
 * - POST /api/shifts mit planningStatus VORLAEUFIG -> bleibt VORLAEUFIG
 *   (Response UND frischer GET).
 * - PATCH auf ANGEBOTEN bzw. FIX wird persistiert; ein PATCH OHNE
 *   planningStatus (nur Notiz) darf den Status NICHT verändern.
 * - POST OHNE planningStatus -> Default FIX.
 * - Kalender-UI: das Schicht-Badge trägt data-planning-status mit dem
 *   jeweils gespeicherten Status (Entwurf-/Vorschlag-Kennzeichnung sichtbar).
 *
 * Der Test registriert ein FRISCHES Konto (eigenes Standard-Team, keine
 * Kollisionen mit parallelen Spec-Daten) und legt die Schichten im aktuellen
 * Monat an (Free-Vorausplanungsfenster immer erfüllt).
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

// Aktueller Monat, feste Tage 10-13 (ein Tag pro Schicht, keine Überschneidung).
const now = new Date();
const YEAR = now.getUTCFullYear();
const MONTH = String(now.getUTCMonth() + 1).padStart(2, "0");
function shiftTimes(day: number): { startTime: string; endTime: string } {
  const d = String(day).padStart(2, "0");
  return {
    startTime: `${YEAR}-${MONTH}-${d}T08:00:00.000Z`,
    endTime: `${YEAR}-${MONTH}-${d}T16:00:00.000Z`,
  };
}

type Shift = { id: number; planningStatus?: string | null; notes?: string | null };

const unique = Date.now();
const ADMIN_EMAIL = `e2e.planstatus.${unique}@dienstplan.test`;
const ADMIN_PASSWORD = "planstatus12345";

let ctx: APIRequestContext;
let assistantId: number;
// Schicht 1: als Entwurf angelegt, bleibt VORLAEUFIG (auch fürs UI-Badge).
let draftShiftId: number;
// Schicht 2: Entwurf -> ANGEBOTEN -> (Notiz-PATCH) -> FIX.
let patchShiftId: number;
// Schicht 3: ohne Status angelegt -> Default FIX (auch fürs UI-Badge).
let defaultShiftId: number;
// Schicht 4: auf ANGEBOTEN gesetzt, bleibt so (fürs UI-Badge).
let offeredShiftId: number;

async function fetchShift(id: number): Promise<Shift> {
  const res = await ctx.get(`/api/shifts/${id}`);
  expect(res.ok(), `GET /api/shifts/${id} fehlgeschlagen (${res.status()})`).toBe(true);
  return (await res.json()) as Shift;
}

async function createShift(
  day: number,
  planningStatus?: string
): Promise<Shift> {
  const res = await ctx.post("/api/shifts", {
    data: {
      userId: assistantId,
      ...shiftTimes(day),
      type: "active",
      ...(planningStatus ? { planningStatus } : {}),
    },
  });
  expect(res.status(), `POST /api/shifts (Tag ${day}) sollte 201 liefern`).toBe(201);
  return (await res.json()) as Shift;
}

test.beforeAll(async () => {
  ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });

  // Frisches Konto: eigenes Standard-Team, keine Datenkollisionen mit
  // anderen Specs; Session ist nach Registrierung direkt im Context gesetzt.
  const registerRes = await ctx.post("/api/auth/register", {
    data: {
      name: `E2E Planstatus Admin ${unique}`,
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      accountType: "privat",
    },
  });
  expect(registerRes.status(), "Registrierung sollte 201 liefern").toBe(201);

  const assistantRes = await ctx.post("/api/users", {
    data: {
      name: `E2E Planstatus Assistent ${unique}`,
      email: `e2e.planstatus.assistent.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(assistantRes.ok(), "Anlegen des Assistenten fehlgeschlagen").toBe(true);
  assistantId = ((await assistantRes.json()) as { id: number }).id;
});

test.afterAll(async () => {
  await ctx?.dispose();
});

test("Anlegen als Entwurf: planningStatus VORLAEUFIG bleibt erhalten (Round-Trip)", async () => {
  const created = await createShift(10, "VORLAEUFIG");
  draftShiftId = created.id;

  // Unmittelbare Response: Feld darf nicht gestrippt sein (SHIFT_SELECT).
  expect(created.planningStatus, "POST-Response muss VORLAEUFIG enthalten").toBe("VORLAEUFIG");

  // Round-Trip über die DB: frischer GET, keine Cache-/Response-Illusion.
  const fresh = await fetchShift(draftShiftId);
  expect(fresh.planningStatus, "Persistierter Status muss VORLAEUFIG sein").toBe("VORLAEUFIG");
});

test("PATCH auf ANGEBOTEN und FIX wird persistiert; PATCH ohne Status ändert ihn nicht", async () => {
  const created = await createShift(11, "VORLAEUFIG");
  patchShiftId = created.id;

  // 1) VORLAEUFIG -> ANGEBOTEN
  const toOffered = await ctx.patch(`/api/shifts/${patchShiftId}`, {
    data: { planningStatus: "ANGEBOTEN" },
  });
  expect(toOffered.ok(), `PATCH auf ANGEBOTEN fehlgeschlagen (${toOffered.status()})`).toBe(true);
  expect(((await toOffered.json()) as Shift).planningStatus).toBe("ANGEBOTEN");
  expect((await fetchShift(patchShiftId)).planningStatus).toBe("ANGEBOTEN");

  // 2) PATCH OHNE planningStatus (nur Notiz) darf den Status NICHT anfassen —
  //    genau hier würde ein versehentlicher Default im Update-Pfad auffallen.
  const notesOnly = await ctx.patch(`/api/shifts/${patchShiftId}`, {
    data: { notes: "Nur Notiz geändert" },
  });
  expect(notesOnly.ok(), `Notiz-PATCH fehlgeschlagen (${notesOnly.status()})`).toBe(true);
  const afterNotes = await fetchShift(patchShiftId);
  expect(afterNotes.notes).toBe("Nur Notiz geändert");
  expect(
    afterNotes.planningStatus,
    "PATCH ohne planningStatus darf den Status nicht zurücksetzen"
  ).toBe("ANGEBOTEN");

  // 3) ANGEBOTEN -> FIX (verbindlich bestätigen)
  const toFix = await ctx.patch(`/api/shifts/${patchShiftId}`, {
    data: { planningStatus: "FIX" },
  });
  expect(toFix.ok(), `PATCH auf FIX fehlgeschlagen (${toFix.status()})`).toBe(true);
  expect(((await toFix.json()) as Shift).planningStatus).toBe("FIX");
  expect((await fetchShift(patchShiftId)).planningStatus).toBe("FIX");
});

test("Anlegen ohne Angabe: Default-Status ist FIX", async () => {
  const created = await createShift(12);
  defaultShiftId = created.id;

  expect(created.planningStatus, "POST ohne Status muss FIX liefern").toBe("FIX");
  expect((await fetchShift(defaultShiftId)).planningStatus).toBe("FIX");
});

test("Kalender zeigt Entwurf-/Vorschlag-Badge (data-planning-status)", async ({ page }) => {
  // Vierte Schicht als Vorschlag, damit alle drei Status im UI prüfbar sind.
  const offered = await createShift(13, "ANGEBOTEN");
  offeredShiftId = offered.id;

  // Als das frische Konto anmelden (programmatisch, dev- und prod-tauglich)
  // und den Dienstplan des aktuellen Monats öffnen (Default-Ansicht).
  await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.goto("/dienstplan");
  await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();

  // Explizit in die mobile LISTEN-Ansicht wechseln: die Ansicht wird in
  // localStorage persistiert und kann auf "Monat" stehen; im Monatsgitter
  // sind die Badges erst nach Tagesauswahl sichtbar.
  const mobile = page.getByTestId("dienstplan-mobile");
  await mobile.getByRole("button", { name: "Liste" }).click();

  // Die Listenansicht rendert ShiftBadge mit data-planning-status je Schicht.
  // WICHTIG: auf den Mobile-Container scopen — dieselben Badges existieren
  // auch im (per CSS versteckten) Desktop-Zweig -> Strict-Mode-Verletzung.
  const draftBadge = mobile.getByTestId(`shift-badge-${draftShiftId}`);
  await expect(draftBadge, "Entwurf-Schicht muss im Kalender sichtbar sein").toBeVisible();
  await expect(draftBadge).toHaveAttribute("data-planning-status", "VORLAEUFIG");
  // Das Entwurf-Label ist für Nutzer sichtbar (Badge-Text im ShiftBadge).
  await expect(draftBadge).toContainText(/Entwurf/i);

  const offeredBadge = mobile.getByTestId(`shift-badge-${offeredShiftId}`);
  await expect(offeredBadge).toBeVisible();
  await expect(offeredBadge).toHaveAttribute("data-planning-status", "ANGEBOTEN");

  const fixBadge = mobile.getByTestId(`shift-badge-${defaultShiftId}`);
  await expect(fixBadge).toBeVisible();
  await expect(fixBadge).toHaveAttribute("data-planning-status", "FIX");
});
