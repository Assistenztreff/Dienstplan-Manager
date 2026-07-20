import React, { createContext, useContext, useEffect, useState } from "react";

export type AuthUser = {
  id: number;
  name: string;
  email: string;
  role: "admin" | "assistant" | "superadmin";
  accountType: "privat" | "dienstleister";
  /** SaaS-Abo-Stufe. "free" = abgespeckte Gratis-Version, "premium" = voller Funktionsumfang. */
  plan: "free" | "premium";
};

type AuthContextType = {
  currentUser: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: {
    name: string;
    email: string;
    password: string;
    accountType: "privat" | "dienstleister";
  }) => Promise<void>;
  logout: () => Promise<void>;
  setPassword: (token: string, password: string) => Promise<AuthUser>;
  refreshUser: () => Promise<void>;
  /** Dev-only: vorhandene Test-Nutzer zum Umschalten auflisten. Leer in Produktion. */
  devListUsers: () => Promise<AuthUser[]>;
  /** Dev-only: als anderer vorhandener Test-Nutzer agieren. No-op in Produktion. */
  devSwitchUser: (userId: number) => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  currentUser: null,
  isLoading: true,
  login: async () => {},
  register: async () => {},
  logout: async () => {},
  setPassword: async () => { throw new Error("not initialized"); },
  refreshUser: async () => {},
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
const DEV_SESSION_KEY = "assistenz_treff_session";

function readStoredSession(): AuthUser | null {
  if (!import.meta.env.DEV) return null;
  try {
    const raw = localStorage.getItem(DEV_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthUser>;
    if (
      parsed &&
      typeof parsed.id === "number" &&
      typeof parsed.name === "string" &&
      typeof parsed.email === "string" &&
      (parsed.role === "admin" || parsed.role === "assistant" || parsed.role === "superadmin") &&
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
  if (!import.meta.env.DEV) return;
  try {
    if (user) localStorage.setItem(DEV_SESSION_KEY, JSON.stringify(user));
    else localStorage.removeItem(DEV_SESSION_KEY);
  } catch {
    // localStorage nicht verfügbar (z. B. privater Modus) — ignorieren
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(() => readStoredSession());
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const meRes = await apiFetch("/api/auth/me");
        if (meRes.ok) {
          const user = (await meRes.json()) as AuthUser;
          if (!cancelled) {
            setCurrentUser(user);
            storeSession(user);
          }
          return;
        }

        if (import.meta.env.DEV) {
          const devRes = await apiFetch("/api/auth/dev-login", { method: "POST" });
          if (devRes.ok) {
            const user = (await devRes.json()) as AuthUser;
            if (!cancelled) {
              setCurrentUser(user);
              storeSession(user);
            }
            return;
          }
        }

        if (!cancelled) {
          setCurrentUser(null);
          storeSession(null);
        }
      } catch {
        if (!cancelled) {
          setCurrentUser(null);
          storeSession(null);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = async (email: string, password: string) => {
    const r = await apiFetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({})) as { error?: string };
      throw new Error(safeErrorText(data.error, "Anmeldung fehlgeschlagen"));
    }
    const user = (await r.json()) as AuthUser;
    setCurrentUser(user);
    storeSession(user);
  };

  const register = async (input: {
    name: string;
    email: string;
    password: string;
    accountType: "privat" | "dienstleister";
  }) => {
    const r = await apiFetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!r.ok) {
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      const err = new Error(safeErrorText(data.error, "Registrierung fehlgeschlagen")) as Error & {
        status?: number;
      };
      err.status = r.status;
      throw err;
    }
    const user = (await r.json()) as AuthUser;
    setCurrentUser(user);
    storeSession(user);
  };

  const logout = async () => {
    await apiFetch("/api/auth/logout", { method: "POST" });
    setCurrentUser(null);
    storeSession(null);
  };

  const refreshUser = async () => {
    try {
      const r = await apiFetch("/api/auth/me");
      if (r.ok) {
        const user = (await r.json()) as AuthUser;
        setCurrentUser(user);
        storeSession(user);
        return;
      }
      // Session serverseitig ungültig (401/403) -> lokalen Zustand & Cache leeren.
      setCurrentUser(null);
      storeSession(null);
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
    setCurrentUser(user);
    storeSession(user);
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
    setCurrentUser(user);
    storeSession(user);
    return user;
  };

  return (
    <AuthContext.Provider value={{ currentUser, isLoading, login, register, logout, setPassword, refreshUser, devListUsers, devSwitchUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
