import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Nur für den isolierten E2E-Test-Stack gesetzt: leitet /api an den
// Test-API-Server (eigene Test-Datenbank) weiter. Im normalen Dev-Betrieb
// unbenutzt -> der geteilte Replit-Proxy übernimmt das Routing.
const e2eApiProxyTarget = process.env.E2E_API_PROXY_TARGET;

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  // jspdf/jspdf-autotable werden erst beim PDF-Export dynamisch importiert.
  // Ohne Pre-Bundling optimiert Vite sie im Dev-Server beim ersten Export
  // on-demand und löst dabei einen Full-Reload aus, der den laufenden Export
  // (doc.save) abbricht. Vorab einschließen -> Export funktioniert sofort.
  optimizeDeps: {
    include: ["jspdf", "jspdf-autotable", "jszip"],
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
    ...(e2eApiProxyTarget
      ? {
          proxy: {
            "/api": { target: e2eApiProxyTarget, changeOrigin: true },
          },
        }
      : {}),
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    // Gleiche /api-Weiterleitung wie im Dev-Server, aber für den Prod-Build
    // (`vite preview`). Genutzt vom E2E-Spec, das den Produktions-Modus prüft
    // (dienstplan-prod-dev-switcher-hidden.spec.ts). Der Header täuscht dem
    // API-Server (trust proxy) HTTPS vor, damit das in Produktion `Secure`
    // gesetzte Session-Cookie auch über den lokalen HTTP-Preview-Proxy gesetzt
    // wird (Chromium akzeptiert Secure-Cookies auf localhost).
    ...(e2eApiProxyTarget
      ? {
          proxy: {
            "/api": {
              target: e2eApiProxyTarget,
              changeOrigin: true,
              headers: { "X-Forwarded-Proto": "https" },
            },
          },
        }
      : {}),
  },
});
