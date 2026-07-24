import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

// PWA: Service Worker nur im Produktions-Build registrieren. Im Dev-Modus
// würde das App-Shell-Caching den Vite-HMR-Workflow stören.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Registrierung darf die App nie blockieren (z. B. ältere Browser).
    });
  });
}
