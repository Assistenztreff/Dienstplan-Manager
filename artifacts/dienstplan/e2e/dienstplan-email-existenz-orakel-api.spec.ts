import { test, expect, request as playwrightRequest } from "@playwright/test";
import {
  BASE_URL,
  deleteFreeAccount,
  registerFreeAccount,
  type FreeAccount,
} from "./helpers/teams";

/**
 * API-Spec (Task #553): E-Mail-Existenz-Orakel — DOKUMENTIERT AKZEPTIERTES
 * Verhalten festschreiben.
 *
 * Entscheidung: Die plattformweite E-Mail-Eindeutigkeit (UNIQUE in der DB) und
 * die bewusste Produkt-UX ("bereits verwendet" direkt am E-Mail-Feld inkl.
 * Login-Link, Tasks #384/#406) machen ein echtes Verstecken der Konto-Existenz
 * unmoeglich — Erfolg vs. 409 bleibt immer beobachtbar, und es gibt keinen
 * E-Mail-Versand-Flow, der eine generische Antwort traegt. Das 409-Verhalten
 * ist daher AKZEPTIERT und hier festgeschrieben; als Mitigation gegen anonyme
 * Massen-Enumeration drosselt ein IP-Rate-Limit die oeffentliche Registrierung
 * (unit-getestet in register-rate-limit.test.ts; im E2E-Stack via
 * REGISTER_RATE_LIMIT_MAX=0 deaktiviert, weil die Suite dutzende Konten von
 * 127.0.0.1 registriert).
 *
 * Festgeschrieben wird:
 * 1. Registrierung mit belegter E-Mail (auch teamfremd) -> 409 "bereits verwendet".
 * 2. POST /users mit teamfremd belegter E-Mail -> 409 (gleiches Orakel,
 *    aber nur fuer angemeldete Admins — auditierbare Akteure).
 * 3. PATCH /users mit teamfremd belegter E-Mail -> 409.
 * 4. Der Login verraet die Existenz NICHT: unbekannte E-Mail und falsches
 *    Passwort antworten identisch (401 "E-Mail oder Passwort falsch").
 */

let accountA: FreeAccount;
let accountB: FreeAccount;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  accountA = await registerFreeAccount("privat", "orakel-a");
  accountB = await registerFreeAccount("privat", "orakel-b");
});

test.afterAll(async () => {
  await deleteFreeAccount(accountA);
  await deleteFreeAccount(accountB);
});

test("Registrierung mit belegter E-Mail antwortet 409 (akzeptiertes Orakel)", async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  try {
    const res = await ctx.post("/api/auth/register", {
      data: {
        name: "E2E Orakel",
        email: accountB.email,
        password: "irgendwas123",
        accountType: "privat",
      },
    });
    expect(res.status(), "Belegte E-Mail muss 409 melden").toBe(409);
    const body = (await res.json()) as { error?: string };
    expect(body.error ?? "").toMatch(/bereits verwendet/i);
  } finally {
    await ctx.dispose();
  }
});

test("POST /users mit teamfremd belegter E-Mail antwortet 409", async () => {
  const res = await accountA.ctx.post("/api/users", {
    data: {
      name: "E2E Orakel Assistent",
      email: accountB.email,
      role: "assistant",
    },
  });
  expect(res.status(), "Teamfremd belegte E-Mail muss 409 melden").toBe(409);
  const body = (await res.json()) as { error?: string };
  expect(body.error ?? "").toMatch(/bereits.*verwendet/i);
});

test("PATCH /users mit teamfremd belegter E-Mail antwortet 409", async () => {
  // Eigenen Assistenten anlegen (im Standard-Team von Konto A via
  // resolveWriteTeamId-Fallback), dann auf die belegte E-Mail von B patchen.
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const createRes = await accountA.ctx.post("/api/users", {
    data: {
      name: "E2E Orakel Patch-Ziel",
      email: `e2e.orakel-patch.${stamp}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(createRes.ok(), `Assistent anlegen fehlgeschlagen (${createRes.status()})`).toBe(true);
  const assistant = (await createRes.json()) as { id: number };

  const res = await accountA.ctx.patch(`/api/users/${assistant.id}`, {
    data: { email: accountB.email },
  });
  expect(res.status(), "PATCH auf teamfremd belegte E-Mail muss 409 melden").toBe(409);
  const body = (await res.json()) as { error?: string };
  expect(body.error ?? "").toMatch(/bereits.*verwendet/i);
});

test("Login verraet die Konto-Existenz nicht (identische 401-Antworten)", async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  try {
    const unknown = await ctx.post("/api/auth/login", {
      data: { email: "e2e.orakel-gibtsnicht@dienstplan.test", password: "falsch12345" },
    });
    const wrongPw = await ctx.post("/api/auth/login", {
      data: { email: accountB.email, password: "falsch12345" },
    });
    expect(unknown.status()).toBe(401);
    expect(wrongPw.status()).toBe(401);
    const unknownBody = (await unknown.json()) as { error?: string };
    const wrongPwBody = (await wrongPw.json()) as { error?: string };
    expect(
      unknownBody.error,
      "401-Meldungen muessen identisch sein (kein Existenz-Leak im Login)",
    ).toBe(wrongPwBody.error);
  } finally {
    await ctx.dispose();
  }
});
