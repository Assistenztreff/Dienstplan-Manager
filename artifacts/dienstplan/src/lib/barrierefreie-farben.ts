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

// ── Kategoriale 12-Slot-Paletten für Assistenzkräfte im Monatskalender ──────
// Zwei Paletten aus der Arbeitsanweisung (Abschnitte 7.1 und 7.2).
// Alle Hex-Werte 1:1 aus der Vorgabe – nicht selbst mischen.
// Reihenfolge ist bereits nach maximaler gegenseitiger Unterscheidbarkeit
// optimiert; Slot 1 zuerst vergeben, dann Slot 2 usw.
// Bei >12 Assistenzkräften beginnt eine zweite Runde ab Slot 1 (wrap-around).
export type PersonSlot = {
  /** Hintergrundfarbe der Kalender-Pille (Inline-Style). */
  bg: string;
  /** Textfarbe auf der Pille – Schwarz (#000) helle Palette, Weiß (#fff) dunkle Palette. */
  text: string;
  /** Rahmenfarbe (abgedunkelte/aufgehellte Variante von bg). */
  border: string;
};

export type AssistantPaletteId = "light" | "dark";

/**
 * 7.1 Helle Palette – 12 Slots, schwarzer Text (#000000).
 * Alle Hex-Werte 1:1 aus Arbeitsanweisung, Kontrast ≥ WCAG-AA (4,5:1).
 */
export const PERSON_SLOTS_LIGHT: PersonSlot[] = [
  { bg: "#8ada62", text: "#000000", border: "#619945" }, // 1 – 12,29:1
  { bg: "#9f73de", text: "#000000", border: "#6f519b" }, // 2 –  5,98:1
  { bg: "#73ccde", text: "#000000", border: "#518f9b" }, // 3 – 11,42:1
  { bg: "#de9f73", text: "#000000", border: "#9b6f51" }, // 4 –  9,31:1
  { bg: "#cbb6e7", text: "#000000", border: "#8e7fa2" }, // 5 – 11,38:1
  { bg: "#de73ba", text: "#000000", border: "#9b5182" }, // 6 –  7,27:1
  { bg: "#de737c", text: "#000000", border: "#9b5157" }, // 7 –  6,85:1
  { bg: "#e0d6a3", text: "#000000", border: "#9d9672" }, // 8 – 14,32:1
  { bg: "#62da94", text: "#000000", border: "#459968" }, // 9 – 11,98:1
  { bg: "#7396de", text: "#000000", border: "#51699b" }, // 10 – 7,15:1
  { bg: "#dec373", text: "#000000", border: "#9b8951" }, // 11 – 12,16:1
  { bg: "#b6d3e7", text: "#000000", border: "#7f94a2" }, // 12 – 13,46:1
];

/**
 * 7.2 Dunkle Palette „Golden-Winkel" – 12 Slots, weißer Text (#ffffff).
 * Hues nach Goldenen-Winkel-Prinzip (Schrittweite ~137,5°); alle ≥ WCAG-AA.
 */
export const PERSON_SLOTS_DARK: PersonSlot[] = [
  { bg: "#701a28", text: "#ffffff", border: "#984250" }, // 1 Rosa-Rot – 11,25:1
  { bg: "#1a7025", text: "#ffffff", border: "#42984d" }, // 2 Grün –     6,20:1
  { bg: "#3e1a70", text: "#ffffff", border: "#664298" }, // 3 Violett –  13,24:1
  { bg: "#70571a", text: "#ffffff", border: "#987f42" }, // 4 Ocker –     6,85:1
  { bg: "#1a6f70", text: "#ffffff", border: "#429798" }, // 5 Petrol –    5,91:1
  { bg: "#701a57", text: "#ffffff", border: "#98427f" }, // 6 Magenta –  10,64:1
  { bg: "#3e701a", text: "#ffffff", border: "#669842" }, // 7 Olivgrün –  5,94:1
  { bg: "#1a2570", text: "#ffffff", border: "#424d98" }, // 8 Indigo –   13,61:1
  { bg: "#70281a", text: "#ffffff", border: "#985042" }, // 9 Terracotta – 10,46:1
  { bg: "#1a7041", text: "#ffffff", border: "#429869" }, // 10 Smaragd –  6,11:1
  { bg: "#5a1a70", text: "#ffffff", border: "#824298" }, // 11 Lila –    11,56:1
  { bg: "#6c701a", text: "#ffffff", border: "#949842" }, // 12 Gelbgrün – 5,29:1
];

/** Aktive Palette anhand der Einstellung zurückgeben. */
export function getPersonSlots(palette: AssistantPaletteId): PersonSlot[] {
  return palette === "dark" ? PERSON_SLOTS_DARK : PERSON_SLOTS_LIGHT;
}

/** @deprecated Verwende PERSON_SLOTS_LIGHT oder getPersonSlots(). */
export const PERSON_SLOTS: PersonSlot[] = PERSON_SLOTS_LIGHT;
