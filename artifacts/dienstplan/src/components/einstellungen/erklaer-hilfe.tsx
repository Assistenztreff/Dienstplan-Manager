/**
 * Erklärung auf Abruf.
 *
 * Vorher stand unter jeder Einstellung ein zwei- bis dreizeiliger Erklärtext.
 * Bei rund siebzehn Einstellungen waren das über vierzig Zeilen Fließtext, die
 * dauerhaft Platz belegten — die Erklärungen machten die Seite lang, nicht die
 * Schalter. Assistenz Connect zeigt in der Anwendung nur den Namen der
 * Einstellung; die Erklärung lebt im Handbuch.
 *
 * Dieses Muster hier liegt dazwischen: sichtbar bleiben Name, Wert und
 * Bedienelement. Die Erklärung steckt hinter einem Fragezeichen daneben und
 * verweist von dort ins passende Handbuch-Kapitel.
 *
 * NICHT hierfür gedacht sind rechtlich relevante Warnungen (etwa die
 * Sozialversicherungspflicht bei Zuschlägen auf Urlaubs- und Kranktage). Die
 * bleiben als sichtbarer Hinweiskasten stehen — was man wegklicken muss, hat
 * man nicht gelesen.
 */
import { HelpCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ReactNode } from "react";

/** Kapitel-Anker im Handbuch unter /handbuch/einstellungen. */
export type HandbuchAnker =
  | "zuschlaege"
  | "pausen"
  | "weitere-schalter"
  | "schichtmodelle"
  | "profil"
  | "kalender-abo"
  | "firmenlogo"
  | "assistenzkraft-farben";

export function ErklaerHilfe({
  titel,
  anker,
  children,
}: {
  /** Name der Einstellung — nur für die Vorlesehilfe, nicht sichtbar. */
  titel: string;
  anker?: HandbuchAnker;
  children: ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Erklärung zu „${titel}“`}
          data-testid={`erklaerung-${titel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <HelpCircle className="h-4 w-4" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-2 text-xs leading-relaxed">
        <div className="space-y-2 text-muted-foreground">{children}</div>
        {anker && (
          <a
            href={`/handbuch/einstellungen#${anker}`}
            className="inline-block font-medium text-foreground underline underline-offset-2"
          >
            Im Handbuch nachlesen
          </a>
        )}
      </PopoverContent>
    </Popover>
  );
}
