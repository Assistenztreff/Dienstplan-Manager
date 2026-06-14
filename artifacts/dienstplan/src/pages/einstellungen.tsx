import { useRef, useState } from "react";
import {
  useListShiftModels,
  useCreateShiftModel,
  useUpdateShiftModel,
  useDeleteShiftModel,
  getListShiftModelsQueryKey,
  useUpdateUser,
  useGetBrandingSettings,
  useUpdateBrandingSettings,
  getGetBrandingSettingsQueryKey,
  requestUploadUrl,
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
import { Plus, Pencil, Trash2, GripVertical, Upload, ImageIcon } from "lucide-react";
import { SHIFT_MODEL_COLORS, colorDotClass } from "@/lib/shift-model-colors";
import { AllowanceSettingsForm } from "@/components/allowance-settings-form";
import { logoSrcFromPath, ACCEPTED_LOGO_TYPES, MAX_LOGO_BYTES } from "@/lib/logo";
import { readableApiError } from "@/lib/api-error";
import { useToast } from "@/hooks/use-toast";

type ShiftModel = {
  id: number;
  name: string;
  valuationPercent: number;
  color: string;
  sortOrder: number;
  isActive: boolean;
};

type FormState = {
  name: string;
  valuationPercent: string;
  color: string;
  sortOrder: string;
  isActive: boolean;
};

function emptyForm(nextSort: number): FormState {
  return { name: "", valuationPercent: "100", color: "primary", sortOrder: String(nextSort), isActive: true };
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
          color: editModel.color,
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
        color: form.color,
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

          <div className="space-y-1.5">
            <Label>Farbe im Kalender</Label>
            <Select value={form.color} onValueChange={(v) => set("color", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SHIFT_MODEL_COLORS.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    <span className="flex items-center gap-2">
                      <span className={`inline-block h-3 w-3 rounded-full ${c.dot}`} />
                      {c.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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

function AccountTypeCard() {
  const { currentUser, refreshUser } = useAuth();
  const { toast } = useToast();
  const updateUser = useUpdateUser();
  const [saving, setSaving] = useState(false);

  const accountType = currentUser?.accountType ?? "privat";

  async function setAccountType(value: "privat" | "dienstleister") {
    if (!currentUser || value === accountType) return;
    setSaving(true);
    try {
      await updateUser.mutateAsync({ id: currentUser.id, data: { accountType: value } });
      await refreshUser();
    } catch (err) {
      toast({
        title: "Konto-Typ konnte nicht geändert werden",
        description: readableApiError(err, "Bitte erneut versuchen."),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="border-border/50 shadow-sm">
      <CardContent className="p-4 space-y-3">
        <div>
          <h3 className="font-serif text-lg font-bold text-foreground">Konto-Typ</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Privat: einzelner Assistenznehmer. Dienstleister: Verwaltung mehrerer Teams.
          </p>
        </div>
        <div className="max-w-xs space-y-1.5">
          <Label>Aktueller Konto-Typ</Label>
          <Select
            value={accountType}
            onValueChange={(v) => void setAccountType(v as "privat" | "dienstleister")}
            disabled={saving}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="privat">Privat (Assistenznehmer)</SelectItem>
              <SelectItem value="dienstleister">Dienstleister (Assistenzdienst)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}

function LogoSettingsCard() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { data, isLoading } = useGetBrandingSettings();
  const updateBranding = useUpdateBrandingSettings();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const branding = data as BrandingSettings | undefined;
  const logoSrc = logoSrcFromPath(branding?.logoPath);

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
      await updateBranding.mutateAsync({ data: { logoPath: objectPath } });
      await queryClient.invalidateQueries({ queryKey: getGetBrandingSettingsQueryKey() });
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
      await updateBranding.mutateAsync({ data: { logoPath: null } });
      await queryClient.invalidateQueries({ queryKey: getGetBrandingSettingsQueryKey() });
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

export default function Einstellungen() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: models, isLoading } = useListShiftModels();
  const deleteModel = useDeleteShiftModel();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editModel, setEditModel] = useState<ShiftModel | undefined>();
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const sortedModels: ShiftModel[] = (models ?? []) as ShiftModel[];
  const nextSortOrder =
    sortedModels.length > 0 ? Math.max(...sortedModels.map((m) => m.sortOrder)) + 10 : 10;

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
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Neues Modell</span>
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
                  <span className={`inline-block h-3 w-3 rounded-full shrink-0 ${colorDotClass(model.color)}`} />
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

      <AccountTypeCard />

      <LogoSettingsCard />

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
