import { describe, it, expect } from "vitest";
import {
  parseArgs,
  hostAndDb,
  dbName,
  urlsCollide,
  confirmNameMatches,
  pushOutputIndicatesFailure,
  TTY_PROMPT_PATTERN,
  ERROR_LINE_PATTERN,
  SESSION_DROP_PATTERN,
  NO_CHANGES_PATTERN,
} from "./migrate-prod-guards.js";

const PROD = "postgres://user:pw@prod.example.com:5432/proddb";

describe("parseArgs", () => {
  it("Dry-Run ohne Argumente nimmt PROD_DATABASE_URL aus der Umgebung", () => {
    const args = parseArgs([], { PROD_DATABASE_URL: PROD });
    expect(args).toEqual({ targetUrlRaw: PROD, apply: false, confirmName: undefined });
  });

  it("URL als Positionsargument überschreibt die Umgebung", () => {
    const args = parseArgs(["postgres://x@h/db2"], { PROD_DATABASE_URL: PROD });
    expect(args.targetUrlRaw).toBe("postgres://x@h/db2");
    expect(args.apply).toBe(false);
  });

  it("ohne URL und ohne Env bleibt targetUrlRaw undefined", () => {
    const args = parseArgs([], {});
    expect(args.targetUrlRaw).toBeUndefined();
  });

  it("--yes <name> setzt apply und confirmName", () => {
    const args = parseArgs(["--yes", "proddb"], { PROD_DATABASE_URL: PROD });
    expect(args.apply).toBe(true);
    expect(args.confirmName).toBe("proddb");
  });

  it("--yes ohne Namen setzt apply, aber KEINEN confirmName", () => {
    const args = parseArgs(["--yes"], { PROD_DATABASE_URL: PROD });
    expect(args.apply).toBe(true);
    expect(args.confirmName).toBeUndefined();
  });

  it("--yes gefolgt von einer Option frisst die Option nicht als Namen", () => {
    expect(() => parseArgs(["--yes", "--foo"], {})).toThrow(/Unbekannte Option: --foo/);
  });

  it("--yes=<name> Schreibweise funktioniert", () => {
    const args = parseArgs(["--yes=proddb"], {});
    expect(args.apply).toBe(true);
    expect(args.confirmName).toBe("proddb");
  });

  it("unbekannte Optionen werfen", () => {
    expect(() => parseArgs(["--force"], {})).toThrow(/Unbekannte Option: --force/);
  });
});

describe("hostAndDb / dbName", () => {
  it("normalisiert fehlenden Port auf 5432", () => {
    expect(hostAndDb("postgres://u:p@host/db")).toBe("host:5432/db");
    expect(hostAndDb("postgres://u:p@host:5432/db")).toBe("host:5432/db");
  });

  it("behält abweichende Ports", () => {
    expect(hostAndDb("postgres://u@host:6432/db")).toBe("host:6432/db");
  });

  it("dbName extrahiert den Namen ohne Query-Parameter", () => {
    expect(dbName("postgres://u@h:5432/proddb?sslmode=require")).toBe("proddb");
    expect(dbName(PROD)).toBe("proddb");
  });
});

describe("urlsCollide (Staging-/Dev-Guard)", () => {
  it("identische URL kollidiert", () => {
    expect(urlsCollide(PROD, PROD)).toBe(true);
  });

  it("gleicher Host+DB mit anderen Zugangsdaten und Query-Parametern kollidiert", () => {
    expect(
      urlsCollide(PROD, "postgres://other:secret@prod.example.com/proddb?sslmode=require"),
    ).toBe(true);
  });

  it("gleicher Host+Port+DB kollidiert trotz anderer Credentials", () => {
    expect(urlsCollide(PROD, "postgres://other:secret@prod.example.com:5432/proddb")).toBe(true);
  });

  it("impliziter vs. expliziter Port 5432 kollidiert", () => {
    expect(urlsCollide(PROD, "postgres://x@prod.example.com/proddb")).toBe(true);
  });

  it("gleicher Host, andere DB kollidiert NICHT", () => {
    expect(urlsCollide(PROD, "postgres://u:pw@prod.example.com:5432/proddb_test")).toBe(false);
  });

  it("anderer Host, gleiche DB kollidiert NICHT", () => {
    expect(urlsCollide(PROD, "postgres://u:pw@staging.example.com:5432/proddb")).toBe(false);
  });

  it("unparsebare Env-URL kollidiert nur bei exakter Gleichheit", () => {
    expect(urlsCollide(PROD, "kaputt")).toBe(false);
    expect(urlsCollide("kaputt", "kaputt")).toBe(true);
  });
});

describe("confirmNameMatches (--yes <dbname>)", () => {
  it("exakter Name passt", () => {
    expect(confirmNameMatches("proddb", "proddb")).toBe(true);
  });

  it("fehlender Name passt nicht", () => {
    expect(confirmNameMatches(undefined, "proddb")).toBe(false);
  });

  it("falscher Name passt nicht (auch bei Groß-/Kleinschreibung oder Teilstring)", () => {
    expect(confirmNameMatches("Proddb", "proddb")).toBe(false);
    expect(confirmNameMatches("prod", "proddb")).toBe(false);
    expect(confirmNameMatches("", "proddb")).toBe(false);
  });
});

describe("drizzle-Ausgabemuster", () => {
  it("TTY-Prompt-Muster erkennt die drizzle-Meldung (case-insensitive)", () => {
    expect(TTY_PROMPT_PATTERN.test("Interactive prompts require a TTY")).toBe(true);
    expect(TTY_PROMPT_PATTERN.test("interactive prompts require a tty!")).toBe(true);
    expect(TTY_PROMPT_PATTERN.test("alles gut")).toBe(false);
  });

  it("Error:-Zeilen werden zeilenweise erkannt", () => {
    expect(ERROR_LINE_PATTERN.test("ok\nError: connect ECONNREFUSED\n")).toBe(true);
    expect(ERROR_LINE_PATTERN.test("ok\n  Error: boom\n")).toBe(true);
    expect(ERROR_LINE_PATTERN.test("No Error: hier mitten in der Zeile")).toBe(false);
  });

  it("pushOutputIndicatesFailure kombiniert beide Muster", () => {
    expect(pushOutputIndicatesFailure("Interactive prompts require a TTY")).toBe(true);
    expect(pushOutputIndicatesFailure("x\nError: kaputt")).toBe(true);
    expect(pushOutputIndicatesFailure("[✓] Changes applied")).toBe(false);
  });

  it("No-Changes-Muster erkennt die Varianten", () => {
    expect(NO_CHANGES_PATTERN.test("No changes detected")).toBe(true);
    expect(NO_CHANGES_PATTERN.test("[i] Everything's fine 🐶")).toBe(true);
    expect(NO_CHANGES_PATTERN.test("Your schema is up to date")).toBe(true);
    expect(NO_CHANGES_PATTERN.test("ALTER TABLE users ...")).toBe(false);
  });
});

describe("SESSION_DROP_PATTERN (Session-Tabellen-Schutz)", () => {
  const dropVariants = [
    'DROP TABLE "session";',
    "DROP TABLE session;",
    'DROP TABLE IF EXISTS "session";',
    "drop table if exists session cascade;",
    'DROP TABLE "public"."session";',
    "DROP TABLE public.session;",
    'DROP  TABLE  "session"',
  ];
  for (const stmt of dropVariants) {
    it(`erkennt: ${stmt}`, () => {
      expect(SESSION_DROP_PATTERN.test(stmt)).toBe(true);
    });
  }

  it("löst NICHT auf andere Tabellen aus", () => {
    expect(SESSION_DROP_PATTERN.test('DROP TABLE "shifts";')).toBe(false);
    expect(SESSION_DROP_PATTERN.test('ALTER TABLE "session" ADD COLUMN x text;')).toBe(false);
  });
});
