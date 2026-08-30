/**
 * Eine Gruppe der Einstellungsseite.
 *
 * Die Seite ist nach Tragweite geordnet: oben steht, was Stunden und Geld
 * bestimmt, unten das Kosmetische. Die beiden oberen Gruppen sind immer offen,
 * die beiden unteren klappen zu — bewusst nur auf GRUPPEN-Ebene, nicht je
 * Einstellung, damit man nicht durch ein Dutzend Aufklapper klicken muss.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const SPEICHER_PRAEFIX = "einstellungen:gruppe:";

/** Zuletzt gewaehlter Zustand dieser Gruppe; null, wenn nie umgeschaltet. */
function gemerkterZustand(id: string): boolean | null {
  try {
    const roh = window.localStorage.getItem(SPEICHER_PRAEFIX + id);
    if (roh === "offen") return true;
    if (roh === "zu") return false;
  } catch {
    // Privater Modus oder gesperrter Speicher: Voreinstellung genuegt.
  }
  return null;
}

function merkeZustand(id: string, offen: boolean) {
  try {
    window.localStorage.setItem(SPEICHER_PRAEFIX + id, offen ? "offen" : "zu");
  } catch {
    // Nicht schlimm — der Zustand gilt dann nur fuer diesen Seitenaufruf.
  }
}

function hashPasst(id: string, anker: readonly string[]): boolean {
  try {
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash) return false;
    return hash === id || anker.includes(hash);
  } catch {
    return false;
  }
}

export function EinstellungsGruppe({
  id,
  titel,
  beschreibung,
  inhaltsangabe,
  einklappbar = false,
  anker = [],
  children,
}: {
  /** Anker-Id der Gruppe, z. B. "abrechnungsgrundlagen". */
  id: string;
  titel: string;
  /** Ein Satz dazu, wofuer diese Gruppe zustaendig ist. */
  beschreibung: string;
  /** Was drinsteckt — im zugeklappten Zustand die einzige Orientierung. */
  inhaltsangabe?: string;
  einklappbar?: boolean;
  /** Weitere Hash-Ziele, die diese Gruppe aufklappen sollen. */
  anker?: readonly string[];
  children: ReactNode;
}) {
  const [offen, setOffen] = useState(() => {
    if (!einklappbar) return true;
    if (hashPasst(id, anker)) return true;
    return gemerkterZustand(id) ?? false;
  });

  // Sprung aus einer anderen Seite (z. B. "/einstellungen#stundenbudget"):
  // die Zielgruppe muss sich oeffnen, sonst landet man auf einer Seite, auf
  // der das Gesuchte gar nicht zu sehen ist.
  // Der Schluessel statt des Arrays in der Abhaengigkeitsliste: die Aufrufer
  // uebergeben ein Literal, das bei jedem Rendern neu entsteht — sonst haengte
  // sich der Zuhoerer bei jedem Rendern neu ein.
  const ankerSchluessel = anker.join(",");
  useEffect(() => {
    if (!einklappbar) return;
    const aufHash = () => {
      if (hashPasst(id, ankerSchluessel.split(",").filter(Boolean))) setOffen(true);
    };
    window.addEventListener("hashchange", aufHash);
    return () => window.removeEventListener("hashchange", aufHash);
  }, [id, ankerSchluessel, einklappbar]);

  const umschalten = useCallback(() => {
    setOffen((vorher) => {
      merkeZustand(id, !vorher);
      return !vorher;
    });
  }, [id]);

  const kopf = (
    <div className="min-w-0 flex-1 text-left">
      <h2 className="font-serif text-lg font-bold text-foreground">{titel}</h2>
      <p className="text-xs text-muted-foreground mt-1">{beschreibung}</p>
      {einklappbar && !offen && inhaltsangabe && (
        <p className="text-xs text-muted-foreground/80 mt-1.5">{inhaltsangabe}</p>
      )}
    </div>
  );

  // Immer offene Gruppen (1 und 2) tragen ihre Felder direkt in derselben
  // Karte — eine eigene Kopf-Karte darueber waere reines Rahmenwerk. Bei den
  // einklappbaren Gruppen ist die Kopfzeile die Karte, und die enthaltenen
  // Karten stehen darunter.
  if (!einklappbar) {
    return (
      <section id={id} className="scroll-mt-4" data-testid={`einstellungsgruppe-${id}`}>
        <Card className="border-border/50 shadow-sm">
          <CardContent className="p-4 space-y-4">
            {kopf}
            <div className="border-t border-border/60 pt-4">{children}</div>
          </CardContent>
        </Card>
      </section>
    );
  }

  return (
    <section id={id} className="scroll-mt-4 space-y-3" data-testid={`einstellungsgruppe-${id}`}>
      <Card className="border-border/50 shadow-sm">
        <CardContent className="p-4">
          <button
            type="button"
            onClick={umschalten}
            aria-expanded={offen}
            aria-controls={`${id}-inhalt`}
            data-testid={`gruppe-schalter-${id}`}
            className="flex w-full items-start gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {kopf}
            <ChevronDown
              className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200 ${
                offen ? "rotate-180" : ""
              }`}
              aria-hidden="true"
            />
          </button>
        </CardContent>
      </Card>

      {offen && (
        <div id={`${id}-inhalt`} className="space-y-4">
          {children}
        </div>
      )}
    </section>
  );
}
