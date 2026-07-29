import { createRoot } from "react-dom/client";
import { toast } from "sonner";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

/**
 * Zeigt einen dezenten Hinweis, dass eine neue App-Version bereitsteht.
 * Klick auf "Neu laden" aktiviert den wartenden Service Worker
 * (SKIP_WAITING-Message) und lädt die Seite neu, sobald er übernommen hat.
 */
function promptForUpdate(registration: ServiceWorkerRegistration) {
  const waiting = registration.waiting;
  if (!waiting) return;

  const reload = () => {
    // Erst neu laden, wenn der neue Worker wirklich die Kontrolle übernommen
    // hat — sonst liefert die alte Version noch die Antwort.
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    });
    waiting.postMessage({ type: "SKIP_WAITING" });
  };

  toast.info("Neue Version verfügbar", {
    id: "sw-update",
    duration: Infinity,
    description: "Eine aktualisierte Version der App steht bereit.",
    action: {
      label: "Neu laden",
      onClick: reload,
    },
  });
}

// PWA: Service Worker nur im Produktions-Build registrieren. Im Dev-Modus
// würde das App-Shell-Caching den Vite-HMR-Workflow stören.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        // Fall 1: Ein Update wartet bereits (z. B. Tab lange offen gewesen).
        if (registration.waiting && navigator.serviceWorker.controller) {
          promptForUpdate(registration);
        }

        // Fall 2: Ein Update wird während der Sitzung gefunden.
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            // "installed" + vorhandener Controller = neue Version wartet.
            // Ohne Controller ist es die Erstinstallation — kein Hinweis nötig.
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              promptForUpdate(registration);
            }
          });
        });
      })
      .catch(() => {
        // Registrierung darf die App nie blockieren (z. B. ältere Browser).
      });
  });
}
