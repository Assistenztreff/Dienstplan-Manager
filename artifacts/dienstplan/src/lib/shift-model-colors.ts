import {
  ASSISTENZ_PAARUNGEN,
  getBarrierefreieFarbe,
  type AssistenzPaarung,
} from "@/lib/barrierefreie-farben";

export type ShiftModelColor = {
  value: string;
  label: string;
  badge: string;
  dot: string;
  // Initialen-Kreis (Legende): dunklerer Hintergrund als die helle Fläche,
  // damit die weiße Beschriftung (2 Buchstaben) hohen Kontrast hat (WCAG AA).
  initials: string;
};

// Personen-Palette = die 8 barrierefreien "assistenz"-Paarungen (WCAG AA).
// Jede helle Fläche ist fest mit ihrem dunklen Text-/Rahmenton gekoppelt;
// Dots/Initialen nutzen die dunklere, kontrastgeprüfte Variante je Farbe.
export const SHIFT_MODEL_COLORS: ShiftModelColor[] = ASSISTENZ_PAARUNGEN.map(
  (p: AssistenzPaarung): ShiftModelColor => ({
    value: p.key,
    label: p.label,
    badge: p.badge,
    dot: p.dot,
    initials: p.initials,
  }),
);

// --- Farbzuordnung pro Assistenzkraft -------------------------------------
// Jede Assistenzkraft (userId) erhält deterministisch eine feste Farbe aus der
// Palette. Dieselbe Person ist dadurch überall (Badges, Punkte) an derselben
// Farbe erkennbar — unabhängig von Schichtart oder Schichtmodell. Stabiler
// Integer-Hash der ID + Modulo über die Palette, damit dieselbe ID immer
// dieselbe Farbe ergibt und benachbarte IDs unterschiedliche Farben bekommen.
export function userColor(userId: number): ShiftModelColor {
  if (!Number.isFinite(userId)) return SHIFT_MODEL_COLORS[0]!;
  // Multiplikator (Knuth-artig) streut aufeinanderfolgende IDs über die Palette,
  // statt sie streng der Reihe nach durchzunummerieren.
  const hash = Math.abs(Math.trunc(userId) * 2654435761);
  return SHIFT_MODEL_COLORS[hash % SHIFT_MODEL_COLORS.length]!;
}

export function userBadgeClass(userId: number): string {
  // Zentrale Quelle: der Farb-Koppler liefert das barrierefreie Klassen-Paar
  // (Fläche + gekoppelter Text-/Rahmenton) für den Farb-Key der Person.
  return getBarrierefreieFarbe(userColor(userId).value);
}

export function userDotClass(userId: number): string {
  return userColor(userId).dot;
}

export function userInitialsClass(userId: number): string {
  return userColor(userId).initials;
}

// Zwei-Buchstaben-Initialen (z. B. "CN" für "Camillo Neubert"): erste
// Buchstaben der ersten beiden Namensbestandteile, sonst die ersten zwei
// Zeichen des Namens. Zentral hier, damit Legende (Filter) und Kalender-
// Punkte dieselbe Ableitung nutzen.
export function nameInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0]! + parts[1][0]!).toUpperCase();
  return name.trim().slice(0, 2).toUpperCase();
}
