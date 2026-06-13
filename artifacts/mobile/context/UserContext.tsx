import AsyncStorage from "@react-native-async-storage/async-storage";
import { setCookieGetter } from "@workspace/api-client-react";
import React, { createContext, useContext, useEffect, useState } from "react";

export type AppUser = {
  id: number;
  name: string;
  email: string;
  role: "admin" | "assistant";
};

type UserContextType = {
  currentUser: AppUser | null;
  setCurrentUser: (user: AppUser | null) => void;
  sessionCookie: string | null;
  setSessionCookie: (cookie: string | null) => void;
  isLoading: boolean;
};

const UserContext = createContext<UserContextType>({
  currentUser: null,
  setCurrentUser: () => {},
  sessionCookie: null,
  setSessionCookie: () => {},
  isLoading: true,
});

const USER_KEY = "dienstplan_user";
const COOKIE_KEY = "dienstplan_session_cookie";

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUserState] = useState<AppUser | null>(null);
  const [sessionCookie, setSessionCookieState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(USER_KEY),
      AsyncStorage.getItem(COOKIE_KEY),
    ])
      .then(([storedUser, storedCookie]) => {
        if (storedUser) setCurrentUserState(JSON.parse(storedUser) as AppUser);
        if (storedCookie) {
          setSessionCookieState(storedCookie);
          setCookieGetter(() => storedCookie);
        }
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  const setCurrentUser = (user: AppUser | null) => {
    setCurrentUserState(user);
    if (user) {
      AsyncStorage.setItem(USER_KEY, JSON.stringify(user)).catch(() => {});
    } else {
      AsyncStorage.removeItem(USER_KEY).catch(() => {});
    }
  };

  const setSessionCookie = (cookie: string | null) => {
    setSessionCookieState(cookie);
    if (cookie) {
      AsyncStorage.setItem(COOKIE_KEY, cookie).catch(() => {});
      setCookieGetter(() => cookie);
    } else {
      AsyncStorage.removeItem(COOKIE_KEY).catch(() => {});
      setCookieGetter(null);
    }
  };

  return (
    <UserContext.Provider
      value={{ currentUser, setCurrentUser, sessionCookie, setSessionCookie, isLoading }}
    >
      {children}
    </UserContext.Provider>
  );
}

export function useCurrentUser() {
  return useContext(UserContext);
}
