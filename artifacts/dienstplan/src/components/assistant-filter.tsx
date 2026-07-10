import { useEffect, useState } from "react";
import { userBadgeClass, userInitialsClass } from "@/lib/shift-model-colors";

// Zwei-Buchstaben-Initialen (z. B. "CN" für "Camillo Neubert"): erste
// Buchstaben der ersten beiden Namensbestandteile, sonst die ersten zwei
// Zeichen des Namens.
function nameInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.trim().slice(0, 2).toUpperCase();
}

export type Assistant = { id: number; name: string };

// Seitenübergreifend geteilter Filter: Dienstplan, Zeiterfassung und Auswertungen
// merken sich denselben zuletzt gewählten Assistenten.
export const ASSISTANT_FILTER_KEY = "dienstplan.selectedAssistant";

function readStored(): number | "all" {
  try {
    const stored = localStorage.getItem(ASSISTANT_FILTER_KEY);
    if (stored === "all") return "all";
    if (stored != null) {
      const parsed = Number(stored);
      if (Number.isInteger(parsed)) return parsed;
    }
  } catch {
    // localStorage nicht verfügbar (z. B. privater Modus) — Fallback nutzen
  }
  return "all";
}

// Persistenter Assistenten-Filter mit localStorage.
// - `assistants`: aktuell sichtbare Assistenten (zur Bereinigung verschwundener Auswahl)
// - `ready`: true, sobald die Assistentenliste geladen ist (sonst fälschlich zurücksetzen)
export function useSelectedAssistant(
  assistants: Assistant[],
  ready: boolean,
): [number | "all", (value: number | "all") => void] {
  const [selected, setSelected] = useState<number | "all">(readStored);

  useEffect(() => {
    try {
      localStorage.setItem(ASSISTANT_FILTER_KEY, String(selected));
    } catch {
      // Schreiben fehlgeschlagen — Auswahl gilt nur für diese Sitzung
    }
  }, [selected]);

  useEffect(() => {
    if (selected === "all") return;
    if (!ready) return;
    if (!assistants.some((a) => a.id === selected)) {
      setSelected("all");
    }
  }, [selected, assistants, ready]);

  return [selected, setSelected];
}

export function AssistantFilter({
  assistants,
  selected,
  onSelect,
}: {
  assistants: Assistant[];
  selected: number | "all";
  onSelect: (val: number | "all") => void;
}) {
  return (
    /* Horizontale, platzsparende Legende: eine schmale Zeile, bei Überlauf
       seitlich wischbar (Scrollbalken ausgeblendet). */
    <div
      className="flex flex-row items-center gap-1.5 overflow-x-auto whitespace-nowrap py-1 -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      data-testid="assistant-filter"
    >
      <button
        type="button"
        data-testid="assistant-chip-all"
        data-active={selected === "all" ? "true" : "false"}
        onClick={() => onSelect("all")}
        className={`shrink-0 rounded-full border px-3 py-1 text-xs transition-colors ${
          selected === "all"
            ? "bg-primary text-primary-foreground border-primary"
            : "bg-card text-muted-foreground border-border"
        }`}
      >
        Alle
      </button>
      {assistants.map((a) => (
        <button
          key={a.id}
          type="button"
          data-testid={`assistant-chip-${a.id}`}
          data-active={selected === a.id ? "true" : "false"}
          onClick={() => onSelect(a.id)}
          className={`shrink-0 rounded-full border pl-1 pr-3 py-1 text-xs transition-colors inline-flex items-center gap-1.5 ${
            selected === a.id
              ? "bg-primary text-primary-foreground border-primary"
              : userBadgeClass(a.id)
          }`}
        >
          {/* Initialen-Kreis in der Personenfarbe (dunkler Ton, weiße Schrift
              für hohen Kontrast) — hilft, ähnliche Farbtöne zu unterscheiden,
              und dient als Legende zu den gleichfarbigen Dienst-Kacheln. */}
          <span
            aria-hidden="true"
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold leading-none ${userInitialsClass(a.id)}`}
          >
            {nameInitials(a.name)}
          </span>
          {a.name}
        </button>
      ))}
    </div>
  );
}
