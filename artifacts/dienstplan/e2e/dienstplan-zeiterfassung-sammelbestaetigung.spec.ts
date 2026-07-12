import { test, expect, type Page } from "@playwright/test";
import {
  deleteFreeAccount,
  registerFreeAccount,
  setAccountPlan,
  type FreeAccount,
} from "./helpers/teams";

/**
 * E2E: Sammelbestätigung offener Zeiteinträge (Task #264).
 *
 * Nach einem Premium-Upgrade kann der Admin alle gefilterten offenen
 * Ist-Zeiten in EINEM Schritt bestätigen (POST /api/time-tracking/confirm-batch),
 * statt jeden Alt-Eintrag einzeln anzufassen. Abgesichert wird:
 *
 * API:
 *  1. Free-Konto: 403 `plan_feature_required` (feature strictTimeTracking) —
 *     dieselbe Sperre wie die Einzelbestätigung.
 *  2. Premium: nur OFFENE Einträge im eigenen Team-Scope werden bestätigt;
 *     abgelehnte/unbekannte IDs werden still übersprungen (confirmedCount).
 *  3. Wiederholung ist idempotent (confirmedCount 0, keine Doppel-Updates).
 *
 * UI:
 *  4. Free: der Button "Alle offenen bestätigen" ist sichtbar, aber gesperrt
 *     (title = Premium-Hinweis) — kein stiller Fehlschlag.
 *  5. Premium: Button öffnet den Bestätigungsdialog mit Vorschau
 *     (Anzahl + Stundensumme); nach dem Bestätigen sind alle Einträge
 *     "Bestätigt" und der Button verschwindet (keine offenen mehr).
 *  6. Einzelbestätigung/-ablehnung bleibt unverändert vorhanden.
 *
 * Läuft gegen den isolierten Test-Stack (eigener API + Vite auf der `_test`-DB).
 */

/** Der 15. des aktuellen Monats (robust gegen Monatslängen/Zeitzonen). */
function currentMonthDay(day = 15): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}-${String(day).padStart(2, "0")}`;
}

/**
 * Session-Cookies des per API registrierten Kontos in den Browser-Kontext
 * übernehmen, damit die App als dieses Konto bootstrappt und NICHT das
 * Dev-Auto-Login (Premium-Standard-Admin) auslöst.
 */
async function adoptSession(page: Page, account: FreeAccount): Promise<void> {
  const state = await account.ctx.storageState();
  await page.context().addCookies(state.cookies);
}

type EntryOut = { id: number; status: string };

async function createAssistant(acc: FreeAccount, label: string): Promise<number> {
  const res = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E Batch ${label}`,
      email: `e2e.batch.${label}.${Date.now()}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(res.status(), "Assistent anlegen sollte 201 liefern").toBe(201);
  return ((await res.json()) as { id: number }).id;
}

async function createPendingEntry(
  acc: FreeAccount,
  userId: number,
  day: string,
  startHour: number,
  hours: number,
): Promise<number> {
  const end = startHour + hours;
  const res = await acc.ctx.post("/api/time-tracking", {
    data: {
      userId,
      actualStart: `${day}T${String(startHour).padStart(2, "0")}:00:00.000Z`,
      actualEnd: `${day}T${String(end).padStart(2, "0")}:00:00.000Z`,
    },
  });
  expect(res.status(), "Ist-Zeit anlegen sollte 201 liefern").toBe(201);
  return ((await res.json()) as { id: number }).id;
}

// ---------------------------------------------------------------------------
// Teil 1: API — Free-Gate, Scope/Status-Filter, Idempotenz
// ---------------------------------------------------------------------------

test.describe("Sammelbestätigung: API (confirm-batch)", () => {
  let acc: FreeAccount;
  let assistantId = 0;
  const pendingIds: number[] = [];
  let rejectedId = 0;

  test.beforeAll(async () => {
    acc = await registerFreeAccount("privat", "batch-api");
    assistantId = await createAssistant(acc, "api");
    const day = currentMonthDay(10);
    pendingIds.push(await createPendingEntry(acc, assistantId, day, 8, 4));
    pendingIds.push(await createPendingEntry(acc, assistantId, currentMonthDay(11), 8, 6));
    pendingIds.push(await createPendingEntry(acc, assistantId, currentMonthDay(12), 8, 2));
    rejectedId = await createPendingEntry(acc, assistantId, currentMonthDay(13), 8, 4);
  });

  test.afterAll(async () => {
    // Konto + Standard-Team inkl. Ist-Zeiten/Assistent werden per
    // SQL-Bereinigung entfernt (DELETE /api/users scheitert am Team-FK-Baum).
    await deleteFreeAccount(acc);
  });

  test("Free-Konto: Sammelbestätigung liefert 403 plan_feature_required", async () => {
    const res = await acc.ctx.post("/api/time-tracking/confirm-batch", {
      data: { ids: pendingIds, confirmedBy: acc.id },
    });
    expect(res.status(), "Sammelbestätigung muss im Free-Tarif gesperrt sein").toBe(403);
    const body = (await res.json()) as { code?: string; feature?: string };
    expect(body.code).toBe("plan_feature_required");
    expect(body.feature).toBe("strictTimeTracking");
  });

  test("Premium: bestätigt nur offene Einträge; abgelehnte/unbekannte IDs werden übersprungen", async () => {
    await setAccountPlan(acc.email, "premium");

    // Einen Eintrag vorab ablehnen — die Sammelbestätigung darf ihn NICHT
    // auf "confirmed" umdrehen (nur pending wird angefasst).
    const rejectRes = await acc.ctx.patch(`/api/time-tracking/${rejectedId}/confirm`, {
      data: { status: "rejected", confirmedBy: acc.id },
    });
    expect(rejectRes.status(), "Ablehnen sollte als Premium funktionieren").toBe(200);

    const res = await acc.ctx.post("/api/time-tracking/confirm-batch", {
      data: { ids: [...pendingIds, rejectedId, 99999999], confirmedBy: acc.id },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { confirmedCount: number };
    expect(body.confirmedCount, "Nur die offenen eigenen Einträge zählen").toBe(
      pendingIds.length,
    );

    // Nachprüfen: alle vormals offenen sind bestätigt, der abgelehnte blieb abgelehnt.
    const listRes = await acc.ctx.get("/api/time-tracking");
    expect(listRes.status()).toBe(200);
    const entries = (await listRes.json()) as EntryOut[];
    const byId = new Map(entries.map((e) => [e.id, e.status]));
    for (const id of pendingIds) {
      expect(byId.get(id), `Eintrag ${id} muss bestätigt sein`).toBe("confirmed");
    }
    expect(byId.get(rejectedId), "Abgelehnter Eintrag bleibt abgelehnt").toBe("rejected");
  });

  test("Wiederholung ist idempotent (confirmedCount 0)", async () => {
    const res = await acc.ctx.post("/api/time-tracking/confirm-batch", {
      data: { ids: pendingIds, confirmedBy: acc.id },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { confirmedCount: number };
    expect(body.confirmedCount).toBe(0);
  });

  test("Leere ID-Liste wird abgewiesen (400)", async () => {
    const res = await acc.ctx.post("/api/time-tracking/confirm-batch", {
      data: { ids: [], confirmedBy: acc.id },
    });
    expect(res.status()).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Teil 2: UI — gesperrter Button (Free), Dialog-Vorschau + Sammel-Flow (Premium)
// ---------------------------------------------------------------------------

test.describe("Sammelbestätigung: UI (Zeiterfassung)", () => {
  let acc: FreeAccount;
  let assistantId = 0;
  const entryIds: number[] = [];

  test.beforeAll(async () => {
    acc = await registerFreeAccount("privat", "batch-ui");
    assistantId = await createAssistant(acc, "ui");
    // Zwei offene Einträge à 8h und 4h → Vorschau: 2 Einträge, 12 h.
    entryIds.push(await createPendingEntry(acc, assistantId, currentMonthDay(16), 8, 8));
    entryIds.push(await createPendingEntry(acc, assistantId, currentMonthDay(17), 8, 4));
  });

  test.afterAll(async () => {
    // Konto + Standard-Team inkl. Ist-Zeiten/Assistent werden per
    // SQL-Bereinigung entfernt (DELETE /api/users scheitert am Team-FK-Baum).
    await deleteFreeAccount(acc);
  });

  test("Free: Button sichtbar, aber gesperrt mit Premium-Hinweis", async ({ page }) => {
    test.setTimeout(60000);
    await adoptSession(page, acc);

    await page.goto("/zeiterfassung");
    const batchButton = page.getByTestId("batch-confirm-open");
    await expect(batchButton).toBeVisible();
    await expect(batchButton, "Sammelbestätigung muss im Free-Tarif gesperrt sein").toBeDisabled();
    await expect(batchButton).toHaveAttribute(
      "title",
      /Premium-Feature/,
    );
  });

  test("Premium: Dialog zeigt Anzahl + Stunden, Bestätigen setzt alle auf Bestätigt", async ({
    page,
  }) => {
    test.setTimeout(90000);
    await setAccountPlan(acc.email, "premium");
    await adoptSession(page, acc);

    // Über den Pending-Filter (Ziel des Dashboard-Hinweis-Links) einsteigen.
    await page.goto("/zeiterfassung?status=pending");

    const batchButton = page.getByTestId("batch-confirm-open");
    await expect(batchButton).toBeVisible();
    await expect(batchButton).toBeEnabled();

    // Einzelbestätigung bleibt parallel vorhanden (2 offene Einträge → je
    // Bestätigen+Ablehnen-Button mit regulärem title).
    await expect(page.locator('button[title="Bestätigen"]')).toHaveCount(2);
    await expect(page.locator('button[title="Ablehnen"]')).toHaveCount(2);

    await batchButton.click();
    const dialog = page.getByTestId("batch-confirm-dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("batch-confirm-count")).toHaveText("2");
    await expect(page.getByTestId("batch-confirm-hours")).toHaveText("12 h");

    await page.getByTestId("batch-confirm-save").click();
    await expect(dialog).not.toBeVisible();

    // Beide Einträge sind bestätigt: im Pending-Filter bleibt nichts übrig …
    await expect(page.getByText("Keine Zeiteinträge mit diesem Status.")).toBeVisible();
    // … und der Button verschwindet (keine offenen Einträge mehr im Filter).
    await expect(batchButton).not.toBeVisible();

    // Gegenprobe über die API: beide Einträge sind wirklich "confirmed".
    const listRes = await acc.ctx.get("/api/time-tracking");
    expect(listRes.status()).toBe(200);
    const entries = (await listRes.json()) as EntryOut[];
    const byId = new Map(entries.map((e) => [e.id, e.status]));
    for (const id of entryIds) {
      expect(byId.get(id), `Eintrag ${id} muss bestätigt sein`).toBe("confirmed");
    }
  });
});
