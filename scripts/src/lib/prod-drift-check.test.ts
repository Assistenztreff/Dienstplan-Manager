import { describe, expect, it } from "vitest";
import { runProdDriftCheck } from "./prod-drift-check.js";

const PROD = "postgres://prod:secret@prod.example.com:11527/proddb?sslmode=require";
const DEV = "postgres://dev:pw@helium:5432/heliumdb";

const noMissing = async () => [];

describe("runProdDriftCheck (Publish-Guard)", () => {
  it("Bypass: SKIP_PROD_SCHEMA_CHECK=1 überspringt den Check ohne DB-Zugriff", async () => {
    const result = await runProdDriftCheck(
      { SKIP_PROD_SCHEMA_CHECK: "1" },
      async () => {
        throw new Error("darf nicht aufgerufen werden");
      },
    );
    expect(result).toEqual({ kind: "skipped" });
  });

  it("fehlende PROD_DATABASE_URL ist fail-closed", async () => {
    const result = await runProdDriftCheck({}, noMissing);
    expect(result).toEqual({ kind: "missing-url" });
  });

  it("Kollision mit DATABASE_URL wird erkannt (falsch-grün-Schutz)", async () => {
    const result = await runProdDriftCheck(
      { PROD_DATABASE_URL: DEV, DATABASE_URL: "postgres://other:x@helium:5432/heliumdb" },
      noMissing,
    );
    expect(result).toEqual({ kind: "collision", envName: "DATABASE_URL" });
  });

  it("Kollision mit APP_DATABASE_URL wird erkannt", async () => {
    const result = await runProdDriftCheck(
      { PROD_DATABASE_URL: DEV, APP_DATABASE_URL: DEV },
      noMissing,
    );
    expect(result).toEqual({ kind: "collision", envName: "APP_DATABASE_URL" });
  });

  it("fehlende Objekte => drift mit Problemliste", async () => {
    const result = await runProdDriftCheck(
      { PROD_DATABASE_URL: PROD },
      async () => ["Spalte fehlt: users.email_verification_token_expiry"],
    );
    expect(result).toEqual({
      kind: "drift",
      target: "prod.example.com:11527/proddb",
      problems: ["Spalte fehlt: users.email_verification_token_expiry"],
    });
  });

  it("Verbindungsfehler ist fail-closed (connect-failed)", async () => {
    const result = await runProdDriftCheck(
      { PROD_DATABASE_URL: PROD },
      async () => {
        throw new Error("ECONNREFUSED");
      },
    );
    expect(result).toMatchObject({ kind: "connect-failed" });
    expect((result as { message: string }).message).toContain("ECONNREFUSED");
  });

  it("kein Drift => ok mit Ziel-Identität", async () => {
    const result = await runProdDriftCheck({ PROD_DATABASE_URL: PROD }, noMissing);
    expect(result).toEqual({ kind: "ok", target: "prod.example.com:11527/proddb" });
  });

  it("rotiertes Passwort: SCALEWAY_DB_PASSWORD ersetzt das URL-Passwort für die Verbindung", async () => {
    let seenUrl = "";
    const result = await runProdDriftCheck(
      { PROD_DATABASE_URL: PROD, SCALEWAY_DB_PASSWORD: "neu#pass" },
      async (url) => {
        seenUrl = url;
        return [];
      },
    );
    expect(result).toMatchObject({ kind: "ok" });
    expect(new URL(seenUrl).password).toBe(encodeURIComponent("neu#pass"));
    expect(seenUrl).not.toContain("secret");
  });

  it("rotiertes Passwort repariert auch unkodierte URL-Passwörter (Normalisierung zuerst)", async () => {
    let seenUrl = "";
    await runProdDriftCheck(
      {
        PROD_DATABASE_URL: "postgres://prod:alt#pw@prod.example.com:11527/proddb",
        SCALEWAY_DB_PASSWORD: "rotiert",
      },
      async (url) => {
        seenUrl = url;
        return [];
      },
    );
    expect(new URL(seenUrl).password).toBe("rotiert");
  });
});
