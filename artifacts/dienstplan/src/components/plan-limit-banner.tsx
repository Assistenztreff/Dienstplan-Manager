// ---------------------------------------------------------------------------
// PlanLimitBanner — gemeinsamer Hinweis-Kasten fuer erreichte Free-Limits.
// ---------------------------------------------------------------------------
// Zeigt die uebergebene Erklaerung (z. B. "max. 6 Assistenten") und verlinkt
// direkt auf die Preise-/Upgrade-Seite, damit der Hinweis keine Sackgasse ist.
// Wird von assistenten.tsx, team-verwaltung.tsx, einstellungen.tsx und
// dienstplan.tsx genutzt.
import type { ReactNode } from "react";
import { Link } from "wouter";
import { Sparkles } from "lucide-react";

export function PlanLimitBanner({ children }: { children: ReactNode }) {
  return (
    <div
      className="rounded-md border border-brand-yellow/40 bg-brand-yellow/10 px-4 py-3 text-sm text-foreground flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
      data-testid="plan-limit-banner"
    >
      <span>{children}</span>
      <Link
        href="/preise"
        className="inline-flex items-center gap-1.5 font-medium text-foreground underline underline-offset-4 hover:no-underline whitespace-nowrap self-start sm:self-auto"
        data-testid="plan-limit-upgrade-link"
      >
        <Sparkles className="h-4 w-4" />
        Preise &amp; Premium ansehen
      </Link>
    </div>
  );
}
