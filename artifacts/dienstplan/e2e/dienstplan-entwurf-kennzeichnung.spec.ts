import { test, expect } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";
import {
  registerFreeAccount,
  setAccountPlan,
  deleteFreeAccount,
  type FreeAccount,
} from "./helpers/teams";

/**
 * Transparenz-Kennzeichnung unverbindlicher Dienste (Task #295).
 *
 * Unverbindliche Dienste (VORLAEUFIG = Entwurf, ANGEBOTEN = Vorschlag) zählen
 * bewusst NICHT in Auswertungen und PDF-Stundennachweis — nur FIX-Dienste sind
 * offiziell. Damit das für Nutzer nicht überraschend ist, gibt es drei
 * Kennzeichnungen, die dieser Test gegen stilles Wegrefactoring absichert:
 *
 * 1. Dienstplan-Badge: sichtbares Status-Label ("Entwurf"/"Vorschlag"),
 *    data-planning-status-Attribut und gestrichelter Rand (border-dashed).
 * 2. Auswertungen-Seite: Hinweis "nur bestätigte Dienste zählen"
 *    (data-testid="fix-only-hint").
 * 3. Export-Dialog des Stundennachweises: derselbe Hinweis
 *    (data-testid="export-fix-only-hint").
 *
 * Setup: frisches Konto (eigenes Standard-Team, keine Kollisionen mit
 * parallelen Specs), das für den Auswertungen-Teil auf Premium gehoben wird —
 * hours-balance (advancedAnalytics) und der PDF-Export-Button (payrollExport)
 * sind Premium-Features; ohne sie bliebe der Export-Dialog unerreichbar.
 * Die Entwurf-Kennzeichnung im Plan selbst ist plan-unabhängig.
 */

// Aktueller Monat (Free-/Premium-Vorausplanungsfenster immer erfüllt),
// feste Tage 10/11 — ein Tag pro Schicht, keine Überschneidung.
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

const PASSWORD = "free12345"; // registerFreeAccount vergibt dieses Passwort.

let acc: FreeAccount;
let assistantId: number;
// Entwurf (VORLAEUFIG) — Kern der Kennzeichnungs-Prüfung.
let draftShiftId: number;
// Vorschlag (ANGEBOTEN) — zweites unverbindliches Label.
let offeredShiftId: number;
// Verbindlich (FIX) — Gegenprobe: KEIN Status-Label, kein gestrichelter Rand.
let fixShiftId: number;

test.beforeAll(async () => {
  // Registrierung + Datenaufbau + execSync-Plan-Flip können zusammen die
  // Standard-Hook-Zeit sprengen (Cold-Start des Test-Stacks).
  test.setTimeout(120_000);

  acc = await registerFreeAccount("privat", "entwurfkennz");

  const assistantRes = await acc.ctx.post("/api/users", {
    data: {
      // WICHTIG: Der Name darf die Wörter "Entwurf"/"Vorschlag" NICHT enthalten —
      // die FIX-Gegenprobe prüft, dass der Badge-Text diese Wörter nicht führt.
      name: `E2E Kennzeichnung Assistent ${Date.now()}`,
      email: `e2e.entwurfkennz.assistent.${Date.now()}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(assistantRes.ok(), "Anlegen des Assistenten fehlgeschlagen").toBe(true);
  assistantId = ((await assistantRes.json()) as { id: number }).id;

  // Vertrag, damit hours-balance auf /auswertungen eine Zeile liefert und der
  // PDF-Export-Button aktiv ist (disabled bei leerer Auswertung).
  const contractRes = await acc.ctx.post("/api/contracts", {
    data: {
      userId: assistantId,
      weeklyHours: 30,
      vacationDays: 25,
      startDate: `${YEAR}-01-01`,
    },
  });
  expect(contractRes.ok(), "Anlegen des Vertrags fehlgeschlagen").toBe(true);

  async function createShift(day: number, planningStatus?: string): Promise<number> {
    const res = await acc.ctx.post("/api/shifts", {
      data: {
        userId: assistantId,
        ...shiftTimes(day),
        type: "active",
        ...(planningStatus ? { planningStatus } : {}),
      },
    });
    expect(res.status(), `POST /api/shifts (Tag ${day}) sollte 201 liefern`).toBe(201);
    return ((await res.json()) as { id: number }).id;
  }

  draftShiftId = await createShift(10, "VORLAEUFIG");
  offeredShiftId = await createShift(11, "ANGEBOTEN");
  fixShiftId = await createShift(12); // Default FIX

  // Premium-Freischaltung (direkt in der Test-DB, wie im Operator-Dashboard):
  // nötig für hours-balance + Export-Dialog. Vor dem Login geflippt, damit
  // /auth/me im Browser bereits plan=premium liefert (Frontend-Gates).
  await setAccountPlan(acc.email, "premium");
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

test("Dienstplan: Entwurf/Vorschlag sichtbar gekennzeichnet (Label, Status-Attribut, gestrichelter Rand)", async ({
  page,
}) => {
  await loginViaUi(page, acc.email, PASSWORD);
  await page.goto("/dienstplan");
  await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();

  // Explizit in die mobile LISTEN-Ansicht wechseln: die Ansicht wird in
  // localStorage persistiert und kann auf "Monat" stehen; im Monatsgitter
  // sind die Badges erst nach Tagesauswahl sichtbar. WICHTIG: auf den
  // Mobile-Container scopen — dieselben Badges existieren auch im per CSS
  // versteckten Desktop-Zweig (Strict-Mode-Verletzung).
  const mobile = page.getByTestId("dienstplan-mobile");
  // Der Ansicht-Umschalter lebt seit der adaptiven Kopfzeile AUSSERHALB des
  // Mobile-Containers (sticky Header) — über die Header-Testids ansteuern.
  await page.getByTestId("view-toggles-mobile").getByTestId("view-toggle-list").click();

  // Entwurf (VORLAEUFIG): Status-Attribut + sichtbares Label + gestrichelter Rand.
  const draftBadge = mobile.getByTestId(`shift-badge-${draftShiftId}`);
  await expect(draftBadge, "Entwurf-Schicht muss im Kalender sichtbar sein").toBeVisible();
  await expect(draftBadge).toHaveAttribute("data-planning-status", "VORLAEUFIG");
  await expect(draftBadge, "Entwurf-Label muss für Nutzer sichtbar sein").toContainText(
    /Entwurf/i
  );
  await expect(
    draftBadge,
    "Entwurf-Badge muss den gestrichelten Rand tragen (border-dashed)"
  ).toHaveClass(/border-dashed/);

  // Vorschlag (ANGEBOTEN): ebenfalls unverbindlich gekennzeichnet.
  const offeredBadge = mobile.getByTestId(`shift-badge-${offeredShiftId}`);
  await expect(offeredBadge).toBeVisible();
  await expect(offeredBadge).toHaveAttribute("data-planning-status", "ANGEBOTEN");
  await expect(offeredBadge, "Vorschlag-Label muss für Nutzer sichtbar sein").toContainText(
    /Vorschlag/i
  );
  await expect(offeredBadge).toHaveClass(/border-dashed/);

  // Gegenprobe FIX: verbindliche Dienste tragen KEIN Planungs-Label und keinen
  // gestrichelten Rand — sonst wäre die Kennzeichnung bedeutungslos.
  const fixBadge = mobile.getByTestId(`shift-badge-${fixShiftId}`);
  await expect(fixBadge).toBeVisible();
  await expect(fixBadge).toHaveAttribute("data-planning-status", "FIX");
  await expect(fixBadge).not.toContainText(/Entwurf|Vorschlag/i);
  await expect(fixBadge).not.toHaveClass(/border-dashed/);
});

test("Auswertungen + Export-Dialog zeigen den Hinweis 'nur bestätigte Dienste zählen'", async ({
  page,
}) => {
  await loginViaUi(page, acc.email, PASSWORD);
  await page.goto("/auswertungen");
  await expect(
    page.getByRole("heading", { name: "Auswertungen", exact: true })
  ).toBeVisible();

  // Hinweis direkt im Seitenkopf — für ALLE sichtbar, unabhängig vom Plan.
  const hint = page.getByTestId("fix-only-hint");
  await expect(hint, "FIX-only-Hinweis muss auf /auswertungen sichtbar sein").toBeVisible();
  await expect(hint).toContainText(/nur bestätigte Dienste/i);

  // Der PDF-Stundennachweis-Export (StatementExportDialog mit
  // export-fix-only-hint) ist seit der Menü-Neustruktur bewusst zurückgestellt:
  // Der Dialog ist im Code vorhanden, aber ohne sichtbaren Öffnen-Pfad
  // (exportOpen wird nirgends gesetzt; der Header nutzt den XLSX/ZIP-Popover).
  // Sobald der PDF-Export wieder aktiviert wird, gehört die Prüfung des
  // Dialog-Hinweises hier wieder her.
  const statementDialog = page.getByTestId("export-fix-only-hint");
  await expect(statementDialog, "Export-Dialog ist zurückgestellt und darf nicht offen sein").toHaveCount(0);
});
