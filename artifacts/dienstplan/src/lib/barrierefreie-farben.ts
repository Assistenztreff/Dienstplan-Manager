/**
 * Universeller Farb-Koppler für die gesamte Dienstplan-App.
 * Nimmt einen Farb- oder Status-Key entgegen und gibt ein barrierefreies
 * (WCAG AA) Set aus Hintergrund-, Text- und Rahmen-Klassen zurück.
 *
 * Grundlage ist die "assistenz"-Palette (siehe index.css, @theme):
 * 8 helle Flächenfarben, jede FEST gekoppelt mit einem kontraststarken
 * dunklen Text-/Rahmenton — mint/yellow/green/pink/sage → assistenz-brand
 * (#05305B), peach/purple/terracotta → assistenz-darkText (#26092E).
 */

export type AssistenzFarbKey =
  | "mint"
  | "yellow"
  | "green"
  | "peach"
  | "purple"
  | "pink"
  | "terracotta"
  | "sage";

export type AssistenzPaarung = {
  key: AssistenzFarbKey;
  label: string;
  /** Helle Fläche + gekoppelter dunkler Text + Rahmen (WCAG AA ≥ 4,5:1). */
  badge: string;
  /** Dunklere, kontrastgeprüfte Variante für kleine Punkte. */
  dot: string;
  /** Dunkle Fläche mit weißer Schrift (Initialen-Kreise, WCAG AA). */
  initials: string;
};

// Die 8 festen Hell/Dunkel-Paarungen. Reihenfolge = Personen-Palette
// (deterministische Zuordnung je Assistenzkraft, siehe shift-model-colors.ts).
export const ASSISTENZ_PAARUNGEN: AssistenzPaarung[] = [
  {
    key: "mint",
    label: "Mint",
    badge: "bg-assistenz-mint text-assistenz-brand border-assistenz-brand/20",
    dot: "bg-assistenz-mint-dark",
    initials: "bg-assistenz-mint-dark text-white",
  },
  {
    key: "yellow",
    label: "Hellgelb",
    badge: "bg-assistenz-yellow text-assistenz-brand border-assistenz-brand/20",
    dot: "bg-assistenz-yellow-dark",
    initials: "bg-assistenz-yellow-dark text-white",
  },
  {
    key: "green",
    label: "Grün",
    badge: "bg-assistenz-green text-assistenz-brand border-assistenz-brand/20",
    dot: "bg-assistenz-green-dark",
    initials: "bg-assistenz-green-dark text-white",
  },
  {
    key: "peach",
    label: "Pfirsich",
    badge: "bg-assistenz-peach text-assistenz-darkText border-assistenz-darkText/20",
    dot: "bg-assistenz-peach-dark",
    initials: "bg-assistenz-peach-dark text-white",
  },
  {
    key: "purple",
    label: "Lila",
    badge: "bg-assistenz-purple text-assistenz-darkText border-assistenz-darkText/20",
    dot: "bg-assistenz-purple-dark",
    initials: "bg-assistenz-purple-dark text-white",
  },
  {
    key: "pink",
    label: "Rosa",
    badge: "bg-assistenz-pink text-assistenz-brand border-assistenz-brand/20",
    dot: "bg-assistenz-pink-dark",
    initials: "bg-assistenz-pink-dark text-white",
  },
  {
    key: "terracotta",
    label: "Terrakotta",
    badge: "bg-assistenz-terracotta text-assistenz-darkText border-assistenz-darkText/20",
    dot: "bg-assistenz-terracotta-dark",
    initials: "bg-assistenz-terracotta-dark text-white",
  },
  {
    key: "sage",
    label: "Salbei",
    badge: "bg-assistenz-sage text-assistenz-brand border-assistenz-brand/20",
    dot: "bg-assistenz-sage-dark",
    initials: "bg-assistenz-sage-dark text-white",
  },
];

const PAARUNG_BY_KEY = new Map<string, AssistenzPaarung>(
  ASSISTENZ_PAARUNGEN.map((p) => [p.key, p]),
);

// Deutsche Alias-Keys + Status-Aliase gemäß Vorlage. Status wird in der App
// weiterhin primär über Badges/Text/Icons kommuniziert — die Aliase sichern
// nur, dass jeder Key ein barrierefreies Paar liefert.
const KEY_ALIASE: Record<string, AssistenzFarbKey> = {
  hellblau: "mint",
  active: "mint",
  hellgelb: "yellow",
  pending: "yellow",
  draft: "yellow",
  "grün": "green",
  gruen: "green",
  confirmed: "green",
  success: "green",
  pfirsich: "peach",
  break: "peach",
  info: "peach",
  lila: "purple",
  rosa: "pink",
  orange: "terracotta",
  salbei: "sage",
};

/** Absolut sicherer, kontraststarker System-Fallback. */
const FALLBACK = "bg-gray-100 text-assistenz-brand border-gray-300";

export function getBarrierefreiePaarung(keyString: string): AssistenzPaarung | null {
  if (!keyString) return null;
  const key = keyString.toLowerCase().trim();
  return PAARUNG_BY_KEY.get(key) ?? PAARUNG_BY_KEY.get(KEY_ALIASE[key] ?? "") ?? null;
}

export function getBarrierefreieFarbe(keyString: string): string {
  return getBarrierefreiePaarung(keyString)?.badge ?? FALLBACK;
}
