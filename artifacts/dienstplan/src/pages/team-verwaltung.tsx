import { useState } from "react";
import {
  useListTeams,
  useCreateTeam,
  useUpdateTeam,
  useDeleteTeam,
  useListTeamMembers,
  useMoveTeamMember,
  useUpdateTeamMemberFlags,
  getListTeamsQueryKey,
  getListTeamMembersQueryKey,
  getListUsersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Pencil, Trash2, Building2, ArrowRightLeft, Lock, UserCog } from "lucide-react";
import { PlanLimitBanner } from "@/components/plan-limit-banner";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/auth";
import { isAdminRole } from "@/lib/roles";
import { isWithinLimit, getLimit } from "@/lib/entitlements";
import { readableApiError, planUpgradeMessage } from "@/lib/api-error";

type Team = {
  id: number;
  name: string;
  ownerId: number;
  createdAt: string;
};

type Member = {
  id: number;
  teamId: number;
  userId: number;
  name: string;
  email: string;
  role: "admin" | "assistant";
  teamCount: number;
  createdAt: string;
  isTeamleiter: boolean;
  canViewPayroll: boolean;
};

function roleLabel(role: "admin" | "assistant"): string {
  return role === "admin" ? "Assistenznehmer" : "Assistent";
}

type TeamDialogProps = {
  open: boolean;
  onClose: () => void;
  editTeam?: Team;
};

function TeamDialog({ open, onClose, editTeam }: TeamDialogProps) {
  const queryClient = useQueryClient();
  const createTeam = useCreateTeam();
  const updateTeam = useUpdateTeam();
  const isEditing = !!editTeam;

  const [name, setName] = useState(editTeam?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim()) {
      setError("Pflichtfeld");
      return;
    }
    setSaving(true);
    try {
      if (isEditing && editTeam) {
        await updateTeam.mutateAsync({ id: editTeam.id, data: { name: name.trim() } });
      } else {
        await createTeam.mutateAsync({ data: { name: name.trim() } });
      }
      await queryClient.invalidateQueries({ queryKey: getListTeamsQueryKey() });
      onClose();
    } catch (err) {
      setError(
        planUpgradeMessage(err) ??
          readableApiError(err, "Speichern fehlgeschlagen. Bitte erneut versuchen."),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">
            {isEditing ? "Team bearbeiten" : "Neues Team"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Bezeichnung *</Label>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              placeholder="z.B. Team Nord"
              className={error ? "border-destructive" : ""}
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Abbrechen
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Speichern..." : isEditing ? "Speichern" : "Anlegen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type TransferDialogProps = {
  team: Team;
  teams: Team[];
  onClose: () => void;
};

/**
 * "Assistenzkraft überführen": verschiebt eine Mitgliedschaft atomar vom
 * Quell-Team (Zeile, aus der der Dialog geöffnet wurde) in ein Ziel-Team über
 * den dedizierten Move-Endpunkt — kein Zwischenzustand aus Entfernen+Anlegen.
 */
function TransferDialog({ team, teams, onClose }: TransferDialogProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: membersData, isLoading } = useListTeamMembers(team.id);
  const moveMember = useMoveTeamMember();

  const [selectedUser, setSelectedUser] = useState<string>("");
  const [targetTeam, setTargetTeam] = useState<string>("");
  const [moving, setMoving] = useState(false);

  const members = (membersData ?? []) as Member[];
  const targetTeams = teams.filter((t) => t.id !== team.id);

  async function handleMove() {
    if (!selectedUser || !targetTeam) return;
    setMoving(true);
    try {
      await moveMember.mutateAsync({
        id: team.id,
        userId: Number(selectedUser),
        data: { targetTeamId: Number(targetTeam) },
      });
      await queryClient.invalidateQueries({ queryKey: getListTeamMembersQueryKey(team.id) });
      await queryClient.invalidateQueries({
        queryKey: getListTeamMembersQueryKey(Number(targetTeam)),
      });
      // Team-gescopte Nutzerlisten (Assistenten-Seite) neu laden.
      await queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
      // Auch Dienstplan, Verträge, Zeiterfassung und Auswertung sind betroffen,
      // weil die persönlichen Daten mitwandern.
      await queryClient.invalidateQueries({
        predicate: (q) => {
          const key = String(q.queryKey[0] ?? "");
          return (
            key.includes("/shifts") ||
            key.includes("/contracts") ||
            key.includes("/time-tracking") ||
            key.includes("/dashboard")
          );
        },
      });
      toast({
        title: "Assistenzkraft überführt",
        description:
          "Die Assistenzkraft und ihre Daten wurden in das Ziel-Team verschoben.",
      });
      onClose();
    } catch (err) {
      if (!navigator.onLine) return; // Banner erklärt den Grund bereits.
      toast({
        title: "Überführen fehlgeschlagen",
        description: readableApiError(err, "Bitte erneut versuchen."),
        variant: "destructive",
      });
    } finally {
      setMoving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">
            Assistenzkraft überführen: {team.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Assistenzkraft *</Label>
            {isLoading ? (
              <Skeleton className="h-9 w-full rounded-md" />
            ) : (
              <Select value={selectedUser} onValueChange={setSelectedUser}>
                <SelectTrigger data-testid="transfer-member-select">
                  <SelectValue
                    placeholder={
                      members.length === 0 ? "Keine Mitglieder in diesem Team" : "Person auswählen"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {members.map((m) => (
                    <SelectItem key={m.userId} value={String(m.userId)}>
                      {m.name} ({roleLabel(m.role)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Ziel-Team *</Label>
            <Select value={targetTeam} onValueChange={setTargetTeam}>
              <SelectTrigger data-testid="transfer-target-select">
                <SelectValue
                  placeholder={
                    targetTeams.length === 0 ? "Kein weiteres Team vorhanden" : "Team auswählen"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {targetTeams.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <p className="text-xs text-muted-foreground">
            Die Mitgliedschaft und alle persönlichen Daten der Assistenzkraft (Verträge, Dienste,
            Zeiteinträge) werden in einem Schritt in das Ziel-Team übernommen — auch vergangene
            Monate zählen danach dort. Team-Einstellungen (Dienste-Vorlagen, Zuschläge) bleiben
            unberührt.
          </p>
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={moving}>
            Abbrechen
          </Button>
          <Button
            onClick={handleMove}
            disabled={!selectedUser || !targetTeam || moving}
            className="gap-2"
            data-testid="transfer-submit"
          >
            <ArrowRightLeft className="h-4 w-4" />
            {moving ? "Überführen..." : "Überführen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Teamleiter-Rollen-Dialog: is_teamleiter und can_view_payroll je Mitglied
// setzen. Nur für vollständige Admins (nicht Teamleiter selbst) sichtbar.
// ---------------------------------------------------------------------------

type TeamleiterDialogProps = {
  team: Team;
  onClose: () => void;
};

function TeamleiterDialog({ team, onClose }: TeamleiterDialogProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: membersData, isLoading } = useListTeamMembers(team.id);
  const members = (membersData ?? []) as Member[];

  // Optimistische lokale Kopie für sofortiges Toggle-Feedback.
  const [localFlags, setLocalFlags] = useState<
    Record<number, { isTeamleiter: boolean; canViewPayroll: boolean }>
  >(() =>
    Object.fromEntries(
      (membersData as Member[] ?? []).map((m) => [
        m.userId,
        { isTeamleiter: m.isTeamleiter ?? false, canViewPayroll: m.canViewPayroll ?? false },
      ]),
    ),
  );

  // Synchronisiert localFlags wenn Mitgliederdaten geladen werden.
  const [syncDone, setSyncDone] = useState(false);
  if (!isLoading && !syncDone && members.length > 0) {
    const flags: typeof localFlags = {};
    for (const m of members) {
      flags[m.userId] = {
        isTeamleiter: m.isTeamleiter ?? false,
        canViewPayroll: m.canViewPayroll ?? false,
      };
    }
    setLocalFlags(flags);
    setSyncDone(true);
  }

  const updateFlags = useUpdateTeamMemberFlags({
    mutation: {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: getListTeamMembersQueryKey(team.id) });
      },
      onError: (err: unknown) => {
        toast({
          title: "Fehler beim Speichern",
          description: readableApiError(err, "Bitte erneut versuchen."),
          variant: "destructive",
        });
      },
    },
  });

  async function toggle(
    userId: number,
    field: "isTeamleiter" | "canViewPayroll",
    value: boolean,
  ) {
    const current = localFlags[userId] ?? { isTeamleiter: false, canViewPayroll: false };
    const next = { ...current, [field]: value };
    // canViewPayroll hat nur Wirkung wenn isTeamleiter=true.
    if (field === "isTeamleiter" && !value) next.canViewPayroll = false;
    setLocalFlags((prev) => ({ ...prev, [userId]: next }));
    await updateFlags.mutateAsync({ id: team.id, userId, data: next });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl flex items-center gap-2">
            <UserCog className="h-5 w-5 text-muted-foreground" />
            Teamleiter-Rollen: {team.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-1 py-2">
          {isLoading ? (
            <div className="space-y-2 py-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full rounded-md" />)}
            </div>
          ) : members.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Keine Mitglieder in diesem Team.
            </p>
          ) : (
            <ul className="divide-y divide-border/40">
              {members.map((m) => {
                const flags = localFlags[m.userId] ?? {
                  isTeamleiter: m.isTeamleiter ?? false,
                  canViewPayroll: m.canViewPayroll ?? false,
                };
                return (
                  <li key={m.userId} className="py-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{m.name}</span>
                      <span className="text-xs text-muted-foreground">{m.email}</span>
                      {flags.isTeamleiter && (
                        <Badge variant="secondary" className="text-xs">Teamleiter</Badge>
                      )}
                    </div>
                    <div className="flex flex-col gap-2 pl-1">
                      <div className="flex items-center gap-3">
                        <Switch
                          id={`tl-${m.userId}`}
                          checked={flags.isTeamleiter}
                          disabled={updateFlags.isPending}
                          onCheckedChange={(v) => void toggle(m.userId, "isTeamleiter", v)}
                        />
                        <Label htmlFor={`tl-${m.userId}`} className="text-sm cursor-pointer">
                          Als Teamleiter festlegen
                          <span className="block text-xs text-muted-foreground font-normal">
                            Kann Schichten, Verträge und Zeiterfassung in diesem Team verwalten
                          </span>
                        </Label>
                      </div>
                      {flags.isTeamleiter && (
                        <div className="flex items-center gap-3 pl-8">
                          <Switch
                            id={`cp-${m.userId}`}
                            checked={flags.canViewPayroll}
                            disabled={updateFlags.isPending}
                            onCheckedChange={(v) => void toggle(m.userId, "canViewPayroll", v)}
                          />
                          <Label htmlFor={`cp-${m.userId}`} className="text-sm cursor-pointer">
                            Darf Lohn-/Personaldaten sehen
                            <span className="block text-xs text-muted-foreground font-normal">
                              Gibt Zugang zu Stundenlohn, Sozialversicherungs- und Steuerdaten
                            </span>
                          </Label>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button onClick={onClose}>Schließen</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function TeamVerwaltung() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { currentUser } = useAuth();
  const { data, isLoading } = useListTeams();
  const deleteTeam = useDeleteTeam();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTeam, setEditTeam] = useState<Team | undefined>();
  const [transferTeam, setTransferTeam] = useState<Team | undefined>();
  const [teamleiterTeam, setTeamleiterTeam] = useState<Team | undefined>();
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  // Teamleiter-Rollen-Button nur für vollständige Admins (dienstleister).
  const isFullAdmin = isAdminRole(currentUser?.role) && currentUser?.accountType === "dienstleister";

  const teams: Team[] = (data ?? []) as Team[];

  // Free-Plan begrenzt die Anzahl der Teams (Free = 1). Da die Registrierung
  // bereits ein Standard-Team anlegt, startet ein Free-Konto direkt am Limit.
  // Ist es erreicht, wird das Anlegen gesperrt (Durchsetzung zusaetzlich
  // serverseitig). `null` = unbegrenzt (Premium). Bestandsschutz: vorhandene
  // Teams bleiben sichtbar/editierbar; nur das Anlegen ueber dem Limit ist gesperrt.
  const teamLimit = getLimit(currentUser, "maxTeams");
  const canAddTeam = isWithinLimit(currentUser, "maxTeams", teams.length);

  function openCreate() {
    setEditTeam(undefined);
    setDialogOpen(true);
  }

  function openEdit(team: Team) {
    setEditTeam(team);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditTeam(undefined);
  }

  async function handleDelete(id: number) {
    if (confirmDelete !== id) {
      setConfirmDelete(id);
      return;
    }
    try {
      await deleteTeam.mutateAsync({ id });
      await queryClient.invalidateQueries({ queryKey: getListTeamsQueryKey() });
    } catch (err) {
      if (!navigator.onLine) return; // Banner erklärt den Grund bereits.
      toast({
        title: "Team kann nicht gelöscht werden",
        description: readableApiError(err, "Es sind noch Daten oder Mitglieder zugeordnet."),
        variant: "destructive",
      });
    } finally {
      setConfirmDelete(null);
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl md:text-3xl font-serif font-bold text-foreground">Team-Verwaltung</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Teams für die Organisation von Assistenten und Dienstplänen verwalten
          </p>
        </div>
        {canAddTeam ? (
          <Button onClick={openCreate} className="gap-2">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Neues Team</span>
            <span className="sm:hidden">Neu</span>
          </Button>
        ) : (
          <Button
            disabled
            className="gap-2"
            title={`Im Free-Plan ist max. ${teamLimit} Team möglich. Upgrade auf Premium für mehrere Teams.`}
          >
            <Lock className="h-4 w-4" />
            <span className="hidden sm:inline">Neues Team</span>
            <span className="sm:hidden">Neu</span>
          </Button>
        )}
      </div>

      {/* Limit-Hinweis (Free-Plan). Bei Premium ist teamLimit null. */}
      {!canAddTeam && teamLimit !== null && (
        <PlanLimitBanner>
          Im Free-Plan ist maximal {teamLimit} Team möglich. Für mehrere Teams ist ein Upgrade auf
          Premium nötig.
        </PlanLimitBanner>
      )}

      <Card className="border-border/50 shadow-sm">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 w-full rounded-lg" />
              ))}
            </div>
          ) : teams.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-muted-foreground mb-4">Noch keine Teams angelegt.</p>
              <Button onClick={openCreate} variant="outline" className="gap-2">
                <Plus className="h-4 w-4" /> Erstes Team anlegen
              </Button>
            </div>
          ) : (
            <ul className="divide-y divide-border/50">
              {teams.map((team) => (
                <li
                  key={team.id}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-muted/20 transition-colors"
                >
                  <Building2 className="h-4 w-4 text-muted-foreground/60 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <span className="font-medium truncate">{team.name}</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setTransferTeam(team)}
                    data-testid={`transfer-team-${team.id}`}
                  >
                    <ArrowRightLeft className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Überführen</span>
                  </Button>
                  {isFullAdmin && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => setTeamleiterTeam(team)}
                      title="Teamleiter-Rollen verwalten"
                    >
                      <UserCog className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Rollen</span>
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => openEdit(team)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Bearbeiten</span>
                  </Button>
                  <Button
                    variant={confirmDelete === team.id ? "destructive" : "ghost"}
                    size="sm"
                    className="gap-1.5"
                    onClick={() => handleDelete(team.id)}
                    onBlur={() => setConfirmDelete(null)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">
                      {confirmDelete === team.id ? "Wirklich?" : "Löschen"}
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Teams strukturieren Assistenten und Dienstpläne. Ein Team kann nur gelöscht werden, wenn
        ihm keine Mitglieder oder Daten mehr zugeordnet sind.
      </p>

      {dialogOpen && (
        <TeamDialog open={dialogOpen} onClose={closeDialog} editTeam={editTeam} />
      )}

      {transferTeam && (
        <TransferDialog
          team={transferTeam}
          teams={teams}
          onClose={() => setTransferTeam(undefined)}
        />
      )}

      {teamleiterTeam && (
        <TeamleiterDialog
          team={teamleiterTeam}
          onClose={() => setTeamleiterTeam(undefined)}
        />
      )}
    </div>
  );
}
