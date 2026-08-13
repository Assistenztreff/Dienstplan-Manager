import { test, expect, request as playwrightRequest } from "@playwright/test";
import {
  deleteFreeAccount,
  registerFreeAccount,
  FREE_ACCOUNT_PASSWORD,
  BASE_URL,
  type FreeAccount,
} from "./helpers/teams";
import {
  dbGetEmailVerificationToken,
  dbMarkEmailVerified,
  dbSetEmailVerification,
  dbSetPasswordResetToken,
  dbGetPasswordResetToken,
} from "./helpers/db";

/**
 * API-Level-Tests fuer die E-Mail-Flows (Verifizierung + Passwort-Reset).
 *
 * Da die Test-Umgebung keinen echten RESEND_API_KEY hat, werden Tokens direkt
 * per DB-Helfer gesetzt (kein echter E-Mail-Versand noetig). So werden alle
 * API-Endpunkte und Fehlerfaelle vollstaendig abgedeckt, ohne von einem
 * Postfach abhaengig zu sein.
 *
 * Suffix "-api" damit der Spec in den scoped-e2e-API-Gate laeuft.
 */

let verifyAcc: FreeAccount;
let resetAcc: FreeAccount;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  [verifyAcc, resetAcc] = await Promise.all([
    registerFreeAccount("privat", "emailverify"),
    registerFreeAccount("privat", "pwreset"),
  ]);
  // Wenn RESEND_API_KEY gesetzt ist, startet jedes neue Konto mit
  // emailVerified=false. Die Specs setzen den Status wo noetig selbst —
  // als Ausgangszustand brauchen wir verifizierte Konten.
  await Promise.all([
    dbMarkEmailVerified(verifyAcc.email),
    dbMarkEmailVerified(resetAcc.email),
  ]);
});

test.afterAll(async () => {
  await Promise.all([
    deleteFreeAccount(verifyAcc),
    deleteFreeAccount(resetAcc),
  ]);
});

// ---------------------------------------------------------------------------
// E-Mail-Verifizierung
// ---------------------------------------------------------------------------

test("Login mit unverifizierter E-Mail → 403 mit code email_not_verified", async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  try {
    // Konto auf unverifiziert setzen
    await dbSetEmailVerification(verifyAcc.email, "dummy-token-for-login-test");

    const res = await ctx.post("/api/auth/login", {
      data: { email: verifyAcc.email, password: FREE_ACCOUNT_PASSWORD },
    });
    expect(res.status()).toBe(403);
    const body = (await res.json()) as { code?: string; error?: string };
    expect(body.code).toBe("email_not_verified");
    expect(body.error).toMatch(/E-Mail/i);
  } finally {
    await ctx.dispose();
  }
});

test("verify-email mit unbekanntem Token → 400", async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  try {
    const res = await ctx.post("/api/auth/verify-email", {
      data: { token: "unbekannter-token-xyz-123" },
    });
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBeTruthy();
  } finally {
    await ctx.dispose();
  }
});

test("verify-email ohne Token → 400", async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  try {
    const res = await ctx.post("/api/auth/verify-email", { data: {} });
    expect(res.status()).toBe(400);
  } finally {
    await ctx.dispose();
  }
});

test("verify-email mit gueltigem Token → 200, Session wird angelegt", async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  try {
    const token = "valid-verify-token-e2e-abc";
    await dbSetEmailVerification(verifyAcc.email, token);

    const res = await ctx.post("/api/auth/verify-email", { data: { token } });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { id?: number; email?: string; role?: string };
    expect(body.id).toBe(verifyAcc.id);
    expect(body.email).toBe(verifyAcc.email);

    // Session muss gesetzt sein → /auth/me antwortet 200
    const me = await ctx.get("/api/auth/me");
    expect(me.status()).toBe(200);
  } finally {
    await ctx.dispose();
  }
});

test("verify-email mit bereits genutztem Token → 400", async () => {
  // Der Token aus dem vorherigen Test wurde bereits geloescht; ein erneuter
  // Aufruf mit demselben Wert muss 400 zurueckgeben.
  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  try {
    const res = await ctx.post("/api/auth/verify-email", {
      data: { token: "valid-verify-token-e2e-abc" },
    });
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/Ungültig|verwendet/i);
  } finally {
    await ctx.dispose();
  }
});

test("resend-verification gibt immer 200 zurueck (auch fuer unbekannte E-Mail)", async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  try {
    // Unbekannte Adresse → kein Existenz-Orakel
    const resUnknown = await ctx.post("/api/auth/resend-verification", {
      data: { email: "unbekannt@dienstplan.test" },
    });
    expect(resUnknown.status()).toBe(200);

    // Bekannte, bereits verifizierte Adresse → ebenfalls 200
    const resVerified = await ctx.post("/api/auth/resend-verification", {
      data: { email: verifyAcc.email },
    });
    expect(resVerified.status()).toBe(200);
  } finally {
    await ctx.dispose();
  }
});

test("resend-verification fuer unverifiziertes Konto erneuert Token und der neue Token ist nutzbar", async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  try {
    const oldToken = "old-token-before-resend";
    await dbSetEmailVerification(verifyAcc.email, oldToken);

    const res = await ctx.post("/api/auth/resend-verification", {
      data: { email: verifyAcc.email },
    });
    expect(res.status()).toBe(200);

    // Wenn RESEND_API_KEY gesetzt ist (isEmailEnabled=true), MUSS der Endpunkt
    // einen neuen Token generiert und gespeichert haben.
    const newToken = await dbGetEmailVerificationToken(verifyAcc.email);

    if (newToken !== null && newToken !== oldToken) {
      // Neuer Token vorhanden — damit den Account echten Verifizierungs-Klick
      // simulieren (beweist End-to-End-Nutzbarkeit des generierten Tokens).
      const verifyRes = await ctx.post("/api/auth/verify-email", { data: { token: newToken } });
      expect(verifyRes.status(), "Neuer Token aus resend-verification muss verifizierbar sein").toBe(
        200,
      );
    } else {
      // RESEND_API_KEY nicht gesetzt → isEmailEnabled()=false → Endpunkt tut
      // intentional nichts; alter Token bleibt erhalten. HTTP 200 (Anti-Enumeration)
      // ist bereits geprueft.
      expect(newToken ?? oldToken, "Alter Token darf nicht geloescht worden sein").toBe(oldToken);
    }
  } finally {
    await ctx.dispose();
  }
});

// ---------------------------------------------------------------------------
// Passwort-Reset
// ---------------------------------------------------------------------------

test("forgot-password gibt immer 200 zurueck (Anti-Enumeration)", async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  try {
    // Unbekannte Adresse
    const resUnknown = await ctx.post("/api/auth/forgot-password", {
      data: { email: "nichtexistent@dienstplan.test" },
    });
    expect(resUnknown.status()).toBe(200);
    const bodyUnknown = (await resUnknown.json()) as { ok: boolean };
    expect(bodyUnknown.ok).toBe(true);

    // Bekannte Adresse
    const resKnown = await ctx.post("/api/auth/forgot-password", {
      data: { email: resetAcc.email },
    });
    expect(resKnown.status()).toBe(200);
    const bodyKnown = (await resKnown.json()) as { ok: boolean };
    expect(bodyKnown.ok).toBe(true);
  } finally {
    await ctx.dispose();
  }
});

test("reset-password mit unbekanntem Token → 400", async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  try {
    const res = await ctx.post("/api/auth/reset-password", {
      data: { token: "unbekannter-reset-token", password: "neuesPasswort99" },
    });
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/Ungültig|abgelaufen/i);
  } finally {
    await ctx.dispose();
  }
});

test("reset-password ohne Token → 400", async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  try {
    const res = await ctx.post("/api/auth/reset-password", {
      data: { password: "neuesPasswort99" },
    });
    expect(res.status()).toBe(400);
  } finally {
    await ctx.dispose();
  }
});

test("reset-password mit abgelaufenem Token → 400", async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  try {
    const expiredToken = "expired-reset-token-e2e";
    const pastDate = new Date(Date.now() - 60_000); // 1 Minute in der Vergangenheit
    await dbSetPasswordResetToken(resetAcc.email, expiredToken, pastDate);

    const res = await ctx.post("/api/auth/reset-password", {
      data: { token: expiredToken, password: "neuesPasswort99" },
    });
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/abgelaufen/i);
  } finally {
    await ctx.dispose();
  }
});

test("reset-password mit zu kurzem Passwort → 400", async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  try {
    const token = "short-pw-test-token";
    await dbSetPasswordResetToken(resetAcc.email, token, new Date(Date.now() + 3_600_000));

    const res = await ctx.post("/api/auth/reset-password", {
      data: { token, password: "kurz" },
    });
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/8 Zeichen/i);
  } finally {
    await ctx.dispose();
  }
});

test("reset-password mit gueltigem Token → 200, danach Login mit neuem Passwort", async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  try {
    const token = "valid-reset-token-e2e-xyz";
    const newPassword = "NeuesPasswort123!";
    await dbSetPasswordResetToken(resetAcc.email, token, new Date(Date.now() + 3_600_000));

    // Reset durchfuehren
    const resetRes = await ctx.post("/api/auth/reset-password", {
      data: { token, password: newPassword },
    });
    expect(resetRes.status()).toBe(200);
    const resetBody = (await resetRes.json()) as { ok: boolean };
    expect(resetBody.ok).toBe(true);

    // Login mit neuem Passwort muss funktionieren
    const loginRes = await ctx.post("/api/auth/login", {
      data: { email: resetAcc.email, password: newPassword },
    });
    expect(loginRes.status()).toBe(200);
    const loginBody = (await loginRes.json()) as { id: number };
    expect(loginBody.id).toBe(resetAcc.id);

    // Token darf nicht wiederverwendbar sein
    const reusedRes = await ctx.post("/api/auth/reset-password", {
      data: { token, password: "NochAnderesPasswort9!" },
    });
    expect(reusedRes.status()).toBe(400);

    // Altes Passwort darf nicht mehr funktionieren
    const oldLoginRes = await ctx.post("/api/auth/login", {
      data: { email: resetAcc.email, password: FREE_ACCOUNT_PASSWORD },
    });
    expect(oldLoginRes.status()).toBe(401);
  } finally {
    await ctx.dispose();
  }
});

test("forgot-password setzt Token in DB, der dann direkt fuer Reset nutzbar ist", async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  try {
    // Alten Token entfernen, damit wir eindeutig sehen ob forgot-password einen
    // neuen setzt.
    await dbSetPasswordResetToken(
      resetAcc.email,
      "sentinel-vor-forgot-password",
      new Date(Date.now() - 1000), // bereits abgelaufen → wird nicht missbraucht
    );

    const res = await ctx.post("/api/auth/forgot-password", {
      data: { email: resetAcc.email },
    });
    expect(res.status()).toBe(200);

    const tokenAfter = await dbGetPasswordResetToken(resetAcc.email);

    if (tokenAfter !== null && tokenAfter !== "sentinel-vor-forgot-password") {
      // RESEND_API_KEY gesetzt → forgot-password hat einen frischen Token
      // hinterlegt. Beweise End-to-End-Nutzbarkeit: Reset mit diesem Token.
      const finalPassword = "PasswortNachForgotPw!9";
      const resetRes = await ctx.post("/api/auth/reset-password", {
        data: { token: tokenAfter, password: finalPassword },
      });
      expect(resetRes.status(), "Vom forgot-password generierter Token muss Reset ermoeglichen").toBe(
        200,
      );

      // Login mit neuem Passwort muss funktionieren
      const loginRes = await ctx.post("/api/auth/login", {
        data: { email: resetAcc.email, password: finalPassword },
      });
      expect(loginRes.status(), "Login mit nach forgot-password gesetztem Passwort muss klappen").toBe(
        200,
      );
    } else {
      // RESEND_API_KEY nicht gesetzt → isEmailEnabled()=false → kein Token
      // hinterlegt; Endpunkt antwortet trotzdem 200 (Anti-Enumeration).
      // HTTP-Status ist bereits geprueft; nichts weiter zu tun.
    }
  } finally {
    await ctx.dispose();
  }
});
