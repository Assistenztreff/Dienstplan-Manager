import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useListTeams } from "@workspace/api-client-react";
import { useAuth } from "@/context/auth";

type Team = { id: number; name: string };

type TeamContextType = {
  teams: Team[];
  isDienstleister: boolean;
  hasTeams: boolean;
  selectedTeamId: number | null;
  setSelectedTeamId: (id: number | null) => void;
};

const STORAGE_KEY = "dienstplan.selectedTeamId";

const TeamContext = createContext<TeamContextType>({
  teams: [],
  isDienstleister: false,
  hasTeams: false,
  selectedTeamId: null,
  setSelectedTeamId: () => {},
});

function readStored(): number | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function TeamProvider({ children }: { children: React.ReactNode }) {
  const { currentUser } = useAuth();
  const isDienstleister =
    currentUser?.role === "admin" && currentUser?.accountType === "dienstleister";

  const { data: teamsData } = useListTeams({
    query: { enabled: !!isDienstleister },
  } as Parameters<typeof useListTeams>[0]);

  const teams = useMemo(() => ((teamsData ?? []) as Team[]), [teamsData]);

  const [selectedTeamId, setSelectedTeamIdState] = useState<number | null>(() => readStored());

  const setSelectedTeamId = (id: number | null) => {
    setSelectedTeamIdState(id);
    if (id == null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, String(id));
  };

  // Auswahl bereinigen, wenn das gespeicherte Team nicht mehr existiert oder der
  // Nutzer kein Dienstleister (mehr) ist.
  useEffect(() => {
    if (!isDienstleister) {
      if (selectedTeamId !== null) setSelectedTeamId(null);
      return;
    }
    if (selectedTeamId !== null && teams.length > 0 && !teams.some((t) => t.id === selectedTeamId)) {
      setSelectedTeamId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDienstleister, teams]);

  return (
    <TeamContext.Provider
      value={{
        teams,
        isDienstleister: !!isDienstleister,
        hasTeams: teams.length > 0,
        selectedTeamId: isDienstleister ? selectedTeamId : null,
        setSelectedTeamId,
      }}
    >
      {children}
    </TeamContext.Provider>
  );
}

export function useTeam() {
  return useContext(TeamContext);
}
