import React, { createContext, useContext, useEffect, useState } from "react";

export type AuthUser = {
  id: number;
  name: string;
  email: string;
  role: "admin" | "assistant";
  accountType: "privat" | "dienstleister";
};

type AuthContextType = {
  currentUser: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setPassword: (token: string, password: string) => Promise<AuthUser>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  currentUser: null,
  isLoading: true,
  login: async () => {},
  logout: async () => {},
  setPassword: async () => { throw new Error("not initialized"); },
  refreshUser: async () => {},
});

async function apiFetch(path: string, init?: RequestInit) {
  const res = await fetch(path, { credentials: "same-origin", ...init });
  return res;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const meRes = await apiFetch("/api/auth/me");
        if (meRes.ok) {
          const user = (await meRes.json()) as AuthUser;
          if (!cancelled) setCurrentUser(user);
          return;
        }

        if (import.meta.env.DEV) {
          const devRes = await apiFetch("/api/auth/dev-login", { method: "POST" });
          if (devRes.ok) {
            const user = (await devRes.json()) as AuthUser;
            if (!cancelled) setCurrentUser(user);
            return;
          }
        }

        if (!cancelled) setCurrentUser(null);
      } catch {
        if (!cancelled) setCurrentUser(null);
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
      throw new Error(data.error ?? "Anmeldung fehlgeschlagen");
    }
    const user = (await r.json()) as AuthUser;
    setCurrentUser(user);
  };

  const logout = async () => {
    await apiFetch("/api/auth/logout", { method: "POST" });
    setCurrentUser(null);
  };

  const refreshUser = async () => {
    const r = await apiFetch("/api/auth/me");
    if (r.ok) {
      const user = (await r.json()) as AuthUser;
      setCurrentUser(user);
    }
  };

  const setPassword = async (token: string, password: string): Promise<AuthUser> => {
    const r = await apiFetch("/api/auth/set-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({})) as { error?: string };
      throw new Error(data.error ?? "Fehler beim Setzen des Passworts");
    }
    const user = (await r.json()) as AuthUser;
    setCurrentUser(user);
    return user;
  };

  return (
    <AuthContext.Provider value={{ currentUser, isLoading, login, logout, setPassword, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
