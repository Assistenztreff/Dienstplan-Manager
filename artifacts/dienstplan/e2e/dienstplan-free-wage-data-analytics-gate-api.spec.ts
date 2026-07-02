import { test, expect } from "@playwright/test";
import {
  deleteFreeAccount,
  registerFreeAccount,
  setAccountPlan,
  type FreeAccount,
} from "./helpers/teams";

/**
 * API-Test für die serverseitigen Premium-Gates rund um Lohndaten und
 * Lohn-Auswertungen (Task #229):
 *
 * - "advancedPersonnelFile": POST/PATCH /api/users mit Lohn-/SV-Feldern
 *   (z.B. iban) ist Free-Konten verboten (403 plan_feature_required);
 *   Basis-Felder bleiben frei. Bestandsschutz: ein bereits gespeicherter Wert
 *   darf unverändert mitgesendet werden (Formulare schicken alle Felder zurück).
 * - "advancedAnalytics": GET /api/dashboard/hours-balance ist Free-Konten
 *   verboten (und sperrt damit transitiv die Datenquelle des PDF-Nachweises,
 *   "payrollExport"); GET /api/dashboard/summary bleibt frei.
 *
 * Hintergrund: Der Setup-Admin wird von `setup-test-db` auf Premium gehoben,
 * sodass die übrigen Specs nur den Premium-Pfad ausüben. Die Free-Gates werden
 * deshalb mit FRISCH registrierten Konten getestet (`registerFreeAccount`);
 * die manuelle Premium-Freischaltung wird mit `setAccountPlan` (direkter
 * DB-Schreibzugriff, wie im Operator-Flow) nachgestellt. `getUserPlan` liest
 * den Plan pro Request frisch aus der DB, Plan-Wechsel greifen also sofort.
 */

type FeatureError = { code?: string; feature?: string };

let accounts: FreeAccount[] = [];

async function freeAccount(label: string): Promise<FreeAccount> {
  const acc = await registerFreeAccount("privat", label);
  accounts.push(acc);
  return acc;
}

test.afterEach(async () => {
  // Registrierte Konten samt Standard-Team + Daten per SQL-Bereinigung
  // entfernen (DELETE /api/users scheitert am Team-FK-Baum) und Kontext freigeben.
  for (const acc of accounts) {
    await deleteFreeAccount(acc);
  }
  accounts = [];
});

test("POST /api/users: Lohn-/SV-Feld (iban) wird im Free-Tarif mit 403 blockiert, Basis-Felder bleiben frei", async () => {
  const acc = await freeAccount("wage-post");

  // Verboten: Anlegen mit erweitertem Personalakte-Feld (iban).
  const withIban = await acc.ctx.post("/api/users", {
    data: {
      name: "E2E Lohn Assistent",
      email: `e2e.wage.post.${acc.id}@dienstplan.test`,
      role: "assistant",
      iban: "DE02120300000000202051",
    },
  });
  expect(withIban.status(), "POST mit iban sollte 403 liefern").toBe(403);
  const body = (await withIban.json()) as FeatureError;
  expect(body.code).toBe("plan_feature_required");
  expect(body.feature).toBe("advancedPersonnelFile");

  // Erlaubt: dasselbe Anlegen ohne Lohn-/SV-Felder (einfache Personalakte).
  const basic = await acc.ctx.post("/api/users", {
    data: {
      name: "E2E Lohn Assistent",
      email: `e2e.wage.post.${acc.id}@dienstplan.test`,
      role: "assistant",
      phone: "0123 4567890",
    },
  });
  expect(basic.status(), "POST ohne Lohn-Felder sollte 201 liefern").toBe(201);
});

test("PATCH /api/users/:id: Ändern eines Lohn-Felds im Free-Tarif 403; unveränderter Bestandswert bleibt speicherbar (Bestandsschutz)", async () => {
  const acc = await freeAccount("wage-patch");

  // Assistent ohne Lohn-Daten anlegen (Free-erlaubt).
  const createRes = await acc.ctx.post("/api/users", {
    data: {
      name: "E2E Patch Assistent",
      email: `e2e.wage.patch.${acc.id}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(createRes.status(), "Assistent anlegen fehlgeschlagen").toBe(201);
  const assistantId = ((await createRes.json()) as { id: number }).id;

  // Bestandsdaten herstellen: Konto kurz auf Premium heben (manuelle
  // Freischaltung), iban speichern, dann wieder auf Free senken (Downgrade).
  const storedIban = "DE02120300000000202051";
  setAccountPlan(acc.email, "premium");
  try {
    const seedRes = await acc.ctx.patch(`/api/users/${assistantId}`, {
      data: { iban: storedIban },
    });
    expect(seedRes.status(), "Premium-Konto sollte iban setzen dürfen").toBe(200);
  } finally {
    setAccountPlan(acc.email, "free");
  }

  // Verboten: echtes Ändern des gespeicherten Werts im Free-Tarif.
  const changeRes = await acc.ctx.patch(`/api/users/${assistantId}`, {
    data: { iban: "DE75512108001245126199" },
  });
  expect(changeRes.status(), "Ändern der iban sollte 403 liefern").toBe(403);
  const changeBody = (await changeRes.json()) as FeatureError;
  expect(changeBody.code).toBe("plan_feature_required");
  expect(changeBody.feature).toBe("advancedPersonnelFile");

  // Bestandsschutz: der gespeicherte Wert wurde durch das abgelehnte PATCH
  // nicht verändert und bleibt lesbar.
  const getRes = await acc.ctx.get(`/api/users/${assistantId}`);
  expect(getRes.ok(), "GET des Assistenten fehlgeschlagen").toBe(true);
  expect(((await getRes.json()) as { iban: string | null }).iban).toBe(storedIban);

  // Bestandsschutz: das unveränderte Zurücksenden des gespeicherten Werts
  // (Formulare schicken alle Felder) bleibt im Free-Tarif erlaubt.
  const resendRes = await acc.ctx.patch(`/api/users/${assistantId}`, {
    data: { iban: storedIban, phone: "0987 654321" },
  });
  expect(resendRes.status(), "Unveränderter Bestandswert sollte 200 liefern").toBe(200);
  const resent = (await resendRes.json()) as { iban: string | null; phone: string | null };
  expect(resent.iban).toBe(storedIban);
  expect(resent.phone).toBe("0987 654321");
});

test("GET /api/dashboard/hours-balance: im Free-Tarif 403 (advancedAnalytics), summary bleibt frei", async () => {
  const acc = await freeAccount("wage-analytics");

  const balance = await acc.ctx.get("/api/dashboard/hours-balance");
  expect(balance.status(), "hours-balance sollte im Free-Tarif 403 liefern").toBe(403);
  const body = (await balance.json()) as FeatureError;
  expect(body.code).toBe("plan_feature_required");
  expect(body.feature).toBe("advancedAnalytics");

  const summary = await acc.ctx.get("/api/dashboard/summary");
  expect(summary.status(), "summary sollte im Free-Tarif 200 liefern").toBe(200);
});

test("Premium-Pfad: dieselben Endpunkte bleiben nach manueller Freischaltung offen", async () => {
  const acc = await freeAccount("wage-premium");
  setAccountPlan(acc.email, "premium");

  // POST mit Lohn-Feld erlaubt.
  const createRes = await acc.ctx.post("/api/users", {
    data: {
      name: "E2E Premium Assistent",
      email: `e2e.wage.premium.${acc.id}@dienstplan.test`,
      role: "assistant",
      iban: "DE02120300000000202051",
    },
  });
  expect(createRes.status(), "Premium-POST mit iban sollte 201 liefern").toBe(201);
  const created = (await createRes.json()) as { id: number; iban: string | null };
  expect(created.iban).toBe("DE02120300000000202051");

  // PATCH auf neuen Lohn-Wert erlaubt.
  const patchRes = await acc.ctx.patch(`/api/users/${created.id}`, {
    data: { iban: "DE75512108001245126199" },
  });
  expect(patchRes.status(), "Premium-PATCH der iban sollte 200 liefern").toBe(200);
  expect(((await patchRes.json()) as { iban: string | null }).iban).toBe(
    "DE75512108001245126199",
  );

  // Lohn-Auswertung erlaubt.
  const balance = await acc.ctx.get("/api/dashboard/hours-balance");
  expect(balance.status(), "Premium hours-balance sollte 200 liefern").toBe(200);

  const summary = await acc.ctx.get("/api/dashboard/summary");
  expect(summary.status(), "Premium summary sollte 200 liefern").toBe(200);
});
