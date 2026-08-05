/**
 * Hook zum Lesen und Setzen der aktiven Assistenzkraft-Farbpalette.
 * Die Einstellung wird in localStorage gespeichert und über ein Custom-Event
 * zwischen Tabs/Komponenten synchronisiert – kein Backend-Roundtrip nötig.
 *
 * Werte:
 *   "light" → 7.1 Helle Palette (schwarzer Text)
 *   "dark"  → 7.2 Dunkle Palette Golden-Winkel (weißer Text)
 */

import { useEffect, useState, useCallback } from "react";
import type { AssistantPaletteId } from "@/lib/barrierefreie-farben";

const STORAGE_KEY = "at_assistant_palette";
const CHANGE_EVENT = "at:palette-changed";

function readPalette(): AssistantPaletteId {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark") return raw;
  } catch {
    // SSR / privacy mode
  }
  return "light";
}

function writePalette(palette: AssistantPaletteId): void {
  try {
    localStorage.setItem(STORAGE_KEY, palette);
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: palette }));
  } catch {
    // ignore
  }
}

export function useAssistantPalette(): [AssistantPaletteId, (p: AssistantPaletteId) => void] {
  const [palette, setPalette] = useState<AssistantPaletteId>(readPalette);

  useEffect(() => {
    const handler = (e: Event) => {
      const ev = e as CustomEvent<AssistantPaletteId>;
      setPalette(ev.detail);
    };
    window.addEventListener(CHANGE_EVENT, handler);
    return () => window.removeEventListener(CHANGE_EVENT, handler);
  }, []);

  const set = useCallback((p: AssistantPaletteId) => {
    writePalette(p);
    setPalette(p);
  }, []);

  return [palette, set];
}
