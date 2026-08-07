import { test, expect } from "@playwright/test";
import {
  deleteFreeAccount,
  registerFreeAccount,
  setAccountPlan,
  type FreeAccount,
} from "./helpers/teams";

/**
 * API-Test: Server-Sperre der Premium-Schalter im Free-Tarif.
 *
 * Die drei Schalter "Zeiterfassung aktivieren", "Pausen automatisch
 * vorbefüllen" und "Pausen von bezahlten Stunden abziehen" (konto-globale
 * Felder in PUT /allowance-settings) sind Premium-Features
 * ("timeTrackingSettings"). Der Client sperrt sie sichtbar — dieser Spec
 * beweist die serverseitige Durchsetzung:
 *
 * - Free: Wert-Änderung an einem der drei Felder → 403 plan_feature_required.
 * - Free: Speichern OHNE Änderung dieser Felder (z. B. Bundesland) → 200.
 * - Bestandsschutz: Ein Konto mit bereits AKTIVIERTER Zeiterfassung kann nach
 *   Downgrade auf Free weiter speichern, solange die Schalter-Werte unberührt
 *   bleiben; das Zurücksetzen des Schalters ist dann gesperrt.
 * - Premium: Änderungen laufen unverändert durch.
 */

let acc: FreeAccount;

interface SettingsBody {
  nightPercent: number;
  nightStart: string;
  nightEnd: string;
  sundayPercent: number;
  holidayPercent: number;
  timeTrackingEnabled: boolean;
  pauseAutoEnabled: boolean;
  deductPausesEnabled: boolean;
  [key: string]: unknown;
}

async function getSettings(): Promise<SettingsBody> {
  const res = await acc.ctx.get("/api/allowance-settings");
  expect(res.ok(), `GET allowance-settings (${res.status()})`).toBe(true);
  return (await res.json()) as SettingsBody;
}

/** PUT mit den aktuellen Werten plus den übergebenen Änderungen. */
async function putSettings(changes: Record<string, unknown>) {
  const s = await getSettings();
  return acc.ctx.put("/api/allowance-settings", {
    data: {
      nightPercent: s.nightPercent,
      nightStart: s.nightStart,
      nightEnd: s.nightEnd,
      sundayPercent: s.sundayPercent,
      holidayPercent: s.holidayPercent,
      timeTrackingEnabled: s.timeTrackingEnabled,
      pauseAutoEnabled: s.pauseAutoEnabled,
      deductPausesEnabled: s.deductPausesEnabled,
      ...changes,
    },
  });
}

async function expectPlanLocked(resPromise: Promise<import("@playwright/test").APIResponse>) {
  const res = await resPromise;
  expect(res.status()).toBe(403);
  const body = (await res.json()) as { code?: string; feature?: string };
  expect(body.code).toBe("plan_feature_required");
  expect(body.feature).toBe("timeTrackingSettings");
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  acc = await registerFreeAccount("privat", "premiumschalter");
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

test("Free: Änderung an timeTrackingEnabled/pauseAutoEnabled/deductPausesEnabled wird mit 403 abgelehnt", async () => {
  await expectPlanLocked(putSettings({ timeTrackingEnabled: true }));
  await expectPlanLocked(putSettings({ pauseAutoEnabled: true }));
  await expectPlanLocked(putSettings({ deductPausesEnabled: true }));

  // Keine der abgelehnten Änderungen wurde gespeichert.
  const s = await getSettings();
  expect(s.timeTrackingEnabled).toBe(false);
  expect(s.pauseAutoEnabled).toBe(false);
  expect(s.deductPausesEnabled).toBe(false);
});

test("Free: Speichern ohne Änderung der Schalter (z. B. Bundesland) bleibt erlaubt", async () => {
  const res = await putSettings({ state: "BY" });
  expect(res.status(), `Unveränderte Schalter müssen durchgehen (${res.status()})`).toBe(200);
  const body = (await res.json()) as { state: string | null };
  expect(body.state).toBe("BY");
});

test("Premium: alle drei Schalter sind änderbar", async () => {
  await setAccountPlan(acc.email, "premium");
  try {
    const res = await putSettings({
      timeTrackingEnabled: true,
      pauseAutoEnabled: true,
      deductPausesEnabled: true,
    });
    expect(res.status(), `Premium muss speichern dürfen (${res.status()})`).toBe(200);
    const body = (await res.json()) as SettingsBody;
    expect(body.timeTrackingEnabled).toBe(true);
    expect(body.pauseAutoEnabled).toBe(true);
    expect(body.deductPausesEnabled).toBe(true);
  } finally {
    await setAccountPlan(acc.email, "free");
  }
});

test("Bestandsschutz: aktive Schalter bleiben nach Downgrade wirksam, Zurücksetzen ist gesperrt", async () => {
  // Konto ist jetzt Free, aber die drei Schalter stehen auf true (von Premium
  // aktiviert). Speichern mit UNVERÄNDERTEN Schalter-Werten muss durchgehen.
  const keepRes = await putSettings({ state: "BW" });
  expect(keepRes.status(), `Bestandsschutz-Speichern (${keepRes.status()})`).toBe(200);

  // Die aktiven Werte wurden nicht angefasst.
  const s = await getSettings();
  expect(s.timeTrackingEnabled).toBe(true);
  expect(s.pauseAutoEnabled).toBe(true);
  expect(s.deductPausesEnabled).toBe(true);

  // Das Zurücksetzen (Änderung) ist im Free-Tarif gesperrt.
  await expectPlanLocked(putSettings({ timeTrackingEnabled: false }));
});
