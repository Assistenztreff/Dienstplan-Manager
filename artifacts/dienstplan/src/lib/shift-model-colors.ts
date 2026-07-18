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
// Farbe erkennbar — unabhängig von Schichtart oder Schichtmodell.
//
// Kollisionsarme Team-Zuordnung: Wenn die Team-Mitgliederliste bekannt ist,
// wird sie zu einer Zuordnung "userId → Palettenfarbe" verrechnet
// (buildPersonColorAssignment). Die IDs werden dedupliziert und aufsteigend
// sortiert (= Beitrittsreihenfolge, da IDs fortlaufend vergeben werden) und
// der Reihe nach den 8 Farben zugewiesen. Dadurch bekommen die ersten 8
// Personen eines Teams garantiert 8 VERSCHIEDENE Farben, und die Zuordnung
// ist unabhängig von Lade-/Anzeigereihenfolge über Seiten und Sitzungen
// stabil. Neue Mitglieder (höhere IDs) hängen sich hinten an, ohne die
// Farben der bestehenden zu verschieben.
export type PersonColorAssignment = Map<number, ShiftModelColor>;

export function buildPersonColorAssignment(userIds: number[]): PersonColorAssignment {
  const sorted = [...new Set(userIds.filter((id) => Number.isFinite(id)))].sort(
    (a, b) => a - b,
  );
  const assignment: PersonColorAssignment = new Map();
  sorted.forEach((id, index) => {
    assignment.set(id, SHIFT_MODEL_COLORS[index % SHIFT_MODEL_COLORS.length]!);
  });
  return assignment;
}

// Fallback ohne Team-Kontext (z. B. Aushilfe-Spiegel aus fremden Teams):
// stabiler Integer-Hash der ID + Modulo über die Palette, damit dieselbe ID
// immer dieselbe Farbe ergibt und benachbarte IDs verschieden ausfallen.
export function userColor(
  userId: number,
  assignment?: PersonColorAssignment,
): ShiftModelColor {
  const assigned = assignment?.get(userId);
  if (assigned) return assigned;
  if (!Number.isFinite(userId)) return SHIFT_MODEL_COLORS[0]!;
  // Multiplikator (Knuth-artig) streut aufeinanderfolgende IDs über die Palette,
  // statt sie streng der Reihe nach durchzunummerieren.
  const hash = Math.abs(Math.trunc(userId) * 2654435761);
  return SHIFT_MODEL_COLORS[hash % SHIFT_MODEL_COLORS.length]!;
}

export function userBadgeClass(
  userId: number,
  assignment?: PersonColorAssignment,
): string {
  // Zentrale Quelle: der Farb-Koppler liefert das barrierefreie Klassen-Paar
  // (Fläche + gekoppelter Text-/Rahmenton) für den Farb-Key der Person.
  return getBarrierefreieFarbe(userColor(userId, assignment).value);
}

export function userDotClass(
  userId: number,
  assignment?: PersonColorAssignment,
): string {
  return userColor(userId, assignment).dot;
}

export function userInitialsClass(
  userId: number,
  assignment?: PersonColorAssignment,
): string {
  return userColor(userId, assignment).initials;
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
