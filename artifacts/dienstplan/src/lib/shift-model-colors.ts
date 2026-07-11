export type ShiftModelColor = {
  value: string;
  label: string;
  badge: string;
  dot: string;
  // Initialen-Kreis (Legende): dunklerer Hintergrund als der Dot, damit die
  // weiße Beschriftung (2 Buchstaben) einen hohen Kontrast hat (WCAG).
  initials: string;
};

export const SHIFT_MODEL_COLORS: ShiftModelColor[] = [
  { value: "primary", label: "Primär", badge: "bg-primary/10 text-primary border-primary/25 hover:bg-primary/20", dot: "bg-primary", initials: "bg-primary text-primary-foreground" },
  { value: "amber", label: "Bernstein", badge: "bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100", dot: "bg-amber-500", initials: "bg-amber-700 text-white" },
  { value: "blue", label: "Blau", badge: "bg-blue-50 text-blue-800 border-blue-200 hover:bg-blue-100", dot: "bg-blue-500", initials: "bg-blue-600 text-white" },
  { value: "indigo", label: "Indigo", badge: "bg-indigo-50 text-indigo-800 border-indigo-200 hover:bg-indigo-100", dot: "bg-indigo-500", initials: "bg-indigo-600 text-white" },
  { value: "purple", label: "Violett", badge: "bg-purple-50 text-purple-800 border-purple-200 hover:bg-purple-100", dot: "bg-purple-500", initials: "bg-purple-600 text-white" },
  { value: "teal", label: "Türkis", badge: "bg-teal-50 text-teal-800 border-teal-200 hover:bg-teal-100", dot: "bg-teal-500", initials: "bg-teal-700 text-white" },
  { value: "green", label: "Grün", badge: "bg-green-50 text-green-800 border-green-200 hover:bg-green-100", dot: "bg-green-500", initials: "bg-green-700 text-white" },
  { value: "rose", label: "Rosé", badge: "bg-rose-50 text-rose-800 border-rose-200 hover:bg-rose-100", dot: "bg-rose-500", initials: "bg-rose-600 text-white" },
  { value: "orange", label: "Orange", badge: "bg-orange-50 text-orange-800 border-orange-200 hover:bg-orange-100", dot: "bg-orange-500", initials: "bg-orange-700 text-white" },
  { value: "slate", label: "Grau", badge: "bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200", dot: "bg-slate-500", initials: "bg-slate-600 text-white" },
];

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
  return userColor(userId).badge;
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
