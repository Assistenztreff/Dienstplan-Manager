import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

export type AuthUser = {
  id: number;
  name: string;
  email: string;
  role: "admin" | "assistant" | "superadmin" | "koordinator";
  accountType: "privat" | "dienstleister";
  /** SaaS-Abo-Stufe. "free" = abgespeckte Gratis-Version, "premium" = voller Funktionsumfang. */
  plan: "free" | "premium";
  /**
   * true wenn der Nutzer in mindestens einem Team als Teamleiter eingetragen ist.
   * Wird vom Server mitgeliefert; undefined = alter Token vor dem Feature-Release.
   */
  isTeamleiter?: boolean;
  /**
   * true wenn der Nutzer in mindestens einem Teamleiter-Team auch canViewPayroll=true hat.
   * Globales Flag; feingranulare Team-Prüfung erfolgt serverseitig.
   */
  canViewPayroll?: boolean;
  /**
   * Höchste gestufte Team-Freischaltung über alle Mitgliedschaften hinweg
   * ("keine" | "basis" | "stufe1" | "stufe2"). Steuert nur die Sichtbarkeit
   * von Menüpunkten — die Durchsetzung passiert pro Team serverseitig.
   */
  teamAccessLevel?: TeamAccessLevel;
};

/** Stufen der Team-Freischaltung, aufsteigend. */
export const TEAM_ACCESS_LEVELS = ["keine", "basis", "stufe1", "stufe2"] as const;
export type TeamAccessLevel = (typeof TEAM_ACCESS_LEVELS)[number];

/** Prüft, ob die Freischaltung des Nutzers mindestens die geforderte Stufe erreicht. */
export function hasTeamAccessLevel(
  user: { teamAccessLevel?: TeamAccessLevel } | null | undefined,
  min: TeamAccessLevel,
): boolean {
  const rank = (l: TeamAccessLevel | undefined) =>
    TEAM_ACCESS_LEVELS.indexOf(l ?? "keine");
  return rank(user?.teamAccessLevel) >= rank(min);
}

type AuthContextType = {
  currentUser: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: {
    name: string;
    email: string;
    password: string;
    accountType: "privat" | "dienstleister";
  }) => Promise<{ emailVerificationSent: boolean; emailDeliveryFailed?: boolean }>;
  logout: () => Promise<void>;
  setPassword: (token: string, password: string) => Promise<AuthUser>;
  refreshUser: () => Promise<void>;
  forgotPassword: (email: string) => Promise<void>;
  resetPassword: (token: string, password: string) => Promise<void>;
  resendVerification: (email: string) => Promise<{ emailDeliveryFailed?: boolean }>;
  /** Dev-only: vorhandene Test-Nutzer zum Umschalten auflisten. Leer in Produktion. */
  devListUsers: () => Promise<AuthUser[]>;
  /** Dev-only: als anderer vorhandener Test-Nutzer agieren. No-op in Produktion. */
  devSwitchUser: (userId: number) => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  currentUser: null,
  isLoading: true,
  login: async () => {},
  register: async () => ({ emailVerificationSent: false }),
  logout: async () => {},
  setPassword: async () => { throw new Error("not initialized"); },
  refreshUser: async () => {},
  forgotPassword: async () => {},
  resetPassword: async () => {},
  resendVerification: async () => ({}),
  devListUsers: async () => [],
  devSwitchUser: async () => {},
});

async function apiFetch(path: string, init?: RequestInit) {
  const res = await fetch(path, { credentials: "same-origin", ...init });
  return res;
}

// Defensive Aufbereitung von `error`-Strings aus Auth-Antworten: HTML-/XML-
// artige oder überlange Texte (z. B. Fragmente der Plattform-Wartungsseite)
// dürfen nie roh im UI landen — stattdessen den generischen Fallback zeigen.
function safeErrorText(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const text = value.trim();
  if (!text || text.startsWith("<") || text.length > 300) return fallback;
  return text;
}

// Dev-only Session-Cache. Speichert NUR das nicht-sensible Nutzerprofil
// (id/name/email/role) zur sofortigen UI-Hydration nach Reload — KEINE
// Passwörter oder Tokens. Die echte Authentifizierung bleibt die serverseitige
// httpOnly-Session (Cookie `connect.sid`). `import.meta.env.DEV` wird beim
// Production-Build statisch entfernt, der Bypass existiert dort also gar nicht.
const SESSION_KEY = "assistenz_treff_session";

// Session-Snapshot (Anzeigedaten, KEINE Berechtigung): Das zuletzt bekannte
// Nutzerprofil wird lokal gespeichert, damit die App beim nächsten Aufruf
// SOFORT rendert, statt hinter einem Vollbild-Spinner auf /auth/me zu warten.
// Sicherheit: Der Snapshot gewährt nichts — jede API-Anfrage wird serverseitig
// über das Session-Cookie geprüft; ist die Session tot, greifen 401-Resync
// bzw. bootstrap() und leeren den Zustand (→ Login-Seite). Eine im Hintergrund
// erkannte andere Nutzer-ID meldet applyUser an den Kontowechsel-Handler,
// der alle zwischengespeicherten Daten verwirft.
function readStoredSession(): AuthUser | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthUser>;
    if (
      parsed &&
      typeof parsed.id === "number" &&
      typeof parsed.name === "string" &&
      typeof parsed.email === "string" &&
      (parsed.role === "admin" ||
        parsed.role === "assistant" ||
        parsed.role === "superadmin" ||
        parsed.role === "koordinator") &&
      (parsed.accountType === "privat" || parsed.accountType === "dienstleister") &&
      (parsed.plan === "free" || parsed.plan === "premium")
    ) {
      return parsed as AuthUser;
    }
    return null;
  } catch {
    return null;
  }
}

function storeSession(user: AuthUser | null): void {
  try {
    if (user) localStorage.setItem(SESSION_KEY, JSON.stringify(user));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // localStorage nicht verfügbar (z. B. privater Modus) — ignorieren
  }
}

/**
 * Nutzer-ID des gespeicherten Session-Snapshots (oder null). Wird vom
 * persistierten Query-Cache (App.tsx) als Cache-Eigentümer-Kennung genutzt:
 * Ein unter anderer ID gespeicherter Cache wird beim Start verworfen.
 */
export function storedSessionUserId(): number | null {
  return readStoredSession()?.id ?? null;
}

// Globaler Hook für die Selbstheilung bei toten Sessions: Wenn eine beliebige
// API-Abfrage mit 401 scheitert (z. B. weil die serverseitige Session nach
// einem Datenbank-Reset nicht mehr existiert, das Cookie im Browser aber
// noch), stößt der QueryClient hierüber eine erneute Authentifizierung an
// (me → Dev-Login → sonst Logout). Single-flight: parallele 401s lösen nur
// einen Durchlauf aus.
let resyncAuthHandler: (() => Promise<boolean>) | null = null;

/** Liefert `null`, wenn gerade kein Auth-Kontext montiert ist (z. B. kurzer
 *  Remount) — dann darf der Aufrufer keinen Cooldown starten. */
export function resyncAuthAfter401(): Promise<boolean> | null {
  return resyncAuthHandler ? resyncAuthHandler() : null;
}

// Kontowechsel-Erkennung: Wird im selben Browser ein anderes Konto angemeldet
// (z. B. weil der Inhaber den Einladungslink einer Assistenzkraft/Koordinatorin
// selbst geöffnet hat oder im Dev-Modus der Nutzer-Umschalter benutzt wurde),
// liefert /auth/me plötzlich eine andere Nutzer-ID. Der hier registrierte
// Handler (App.tsx) verwirft dann alle zwischengespeicherten Daten, damit
// keine veraltete Ansicht des vorherigen Kontos stehen bleibt.
let userSwitchHandler: ((next: AuthUser) => void) | null = null;

/** Registriert den globalen Kontowechsel-Handler. Liefert eine Abmeldefunktion. */
export function registerUserSwitchHandler(handler: (next: AuthUser) => void): () => void {
  userSwitchHandler = handler;
  return () => {
    if (userSwitchHandler === handler) userSwitchHandler = null;
  };
}

// Abmelde-Handler: Wird ein angemeldeter Nutzer zu null (Logout, tote
// Session), müssen In-Memory- UND persistierter Query-Cache geleert werden —
// gerade auf geteilten Geräten dürfen die zuletzt gesehenen Daten den
// nächsten Anmeldenden nicht erreichen.
let signOutHandler: (() => void) | null = null;

/** Registriert den globalen Abmelde-Handler. Liefert eine Abmeldefunktion. */
export function registerSignOutHandler(handler: () => void): () => void {
  signOutHandler = handler;
  return () => {
    if (signOutHandler === handler) signOutHandler = null;
  };
}

/** Mindestabstand zwischen zwei Session-Frischeprüfungen beim Tab-Fokus. */
const SESSION_RECHECK_MIN_INTERVAL_MS = 10_000;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(() => readStoredSession());
  // Mit Session-Snapshot rendert die App SOFORT (Stale-While-Revalidate):
  // Der Vollbild-Spinner erscheint nur noch beim allerersten Besuch bzw. nach
  // Logout; bootstrap() verifiziert die Session parallel im Hintergrund.
  const [isLoading, setIsLoading] = useState(currentUser === null);

  // ID des zuletzt angewendeten Nutzers — Grundlage der Kontowechsel-Erkennung.
  const lastUserIdRef = useRef<number | null>(currentUser?.id ?? null);
  // Auth-Epoche: wird bei JEDER Zustandsanwendung erhöht. Frischeprüfungen
  // (/auth/me aus Bootstrap, Fokus-Check, 401/403-Resync) merken sich die
  // Epoche vor ihrem Request und wenden ihre Antwort nur an, wenn sich die
  // Epoche nicht geändert hat. So kann eine verspätet eintreffende Antwort
  // (noch unter dem alten Cookie gestartet) nie eine neuere Identität
  // überschreiben und die veraltete Inhaber-Ansicht wiederherstellen.
  const authEpochRef = useRef(0);

  /**
   * Zentraler Setter für den Auth-Zustand: aktualisiert State + Dev-Cache und
   * meldet einen Kontowechsel (andere Nutzer-ID als zuvor) an den global
   * registrierten Handler, damit die App veraltete Daten verwerfen kann.
   * Erhöht die Auth-Epoche und invalidiert damit alle noch laufenden
   * Frischeprüfungen.
   */
  const applyUser = useCallback((user: AuthUser | null) => {
    authEpochRef.current += 1;
    const prevId = lastUserIdRef.current;
    lastUserIdRef.current = user?.id ?? null;
    setCurrentUser((prev) => {
      // Unverändertes Profil nicht neu setzen — vermeidet Re-Render bei jeder
      // Fokus-Frischeprüfung.
      if (prev && user && JSON.stringify(prev) === JSON.stringify(user)) return prev;
      return user;
    });
    storeSession(user);
    // Kontowechsel AUCH beim ersten Bootstrap melden: Der Session-Snapshot
    // (und der persistierte Query-Cache) können zu Nutzer A gehören, während
    // das Cookie inzwischen Nutzer B angehört — dann müssen alle
    // zwischengespeicherten Daten sofort verworfen werden.
    if (prevId != null && user != null && user.id !== prevId) {
      userSwitchHandler?.(user);
    }
    // Abmeldung (angemeldet → null): Caches leeren, siehe registerSignOutHandler.
    if (prevId != null && user == null) {
      signOutHandler?.();
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Single-flight für ALLE Frischeprüfungen (Bootstrap-Resync UND
    // Fokus-Check): Es läuft immer höchstens ein /auth/me-Abgleich. Damit
    // können sich zwei Abgleiche nie gegenseitig überholen und in falscher
    // Reihenfolge anwenden.
    let inflight: Promise<boolean> | null = null;

    // Versucht, eine gültige Session herzustellen: erst /auth/me, im Dev-Modus
    // notfalls per Dev-Login. Liefert true, wenn danach ein Nutzer angemeldet
    // ist. Bei endgültigem Scheitern wird der lokale Zustand geleert, sodass
    // die App auf die Login-Seite wechselt statt endlos 401s zu produzieren.
    // Epoch-Guard: Antworten werden nur angewendet, wenn zwischenzeitlich
    // keine andere Zustandsanwendung passiert ist (z. B. expliziter Login).
    async function bootstrap(): Promise<boolean> {
      const epoch = authEpochRef.current;
      const stillCurrent = () => !cancelled && authEpochRef.current === epoch;
      try {
        const meRes = await apiFetch("/api/auth/me");
        if (meRes.ok) {
          const user = (await meRes.json()) as AuthUser;
          if (stillCurrent()) applyUser(user);
          return true;
        }

        if (import.meta.env.DEV) {
          const devRes = await apiFetch("/api/auth/dev-login", { method: "POST" });
          if (devRes.ok) {
            const user = (await devRes.json()) as AuthUser;
            if (stillCurrent()) applyUser(user);
            return true;
          }
        }

        if (stillCurrent()) applyUser(null);
        return false;
      } catch (error) {
        // Netzwerkfehler (TypeError bei fetch) bedeuten, dass der Nutzer offline
        // ist oder der Server vorübergehend nicht erreichbar ist — in diesem Fall
        // den angemeldeten Zustand NICHT leeren. Stattdessen bleibt der zuletzt
        // bekannte Nutzer gesetzt und das OfflineBanner zeigt den Hinweis.
        // Nur bei einem 4xx/5xx (kein TypeError) wird der Zustand geleert.
        const isNetworkError = error instanceof TypeError;
        if (!isNetworkError && !cancelled && authEpochRef.current === epoch) applyUser(null);
        return false;
      }
    }

    resyncAuthHandler = () => {
      if (!inflight) {
        inflight = bootstrap().finally(() => {
          inflight = null;
        });
      }
      return inflight;
    };

    // Kontowechsel-Frischeprüfung: Wird der Tab wieder sichtbar/fokussiert
    // (z. B. nachdem in einem anderen Tab ein Einladungslink geöffnet und
    // damit ein anderes Konto angemeldet wurde), prüfen wir /auth/me erneut.
    // Eine geänderte Nutzer-ID meldet applyUser an den Kontowechsel-Handler.
    // Sanfter als bootstrap(): Nur eine 200-Antwort wird angewendet — 401
    // überlässt der bestehenden Selbstheilung, transiente 5xx loggen nicht aus.
    let lastCheckAt = 0;
    const check = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (inflight || now - lastCheckAt < SESSION_RECHECK_MIN_INTERVAL_MS) return;
      lastCheckAt = now;
      inflight = (async () => {
        const epoch = authEpochRef.current;
        try {
          const r = await apiFetch("/api/auth/me");
          if (r.ok) {
            const user = (await r.json()) as AuthUser;
            if (!cancelled && authEpochRef.current === epoch) applyUser(user);
            return true;
          }
          return false;
        } catch {
          // Offline/Netzwerkfehler: Zustand unangetastet lassen.
          return false;
        }
      })().finally(() => {
        inflight = null;
      });
    };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);

    bootstrap().finally(() => {
      if (!cancelled) {
        setIsLoading(false);
      }
    });
    return () => {
      cancelled = true;
      resyncAuthHandler = null;
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [applyUser]);

  const login = async (email: string, password: string) => {
    const r = await apiFetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({})) as { error?: string; code?: string };
      throw Object.assign(
        new Error(safeErrorText(data.error, "Anmeldung fehlgeschlagen")),
        { status: r.status, code: data.code },
      );
    }
    const user = (await r.json()) as AuthUser;
    applyUser(user);
  };

  const register = async (input: {
    name: string;
    email: string;
    password: string;
    accountType: "privat" | "dienstleister";
  }): Promise<{ emailVerificationSent: boolean; emailDeliveryFailed?: boolean }> => {
    const r = await apiFetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!r.ok) {
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      const err = new Error(safeErrorText(data.error, "Registrierung fehlgeschlagen")) as Error & {
        status?: number;
        retryAfterSeconds?: number;
      };
      err.status = r.status;
      // 429 (Rate-Limit, Task #553): Wartezeit aus dem Retry-After-Header
      // mitgeben, damit die Registrierungsseite sie verständlich anzeigen kann.
      const retryAfter = Number(r.headers.get("Retry-After"));
      if (Number.isFinite(retryAfter) && retryAfter > 0) {
        err.retryAfterSeconds = retryAfter;
      }
      throw err;
    }
    const data = (await r.json()) as AuthUser & {
      emailVerificationSent?: boolean;
      emailDeliveryFailed?: boolean;
    };
    if (!data.emailVerificationSent) {
      applyUser(data);
    }
    return {
      emailVerificationSent: !!data.emailVerificationSent,
      ...(data.emailDeliveryFailed ? { emailDeliveryFailed: true } : {}),
    };
  };

  const forgotPassword = async (email: string): Promise<void> => {
    const r = await apiFetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({})) as { error?: string };
      const err = new Error(safeErrorText(data.error, "Fehler beim Anfordern des Reset-Links")) as Error & {
        status?: number;
        retryAfterSeconds?: number;
      };
      err.status = r.status;
      if (r.status === 429) {
        const retryAfter = Number(r.headers.get("Retry-After"));
        if (Number.isFinite(retryAfter) && retryAfter > 0) {
          err.retryAfterSeconds = retryAfter;
        }
      }
      throw err;
    }
  };

  const resetPassword = async (token: string, password: string): Promise<void> => {
    const r = await apiFetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({})) as { error?: string };
      throw new Error(safeErrorText(data.error, "Fehler beim Zurücksetzen des Passworts"));
    }
  };

  const resendVerification = async (email: string): Promise<{ emailDeliveryFailed?: boolean }> => {
    const r = await apiFetch("/api/auth/resend-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({})) as { error?: string };
      const err = new Error(safeErrorText(data.error, "Fehler beim Senden der Bestätigungsmail")) as Error & {
        status?: number;
        retryAfterSeconds?: number;
      };
      err.status = r.status;
      if (r.status === 429) {
        const retryAfter = Number(r.headers.get("Retry-After"));
        if (Number.isFinite(retryAfter) && retryAfter > 0) {
          err.retryAfterSeconds = retryAfter;
        }
      }
      throw err;
    }
    // Zustellfehler-Flag aus der Antwort auslesen (kein Orakel: fehlt bei
    // nicht-existierenden E-Mail-Adressen, gesetzt nur wenn wirklich versucht).
    const data = await r.json().catch(() => ({})) as { emailDeliveryFailed?: boolean };
    return { emailDeliveryFailed: data.emailDeliveryFailed };
  };

  const logout = async () => {
    await apiFetch("/api/auth/logout", { method: "POST" });
    applyUser(null);
  };

  const refreshUser = async () => {
    // Frischeprüfung wie der Fokus-Check: Epoch-Guard, damit eine verspätete
    // Antwort keinen zwischenzeitlich angewendeten Zustand überschreibt.
    const epoch = authEpochRef.current;
    try {
      const r = await apiFetch("/api/auth/me");
      if (authEpochRef.current !== epoch) return;
      if (r.ok) {
        const user = (await r.json()) as AuthUser;
        if (authEpochRef.current === epoch) applyUser(user);
        return;
      }
      // Session serverseitig ungültig (401/403) -> lokalen Zustand & Cache leeren.
      applyUser(null);
    } catch {
      // Transienter Netzwerkfehler: bestehenden Zustand bewusst NICHT verwerfen.
    }
  };

  const devListUsers = async (): Promise<AuthUser[]> => {
    if (!import.meta.env.DEV) return [];
    try {
      const r = await apiFetch("/api/auth/dev-users");
      if (!r.ok) return [];
      return (await r.json()) as AuthUser[];
    } catch {
      return [];
    }
  };

  const devSwitchUser = async (userId: number): Promise<void> => {
    if (!import.meta.env.DEV) return;
    const r = await apiFetch("/api/auth/dev-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (!r.ok) {
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      throw new Error(safeErrorText(data.error, "Nutzerwechsel fehlgeschlagen"));
    }
    const user = (await r.json()) as AuthUser;
    applyUser(user);
  };

  const setPassword = async (token: string, password: string): Promise<AuthUser> => {
    const r = await apiFetch("/api/auth/set-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({})) as { error?: string };
      throw new Error(safeErrorText(data.error, "Fehler beim Setzen des Passworts"));
    }
    const user = (await r.json()) as AuthUser;
    applyUser(user);
    return user;
  };

  return (
    <AuthContext.Provider value={{ currentUser, isLoading, login, register, logout, setPassword, refreshUser, forgotPassword, resetPassword, resendVerification, devListUsers, devSwitchUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
