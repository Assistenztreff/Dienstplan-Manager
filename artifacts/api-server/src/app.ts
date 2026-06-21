import express, { type Express } from "express";
import cors from "cors";
import session from "express-session";
import ConnectPgSimple from "connect-pg-simple";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const PgStore = ConnectPgSimple(session);

// Wenn die App in einem fremden Origin (z. B. als iframe in der
// Assistenztreff-Plattform) eingebettet wird, ist der Kontext "cross-site".
// Ein SameSite=Lax-Cookie wird dann vom Browser NICHT mitgesendet -> Login
// würde im iframe stillschweigend fehlschlagen. In diesem Fall muss das
// Session-Cookie SameSite=None; Secure sein (Secure setzt HTTPS voraus).
// Standardmäßig in Produktion aktiv; per SESSION_COOKIE_CROSS_SITE=1 auch in
// anderen Umgebungen erzwingbar (z. B. zum Testen gegen ein Deployment).
const crossSiteCookie =
  process.env.NODE_ENV === "production" ||
  process.env.SESSION_COOKIE_CROSS_SITE === "1";

// Explizite Allowlist erlaubter Cross-Origin-Aufrufer (z. B. eine separat
// gehostete Mobile-Web-App). Im Normalfall LEER: Frontend und API laufen unter
// derselben Origin (SPA -> /api same-origin, auch innerhalb des iframes), CORS
// wird dann gar nicht benötigt. Format: kommagetrennte Origins.
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

// CORS streng: KEIN reflektierendes credentialed CORS. Da das Session-Cookie
// cross-site (SameSite=None) gesendet wird, würde reflektierendes CORS jeder
// fremden Origin erlauben, authentifizierte Antworten auszulesen. Erlaubt sind
// daher nur: kein Origin-Header (same-origin/native/curl) und explizit
// gelistete Origins. In Dev (Lax-Cookie) bleibt es bequem permissiv.
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      if (!crossSiteCookie) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
  }),
);

app.use(
  session({
    store: new PgStore({
      conString: process.env.DATABASE_URL,
      tableName: "session",
      pruneSessionInterval: 60 * 60,
    }),
    secret: process.env.SESSION_SECRET ?? "dev-secret-change-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: crossSiteCookie ? "none" : "lax",
      secure: crossSiteCookie,
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

export default app;
