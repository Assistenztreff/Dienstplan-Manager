import AsyncStorage from "@react-native-async-storage/async-storage";
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
  isLoading: boolean;
};

const UserContext = createContext<UserContextType>({
  currentUser: null,
  setCurrentUser: () => {},
  isLoading: true,
});

const STORAGE_KEY = "dienstplan_user";

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUserState] = useState<AppUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (stored) setCurrentUserState(JSON.parse(stored) as AppUser);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  const setCurrentUser = (user: AppUser | null) => {
    setCurrentUserState(user);
    if (user) {
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(user)).catch(() => {});
    } else {
      AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
    }
  };

  return (
    <UserContext.Provider value={{ currentUser, setCurrentUser, isLoading }}>
      {children}
    </UserContext.Provider>
  );
}

export function useCurrentUser() {
  return useContext(UserContext);
}
