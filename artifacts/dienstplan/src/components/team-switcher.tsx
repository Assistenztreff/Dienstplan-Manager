import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { useGetBrandingSettings } from "@workspace/api-client-react";
import type { BrandingSettings } from "@workspace/api-client-react";
import { useTeam } from "@/context/team";
import { logoSrcFromPath } from "@/lib/logo";

function TeamLogo() {
  const { selectedTeamId } = useTeam();

  const { data: teamData } = useGetBrandingSettings(
    selectedTeamId != null ? { teamId: selectedTeamId } : undefined,
  );
  // Ohne teamId liefert der Server das eigene Konto-Logo des Aufrufers (nie das
  // eines anderen Kontos) — dient hier nur als Fallback, wenn kein Team gewählt ist.
  const { data: accountData } = useGetBrandingSettings(undefined);

  const teamLogoPath = (teamData as BrandingSettings | undefined)?.logoPath;
  const accountLogoPath = (accountData as BrandingSettings | undefined)?.logoPath;
  const logoSrc = logoSrcFromPath(teamLogoPath ?? accountLogoPath);

  if (!logoSrc) return null;

  return (
    <img
      src={logoSrc}
      alt="Team-Logo"
      className="h-8 w-auto min-w-0 max-w-[120px] shrink rounded object-contain"
    />
  );
}

export function TeamSwitcher() {
  const { isDienstleister, hasTeams, teams, selectedTeamId, setSelectedTeamId } = useTeam();

  if (!isDienstleister || !hasTeams) return null;

  return (
    /* Kein "Alle Teams"-Eintrag mehr: es ist immer genau ein Team gewählt
       (Auto-Auswahl im Team-Context). Breite flexibel: der Switcher darf in
       engen Kopfzeilen schrumpfen (truncate), statt fest 224px zu belegen —
       so bleibt die Label-Stufe der Dienstplanleiste länger erhalten. */
    <div className="flex min-w-0 shrink items-center gap-2">
      <TeamLogo />
      <Select
        value={selectedTeamId == null ? undefined : String(selectedTeamId)}
        onValueChange={(v) => setSelectedTeamId(Number(v))}
      >
        <SelectTrigger
          className="w-full min-w-[7.5rem] truncate sm:w-auto sm:max-w-56"
          aria-label="Team auswählen"
        >
          <SelectValue placeholder="Team auswählen" />
        </SelectTrigger>
        <SelectContent>
          {teams.map((t) => (
            <SelectItem key={t.id} value={String(t.id)}>
              {t.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
