import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import compression from "compression";
import cors from "cors";
import session, { type SessionData } from "express-session";
import ConnectPgSimple from "connect-pg-simple";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { recordPlatformError } from "./lib/platform-errors";
import { pool as dbPool } from "@workspace/db";

const PgStore = ConnectPgSimple(session);

// touch() aktualisiert bei jedem authentifizierten Request nur die
// expire-Spalte (Session-Verlaengerung) und ist damit die mit Abstand
// haeufigste Session-Store-Query. Ein neues Ablaufdatum weicht i.d.R. nur um
// Sekunden vom bisherigen ab (rollierendes 7-Tage-Cookie) -- ein UPDATE pro
// Request ist daher unnoetig. Wir drosseln pro sid in-process: ein echtes
// UPDATE erfolgt nur, wenn seit dem letzten UPDATE mehr als 1h vergangen ist.
// Bei mehreren API-Instanzen ist das je Instanz unabhaengig (kein Shared
// State) -- das fuehrt bestenfalls zu etwas haeufigeren, nie zu selteneren
// UPDATEs, es gibt also kein Korrektheitsrisiko fuer die Session-Lebensdauer.
const TOUCH_THROTTLE_MS = 60 * 60 * 1000;
const lastTouchedAt = new Map<string, number>();

class ThrottledPgStore extends PgStore {
  touch(
    sid: string,
    sessionData: SessionData,
    fn?: (err?: unknown) => void,
  ): void {
    const now = Date.now();
    const last = lastTouchedAt.get(sid);
    if (last !== undefined && now - last < TOUCH_THROTTLE_MS) {
      fn?.();
      return;
    }
    lastTouchedAt.set(sid, now);
    super.touch(sid, sessionData, fn);
  }

  destroy(sid: string, fn?: (err?: unknown) => void): void {
    lastTouchedAt.delete(sid);
    super.destroy(sid, fn);
  }
}

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

// Antworten (v.a. groessere JSON-Listen wie /shifts, /dashboard/summary)
// gzip-komprimieren; reduziert Uebertragungsgroesse und -zeit spuerbar bei
// langsamen/mobilen Verbindungen.
app.use(compression());

app.use(
  session({
    store: new ThrottledPgStore({
      // Gehaerteter, bereits konfigurierter Pool aus @workspace/db (min:2,
      // Keepalive, Timeouts, Error-Handler) statt eines eigenen,
      // unkonfigurierten Zweit-Pools nur fuer den Session-Store.
      pool: dbPool,
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
