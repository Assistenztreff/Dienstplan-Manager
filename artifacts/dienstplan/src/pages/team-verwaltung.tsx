import { useState } from "react";
import {
  useListTeams,
  useCreateTeam,
  useUpdateTeam,
  useDeleteTeam,
  getListTeamsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Plus, Pencil, Trash2, Building2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Team = {
  id: number;
  name: string;
  ownerId: number;
  createdAt: string;
};

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
    } catch {
      setError("Speichern fehlgeschlagen. Bitte erneut versuchen.");
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

export default function TeamVerwaltung() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useListTeams();
  const deleteTeam = useDeleteTeam();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTeam, setEditTeam] = useState<Team | undefined>();
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const teams: Team[] = (data ?? []) as Team[];

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
    } catch {
      toast({
        title: "Team kann nicht gelöscht werden",
        description: "Es sind noch Daten oder Mitglieder zugeordnet.",
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
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Neues Team</span>
          <span className="sm:hidden">Neu</span>
        </Button>
      </div>

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
    </div>
  );
}
