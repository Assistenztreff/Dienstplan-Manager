import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { useTeam } from "@/context/team";

const ALL_VALUE = "__all__";

export function TeamSwitcher() {
  const { isDienstleister, hasTeams, teams, selectedTeamId, setSelectedTeamId } = useTeam();

  if (!isDienstleister || !hasTeams) return null;

  return (
    <Select
      value={selectedTeamId == null ? ALL_VALUE : String(selectedTeamId)}
      onValueChange={(v) => setSelectedTeamId(v === ALL_VALUE ? null : Number(v))}
    >
      <SelectTrigger className="w-full sm:w-56" aria-label="Team auswählen">
        <SelectValue placeholder="Team auswählen" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_VALUE}>Alle Teams</SelectItem>
        {teams.map((t) => (
          <SelectItem key={t.id} value={String(t.id)}>
            {t.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
