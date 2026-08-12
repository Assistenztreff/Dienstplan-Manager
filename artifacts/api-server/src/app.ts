import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import path from "path";
import cors from "cors";
import session from "express-session";
import ConnectPgSimple from "connect-pg-simple";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { recordPlatformError } from "./lib/platform-errors";

const PgStore = ConnectPgSimple(session);

// Standalone-Betrieb (First-Party unter dienstplan.assistenztreff.de bzw. der
// Replit-Deploy-Domain): Das Session-Cookie ist immer SameSite=Lax; in
// Produktion zusätzlich Secure (HTTPS via Proxy, siehe trust proxy).
const isProduction = process.env.NODE_ENV === "production";

// Explizite Allowlist erlaubter Cross-Origin-Aufrufer (z. B. eine separat
// gehostete Mobile-Web-App). Im Normalfall LEER: Frontend und API laufen unter
// derselben Origin (SPA -> /api same-origin), CORS wird dann gar nicht
// benötigt. Format: kommagetrennte Origins.
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

function hostnameOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

const app: Express = express();

app.set("trust proxy", 1);

// CORS streng: KEIN reflektierendes credentialed CORS. Erlaubt sind nur:
// kein Origin-Header (same-origin/native/curl) und explizit gelistete
// Origins. In Dev bleibt es bequem permissiv. Das SameSite=Lax-Cookie
// schützt zusätzlich vor Cross-Site-Requests mit Credentials.
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      if (!isProduction) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
  }),
);

app.use(
  session({
    store: new PgStore({
      // @workspace/db (frueher importiert) schreibt die via resolveDatabaseUrl
      // aufgeloeste URL (APP_DATABASE_URL-Override) nach process.env zurueck.
      conString: process.env.DATABASE_URL,
      tableName: "session",
      pruneSessionInterval: 60 * 60,
    }),
    secret: process.env.SESSION_SECRET ?? "dev-secret-change-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  }),
);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CSRF-Schutz per Origin-/Referer-Abgleich. SameSite=None schaltet den
// SameSite-CSRF-Schutz ab; zustandsändernde Requests werden daher auf
// vertrauenswürdige Herkünfte beschränkt: gleiche Origin (Browser sendet
// Origin auf allen POST/PATCH/DELETE) oder explizit gelistete Origin. Fehlt
// jeder Herkunfts-Header (native Mobile-App, Server-zu-Server, curl), ist es
// kein Browser-CSRF-Vektor und wird durchgelassen.
app.use("/api", (req, res, next) => {
  const isSafe =
    req.method === "GET" ||
    req.method === "HEAD" ||
    req.method === "OPTIONS";
  if (isSafe) return next();

  const sourceHostname = hostnameOf(
    (req.headers.origin as string | undefined) ??
      (req.headers.referer as string | undefined),
  );
  if (sourceHostname === null) return next();

  const trusted =
    sourceHostname === req.hostname ||
    allowedOrigins.some((o) => hostnameOf(o) === sourceHostname);
  if (!trusted) {
    res.status(403).json({ error: "Ungültige Anfrageherkunft" });
    return;
  }
  next();
});

app.use("/api", router);

// ---------------------------------------------------------------------------
// Production SPA-Auslieferung: Alle Nicht-API-Pfade liefern das Vite-Build.
// So funktionieren direkte Links (z. B. /passwort-zuruecksetzen?token=...)
// zuverlässig, ohne auf den eingebauten Static-Handler von Replit angewiesen
// zu sein.
// ---------------------------------------------------------------------------
if (isProduction) {
  const frontendDir = path.resolve("artifacts/dienstplan/dist/public");
  // Statische Assets (JS, CSS, Bilder) zuerst — ohne index.html-Fallback.
  app.use(express.static(frontendDir, { index: false }));
  // Catch-all: jeder unbekannte GET-Pfad liefert die SPA-Shell.
  app.get("*", (_req, res) => {
    res.sendFile(path.join(frontendDir, "index.html"));
  });
}

// ---------------------------------------------------------------------------
// Zentraler Error-Handler: JEDER unbehandelte Fehler (Express 5 leitet auch
// abgelehnte Promises aus async-Handlern hierher) wird einheitlich geloggt,
// als 500-JSON beantwortet und im Fehler-Tracking (platform_errors)
// persistiert — inkl. gedrosselter Warn-E-Mail an den Betreiber. Die
// Erfassung laeuft fire-and-forget und wirft nie, damit die Antwort an den
// Client nie am Tracking scheitert.
// ---------------------------------------------------------------------------
app.use(
  (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    const message = err instanceof Error ? err.message : String(err);
    const context = `${req.method} ${req.originalUrl?.split("?")[0] ?? req.path}`;
    (req.log ?? logger).error({ err }, "Unbehandelter Serverfehler");
    void recordPlatformError({
      level: "error",
      message,
      context,
      stack: err instanceof Error ? err.stack : undefined,
    });
    if (!res.headersSent) {
      res.status(500).json({ error: "Interner Serverfehler" });
    }
  },
);

export default app;
