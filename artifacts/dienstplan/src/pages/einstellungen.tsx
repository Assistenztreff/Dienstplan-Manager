import { useRef, useState } from "react";
import {
  useListShiftModels,
  useCreateShiftModel,
  useUpdateShiftModel,
  useDeleteShiftModel,
  getListShiftModelsQueryKey,
  useListShiftTemplates,
  useCreateShiftTemplate,
  useUpdateShiftTemplate,
  useDeleteShiftTemplate,
  getListShiftTemplatesQueryKey,
  useGetBrandingSettings,
  useUpdateBrandingSettings,
  getGetBrandingSettingsQueryKey,
  useChangePassword,
  useUpdateProfile,
  requestUploadUrl,
  exportCalendar,
  useGetCalendarToken,
  useRotateCalendarToken,
  useRevokeCalendarToken,
  getGetCalendarTokenQueryKey,
  type CalendarToken,
  type BrandingSettings,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/auth";
import { useTeam } from "@/context/team";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2, GripVertical, Upload, ImageIcon, KeyRound, Mail, User as UserIcon, Lock, CalendarDays, Copy, RefreshCw } from "lucide-react";
import { PlanLimitBanner } from "@/components/plan-limit-banner";
import { AllowanceSettingsForm } from "@/components/allowance-settings-form";
import { logoSrcFromPath, ACCEPTED_LOGO_TYPES, MAX_LOGO_BYTES } from "@/lib/logo";
import { readableApiError, planUpgradeMessage, planFeatureMessage, PLAN_FEATURE_MESSAGES } from "@/lib/api-error";
import { isWithinLimit, getLimit, hasAccess } from "@/lib/entitlements";
import { useToast } from "@/hooks/use-toast";

type ShiftModel = {
  id: number;
  name: string;
  valuationPercent: number;
  sortOrder: number;
  isActive: boolean;
};

type FormState = {
  name: string;
  valuationPercent: string;
  sortOrder: string;
  isActive: boolean;
};

function emptyForm(nextSort: number): FormState {
  return { name: "", valuationPercent: "100", sortOrder: String(nextSort), isActive: true };
}

// Wochentage 1 (Montag) bis 7 (Sonntag) für die Vorlagen-Auswahl.
const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: "Mo" },
  { value: 2, label: "Di" },
  { value: 3, label: "Mi" },
  { value: 4, label: "Do" },
  { value: 5, label: "Fr" },
  { value: 6, label: "Sa" },
  { value: 7, label: "So" },
];

function weekdaysLabel(weekdays: number[]): string {
  if (!weekdays || weekdays.length === 0) return "Alle Tage";
  return [...weekdays]
    .sort((a, b) => a - b)
    .map((d) => WEEKDAYS.find((w) => w.value === d)?.label ?? d)
    .join(", ");
}

type ShiftTemplate = {
  id: number;
  name: string;
  startTime: string;
  endTime: string;
  weekdays: number[];
};

type TemplateFormState = {
  name: string;
  startTime: string;
  endTime: string;
  weekdays: number[];
};

type TemplateDialogProps = {
  open: boolean;
  onClose: () => void;
  editTemplate?: ShiftTemplate;
};

function TemplateDialog({ open, onClose, editTemplate }: TemplateDialogProps) {
  const queryClient = useQueryClient();
  const { selectedTeamId } = useTeam();
  const createTemplate = useCreateShiftTemplate();
  const updateTemplate = useUpdateShiftTemplate();

  const isEditing = !!editTemplate;

  const [form, setForm] = useState<TemplateFormState>(() =>
    editTemplate
      ? {
          name: editTemplate.name,
          startTime: editTemplate.startTime,
          endTime: editTemplate.endTime,
          weekdays: editTemplate.weekdays ?? [],
        }
      : { name: "", startTime: "08:00", endTime: "16:00", weekdays: [] }
  );
  const [errors, setErrors] = useState<Partial<Record<keyof TemplateFormState, string>>>({});
  const [saving, setSaving] = useState(false);

  function set<K extends keyof TemplateFormState>(field: K, value: TemplateFormState[K]) {
    setForm((f) => ({ ...f, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
  }

  function toggleWeekday(day: number) {
    setForm((f) => ({
      ...f,
      weekdays: f.weekdays.includes(day)
        ? f.weekdays.filter((d) => d !== day)
        : [...f.weekdays, day],
    }));
  }

  function validate(): boolean {
    const errs: Partial<Record<keyof TemplateFormState, string>> = {};
    if (!form.name.trim()) errs.name = "Pflichtfeld";
    if (!form.startTime) errs.startTime = "Startzeit angeben";
    if (!form.endTime) errs.endTime = "Endzeit angeben";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        startTime: form.startTime,
        endTime: form.endTime,
        weekdays: [...form.weekdays].sort((a, b) => a - b),
      };
      if (isEditing && editTemplate) {
        await updateTemplate.mutateAsync({ id: editTemplate.id, data: payload });
      } else {
        await createTemplate.mutateAsync({
          data: { ...payload, ...(selectedTeamId != null ? { teamId: selectedTeamId } : {}) },
        });
      }
      await queryClient.invalidateQueries({ queryKey: getListShiftTemplatesQueryKey() });
      onClose();
    } catch (err) {
      setErrors({ name: readableApiError(err, "Speichern fehlgeschlagen. Bitte erneut versuchen.") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">
            {isEditing ? "Vorlage bearbeiten" : "Neue Vorlage"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Bezeichnung *</Label>
            <Input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="z.B. Frühdienst Mo–Fr"
              className={errors.name ? "border-destructive" : ""}
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Startzeit *</Label>
              <Input
                type="time"
                value={form.startTime}
                onChange={(e) => set("startTime", e.target.value)}
                className={errors.startTime ? "border-destructive" : ""}
              />
              {errors.startTime && <p className="text-xs text-destructive">{errors.startTime}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Endzeit *</Label>
              <Input
                type="time"
                value={form.endTime}
                onChange={(e) => set("endTime", e.target.value)}
                className={errors.endTime ? "border-destructive" : ""}
              />
              {errors.endTime && <p className="text-xs text-destructive">{errors.endTime}</p>}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Wochentage</Label>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((w) => {
                const active = form.weekdays.includes(w.value);
                return (
                  <button
                    key={w.value}
                    type="button"
                    onClick={() => toggleWeekday(w.value)}
                    className={
                      "h-9 w-10 rounded-md border text-sm font-medium transition-colors " +
                      (active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-foreground hover:bg-muted")
                    }
                  >
                    {w.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Optionale Einschränkung auf bestimmte Wochentage. Ohne Auswahl gilt die Vorlage für
              alle Tage.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Abbrechen
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Speichern..." : isEditing ? "Speichern" : "Anlegen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TemplateSettingsCard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: templates, isLoading } = useListShiftTemplates();
  const deleteTemplate = useDeleteShiftTemplate();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTemplate, setEditTemplate] = useState<ShiftTemplate | undefined>();
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const list: ShiftTemplate[] = (templates ?? []) as ShiftTemplate[];

  function openCreate() {
    setEditTemplate(undefined);
    setDialogOpen(true);
  }

  function openEdit(template: ShiftTemplate) {
    setEditTemplate(template);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditTemplate(undefined);
  }

  async function handleDelete(id: number) {
    if (confirmDelete !== id) {
      setConfirmDelete(id);
      return;
    }
    try {
      await deleteTemplate.mutateAsync({ id });
      await queryClient.invalidateQueries({ queryKey: getListShiftTemplatesQueryKey() });
    } catch (err) {
      toast({
        title: "Vorlage kann nicht gelöscht werden",
        description: readableApiError(err, "Bitte erneut versuchen."),
        variant: "destructive",
      });
    } finally {
      setConfirmDelete(null);
    }
  }

  return (
    <Card className="border-border/50 shadow-sm">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-serif text-lg font-bold text-foreground">Arbeitszeit-Vorlagen</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Wiederkehrende Arbeitszeiten (z.B. Frühdienst Mo–Fr). Vorlagen belegen beim Anlegen
              einer Schicht im Dienstplan die Start- und Endzeit automatisch vor.
            </p>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5 shrink-0" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Neue Vorlage</span>
            <span className="sm:hidden">Neu</span>
          </Button>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 p-6 text-center">
            <p className="text-sm text-muted-foreground">Noch keine Vorlagen angelegt.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border/50 rounded-lg border border-border/50">
            {list.map((template) => (
              <li
                key={template.id}
                className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/20 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <span className="font-medium truncate block">{template.name}</span>
                  <p className="text-xs text-muted-foreground">
                    {template.startTime}–{template.endTime} · {weekdaysLabel(template.weekdays)}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => openEdit(template)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Bearbeiten</span>
                </Button>
                <Button
                  variant={confirmDelete === template.id ? "destructive" : "ghost"}
                  size="sm"
                  className="gap-1.5"
                  onClick={() => handleDelete(template.id)}
                  onBlur={() => setConfirmDelete(null)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">
                    {confirmDelete === template.id ? "Wirklich?" : "Löschen"}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {dialogOpen && (
        <TemplateDialog open={dialogOpen} onClose={closeDialog} editTemplate={editTemplate} />
      )}
    </Card>
  );
}

type ModelDialogProps = {
  open: boolean;
  onClose: () => void;
  editModel?: ShiftModel;
  nextSortOrder: number;
};

function ModelDialog({ open, onClose, editModel, nextSortOrder }: ModelDialogProps) {
  const queryClient = useQueryClient();
  const { selectedTeamId } = useTeam();
  const createModel = useCreateShiftModel();
  const updateModel = useUpdateShiftModel();

  const isEditing = !!editModel;

  const [form, setForm] = useState<FormState>(() =>
    editModel
      ? {
          name: editModel.name,
          valuationPercent: String(editModel.valuationPercent),
          sortOrder: String(editModel.sortOrder),
          isActive: editModel.isActive,
        }
      : emptyForm(nextSortOrder)
  );
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [saving, setSaving] = useState(false);

  function set<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
  }

  function validate(): boolean {
    const errs: Partial<Record<keyof FormState, string>> = {};
    if (!form.name.trim()) errs.name = "Pflichtfeld";
    const vp = Number(form.valuationPercent);
    if (form.valuationPercent === "" || Number.isNaN(vp) || vp < 0) errs.valuationPercent = "Muss mindestens 0 sein";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        valuationPercent: Number(form.valuationPercent),
        sortOrder: Number(form.sortOrder) || 0,
        isActive: form.isActive,
      };
      if (isEditing && editModel) {
        await updateModel.mutateAsync({ id: editModel.id, data: payload });
      } else {
        await createModel.mutateAsync({
          data: { ...payload, ...(selectedTeamId != null ? { teamId: selectedTeamId } : {}) },
        });
      }
      await queryClient.invalidateQueries({ queryKey: getListShiftModelsQueryKey() });
      onClose();
    } catch (err) {
      setErrors({
        name:
          planUpgradeMessage(err) ??
          readableApiError(err, "Speichern fehlgeschlagen. Bitte erneut versuchen."),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">
            {isEditing ? "Schichtmodell bearbeiten" : "Neues Schichtmodell"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Bezeichnung *</Label>
            <Input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="z.B. Aktivdienst"
              className={errors.name ? "border-destructive" : ""}
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>Zeitwertung *</Label>
            <div className="relative">
              <Input
                type="number"
                min="0"
                max="200"
                value={form.valuationPercent}
                onChange={(e) => set("valuationPercent", e.target.value)}
                className={errors.valuationPercent ? "border-destructive" : ""}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                %
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Anteil der Arbeitszeit, der als Sollstunden gewertet wird (z.B. 50 % für Bereitschaft).
            </p>
            {errors.valuationPercent && <p className="text-xs text-destructive">{errors.valuationPercent}</p>}
          </div>


          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Reihenfolge</Label>
              <Input
                type="number"
                value={form.sortOrder}
                onChange={(e) => set("sortOrder", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={form.isActive ? "active" : "inactive"}
                onValueChange={(v) => set("isActive", v === "active")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Aktiv</SelectItem>
                  <SelectItem value="inactive">Inaktiv</SelectItem>
                </SelectContent>
              </Select>
            </div>
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

function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const changePassword = useChangePassword();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setError("");
    if (newPassword.length < 8) {
      setError("Das neue Passwort muss mindestens 8 Zeichen lang sein.");
      return;
    }
    if (newPassword !== confirm) {
      setError("Die neuen Passwörter stimmen nicht überein.");
      return;
    }
    setSaving(true);
    try {
      await changePassword.mutateAsync({ data: { currentPassword, newPassword } });
      toast({ title: "Passwort geändert", description: "Ihr Passwort wurde erfolgreich aktualisiert." });
      onClose();
    } catch (err) {
      setError(readableApiError(err, "Passwort konnte nicht geändert werden. Bitte erneut versuchen."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">Passwort ändern</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {error && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="current-password">Aktuelles Passwort</Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-password">Neues Passwort</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Mindestens 8 Zeichen"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-password">Neues Passwort bestätigen</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="••••••••"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Abbrechen
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Speichern..." : "Passwort ändern"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditProfileDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { currentUser, refreshUser } = useAuth();
  const { toast } = useToast();
  const updateProfile = useUpdateProfile();
  const [name, setName] = useState(currentUser?.name ?? "");
  const [email, setEmail] = useState(currentUser?.email ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setError("");
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (!trimmedName) {
      setError("Bitte einen Namen angeben.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError("Bitte eine gültige E-Mail-Adresse angeben.");
      return;
    }
    setSaving(true);
    try {
      await updateProfile.mutateAsync({ data: { name: trimmedName, email: trimmedEmail } });
      await refreshUser();
      toast({ title: "Profil aktualisiert", description: "Ihre Kontodaten wurden gespeichert." });
      onClose();
    } catch (err) {
      setError(readableApiError(err, "Profil konnte nicht gespeichert werden. Bitte erneut versuchen."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">Profil bearbeiten</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {error && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="profile-name">Name</Label>
            <Input
              id="profile-name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Vor- und Nachname"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="profile-email">E-Mail-Adresse</Label>
            <Input
              id="profile-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@beispiel.de"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Abbrechen
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Speichern..." : "Speichern"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProfileCard() {
  const { currentUser } = useAuth();
  const [pwOpen, setPwOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  return (
    <Card className="border-border/50 shadow-sm">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-serif text-lg font-bold text-foreground">Profilinformationen</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Ihre persönlichen Kontodaten. Name, E-Mail und Passwort können Sie hier ändern.
            </p>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5 shrink-0" onClick={() => setEditOpen(true)}>
            <Pencil className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Bearbeiten</span>
          </Button>
        </div>

        <dl className="space-y-3">
          <div className="flex items-start gap-3">
            <UserIcon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Name</dt>
              <dd className="text-sm font-medium text-foreground break-words">
                {currentUser?.name ?? "—"}
              </dd>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Mail className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">E-Mail-Adresse</dt>
              <dd className="text-sm font-medium text-foreground break-words">
                {currentUser?.email ?? "—"}
              </dd>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <KeyRound className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <dt className="text-xs text-muted-foreground">Passwort</dt>
              <dd className="text-sm font-medium text-foreground">••••••••</dd>
            </div>
            <Button variant="outline" size="sm" className="gap-1.5 shrink-0" onClick={() => setPwOpen(true)}>
              <KeyRound className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Passwort ändern</span>
              <span className="sm:hidden">Ändern</span>
            </Button>
          </div>
        </dl>
      </CardContent>

      {editOpen && <EditProfileDialog open={editOpen} onClose={() => setEditOpen(false)} />}
      {pwOpen && <ChangePasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} />}
    </Card>
  );
}

function LogoSettingsCard() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { isDienstleister, hasTeams, teams, selectedTeamId } = useTeam();
  const teamParams = selectedTeamId != null ? { teamId: selectedTeamId } : undefined;
  const { data, isLoading } = useGetBrandingSettings(teamParams);
  const updateBranding = useUpdateBrandingSettings();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const branding = data as BrandingSettings | undefined;
  const logoSrc = logoSrcFromPath(branding?.logoPath);

  // Für Dienstleister: ein Logo je Team (folgt dem Team-Switcher). Ohne Team-Auswahl
  // bzw. für Privat-Konten wird das globale Logo bearbeitet.
  const showsTeamLogo = isDienstleister && hasTeams && selectedTeamId != null;
  const selectedTeamName = teams.find((t) => t.id === selectedTeamId)?.name;
  const teamHint =
    isDienstleister && hasTeams
      ? showsTeamLogo
        ? `Logo für Team „${selectedTeamName}". Es erscheint auf den Stundennachweisen dieses Teams.`
        : 'Globales Logo (Fallback). Wähle oben ein Team aus, um ein eigenes Team-Logo zu hinterlegen.'
      : null;

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setError(null);
    if (!ACCEPTED_LOGO_TYPES.includes(file.type)) {
      setError("Bitte eine PNG- oder JPG-Datei auswählen.");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setError("Die Datei ist zu groß (max. 5 MB).");
      return;
    }

    setUploading(true);
    try {
      const { uploadURL, objectPath } = await requestUploadUrl({
        name: file.name,
        size: file.size,
        contentType: file.type,
      });
      const putRes = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!putRes.ok) throw new Error("Upload fehlgeschlagen");
      await updateBranding.mutateAsync({
        data: { logoPath: objectPath, ...(selectedTeamId != null ? { teamId: selectedTeamId } : {}) },
      });
      await queryClient.invalidateQueries({ queryKey: getGetBrandingSettingsQueryKey(teamParams) });
    } catch (err) {
      setError(readableApiError(err, "Logo konnte nicht hochgeladen werden. Bitte erneut versuchen."));
    } finally {
      setUploading(false);
    }
  }

  async function handleRemove() {
    setError(null);
    setUploading(true);
    try {
      await updateBranding.mutateAsync({
        data: { logoPath: null, ...(selectedTeamId != null ? { teamId: selectedTeamId } : {}) },
      });
      await queryClient.invalidateQueries({ queryKey: getGetBrandingSettingsQueryKey(teamParams) });
    } catch (err) {
      setError(readableApiError(err, "Logo konnte nicht entfernt werden. Bitte erneut versuchen."));
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card className="border-border/50 shadow-sm">
      <CardContent className="p-4 space-y-3">
        <div>
          <h3 className="font-serif text-lg font-bold text-foreground">Firmenlogo</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Das Logo erscheint oben rechts auf dem PDF-Stundennachweis. Ohne eigenes Logo wird das
            Standard-Logo verwendet. PNG oder JPG, max. 5 MB.
          </p>
          {teamHint && <p className="text-xs text-muted-foreground mt-1">{teamHint}</p>}
        </div>

        {isLoading ? (
          <Skeleton className="h-20 w-48 rounded-lg" />
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex h-20 w-48 items-center justify-center rounded-lg border border-border/60 bg-muted/30 p-2">
              {logoSrc ? (
                <img
                  src={logoSrc}
                  alt="Firmenlogo"
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <ImageIcon className="h-4 w-4" />
                  Kein Logo
                </span>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg"
                className="hidden"
                onChange={handleFileSelected}
              />
              <Button
                variant="outline"
                className="gap-2"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-4 w-4" />
                {uploading ? "Wird hochgeladen..." : logoSrc ? "Logo ersetzen" : "Logo hochladen"}
              </Button>
              {logoSrc && (
                <Button
                  variant="ghost"
                  className="gap-2 text-destructive hover:text-destructive"
                  disabled={uploading}
                  onClick={handleRemove}
                >
                  <Trash2 className="h-4 w-4" />
                  Entfernen
                </Button>
              )}
            </div>
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

function CalendarExportCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();
  const { selectedTeamId } = useTeam();
  const [isExporting, setIsExporting] = useState(false);

  // Premium-Feature calendarSync: Export der verbindlichen (FIX) Schichten als
  // iCalendar-Datei (.ics) für die eigene Kalender-App. UX-Gate — autoritativ
  // setzt der Server durch (403 plan_feature_required).
  const canSync = hasAccess(currentUser, "calendarSync");

  // Abo-Feed: geheimer Token für eine ICS-URL, die Kalender-Apps abonnieren
  // können (automatische Aktualisierung, kein erneuter Download nötig).
  const { data: tokenData } = useGetCalendarToken({
    query: { enabled: canSync },
  } as Parameters<typeof useGetCalendarToken>[0]) as { data?: CalendarToken };
  const rotateToken = useRotateCalendarToken();
  const revokeToken = useRevokeCalendarToken();

  const feedUrl =
    tokenData?.feedPath != null
      ? `${window.location.origin}${tokenData.feedPath}`
      : null;

  async function handleRotate() {
    try {
      await rotateToken.mutateAsync();
      await queryClient.invalidateQueries({ queryKey: getGetCalendarTokenQueryKey() });
      toast({
        title: feedUrl ? "Abo-Link erneuert" : "Abo-Link erstellt",
        description: feedUrl
          ? "Der alte Link ist ab sofort ungültig. Bitte in der Kalender-App neu hinterlegen."
          : "Den Link in der Kalender-App als Abonnement hinzufügen.",
      });
    } catch (err) {
      toast({
        title: "Abo-Link konnte nicht erstellt werden",
        description:
          planFeatureMessage(err) ?? readableApiError(err, "Bitte erneut versuchen."),
        variant: "destructive",
      });
    }
  }

  async function handleRevoke() {
    try {
      await revokeToken.mutateAsync();
      await queryClient.invalidateQueries({ queryKey: getGetCalendarTokenQueryKey() });
      toast({
        title: "Abo-Link widerrufen",
        description: "Abonnierte Kalender erhalten keine Aktualisierungen mehr.",
      });
    } catch (err) {
      toast({
        title: "Widerrufen fehlgeschlagen",
        description: readableApiError(err, "Bitte erneut versuchen."),
        variant: "destructive",
      });
    }
  }

  async function handleCopy() {
    if (!feedUrl) return;
    try {
      await navigator.clipboard.writeText(feedUrl);
      toast({ title: "Abo-URL kopiert" });
    } catch {
      toast({
        title: "Kopieren nicht möglich",
        description: "Bitte die URL manuell markieren und kopieren.",
        variant: "destructive",
      });
    }
  }

  async function handleDownload() {
    setIsExporting(true);
    try {
      const ics = await exportCalendar(
        selectedTeamId != null ? { teamId: selectedTeamId } : undefined,
      );
      const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "dienstplan.ics";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({
        title: "Kalender-Export fehlgeschlagen",
        description:
          planFeatureMessage(err) ?? readableApiError(err, "Bitte erneut versuchen."),
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <Card className="border-border/50 shadow-sm">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-medium text-foreground">Kalender-Export</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Exportiert die verbindlichen (FIX) Dienste als iCalendar-Datei (.ics) zum
          Import in die eigene Kalender-App (z. B. Google Kalender, Apple Kalender,
          Outlook).
        </p>
        {canSync ? (
          <>
            <Button
              variant="outline"
              className="gap-2"
              onClick={handleDownload}
              disabled={isExporting}
              data-testid="calendar-export-button"
            >
              <CalendarDays className="h-4 w-4" />
              {isExporting ? "Exportiere..." : "Als .ics herunterladen"}
            </Button>

            <div className="pt-3 border-t border-border/50 space-y-2">
              <h4 className="text-sm font-medium text-foreground">
                Kalender-Abo (automatische Aktualisierung)
              </h4>
              <p className="text-sm text-muted-foreground">
                Die Abo-URL in der Kalender-App als Kalender-Abonnement hinzufügen —
                neue oder verschobene verbindliche Dienste erscheinen dann automatisch,
                ohne erneuten Download. Die URL enthält einen geheimen Zugriffs-Token:
                nicht weitergeben.
              </p>
              {feedUrl ? (
                <>
                  <div className="flex items-center gap-2">
                    <Input
                      readOnly
                      value={feedUrl}
                      className="text-xs font-mono"
                      onFocus={(e) => e.currentTarget.select()}
                      data-testid="calendar-feed-url"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      className="shrink-0"
                      onClick={handleCopy}
                      title="Abo-URL kopieren"
                      data-testid="calendar-feed-copy"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      className="gap-2"
                      onClick={handleRotate}
                      disabled={rotateToken.isPending}
                      data-testid="calendar-feed-rotate"
                    >
                      <RefreshCw className="h-4 w-4" />
                      {rotateToken.isPending ? "Erneuere..." : "Link erneuern"}
                    </Button>
                    <Button
                      variant="ghost"
                      className="gap-2 text-destructive hover:text-destructive"
                      onClick={handleRevoke}
                      disabled={revokeToken.isPending}
                      data-testid="calendar-feed-revoke"
                    >
                      <Trash2 className="h-4 w-4" />
                      {revokeToken.isPending ? "Widerrufe..." : "Widerrufen"}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    „Link erneuern" macht die bisherige URL ungültig (z. B. wenn sie
                    versehentlich geteilt wurde).
                  </p>
                </>
              ) : (
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={handleRotate}
                  disabled={rotateToken.isPending}
                  data-testid="calendar-feed-create"
                >
                  <RefreshCw className="h-4 w-4" />
                  {rotateToken.isPending ? "Erstelle..." : "Abo-Link erstellen"}
                </Button>
              )}
            </div>
          </>
        ) : (
          <>
            <Button
              variant="outline"
              className="gap-2"
              disabled
              title={PLAN_FEATURE_MESSAGES.calendarSync}
              data-testid="calendar-export-button"
            >
              <Lock className="h-4 w-4" />
              Als .ics herunterladen
            </Button>
            <p className="text-xs text-muted-foreground">
              {PLAN_FEATURE_MESSAGES.calendarSync}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function Einstellungen() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { currentUser } = useAuth();
  const { data: models, isLoading } = useListShiftModels();
  const deleteModel = useDeleteShiftModel();

  const isDienstleister = currentUser?.accountType === "dienstleister";

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editModel, setEditModel] = useState<ShiftModel | undefined>();
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const sortedModels: ShiftModel[] = (models ?? []) as ShiftModel[];
  const nextSortOrder =
    sortedModels.length > 0 ? Math.max(...sortedModels.map((m) => m.sortOrder)) + 10 : 10;

  // Free-Plan begrenzt die Anzahl der Schichtmodelle (Free = 5: 4 vorinstallierte
  // Standard-Dienste + 1 eigener). Ist das Limit erreicht, wird das Anlegen
  // gesperrt (Durchsetzung zusaetzlich serverseitig). `null` = unbegrenzt (Premium).
  const shiftModelLimit = getLimit(currentUser, "maxShiftModels");
  const canAddModel = isWithinLimit(currentUser, "maxShiftModels", sortedModels.length);

  function openCreate() {
    setEditModel(undefined);
    setDialogOpen(true);
  }

  function openEdit(model: ShiftModel) {
    setEditModel(model);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditModel(undefined);
  }

  async function handleDelete(id: number) {
    if (confirmDelete !== id) {
      setConfirmDelete(id);
      return;
    }
    try {
      await deleteModel.mutateAsync({ id });
      await queryClient.invalidateQueries({ queryKey: getListShiftModelsQueryKey() });
    } catch (err) {
      toast({
        title: "Schichtmodell kann nicht gelöscht werden",
        description: readableApiError(err, "Bitte erneut versuchen."),
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
          <h2 className="text-2xl md:text-3xl font-serif font-bold text-foreground">Einstellungen</h2>
          <p className="text-muted-foreground mt-1 text-sm">Schichtmodelle für den Dienstplan verwalten</p>
        </div>
        {canAddModel ? (
          <Button onClick={openCreate} className="gap-2">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Neues Modell</span>
            <span className="sm:hidden">Neu</span>
          </Button>
        ) : (
          <Button
            disabled
            className="gap-2"
            title={`Im Free-Plan sind max. ${shiftModelLimit} Schichtmodelle möglich. Upgrade auf Premium für unbegrenzte Modelle.`}
          >
            <Lock className="h-4 w-4" />
            <span className="hidden sm:inline">Neues Modell</span>
            <span className="sm:hidden">Neu</span>
          </Button>
        )}
      </div>

      {/* Limit-Hinweis (Free-Plan). Bei Premium ist shiftModelLimit null. */}
      {!canAddModel && shiftModelLimit !== null && (
        <PlanLimitBanner>
          Im Free-Plan sind maximal {shiftModelLimit} Schichtmodelle möglich. Für unbegrenzte
          Schichtmodelle ist ein Upgrade auf Premium nötig.
        </PlanLimitBanner>
      )}

      <ProfileCard />

      <CalendarExportCard />

      <Card className="border-border/50 shadow-sm">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 w-full rounded-lg" />
              ))}
            </div>
          ) : sortedModels.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-muted-foreground mb-4">Noch keine Schichtmodelle angelegt.</p>
              <Button onClick={openCreate} variant="outline" className="gap-2">
                <Plus className="h-4 w-4" /> Erstes Modell anlegen
              </Button>
            </div>
          ) : (
            <ul className="divide-y divide-border/50">
              {sortedModels.map((model) => (
                <li
                  key={model.id}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-muted/20 transition-colors"
                >
                  <GripVertical className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{model.name}</span>
                      {!model.isActive && (
                        <Badge variant="secondary" className="text-xs">Inaktiv</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">Zeitwertung {model.valuationPercent} %</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => openEdit(model)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Bearbeiten</span>
                  </Button>
                  <Button
                    variant={confirmDelete === model.id ? "destructive" : "ghost"}
                    size="sm"
                    className="gap-1.5"
                    onClick={() => handleDelete(model.id)}
                    onBlur={() => setConfirmDelete(null)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">
                      {confirmDelete === model.id ? "Wirklich?" : "Löschen"}
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Schichtmodelle stehen beim Anlegen einer Schicht im Dienstplan zur Auswahl. Die Zeitwertung
        bestimmt, wie die geleistete Zeit in der Auswertung auf die Sollstunden angerechnet wird.
      </p>

      <TemplateSettingsCard />

      {isDienstleister && <LogoSettingsCard />}

      <AllowanceSettingsForm />

      <p className="text-xs text-muted-foreground">
        Zuschläge werden zentral gespeichert und bei der Auswertung angewandt. Änderungen wirken sich
        rückwirkend auf alle Auswertungen aus, ohne dass Schichten neu gespeichert werden müssen.
      </p>

      {dialogOpen && (
        <ModelDialog
          open={dialogOpen}
          onClose={closeDialog}
          editModel={editModel}
          nextSortOrder={nextSortOrder}
        />
      )}
    </div>
  );
}
