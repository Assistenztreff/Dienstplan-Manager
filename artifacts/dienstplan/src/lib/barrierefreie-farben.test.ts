import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ASSISTENZ_PAARUNGEN } from "./barrierefreie-farben";

// Liest die Hex-Werte der assistenz-Palette direkt aus index.css, damit der
// Test automatisch mitzieht, wenn Farbtoken angepasst werden. Sinkt eine
// Paarung unter WCAG AA (4,5:1 für normalen Text), schlägt der Test fehl.

const cssPath = fileURLToPath(new URL("../index.css", import.meta.url));
const css = readFileSync(cssPath, "utf8");

function tokenHex(token: string): string {
  const match = css.match(new RegExp(`--color-${token}\\s*:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  if (!match) throw new Error(`Token --color-${token} nicht in index.css gefunden`);
  return match[1];
}

function srgbChannel(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * srgbChannel(r) + 0.7152 * srgbChannel(g) + 0.0722 * srgbChannel(b);
}

function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  const [light, dark] = la >= lb ? [la, lb] : [lb, la];
  return (light + 0.05) / (dark + 0.05);
}

const WCAG_AA = 4.5;

function extractToken(classes: string, prefix: "bg" | "text"): string {
  const match = classes.match(new RegExp(`(?:^|\\s)${prefix}-(assistenz-[a-zA-Z-]+?)(?:/\\d+)?(?:\\s|$)`));
  if (!match) throw new Error(`Keine ${prefix}-assistenz-Klasse in "${classes}" gefunden`);
  return match[1];
}

describe("assistenz-Palette bleibt barrierefrei (WCAG AA ≥ 4,5:1)", () => {
  it("umfasst alle 8 Paarungen", () => {
    expect(ASSISTENZ_PAARUNGEN).toHaveLength(8);
  });

  for (const paarung of ASSISTENZ_PAARUNGEN) {
    it(`${paarung.label}: helle Fläche + gekoppelter Textton`, () => {
      const bg = tokenHex(extractToken(paarung.badge, "bg"));
      const text = tokenHex(extractToken(paarung.badge, "text"));
      const ratio = contrastRatio(bg, text);
      expect(
        ratio,
        `Kontrast ${paarung.key} Fläche/Text ist ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(WCAG_AA);
    });

    it(`${paarung.label}: dunkle Variante + Weiß (Initialen)`, () => {
      expect(paarung.initials.split(/\s+/), "Initialen müssen text-white nutzen").toContain(
        "text-white",
      );
      const bg = tokenHex(extractToken(paarung.initials, "bg"));
      const ratio = contrastRatio(bg, "#ffffff");
      expect(
        ratio,
        `Kontrast ${paarung.key} Dunkelvariante/Weiß ist ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(WCAG_AA);
    });
  }
});
