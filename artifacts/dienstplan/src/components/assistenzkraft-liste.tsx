import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "wouter";
import { format, parseISO } from "date-fns";
import {
  useListUsers,
  useListContracts,
  useListTeamMembers,
  useRemoveTeamMember,
  getListUsersQueryKey,
  getListContractsQueryKey,
  getListTeamMembersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/auth";
import { isWithinLimit, getLimit, hasAccess } from "@/lib/entitlements";
import { readableApiError, PLAN_FEATURE_MESSAGES } from "@/lib/api-error";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
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
import {
  Calendar,
  Mail,
  Phone,
  MapPin,
  Pencil,
  UserPlus,
  UserMinus,
  Send,
  Download,
  Lock,
  ShieldCheck,
} from "lucide-react";
import { formatHours } from "@/lib/utils";
import { PlanLimitBanner } from "@/components/plan-limit-banner";
import { toast } from "sonner";
import { StatementExportDialog } from "@/components/statement-export-dialog";
import {
  AssistentDialog,
  InviteDialog,
  splitName,
  type Assistenzkraft,
  type Vertrag,
} from "@/components/assistenzkraft-formular";

type Mitgliedschaft = {
  userId: number;
  teamCount: number;
  isTeamleiter: boolean;
};

type Props = {
  /** Team, dessen Assistenzkräfte gezeigt werden. null = kein Team-Kontext. */
  teamId: number | null;
  /**
   * Darf Mitgliedschaften steuern (aus dem Team entfernen). Nur für
   * Konto-Admins — die Durchsetzung bleibt serverseitig.
   */
  canManageMembers: boolean;
};

/**
 * Assistenzkräfte eines Teams als Karten-Liste — inklusive Anlegen,
 * Bearbeiten, Einladen, PDF-Stundennachweis und Entfernen aus dem Team.
 *
 * Aufbau der Karte: oben Name mit Kontaktdaten und Status-Badges, in der
 * Mitte die Vertragsdaten als Beschriftung-Wert-Zeilen, unten die Aktionen.
 * Der Teamleiter-Status wird im Zugriffsrechte-Dialog der Team-Verwaltung
 * gepflegt; die Karte zeigt ihn nur als Badge an.
 */
export function AssistenzkraftListe({ teamId, canManageMembers }: Props) {
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();

  const teamScope = teamId != null;
  // staleTime wird vom globalen QueryClient (5 min) übernommen — kein
  // lokaler Override nötig, der Orval-Typ-Inferenz stört.
  const { data: users, isLoading: usersLoading } = useListUsers(
    teamScope ? { role: "assistant", teamId } : { role: "assistant" },
  );
  const { data: contracts, isLoading: contractsLoading } = useListContracts();

  // Mitgliederliste des Teams: liefert teamCount (Warnung vor der LETZTEN
  // Mitgliedschaft) und den Teamleiter-Status je Person.
  const { data: teamMembers } = useListTeamMembers(teamId ?? 0, {
    query: { enabled: teamScope },
  } as Parameters<typeof useListTeamMembers>[1]) as { data?: Mitgliedschaft[] };

  const removeMember = useRemoveTeamMember();

  const [removeUser, setRemoveUser] = useState<Assistenzkraft | undefined>();
  const [memberBusy, setMemberBusy] = useState(false);

  const memberByUserId = new Map((teamMembers ?? []).map((m) => [m.userId, m]));

  async function invalidateMemberQueries() {
    await queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
    await queryClient.invalidateQueries({ queryKey: getListContractsQueryKey() });
    if (teamId != null) {
      await queryClient.invalidateQueries({ queryKey: getListTeamMembersQueryKey(teamId) });
    }
  }

  async function handleRemoveFromTeam() {
    if (!removeUser || teamId == null) return;
    setMemberBusy(true);
    try {
      await removeMember.mutateAsync({ id: teamId, userId: removeUser.id });
      setRemoveUser(undefined);
      await invalidateMemberQueries();
      toast.success("Assistenzkraft aus dem Team entfernt.");
    } catch (err) {
      if (!navigator.onLine) return; // Banner erklärt den Grund bereits.
      toast.error(readableApiError(err, "Entfernen fehlgeschlagen. Bitte erneut versuchen."));
    } finally {
      setMemberBusy(false);
    }
  }

  // Free-Plan begrenzt die Anzahl der Assistenzkräfte. Bestandsschutz: vorhandene
  // bleiben sichtbar und editierbar, nur das Anlegen darüber ist gesperrt.
  const assistantCount = (users ?? []).length;
  const assistantLimit = getLimit(currentUser, "maxAssistants");
  const canAddAssistant = isWithinLimit(currentUser, "maxAssistants", assistantCount);

  // Premium-Gates (reine UX — autoritativ setzt der Server durch).
  const canPayrollExport = hasAccess(currentUser, "payrollExport");
  const canInvite = hasAccess(currentUser, "caregiverLogin");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editUser, setEditUser] = useState<Assistenzkraft | undefined>();
  const [editContract, setEditContract] = useState<Vertrag | undefined>();
  const [dialogOpenToken, setDialogOpenToken] = useState(0);
  const [inviteUser, setInviteUser] = useState<Assistenzkraft | undefined>();
  const [exportUser, setExportUser] = useState<Assistenzkraft | undefined>();

  const isLoading = usersLoading || contractsLoading;

  // Hervorheben einer Assistenzkraft (z.B. vom Dashboard-Hinweis "wenig Resturlaub").
  const [searchParams] = useSearchParams();
  const highlightId = searchParams.get("highlight");
  const highlightRef = useRef<HTMLDivElement | null>(null);
  const [highlightActive, setHighlightActive] = useState(false);

  useEffect(() => {
    if (!highlightId || isLoading) return;
    const node = highlightRef.current;
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightActive(true);
    const timer = setTimeout(() => setHighlightActive(false), 2500);
    return () => clearTimeout(timer);
  }, [highlightId, isLoading, users]);

  function openCreate() {
    setEditUser(undefined);
    setEditContract(undefined);
    setDialogOpenToken((t) => t + 1);
    setDialogOpen(true);
  }

  function openEdit(user: Assistenzkraft, contract?: Vertrag) {
    setEditUser(user);
    setEditContract(contract);
    setDialogOpenToken((t) => t + 1);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditUser(undefined);
    setEditContract(undefined);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {isLoading
            ? "Assistenzkräfte werden geladen …"
            : `${assistantCount} ${assistantCount === 1 ? "Assistenzkraft" : "Assistenzkräfte"}`}
        </p>
        {canAddAssistant ? (
          <Button onClick={openCreate} className="gap-2" data-testid="assistenzkraft-anlegen">
            <UserPlus className="h-4 w-4" />
            Assistenzkraft anlegen
          </Button>
        ) : (
          <Button
            disabled
            className="gap-2"
            data-testid="assistenzkraft-anlegen"
            title={`Im Free-Plan sind max. ${assistantLimit} Assistenzkräfte möglich. Upgrade auf Premium für unbegrenzte Assistenzkräfte.`}
          >
            <Lock className="h-4 w-4" />
            Assistenzkraft anlegen
          </Button>
        )}
      </div>

      {!canAddAssistant && assistantLimit !== null && (
        <PlanLimitBanner>
          Im Free-Plan sind maximal {assistantLimit} Assistenzkräfte möglich. Für unbegrenzte
          Assistenzkräfte ist ein Upgrade auf Premium nötig.
        </PlanLimitBanner>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(users ?? []).map((user) => {
            const userContracts = (contracts ?? []).filter((c) => c.userId === user.id);
            const activeContract = userContracts.find(
              (c) => !c.endDate || new Date(c.endDate) > new Date(),
            );
            const { vorname, nachname } = splitName(user.name);
            const isHighlighted = highlightId != null && String(user.id) === highlightId;
            const membership = memberByUserId.get(user.id);
            const isTeamleiter = membership?.isTeamleiter === true;

            return (
              <Card
                key={user.id}
                ref={isHighlighted ? highlightRef : undefined}
                data-testid={`assistant-card-${user.id}`}
                data-highlighted={isHighlighted && highlightActive ? "true" : "false"}
                className={`personalakte-glossy overflow-hidden flex flex-col ${
                  isHighlighted && highlightActive ? "ring-2 ring-primary ring-offset-2" : ""
                }`}
              >
                <div className="personalakte-glossy__header px-5 py-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-base leading-tight">
                      {vorname} {nachname}
                    </h3>
                    <div className="flex items-center gap-1.5 mt-1.5 text-xs text-muted-foreground">
                      <Mail className="h-3 w-3 shrink-0" />
                      <span className="truncate">{user.email}</span>
                    </div>
                    {user.phone && (
                      <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
                        <Phone className="h-3 w-3 shrink-0" />
                        <span>{user.phone}</span>
                      </div>
                    )}
                    {user.address && (
                      <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3 shrink-0" />
                        <span className="truncate">{user.address}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Badge variant={user.isActive ? "default" : "secondary"} className="text-xs">
                      {user.isActive ? "Aktiv" : "Inaktiv"}
                    </Badge>
                    {isTeamleiter && (
                      <Badge
                        variant="outline"
                        className="text-xs gap-1"
                        data-testid={`teamleiter-badge-${user.id}`}
                      >
                        <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                        Teamleiter
                      </Badge>
                    )}
                  </div>
                </div>

                <CardContent className="personalakte-glossy__content p-5 flex-1 flex flex-col justify-between gap-4">
                  {activeContract ? (
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Wochenstunden</span>
                        <span className="font-medium">
                          {formatHours(activeContract.weeklyHours)} h
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Arbeitstage/Woche</span>
                        <span className="font-medium">
                          {formatHours(activeContract.workdaysPerWeek ?? 5)} Tage
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Urlaubsanspruch</span>
                        <span className="font-medium">{activeContract.vacationDays} Tage</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5" aria-hidden="true" /> Seit
                        </span>
                        <span className="font-medium">
                          {/* parseISO statt new Date(): Datums-Strings ohne Zeitanteil
                              würden sonst als UTC-Mitternacht gedeutet und westlich
                              von UTC einen Tag zu früh angezeigt. */}
                          {format(parseISO(activeContract.startDate), "dd.MM.yyyy")}
                        </span>
                      </div>
                      {activeContract.notes && (
                        <p className="text-xs text-muted-foreground pt-1 border-t border-border/40">
                          {activeContract.notes}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground py-4 px-3 text-center border border-dashed rounded-lg">
                      Arbeitszeiten sind noch nicht hinterlegt. Du kannst sie beim Bearbeiten
                      ergänzen.
                    </div>
                  )}

                  <div className="personalakte-glossy__actions flex justify-end gap-2 flex-wrap">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 text-muted-foreground hover:text-foreground"
                      onClick={() => setExportUser(user as Assistenzkraft)}
                      disabled={!canPayrollExport}
                      title={
                        canPayrollExport
                          ? "Stundennachweis als PDF exportieren"
                          : PLAN_FEATURE_MESSAGES.payrollExport
                      }
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Nachweis</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 text-muted-foreground hover:text-foreground"
                      onClick={() => setInviteUser(user as Assistenzkraft)}
                      disabled={!canInvite}
                      title={
                        canInvite ? "Einladungslink generieren" : PLAN_FEATURE_MESSAGES.caregiverLogin
                      }
                    >
                      <Send className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Einladen</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() =>
                        openEdit(user as Assistenzkraft, activeContract as Vertrag | undefined)
                      }
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Bearbeiten
                    </Button>
                    {canManageMembers && teamScope && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1.5 text-muted-foreground hover:text-destructive"
                        onClick={() => setRemoveUser(user as Assistenzkraft)}
                        title="Aus diesem Team entfernen"
                        data-testid={`remove-member-${user.id}`}
                      >
                        <UserMinus className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Aus Team entfernen</span>
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {(!users || users.length === 0) && (
            <div className="col-span-full p-12 text-center border rounded-xl bg-card">
              <p className="text-muted-foreground mb-4">Noch keine Assistenzkräfte in diesem Team.</p>
              <Button onClick={openCreate} variant="outline" className="gap-2">
                <UserPlus className="h-4 w-4" /> Erste Assistenzkraft anlegen
              </Button>
            </div>
          )}
        </div>
      )}

      <AssistentDialog
        key={dialogOpenToken}
        open={dialogOpen}
        onClose={closeDialog}
        editUser={editUser}
        editContract={editContract}
        teamId={teamId}
      />
      {inviteUser && (
        <InviteDialog
          open={!!inviteUser}
          onClose={() => setInviteUser(undefined)}
          userId={inviteUser.id}
          userName={inviteUser.name}
        />
      )}
      {exportUser && (
        <StatementExportDialog
          open={!!exportUser}
          onClose={() => setExportUser(undefined)}
          teamId={teamId}
          assistantFilter={exportUser.id}
          assistantName={exportUser.name}
          rangeFromSections
          description={
            <>
              Einzelnachweis für{" "}
              <span className="font-medium text-foreground">{exportUser.name}</span> als PDF.
              Wähle den gewünschten Zeitraum – pro Monat entsteht eine Seite.
            </>
          }
        />
      )}

      {/* Bestätigung vor dem Entfernen aus dem Team; bei der LETZTEN
          Team-Zuordnung zusätzliche Warnung (Person verschwindet aus allen
          team-gescopten Listen, Daten bleiben erhalten). */}
      <AlertDialog open={!!removeUser} onOpenChange={(v) => !v && setRemoveUser(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Aus dem Team entfernen?</AlertDialogTitle>
            <AlertDialogDescription>
              {removeUser && (
                <>
                  {removeUser.name} wird aus diesem Team entfernt.{" "}
                  {(memberByUserId.get(removeUser.id)?.teamCount ?? 0) <= 1 ? (
                    <span className="font-medium text-destructive">
                      Das ist die letzte Team-Zuordnung dieser Person — sie erscheint danach in
                      keiner Team-Liste mehr, bis sie wieder einem Team zugeordnet wird. Daten
                      (Verträge, Dienste, Zeiten) bleiben erhalten.
                    </span>
                  ) : (
                    "Andere Team-Mitgliedschaften bleiben unberührt."
                  )}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={memberBusy}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleRemoveFromTeam();
              }}
              disabled={memberBusy}
              data-testid="confirm-remove-member"
            >
              {memberBusy ? "Entfernen..." : "Entfernen"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
