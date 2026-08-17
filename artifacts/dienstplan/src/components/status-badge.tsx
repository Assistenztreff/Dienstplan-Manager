/**
 * StatusBadge — globale Status-Icons „Variante C" (Arbeitsanweisung 06.08.2026,
 * Punkte 2.1 + 3.1): gefüllter Farbkreis mit weißem Symbol innen. Einzige
 * erlaubte Quelle für die Status-Icons Entwurf / Bestätigt / Warnung /
 * Vertretung / Uhr — dünne Strich-Icons werden nicht mehr verwendet.
 * Werte exakt nach der Design-Vorlage (icon-varianten-und-emoji-menu.html).
 */
import type { ReactElement } from "react";

export type StatusBadgeKind =
  | "draft"
  | "confirmed"
  | "krank"
  | "vertretung"
  | "clock";

const KIND_CONFIG: Record<
  StatusBadgeKind,
  {
    circle: number;
    compactCircle: number;
    bg: string;
    /** Anteil des Kreisdurchmessers, den das Symbol einnimmt (Default 0.75). */
    symbolScale?: number;
    symbol: (s: number) => ReactElement;
  }
> = {
  // Entwurf: Kreis 16px #b5790a, weißer Stift 9px
  draft: {
    circle: 16,
    compactCircle: 10,
    bg: "#b5790a",
    symbol: (s) => (
      <svg width={s} height={s} viewBox="0 0 20 20" fill="#fff" stroke="none" aria-hidden="true">
        <path d="M14.5 2.3l3.2 3.2-9.6 9.6-4.3 1.1 1.1-4.3z" />
      </svg>
    ),
  },
  // Bestätigt: Kreis 16px #1e8f4e, weißer Haken 9px (stroke 3)
  confirmed: {
    circle: 16,
    compactCircle: 10,
    bg: "#1e8f4e",
    symbol: (s) => (
      <svg
        width={s}
        height={s}
        viewBox="0 0 20 20"
        fill="none"
        stroke="#fff"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M4 10.5l4 4 8-9" />
      </svg>
    ),
  },
  // Krankheit: Kreis 16px #b23b3b, weißes medizinisches Kreuz. Erscheint
  // zusätzlich zum Bestätigt-Haken, sobald die Backend-Automatik die Schicht
  // als „Assistenzkraft krankgemeldet" markiert (Icon-Set final, 16.08.2026).
  krank: {
    circle: 16,
    compactCircle: 10,
    bg: "#b23b3b",
    symbol: (s) => (
      <svg width={s} height={s} viewBox="0 0 20 20" fill="#fff" stroke="none" aria-hidden="true">
        <path d="M8 2h4v6h6v4h-6v6H8v-6H2V8h6z" />
      </svg>
    ),
  },
  // Vertretung: Kreis 15px #0f6e8c, weiße Rotationspfeile MIT Pfeilspitzen
  // (überarbeitet, Icon-Set final 16.08.2026 — ersetzt die offenen Bögen).
  vertretung: {
    circle: 15,
    compactCircle: 9,
    bg: "#0f6e8c",
    symbol: (s) => (
      <svg
        width={s}
        height={s}
        viewBox="0 0 24 24"
        fill="none"
        stroke="#fff"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points="17 1 21 5 17 9" />
        <path d="M3 11V9a4 4 0 0 1 4-4h14" />
        <polyline points="7 23 3 19 7 15" />
        <path d="M21 13v2a4 4 0 0 1-4 4H3" />
      </svg>
    ),
  },
  // Uhr: Kreis 15px, hell (Arbeitsanweisung 17.08.2026 Punkt 3 — vormals
  // dunkel #444/weiß, wirkte in der grauen Zeile 2 zu schwer). Jetzt helles
  // Rund #eef0f3 mit dunklem Uhr-Symbol, das Symbol selbst etwas größer als
  // bei den übrigen Icons (symbolScale 0.9 statt 0.75) und mittig zentriert.
  clock: {
    circle: 15,
    compactCircle: 9,
    bg: "#eef0f3",
    symbolScale: 0.9,
    symbol: (s) => (
      <svg
        width={s}
        height={s}
        viewBox="0 0 20 20"
        fill="none"
        stroke="#444444"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="10" cy="10" r="7.2" />
        <path d="M10 6.3v4l2.8 1.8" />
      </svg>
    ),
  },
};

/** Innensymbol bei standardmäßig 75 % der Kreisgröße (Icon-Set final,
 *  16.08.2026; pro Kind über `symbolScale` überschreibbar, z. B. die Uhr mit
 *  90 % seit Arbeitsanweisung 17.08.2026 Punkt 3). Das Symbol behält dieselbe
 *  Parität wie der Kreis, damit (Kreis − Symbol) durch 2 teilbar ist und das
 *  Symbol pixelgenau zentriert sitzt — z. B. 8px im 12px-Kompakt-Kreis statt
 *  gerundeter (schiefer) 9px. */
function symbolSize(circle: number, scale = 0.75): number {
  const raw = Math.round(circle * scale);
  return raw % 2 === circle % 2 ? raw : raw - 1;
}

export function StatusBadge({
  kind,
  label,
  className,
  compact = false,
  calendarCompact = false,
}: {
  kind: StatusBadgeKind;
  /** aria-label für Screenreader; ohne Angabe gilt das Badge als dekorativ. */
  label?: string;
  className?: string;
  /** Kompakt-Größe für die Smartphone-Pille (Arbeitsanweisung 3.2/3.3). */
  compact?: boolean;
  /** 13-px-Kreis für Statusabweichungen in der aufgeklappten Kalenderzelle
   *  (Arbeitsanweisung 17.08.2026, Folgeauftrag: 1px größer als zuvor, um den
   *  gleichzeitig verkleinerten Avatar auszugleichen). */
  calendarCompact?: boolean;
}) {
  const cfg = KIND_CONFIG[kind];
  const circle = calendarCompact ? 13 : compact ? cfg.compactCircle : cfg.circle;
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={`inline-flex shrink-0 items-center justify-center rounded-full${className ? ` ${className}` : ""}`}
      style={{
        width: circle,
        height: circle,
        backgroundColor: cfg.bg,
      }}
      data-status-badge={kind}
    >
      {cfg.symbol(symbolSize(circle, cfg.symbolScale))}
    </span>
  );
}
