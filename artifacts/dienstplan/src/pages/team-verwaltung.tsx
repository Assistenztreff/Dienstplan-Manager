import { useState } from "react";
import {
  useListTeams,
  useCreateTeam,
  useUpdateTeam,
  useDeleteTeam,
  useListTeamMembers,
  useMoveTeamMember,
  useUpdateTeamMemberFlags,
  useListKoordinatoren,
  useCreateKoordinator,
  useSetKoordinatorTeams,
  useUpdateKoordinator,
  useDeleteKoordinator,
  getListTeamsQueryKey,
  getListTeamMembersQueryKey,
  getListUsersQueryKey,
  getListKoordinatorenQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
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
import {
  Plus,
  Pencil,
  Trash2,
  Building2,
  ArrowRightLeft,
  Lock,
  UserCog,
  ChevronDown,
  ChevronRight,
  Mail,
  UserPlus,
  Ban,
  Unlock,
} from "lucide-react";
import { PlanLimitBanner } from "@/components/plan-limit-banner";
import { AssistenzkraftListe } from "@/components/assistenzkraft-liste";
import { InviteDialog } from "@/components/assistenzkraft-formular";
import { useToast } from "@/hooks/use-toast";
import { useAuth, hasTeamAccessLevel, type TeamAccessLevel } from "@/context/auth";
import { isAdminRole } from "@/lib/roles";
import { isWithinLimit, getLimit, hasAccess } from "@/lib/entitlements";
import {
  readableApiError,
  planUpgradeMessage,
  ownerSessionMessage,
  PLAN_FEATURE_MESSAGES,
} from "@/lib/api-error";

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
  role: "admin" | "assistant" | "koordinator";
  teamCount: number;
  createdAt: string;
  isTeamleiter: boolean;
  canViewPayroll: boolean;
  accessLevel: TeamAccessLevel;
};

function roleLabel(role: "admin" | "assistant" | "koordinator"): string {
  if (role === "admin") return "Assistenznehmer";
  if (role === "koordinator") return "Teamkoordinator";
  return "Assistenzkraft";
}

/** Teamkoordinator aus Sicht des Konto-Inhabers (GET /koordinatoren). */
type Koordinator = {
  id: number;
  name: string;
  email: string;
  isActive: boolean;
  hasLogin: boolean;
  teamIds: number[];
  createdAt: string;
};

/** Beschriftungen der gestuften Team-Freischaltung (siehe Handbuch "Rollen"). */
const ACCESS_LEVEL_OPTIONS: { value: TeamAccessLevel; label: string; hint: string }[] = [
  { value: "keine", label: "Kein Zugriff", hint: "Sieht nur die eigenen Daten." },
  { value: "basis", label: "Basis – nur ansehen", hint: "Darf den Team-Überblick lesen." },
  {
    value: "stufe1",
    label: "Stufe 1 – planen",
    hint: "Darf Dienste und Abwesenheiten planen sowie Assistenzkräfte pflegen.",
  },
  {
    value: "stufe2",
    label: "Stufe 2 – verwalten",
    hint: "Zusätzlich Team-Verwaltung und Zeiterfassung.",
  },
];

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
 * Das ist der einzige Weg für einen Teamwechsel.
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
      // Team-gescopte Nutzerlisten neu laden.
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
// Zugriffsrechte-Dialog: bündelt alle Rechte-Entscheidungen je Mitgliedschaft —
// die gestufte Freischaltung, den Teamleiter-Status und (nur für
// Dienstleister-Teamleiter) die zusätzliche Lohndaten-Freigabe.
// ---------------------------------------------------------------------------

type ZugriffsrechteDialogProps = {
  team: Team;
  /** Ob der eingeloggte Admin ein Dienstleister-Konto hat (steuert Lohn-Freigabe). */
  isDienstleister: boolean;
  /**
   * true = Konto-Inhaber (alle Bedienelemente). false = Teamleiter-Sicht:
   * nur Zugriffsstufen, keine Teamleiter-/Lohndaten-Schalter, Inhaber-Zeile
   * schreibgeschützt. Die Durchsetzung bleibt serverseitig.
   */
  isOwnerView: boolean;
  onClose: () => void;
};

function ZugriffsrechteDialog({ team, isDienstleister, isOwnerView, onClose }: ZugriffsrechteDialogProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: membersData, isLoading } = useListTeamMembers(team.id);
  const members = (membersData ?? []) as Member[];

  const [busyUserId, setBusyUserId] = useState<number | null>(null);

  const updateFlags = useUpdateTeamMemberFlags();

  async function save(
    member: Member,
    patch: { accessLevel?: TeamAccessLevel; canViewPayroll?: boolean; isTeamleiter?: boolean },
    successTitle?: string,
  ) {
    setBusyUserId(member.userId);
    try {
      await updateFlags.mutateAsync({ id: team.id, userId: member.userId, data: patch });
      await queryClient.invalidateQueries({ queryKey: getListTeamMembersQueryKey(team.id) });
      if (successTitle) {
        toast({ title: successTitle });
      }
    } catch (err) {
      if (!navigator.onLine) return; // Banner erklärt den Grund bereits.
      toast({
        title: "Fehler beim Speichern",
        description: readableApiError(err, "Bitte erneut versuchen."),
        variant: "destructive",
      });
    } finally {
      setBusyUserId(null);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl flex items-center gap-2">
            <UserCog className="h-5 w-5 text-muted-foreground" />
            Zugriffsrechte: {team.name}
          </DialogTitle>
        </DialogHeader>

        {!isOwnerView && (
          <p className="text-xs text-muted-foreground">
            Als Teamleiter vergibst du hier die Zugriffsstufen. Teamleiter- und
            Lohndaten-Freigaben kann nur der Konto-Inhaber ändern.
          </p>
        )}

        <div className="space-y-1 py-2">
          {isLoading ? (
            <div className="space-y-2 py-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full rounded-md" />
              ))}
            </div>
          ) : members.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Keine Mitglieder in diesem Team.
            </p>
          ) : (
            <ul className="divide-y divide-border/40">
              {members.map((m) => {
                const level: TeamAccessLevel = m.accessLevel ?? "keine";
                const busy = busyUserId === m.userId;
                const option = ACCESS_LEVEL_OPTIONS.find((o) => o.value === level);
                return (
                  <li key={m.userId} className="py-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-sm">{m.name}</span>
                      <span className="text-xs text-muted-foreground">{m.email}</span>
                      {m.role === "koordinator" ? (
                        <Badge variant="secondary" className="text-xs">
                          Teamkoordinator
                        </Badge>
                      ) : (
                        m.isTeamleiter && (
                          <Badge variant="secondary" className="text-xs">
                            Teamleiter
                          </Badge>
                        )
                      )}
                    </div>

                    {/* Koordinatoren beziehen ihre Rechte aus der Team-Zuweisung
                        (Teamleiter-Status), nicht aus der gestuften
                        Freischaltung — das Stufen-Feld wäre hier irreführend. */}
                    {m.role === "koordinator" ? (
                      <p className="text-xs text-muted-foreground">
                        {isOwnerView
                          ? "Die Team-Zuweisung verwaltest du im Bereich „Teamkoordinatoren“ auf dieser Seite."
                          : "Die Team-Zuweisung verwaltet der Konto-Inhaber."}
                      </p>
                    ) : /* Teamleiter-Sicht: Die Zeile des Konto-Inhabers bleibt
                        schreibgeschützt — der Server lehnt solche Änderungen
                        ohnehin ab (403). */
                    !isOwnerView && m.userId === team.ownerId ? (
                      <p className="text-xs text-muted-foreground">
                        Konto-Inhaber — die Rechte kannst du hier nicht ändern.
                      </p>
                    ) : (
                    <div className="space-y-1.5">
                      <Label htmlFor={`al-${m.userId}`} className="text-xs text-muted-foreground">
                        Freischaltung in diesem Team
                      </Label>
                      <Select
                        value={level}
                        disabled={busy}
                        onValueChange={(v) =>
                          void save(m, { accessLevel: v as TeamAccessLevel })
                        }
                      >
                        <SelectTrigger
                          id={`al-${m.userId}`}
                          data-testid={`access-level-${m.userId}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ACCESS_LEVEL_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {option && (
                        <p className="text-xs text-muted-foreground">{option.hint}</p>
                      )}
                    </div>
                    )}

                    {/* Teamleiter-Status: zählt serverseitig wie Stufe 2 und ist
                        Voraussetzung für die Lohndaten-Freigabe. Nur für
                        Assistenzkraft-Mitgliedschaften — Assistenznehmer und
                        Konto-Inhaber steuern ihre Rechte nicht über dieses Flag.
                        In der Teamleiter-Sicht ausgeblendet (Inhaber-only). */}
                    {isOwnerView && m.role === "assistant" && (
                    <div className="flex items-center gap-3 pt-1">
                      <Switch
                        id={`tl-${m.userId}`}
                        checked={m.isTeamleiter ?? false}
                        disabled={busy}
                        onCheckedChange={(v) =>
                          void save(
                            m,
                            { isTeamleiter: v },
                            v
                              ? `${m.name} ist jetzt Teamleiter.`
                              : `${m.name} ist kein Teamleiter mehr.`,
                          )
                        }
                        data-testid={`toggle-teamleiter-${m.userId}`}
                      />
                      <Label htmlFor={`tl-${m.userId}`} className="text-sm cursor-pointer">
                        Teamleiter
                        <span className="block text-xs text-muted-foreground font-normal">
                          Darf Dienste, Abwesenheiten und Zeiterfassung in diesem Team verwalten
                          — zählt wie Stufe 2.
                          {isDienstleister &&
                            " Nur Teamleiter können die Lohndaten-Freigabe bekommen."}
                        </span>
                      </Label>
                    </div>
                    )}

                    {/* Lohndaten sind eine bewusste Extra-Freigabe und nur für
                        Teamleiter in Dienstleister-Konten zulässig (Inhaber-only). */}
                    {isOwnerView && isDienstleister && m.isTeamleiter && (
                      <div className="flex items-center gap-3 pt-1">
                        <Switch
                          id={`cp-${m.userId}`}
                          checked={m.canViewPayroll ?? false}
                          disabled={busy}
                          onCheckedChange={(v) => void save(m, { canViewPayroll: v })}
                        />
                        <Label htmlFor={`cp-${m.userId}`} className="text-sm cursor-pointer">
                          Darf Lohn- und Personaldaten sehen
                          <span className="block text-xs text-muted-foreground font-normal">
                            Gibt Zugang zu Stundenlohn, Sozialversicherungs- und Steuerdaten.
                          </span>
                        </Label>
                      </div>
                    )}
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

/**
 * Zugriffsrechte-Knopf für Teamleiter ohne Admin-Rolle: erscheint nur, wenn
 * die eigene Mitgliedschaft in GENAU DIESEM Team als Teamleiter markiert ist —
 * eine Freischaltung (Stufe 2) genügt nicht. Die Durchsetzung bleibt
 * serverseitig; hier geht es nur darum, den Dialog nicht in Teams anzubieten,
 * in denen jeder Speicherversuch abgelehnt würde.
 */
function TeamleiterRechteButton({ teamId, onRechte }: { teamId: number; onRechte: () => void }) {
  const { currentUser } = useAuth();
  const { data } = useListTeamMembers(teamId);
  const isTeamleiterHier = ((data ?? []) as Member[]).some(
    (m) => m.userId === currentUser?.id && m.isTeamleiter,
  );
  if (!isTeamleiterHier) return null;
  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5"
      onClick={onRechte}
      data-testid={`rights-team-${teamId}`}
      title="Zugriffsrechte der Mitglieder verwalten"
    >
      <UserCog className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">Zugriffsrechte</span>
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Teamkoordinatoren: Verwaltungspersonen des Dienstleister-Kontos mit eigenem
// Login. Die Team-Zuweisung vergibt Teamleiter-Rechte je Team; sichtbar nur
// für den Konto-Inhaber (Dienstleister).
// ---------------------------------------------------------------------------

function KoordinatorAnlegenDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const createKoordinator = useCreateKoordinator();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim() || !email.trim()) {
      setError("Bitte Name und E-Mail-Adresse angeben.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createKoordinator.mutateAsync({ data: { name: name.trim(), email: email.trim() } });
      await queryClient.invalidateQueries({ queryKey: getListKoordinatorenQueryKey() });
      onClose();
    } catch (err) {
      setError(
        planUpgradeMessage(err) ??
          ownerSessionMessage(err) ??
          readableApiError(err, "Speichern fehlgeschlagen. Bitte erneut versuchen."),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">Teamkoordinator anlegen</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            Ein Teamkoordinator plant und verwaltet die Teams, die du ihm zuweist — ohne selbst
            Assistenzkraft zu sein. Nach dem Anlegen kannst du ihn per Einladungslink zum eigenen
            Zugang einladen.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="koordinator-name">Name</Label>
            <Input
              id="koordinator-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Vor- und Nachname"
              data-testid="koordinator-name"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="koordinator-email">E-Mail-Adresse</Label>
            <Input
              id="koordinator-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@beispiel.de"
              data-testid="koordinator-email"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Abbrechen
          </Button>
          <Button
            onClick={() => void handleSave()}
            disabled={saving}
            data-testid="koordinator-speichern"
          >
            {saving ? "Speichert …" : "Anlegen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function KoordinatorenBereich({ teams }: { teams: Team[] }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { currentUser } = useAuth();
  const { data, isLoading } = useListKoordinatoren();
  const koordinatoren = (data ?? []) as Koordinator[];
  const setKoordinatorTeams = useSetKoordinatorTeams();
  const updateKoordinator = useUpdateKoordinator();
  const deleteKoordinator = useDeleteKoordinator();

  const [createOpen, setCreateOpen] = useState(false);
  const [inviteFor, setInviteFor] = useState<Koordinator | null>(null);
  const [sperrenFor, setSperrenFor] = useState<Koordinator | null>(null);
  const [entfernenFor, setEntfernenFor] = useState<Koordinator | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  // Gleiche Premium-Bedingung wie der Einladungslink für Assistenzkräfte:
  // Koordinatoren sind nur mit eigenem Login sinnvoll (caregiverLogin).
  const canManage = hasAccess(currentUser, "caregiverLogin");

  async function toggleTeam(k: Koordinator, teamId: number, assigned: boolean) {
    const next = assigned
      ? Array.from(new Set([...k.teamIds, teamId]))
      : k.teamIds.filter((t) => t !== teamId);
    setBusyId(k.id);
    try {
      await setKoordinatorTeams.mutateAsync({ id: k.id, data: { teamIds: next } });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListKoordinatorenQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListTeamMembersQueryKey(teamId) }),
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() }),
      ]);
    } catch (err) {
      if (!navigator.onLine) return; // Banner erklärt den Grund bereits.
      toast({
        title: "Fehler beim Speichern",
        description:
          planUpgradeMessage(err) ??
          ownerSessionMessage(err) ??
          readableApiError(err, "Bitte erneut versuchen."),
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  }

  /** Nach Sperren/Entsperren/Entfernen betroffene Listen neu laden. */
  async function refreshKoordinatorData(k: Koordinator) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getListKoordinatorenQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() }),
      ...k.teamIds.map((teamId) =>
        queryClient.invalidateQueries({ queryKey: getListTeamMembersQueryKey(teamId) }),
      ),
    ]);
  }

  function showError(err: unknown, title: string) {
    if (!navigator.onLine) return; // Banner erklärt den Grund bereits.
    toast({
      title,
      description:
        ownerSessionMessage(err) ?? readableApiError(err, "Bitte erneut versuchen."),
      variant: "destructive",
    });
  }

  async function handleSperren(k: Koordinator, isActive: boolean) {
    setBusyId(k.id);
    try {
      await updateKoordinator.mutateAsync({ id: k.id, data: { isActive } });
      await refreshKoordinatorData(k);
      toast({
        title: isActive ? "Zugang entsperrt" : "Zugang gesperrt",
        description: isActive
          ? `${k.name} kann sich wieder anmelden.`
          : `${k.name} kann sich nicht mehr anmelden. Bestehende Sitzungen enden sofort.`,
      });
    } catch (err) {
      showError(err, isActive ? "Entsperren fehlgeschlagen" : "Sperren fehlgeschlagen");
    } finally {
      setBusyId(null);
      setSperrenFor(null);
    }
  }

  async function handleEntfernen(k: Koordinator) {
    setBusyId(k.id);
    try {
      await deleteKoordinator.mutateAsync({ id: k.id });
      await refreshKoordinatorData(k);
      toast({
        title: "Koordinator entfernt",
        description: `${k.name} wurde samt Team-Zuweisungen und Zugang entfernt.`,
      });
    } catch (err) {
      showError(err, "Entfernen fehlgeschlagen");
    } finally {
      setBusyId(null);
      setEntfernenFor(null);
    }
  }

  return (
    <section className="space-y-3" data-testid="koordinatoren-bereich">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-serif font-bold text-foreground">Teamkoordinatoren</h3>
          <p className="text-muted-foreground text-sm mt-0.5">
            Verwaltungspersonen mit eigenem Zugang — sie planen und verwalten die Teams, die du
            ihnen zuweist, tauchen aber nicht als Assistenzkraft im Dienstplan auf.
          </p>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          variant="outline"
          className="gap-2"
          disabled={!canManage}
          title={canManage ? undefined : PLAN_FEATURE_MESSAGES.caregiverLogin}
          data-testid="koordinator-anlegen"
        >
          {canManage ? <UserPlus className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
          <span className="hidden sm:inline">Koordinator anlegen</span>
          <span className="sm:hidden">Neu</span>
        </Button>
      </div>

      {!canManage && (
        <PlanLimitBanner>{PLAN_FEATURE_MESSAGES.caregiverLogin}</PlanLimitBanner>
      )}

      {isLoading ? (
        <Skeleton className="h-24 w-full rounded-xl" />
      ) : koordinatoren.length === 0 ? (
        <Card className="border-border/50 shadow-sm">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            Noch keine Teamkoordinatoren angelegt.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {koordinatoren.map((k) => {
            const busy = busyId === k.id;
            return (
              <Card
                key={k.id}
                className="border-border/50 shadow-sm"
                data-testid={`koordinator-card-${k.id}`}
              >
                <CardContent className="p-4 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{k.name}</span>
                    <span className="text-xs text-muted-foreground">{k.email}</span>
                    {!k.isActive ? (
                      <Badge variant="destructive" className="text-xs">
                        Gesperrt
                      </Badge>
                    ) : k.hasLogin ? (
                      <Badge variant="secondary" className="text-xs">
                        Zugang aktiv
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs">
                        Noch kein Zugang
                      </Badge>
                    )}
                    <div className="ml-auto flex flex-wrap items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => setInviteFor(k)}
                        disabled={busy || !k.isActive}
                        data-testid={`koordinator-einladen-${k.id}`}
                        title={
                          k.isActive
                            ? "Einladungslink für den eigenen Zugang generieren"
                            : "Zugang ist gesperrt — erst entsperren"
                        }
                      >
                        <Mail className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Einladen</span>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        disabled={busy}
                        onClick={() =>
                          k.isActive ? setSperrenFor(k) : void handleSperren(k, true)
                        }
                        data-testid={`koordinator-sperren-${k.id}`}
                        title={
                          k.isActive
                            ? "Zugang sperren — die Person kann sich nicht mehr anmelden"
                            : "Zugang wieder entsperren"
                        }
                      >
                        {k.isActive ? (
                          <Ban className="h-3.5 w-3.5" />
                        ) : (
                          <Unlock className="h-3.5 w-3.5" />
                        )}
                        <span className="hidden sm:inline">
                          {k.isActive ? "Sperren" : "Entsperren"}
                        </span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1.5 text-destructive hover:text-destructive"
                        disabled={busy}
                        onClick={() => setEntfernenFor(k)}
                        data-testid={`koordinator-entfernen-${k.id}`}
                        title="Koordinator entfernen — Eintrag, Team-Zuweisungen und Zugang werden gelöscht"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Entfernen</span>
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground">
                      Zugewiesene Teams — dort hat {k.name.split(" ")[0] ?? k.name}{" "}
                      Teamleiter-Rechte:
                    </p>
                    <div className="flex flex-wrap gap-x-5 gap-y-2">
                      {teams.map((team) => {
                        const assigned = k.teamIds.includes(team.id);
                        return (
                          <div key={team.id} className="flex items-center gap-2">
                            <Switch
                              id={`kt-${k.id}-${team.id}`}
                              checked={assigned}
                              disabled={busy}
                              onCheckedChange={(v) => void toggleTeam(k, team.id, v)}
                              data-testid={`koordinator-team-${k.id}-${team.id}`}
                            />
                            <Label
                              htmlFor={`kt-${k.id}-${team.id}`}
                              className="text-sm cursor-pointer"
                            >
                              {team.name}
                            </Label>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {createOpen && <KoordinatorAnlegenDialog onClose={() => setCreateOpen(false)} />}
      {inviteFor && (
        <InviteDialog
          open
          onClose={() => setInviteFor(null)}
          userId={inviteFor.id}
          userName={inviteFor.name}
        />
      )}

      {/* Bestätigung: Zugang sperren (Entsperren geht ohne Rückfrage). */}
      <AlertDialog open={sperrenFor != null} onOpenChange={(v) => !v && setSperrenFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Zugang sperren?</AlertDialogTitle>
            <AlertDialogDescription>
              {sperrenFor?.name} kann sich danach nicht mehr anmelden — auch bestehende
              Sitzungen enden sofort. Der Eintrag und die Team-Zuweisungen bleiben bestehen,
              du kannst den Zugang jederzeit wieder entsperren.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyId != null}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              disabled={busyId != null}
              onClick={() => sperrenFor && void handleSperren(sperrenFor, false)}
              data-testid="koordinator-sperren-bestaetigen"
            >
              Zugang sperren
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bestätigung: Koordinator entfernen (endgültig). */}
      <AlertDialog open={entfernenFor != null} onOpenChange={(v) => !v && setEntfernenFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Koordinator entfernen?</AlertDialogTitle>
            <AlertDialogDescription>
              {entfernenFor?.name} wird endgültig entfernt: Eintrag, alle Team-Zuweisungen und
              der Login-Zugang. Bestehende Sitzungen enden sofort. Das lässt sich nicht
              rückgängig machen — wenn du dir unsicher bist, sperre den Zugang stattdessen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyId != null}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              disabled={busyId != null}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => entfernenFor && void handleEntfernen(entfernenFor)}
              data-testid="koordinator-entfernen-bestaetigen"
            >
              Endgültig entfernen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/**
 * Ein Team als aufklappbarer Block: Kopfzeile mit Aktionen, darunter die
 * Assistenzkräfte dieses Teams samt "Assistenzkraft anlegen".
 */
function TeamBlock({
  team,
  teams,
  expanded,
  onToggle,
  isFullAdmin,
  onTransfer,
  onRechte,
  onEdit,
  onDelete,
  confirmDelete,
  onCancelDelete,
  collapsible,
}: {
  team: Team;
  teams: Team[];
  expanded: boolean;
  onToggle: () => void;
  isFullAdmin: boolean;
  onTransfer: () => void;
  onRechte: () => void;
  onEdit: () => void;
  onDelete: () => void;
  confirmDelete: boolean;
  onCancelDelete: () => void;
  collapsible: boolean;
}) {
  return (
    <Card className="border-border/50 shadow-sm" data-testid={`team-block-${team.id}`}>
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-border/40 bg-muted/20">
        {collapsible ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            data-testid={`toggle-team-${team.id}`}
            className="flex min-h-11 min-w-11 flex-1 items-center gap-2 rounded-md px-1 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
            )}
            <Building2 className="h-4 w-4 text-muted-foreground/60 shrink-0" aria-hidden="true" />
            <span className="font-medium truncate">{team.name}</span>
          </button>
        ) : (
          <div className="flex flex-1 items-center gap-2 px-1">
            <Building2 className="h-4 w-4 text-muted-foreground/60 shrink-0" aria-hidden="true" />
            <span className="font-medium truncate">{team.name}</span>
          </div>
        )}

        {isFullAdmin && (
          <div className="flex flex-wrap items-center gap-2">
            {teams.length > 1 && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={onTransfer}
                data-testid={`transfer-team-${team.id}`}
                title="Assistenzkraft in ein anderes Team überführen"
              >
                <ArrowRightLeft className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Überführen</span>
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={onRechte}
              data-testid={`rights-team-${team.id}`}
              title="Zugriffsrechte der Mitglieder verwalten"
            >
              <UserCog className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Zugriffsrechte</span>
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Bearbeiten</span>
            </Button>
            <Button
              variant={confirmDelete ? "destructive" : "ghost"}
              size="sm"
              className="gap-1.5"
              onClick={onDelete}
              onBlur={onCancelDelete}
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{confirmDelete ? "Wirklich?" : "Löschen"}</span>
            </Button>
          </div>
        )}
        {!isFullAdmin && <TeamleiterRechteButton teamId={team.id} onRechte={onRechte} />}
      </div>

      {expanded && (
        <CardContent className="p-4">
          <AssistenzkraftListe teamId={team.id} canManageMembers={isFullAdmin} />
        </CardContent>
      )}
    </Card>
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
  const [rechteTeam, setRechteTeam] = useState<Team | undefined>();
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const isFullAdmin = isAdminRole(currentUser?.role);
  // Freigeschaltete Nicht-Admins (klassische Teamleiter oder ab Stufe 1) pflegen
  // hier die Assistenzkräfte, aber ohne Team-Struktur-Aktionen.
  const isDelegiert =
    !isFullAdmin &&
    (currentUser?.isTeamleiter === true || hasTeamAccessLevel(currentUser, "stufe1"));
  const isDienstleisterKonto = currentUser?.accountType === "dienstleister";

  const teams: Team[] = (data ?? []) as Team[];
  // Privatkonten führen genau ein Team: Der Mitgliederbereich wird direkt
  // aufgeklappt gezeigt, ohne Team-Auswahl davor.
  const singleTeamView = teams.length <= 1;

  // Free-Plan begrenzt die Anzahl der Teams (Free = 1). Da die Registrierung
  // bereits ein Standard-Team anlegt, startet ein Free-Konto direkt am Limit.
  const teamLimit = getLimit(currentUser, "maxTeams");
  const canAddTeam = isWithinLimit(currentUser, "maxTeams", teams.length);

  // Teams sind standardmäßig offen — Zuklappen ist die bewusste Aktion. So
  // sieht man die Assistenzkräfte sofort, statt erst suchen zu müssen.
  function isExpanded(teamId: number): boolean {
    if (singleTeamView) return true;
    return expanded[teamId] !== false;
  }

  function toggleTeam(teamId: number) {
    setExpanded((prev) => ({ ...prev, [teamId]: !prev[teamId] }));
  }

  function openCreate() {
    setEditTeam(undefined);
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl md:text-3xl font-serif font-bold text-foreground">
            Team-Verwaltung
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">Teams und Assistenzkräfte verwalten</p>
        </div>
        {/* Neues Team nur für Konto-Admins mit Dienstleister-Konto — Privatkonten
            und freigeschaltete Nicht-Admins legen keine Teams an. */}
        {isFullAdmin &&
          isDienstleisterKonto &&
          (canAddTeam ? (
            <Button onClick={openCreate} className="gap-2" data-testid="team-anlegen">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Neues Team</span>
              <span className="sm:hidden">Neu</span>
            </Button>
          ) : (
            <Button
              disabled
              className="gap-2"
              data-testid="team-anlegen"
              title={`Im Free-Plan ist max. ${teamLimit} Team möglich. Upgrade auf Premium für mehrere Teams.`}
            >
              <Lock className="h-4 w-4" />
              <span className="hidden sm:inline">Neues Team</span>
              <span className="sm:hidden">Neu</span>
            </Button>
          ))}
      </div>

      {/* Limit-Hinweis (Free-Plan). Bei Premium ist teamLimit null. */}
      {isFullAdmin && isDienstleisterKonto && !canAddTeam && teamLimit !== null && (
        <PlanLimitBanner>
          Im Free-Plan ist maximal {teamLimit} Team möglich. Für mehrere Teams ist ein Upgrade auf
          Premium nötig.
        </PlanLimitBanner>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      ) : teams.length === 0 ? (
        <Card className="border-border/50 shadow-sm">
          <CardContent className="p-12 text-center">
            <p className="text-muted-foreground mb-4">
              {isDelegiert
                ? "Dir ist derzeit kein Team zugewiesen."
                : "Noch keine Teams angelegt."}
            </p>
            {isFullAdmin && (
              <Button onClick={openCreate} variant="outline" className="gap-2">
                <Plus className="h-4 w-4" /> Erstes Team anlegen
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {teams.map((team) => (
            <TeamBlock
              key={team.id}
              team={team}
              teams={teams}
              expanded={isExpanded(team.id)}
              onToggle={() => toggleTeam(team.id)}
              isFullAdmin={isFullAdmin}
              onTransfer={() => setTransferTeam(team)}
              onRechte={() => setRechteTeam(team)}
              onEdit={() => {
                setEditTeam(team);
                setDialogOpen(true);
              }}
              onDelete={() => void handleDelete(team.id)}
              confirmDelete={confirmDelete === team.id}
              onCancelDelete={() => setConfirmDelete(null)}
              collapsible={!singleTeamView}
            />
          ))}
        </div>
      )}

      {/* Teamkoordinatoren: nur der Konto-Inhaber eines Dienstleister-Kontos
          verwaltet sie — Teamleiter und freigeschaltete Mitglieder nicht. */}
      {isFullAdmin && isDienstleisterKonto && !isLoading && (
        <KoordinatorenBereich teams={teams} />
      )}

      {isFullAdmin && isDienstleisterKonto && teams.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Teams strukturieren Assistenzkräfte und Dienstpläne. Ein Team kann nur gelöscht werden,
          wenn ihm keine Mitglieder oder Daten mehr zugeordnet sind. Ein Teamwechsel läuft immer
          über „Überführen“ — so wandern die Daten der Assistenzkraft in einem Schritt mit.
        </p>
      )}

      {dialogOpen && <TeamDialog open={dialogOpen} onClose={closeDialog} editTeam={editTeam} />}

      {transferTeam && (
        <TransferDialog
          team={transferTeam}
          teams={teams}
          onClose={() => setTransferTeam(undefined)}
        />
      )}

      {rechteTeam && (
        <ZugriffsrechteDialog
          team={rechteTeam}
          isDienstleister={isDienstleisterKonto}
          isOwnerView={isFullAdmin}
          onClose={() => setRechteTeam(undefined)}
        />
      )}
    </div>
  );
}
