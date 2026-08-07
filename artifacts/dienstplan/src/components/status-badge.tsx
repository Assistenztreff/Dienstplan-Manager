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
  | "warning"
  | "vertretung"
  | "clock";

const KIND_CONFIG: Record<
  StatusBadgeKind,
  { circle: number; compactCircle: number; bg: string; ring?: string; compactRing?: string; symbol: (s: number) => ReactElement }
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
  // Warnung: Kreis 17px #c23b34, weißes Dreieck 10px, Außenring
  warning: {
    circle: 17,
    compactCircle: 10,
    bg: "#c23b34",
    ring: "0 0 0 2px #fff, 0 0 0 3.5px #f3c9c5",
    compactRing: "0 0 0 1.2px #fff, 0 0 0 2px #f3c9c5",
    symbol: (s) => (
      <svg width={s} height={s} viewBox="0 0 20 20" fill="#fff" stroke="none" aria-hidden="true">
        <path d="M10 3L18 16.5H2z" />
      </svg>
    ),
  },
  // Vertretung: Kreis 15px #0f6e8c, weißes Rotations-Symbol 9px (stroke 2.4)
  vertretung: {
    circle: 15,
    compactCircle: 9,
    bg: "#0f6e8c",
    symbol: (s) => (
      <svg
        width={s}
        height={s}
        viewBox="0 0 20 20"
        fill="none"
        stroke="#fff"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M4 8a6 6 0 0110-4.2M16 12a6 6 0 01-10 4.2" />
      </svg>
    ),
  },
  // Uhr: Kreis 15px #444, weiße Uhr 9px (stroke 2)
  clock: {
    circle: 15,
    compactCircle: 9,
    bg: "#444444",
    symbol: (s) => (
      <svg
        width={s}
        height={s}
        viewBox="0 0 20 20"
        fill="none"
        stroke="#fff"
        strokeWidth={2}
        aria-hidden="true"
      >
        <circle cx="10" cy="10" r="7.2" />
        <path d="M10 6.3v4l2.8 1.8" />
      </svg>
    ),
  },
};

/** Innensymbol etwas über halber Kreisgröße (Vorlage: 9–10px in 15–17px,
 *  kompakt 5–6px in 9–10px wie badge-warn-sm der Smartphone-Vorlage). */
function symbolSize(circle: number, compact: boolean): number {
  return Math.round(circle * (compact ? 0.55 : 0.6));
}

export function StatusBadge({
  kind,
  label,
  className,
  compact = false,
}: {
  kind: StatusBadgeKind;
  /** aria-label für Screenreader; ohne Angabe gilt das Badge als dekorativ. */
  label?: string;
  className?: string;
  /** Kompakt-Größe für die Smartphone-Pille (Arbeitsanweisung 3.2/3.3). */
  compact?: boolean;
}) {
  const cfg = KIND_CONFIG[kind];
  const circle = compact ? cfg.compactCircle : cfg.circle;
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
        boxShadow: compact ? cfg.compactRing ?? cfg.ring : cfg.ring,
      }}
      data-status-badge={kind}
    >
      {cfg.symbol(symbolSize(circle, compact))}
    </span>
  );
}
