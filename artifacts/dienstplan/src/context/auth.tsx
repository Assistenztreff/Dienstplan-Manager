import React, { createContext, useContext, useEffect, useState } from "react";

export type AuthUser = {
  id: number;
  name: string;
  email: string;
  role: "admin" | "assistant";
};

type AuthContextType = {
  currentUser: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setPassword: (token: string, password: string) => Promise<AuthUser>;
};

const AuthContext = createContext<AuthContextType>({
  currentUser: null,
  isLoading: true,
  login: async () => {},
  logout: async () => {},
  setPassword: async () => { throw new Error("not initialized"); },
});

async function apiFetch(path: string, init?: RequestInit) {
  const res = await fetch(path, { credentials: "same-origin", ...init });
  return res;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    apiFetch("/api/auth/me")
      .then((r) => (r.ok ? (r.json() as Promise<AuthUser>) : null))
      .then((user) => setCurrentUser(user))
      .catch(() => setCurrentUser(null))
      .finally(() => setIsLoading(false));
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
    <AuthContext.Provider value={{ currentUser, isLoading, login, logout, setPassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
