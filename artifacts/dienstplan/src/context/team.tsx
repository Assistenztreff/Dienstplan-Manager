import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useListTeams } from "@workspace/api-client-react";
import { useAuth, hasTeamAccessLevel } from "@/context/auth";
import { isAdminRole } from "@/lib/roles";
import { REFERENCE_DATA_STALE_TIME_MS } from "@/lib/shift-cache";

type Team = { id: number; name: string };

type TeamContextType = {
  teams: Team[];
  /**
   * true für Dienstleister-Admins (eigene Teams) UND für Teamleiter (zugewiesene
   * Teams). Steuert die Sichtbarkeit des Team-Switchers und die Team-Scoping-Logik.
   */
  isDienstleister: boolean;
  /**
   * true wenn der Nutzer ausschließlich als Teamleiter agiert (keine eigenen Teams,
   * nur zugewiesene). Ermöglicht differenzierte UI-Entscheidungen (z.B. kein
   * "Team anlegen"-Button).
   */
  isTeamleiterOnly: boolean;
  hasTeams: boolean;
  selectedTeamId: number | null;
  setSelectedTeamId: (id: number | null) => void;
  /**
   * true, sobald der Team-Kontext SETTLED ist: Für Dienstleister heißt das,
   * die Team-Liste ist geladen UND die Auto-Auswahl des ersten Teams (siehe
   * Effekt unten) ist bereits angewandt. Scope-abhängige Schreib-Flows (z.B.
   * Logo-Upload: Konto- vs. Team-Zeile) müssen darauf warten, sonst schreiben
   * sie in den falschen Scope, wenn die Auswahl mitten im Flow umspringt.
   */
  isTeamScopeReady: boolean;
};

const STORAGE_KEY = "dienstplan.selectedTeamId";

const TeamContext = createContext<TeamContextType>({
  teams: [],
  isDienstleister: false,
  isTeamleiterOnly: false,
  hasTeams: false,
  selectedTeamId: null,
  setSelectedTeamId: () => {},
  isTeamScopeReady: false,
});

function readStored(): number | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function TeamProvider({ children }: { children: React.ReactNode }) {
  const { currentUser } = useAuth();
  const isActualDienstleister =
    isAdminRole(currentUser?.role) && currentUser?.accountType === "dienstleister";
  // Teamleiter sind Nutzer mit is_teamleiter=true (kann assistant ODER admin sein,
  // aber nicht der Eigentümer eines eigenen Mandanten).
  const isTeamleiterUser = currentUser?.isTeamleiter === true && !isActualDienstleister;
  // Freigeschaltete Mitglieder (Stufe „basis" und höher) arbeiten ebenfalls im
  // Team-Scope: Ohne diese Zeile blieben ihre Anfragen unscoped und die Seiten
  // zeigten nichts, obwohl der Server den Zugriff erlaubt.
  const hasFreigabe = !isActualDienstleister && hasTeamAccessLevel(currentUser, "basis");

  // Alle drei Gruppen bekommen den Team-Switcher und die Team-Scoping-Logik.
  const showTeamSwitcher = isActualDienstleister || isTeamleiterUser || hasFreigabe;

  const { data: teamsData, isLoading: teamsLoading } = useListTeams({
    query: { enabled: !!showTeamSwitcher, staleTime: REFERENCE_DATA_STALE_TIME_MS },
  } as unknown as Parameters<typeof useListTeams>[0]);

  const teams = useMemo(() => ((teamsData ?? []) as Team[]), [teamsData]);

  const [selectedTeamId, setSelectedTeamIdState] = useState<number | null>(() => readStored());

  const setSelectedTeamId = (id: number | null) => {
    setSelectedTeamIdState(id);
    if (id == null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, String(id));
  };

  // Auswahl bereinigen: kein Team-Switcher-Nutzer (mehr) → keine Team-Auswahl.
  // Für Dienstleister und Teamleiter mit Teams gibt es KEINEN "Alle Teams"-Zustand
  // mehr — fehlt eine (gültige) Auswahl (Erstnutzung, gewähltes Team gelöscht),
  // wird automatisch das erste Team gewählt.
  useEffect(() => {
    if (!showTeamSwitcher) {
      if (selectedTeamId !== null) setSelectedTeamId(null);
      return;
    }
    if (teams.length === 0) return;
    if (selectedTeamId === null || !teams.some((t) => t.id === selectedTeamId)) {
      setSelectedTeamId(teams[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTeamSwitcher, teams, selectedTeamId]);

  // Scope settled? Kein Switcher-Nutzer: sofort (immer Konto-Scope). Switcher-
  // Nutzer: Teams geladen und — falls Teams existieren — die Auto-Auswahl
  // bereits auf ein gültiges Team gezeigt (der Effekt oben läuft einen Render
  // später; bis dahin gilt der Scope als "noch nicht bereit").
  const isTeamScopeReady =
    !showTeamSwitcher ||
    (!teamsLoading &&
      (teams.length === 0 ||
        (selectedTeamId !== null && teams.some((t) => t.id === selectedTeamId))));

  return (
    <TeamContext.Provider
      value={{
        teams,
        isDienstleister: !!showTeamSwitcher,
        isTeamleiterOnly: isTeamleiterUser || hasFreigabe,
        hasTeams: teams.length > 0,
        selectedTeamId: showTeamSwitcher ? selectedTeamId : null,
        setSelectedTeamId,
        isTeamScopeReady,
      }}
    >
      {children}
    </TeamContext.Provider>
  );
}

export function useTeam() {
  return useContext(TeamContext);
}
