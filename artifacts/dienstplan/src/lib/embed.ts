const STORAGE_KEY = "dienstplan_embed";

// Erkennt den Einbettungs-Modus (iframe in der Plattform unter "Connect").
// Aktivierung explizit über ?embed=1 in der iframe-URL; die Auswahl wird in
// sessionStorage gemerkt, damit sie clientseitige Navigationswechsel innerhalb
// des iframes überdauert. Bewusst KEINE Auto-Erkennung via window.top, damit
// die normale Vorschau (die ebenfalls in einem iframe läuft) das App-Chrome
// nicht versehentlich ausblendet.
export function isEmbedded(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("embed") === "1") {
      try {
        window.sessionStorage.setItem(STORAGE_KEY, "1");
      } catch {
        /* sessionStorage nicht verfügbar -> ignorieren */
      }
      return true;
    }
    try {
      return window.sessionStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}
