import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findViolationsInSource, scanRepo } from "./check-test-db-derivation";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("check-test-db-derivation", () => {
  it("meldet Template-Interpolation vor _test", () => {
    const src = 'const name = `${baseName}_test`;\n';
    expect(findViolationsInSource(src, "scripts/src/evil.ts")).toHaveLength(1);
  });

  it("meldet _test_ vor Interpolation und Konkatenation", () => {
    expect(
      findViolationsInSource("const n = `${b}_test_${s}`;", "a.ts"),
    ).toHaveLength(1);
    expect(findViolationsInSource('const n = base + "_test";', "a.ts")).toHaveLength(1);
    expect(findViolationsInSource('u.pathname = "/" + db + "_test";', "a.ts")).toHaveLength(1);
  });

  it("erlaubt Erwaehnungen in Kommentaren, Meldungen und Pruef-Regexen", () => {
    const src = [
      "// laeuft gegen die `_test`-DB",
      ' * `<dbname>_test`-DB wird provisioniert',
      'throw new Error(`erwartet Suffix "_test" oder "_test_<suffix>"`);',
      "if (!/_test(_[a-z0-9]{1,16})?$/.test(currentDbName)) {",
    ].join("\n");
    expect(findViolationsInSource(src, "scripts/src/ok.ts")).toHaveLength(0);
  });

  it("erlaubt das zentrale Modul", () => {
    const src = "const name = `${baseName}_test_${suffix}`;";
    expect(
      findViolationsInSource(src, "lib/test-fixtures/src/test-db-name.ts"),
    ).toHaveLength(0);
  });

  it("findet im echten Repo keine Verstoesse", () => {
    expect(scanRepo(repoRoot)).toEqual([]);
  });
});
