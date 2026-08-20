import { useEffect, useRef, useState } from "react";
import {
  useCreateUser,
  useUpdateUser,
  useDeleteUser,
  useCreateContract,
  useUpdateContract,
  useInviteUser,
  useGetAllowanceSettings,
  getListUsersQueryKey,
  getListContractsQueryKey,
  type AllowanceSettings,
} from "@workspace/api-client-react";
import { useTeam } from "@/context/team";
import { useAuth } from "@/context/auth";
import { hasAccess } from "@/lib/entitlements";
import { readableApiError, planUpgradeMessage, planFeatureMessage } from "@/lib/api-error";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
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
import { DatePickerField } from "@/components/date-picker-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Send, Copy, Check, Trash2, Lock, Calculator } from "lucide-react";
import { ArbeitstageRechnerDialog } from "@/components/arbeitstage-rechner-dialog";
import { PlanUpgradeLink } from "@/components/plan-limit-banner";
import { format } from "date-fns";

/**
 * Formulare rund um eine einzelne Assistenzkraft: Stammdaten-Dialog (inkl.
 * Lohn-/SV-Bereich und Arbeitszeit-Konditionen) und Einladungs-Dialog.
 *
 * Ausgelagert aus der früheren Seite /assistenten, damit die Team-Verwaltung
 * dieselben Dialoge nutzen kann, ohne dass eine Funktion verloren geht.
 */

export type Assistenzkraft = {
  id: number;
  name: string;
  email: string;
  role: string;
  phone?: string | null;
  address?: string | null;
  birthDate?: string | null;
  socialSecurityNumber?: string | null;
  taxId?: string | null;
  taxClass?: string | null;
  healthInsurance?: string | null;
  iban?: string | null;
  hourlyWage?: number | null;
  isActive: boolean;
};

export type Vertrag = {
  id: number;
  userId: number;
  weeklyHours: number;
  workdaysPerWeek?: number;
  vacationDays: number;
  startDate: string;
  endDate?: string | null;
  notes?: string | null;
};

type FormState = {
  vorname: string;
  nachname: string;
  email: string;
  phone: string;
  address: string;
  birthDate: string;
  socialSecurityNumber: string;
  taxId: string;
  taxClass: string;
  healthInsurance: string;
  iban: string;
  hourlyWage: string;
  weeklyHours: string;
  workdaysPerWeek: string;
  vacationDays: string;
  startDate: string;
  notes: string;
};

const EMPTY_FORM: FormState = {
  vorname: "",
  nachname: "",
  email: "",
  phone: "",
  address: "",
  birthDate: "",
  socialSecurityNumber: "",
  taxId: "",
  taxClass: "",
  healthInsurance: "",
  iban: "",
  hourlyWage: "",
  weeklyHours: "20",
  workdaysPerWeek: "5",
  vacationDays: "30",
  startDate: format(new Date(), "yyyy-MM-dd"),
  notes: "",
};

export function splitName(name: string): { vorname: string; nachname: string } {
  const parts = name.trim().split(/\s+/);
  return {
    vorname: parts[0] ?? "",
    nachname: parts.slice(1).join(" "),
  };
}

type InviteDialogProps = {
  open: boolean;
  onClose: () => void;
  userId: number;
  userName: string;
};

export function InviteDialog({ open, onClose, userId, userName }: InviteDialogProps) {
  const inviteUser = useInviteUser();
  const [result, setResult] = useState<{ inviteUrl: string; token: string; expiresIn: string; note: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const data = await inviteUser.mutateAsync({ id: userId });
      setResult(data);
    } catch (err) {
      setError(
        planFeatureMessage(err) ??
          readableApiError(err, "Einladungslink konnte nicht generiert werden."),
      );
    } finally {
      setLoading(false);
    }
  }

  async function copyLink() {
    if (!result) return;
    await navigator.clipboard.writeText(result.inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleClose() {
    setResult(null);
    setError(null);
    setCopied(false);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">Teammitglied einladen</DialogTitle>
        </DialogHeader>

        <div className="py-2 space-y-4">
          <p className="text-sm text-muted-foreground">
            Generiere einen temporären Einladungslink für{" "}
            <span className="font-medium text-foreground">{userName}</span>. Der Link ist{" "}
            {result?.expiresIn ?? "48 Stunden"} gültig.
          </p>

          {!result && (
            <Button onClick={generate} disabled={loading} className="w-full gap-2">
              <Send className="h-4 w-4" />
              {loading ? "Wird generiert..." : "Einladungslink generieren"}
            </Button>
          )}

          {error && (
            <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>
          )}

          {result && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Einladungslink</Label>
                <div className="flex gap-2">
                  <Input
                    value={result.inviteUrl}
                    readOnly
                    className="font-mono text-xs bg-muted"
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <Button variant="outline" size="icon" onClick={copyLink} title="Link kopieren">
                    {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Token (alternativ)</Label>
                <Input
                  value={result.token}
                  readOnly
                  className="font-mono text-xs bg-muted"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
              </div>

              <p className="text-xs text-muted-foreground border-l-2 border-border pl-3">
                {result.note}
              </p>

              <p
                className="text-xs text-muted-foreground border-l-2 border-amber-400/70 pl-3"
                data-testid="invite-browser-hinweis"
              >
                Wichtig: Öffne den Link nicht selbst in diesem Browser — sonst ersetzt die
                Anmeldung der eingeladenen Person deine eigene. Gib den Link weiter oder nutze
                zum Ausprobieren ein privates Fenster.
              </p>

              <Button variant="outline" className="w-full gap-2" onClick={generate} disabled={loading}>
                <Send className="h-4 w-4" />
                Neuen Link generieren
              </Button>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Schliessen</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FieldRow({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 text-[#192034] bg-[#eef3f3]">
      <Label className="text-sm font-medium text-foreground">{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

type AssistentDialogProps = {
  open: boolean;
  onClose: () => void;
  editUser?: Assistenzkraft;
  editContract?: Vertrag;
  /**
   * Team, dem eine neu angelegte Assistenzkraft zugeordnet wird. Ohne Angabe
   * gilt das global gewaehlte Team aus dem Team-Umschalter.
   */
  teamId?: number | null;
};

export function AssistentDialog({ open, onClose, editUser, editContract, teamId }: AssistentDialogProps) {
  const queryClient = useQueryClient();
  const { selectedTeamId: globalTeamId } = useTeam();
  const selectedTeamId = teamId !== undefined ? teamId : globalTeamId;
  const { currentUser } = useAuth();

  // Lohn-/SV-Daten sind das Premium-Feature "advancedPersonnelFile" (Server
  // lehnt echte Aenderungen fuer Free-Konten mit 403 plan_feature_required ab).
  // Free-Konten sehen die Felder deaktiviert mit Premium-Hinweis; bereits
  // erfasste Werte bleiben sichtbar (Bestandsschutz), werden aber nicht mehr
  // mitgesendet. Frontend-Gate ist reine UX, Durchsetzung bleibt serverseitig.
  const canEditWageData = hasAccess(currentUser, "advancedPersonnelFile");
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const createContract = useCreateContract();
  const updateContract = useUpdateContract();

  const isEditing = !!editUser;

  // Vollzeit-Referenz (AP 2) fürs Vorbelegen des Urlaubsanspruchs bei
  // Neuanlage und für die "eigene Urlaubstage/poolHours"-Vorschau.
  const { data: allowanceSettings } = useGetAllowanceSettings(
    selectedTeamId != null ? { teamId: selectedTeamId } : undefined,
    { query: {} } as Parameters<typeof useGetAllowanceSettings>[1],
  ) as { data?: AllowanceSettings };
  const defaultVacationDaysAppliedRef = useRef(false);

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>(() => {
    if (editUser) {
      const { vorname, nachname } = splitName(editUser.name);
      return {
        vorname,
        nachname,
        email: editUser.email,
        phone: editUser.phone ?? "",
        address: editUser.address ?? "",
        birthDate: editUser.birthDate ?? "",
        socialSecurityNumber: editUser.socialSecurityNumber ?? "",
        taxId: editUser.taxId ?? "",
        taxClass: editUser.taxClass ?? "",
        healthInsurance: editUser.healthInsurance ?? "",
        iban: editUser.iban ?? "",
        hourlyWage: editUser.hourlyWage != null ? String(editUser.hourlyWage) : "",
        weeklyHours: editContract ? String(editContract.weeklyHours) : "20",
        workdaysPerWeek: editContract?.workdaysPerWeek != null ? String(editContract.workdaysPerWeek) : "5",
        vacationDays: editContract ? String(editContract.vacationDays) : "30",
        startDate: editContract ? editContract.startDate : format(new Date(), "yyyy-MM-dd"),
        notes: editContract?.notes ?? "",
      };
    }
    return {
      ...EMPTY_FORM,
      vacationDays:
        allowanceSettings?.defaultVacationDays != null
          ? String(allowanceSettings.defaultVacationDays)
          : EMPTY_FORM.vacationDays,
    };
  });

  // Neuanlage: sobald die Vollzeit-Referenz nachträglich eintrifft (Query war
  // beim ersten Render noch nicht geladen), den Urlaubsanspruch EINMAL
  // vorbelegen — nur solange das Feld noch den Formular-Standardwert trägt,
  // damit eine bereits vom Nutzer vorgenommene Eingabe nie überschrieben wird.
  useEffect(() => {
    if (
      !isEditing &&
      !defaultVacationDaysAppliedRef.current &&
      allowanceSettings?.defaultVacationDays != null
    ) {
      defaultVacationDaysAppliedRef.current = true;
      setForm((f) =>
        f.vacationDays === EMPTY_FORM.vacationDays
          ? { ...f, vacationDays: String(allowanceSettings.defaultVacationDays) }
          : f,
      );
    }
  }, [isEditing, allowanceSettings]);

  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [planError, setPlanError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [rechnerOpen, setRechnerOpen] = useState(false);

  function set(field: keyof FormState, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
    setPlanError(null);
  }

  function validate(): boolean {
    const errs: Partial<Record<keyof FormState, string>> = {};
    if (!form.vorname.trim()) errs.vorname = "Pflichtfeld";
    if (!form.nachname.trim()) errs.nachname = "Pflichtfeld";
    if (!form.email.trim()) errs.email = "Pflichtfeld";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = "Ungueltige E-Mail-Adresse";
    if (!form.address.trim()) errs.address = "Pflichtfeld";
    if (!form.weeklyHours || Number(form.weeklyHours) <= 0) errs.weeklyHours = "Muss groesser als 0 sein";
    const workdays = Number(form.workdaysPerWeek);
    if (!form.workdaysPerWeek || !Number.isFinite(workdays) || workdays < 0.1 || workdays > 7)
      errs.workdaysPerWeek = "Zahl zwischen 0,1 und 7";
    if (!form.vacationDays || Number(form.vacationDays) < 0) errs.vacationDays = "Muss mindestens 0 sein";
    if (!form.startDate) errs.startDate = "Pflichtfeld";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);

    try {
      const name = `${form.vorname.trim()} ${form.nachname.trim()}`.trim();

      if (isEditing && editUser) {
        await updateUser.mutateAsync({
          id: editUser.id,
          data: {
            name,
            email: form.email,
            phone: form.phone || null,
            address: form.address,
            // Lohn-/SV-Felder nur senden, wenn Premium — Free-Konten aendern
            // sie nicht (Felder deaktiviert), Weglassen laesst den DB-Stand
            // unangetastet (Bestandsschutz).
            ...(canEditWageData
              ? {
                  birthDate: form.birthDate || null,
                  socialSecurityNumber: form.socialSecurityNumber || null,
                  taxId: form.taxId || null,
                  taxClass: form.taxClass || null,
                  healthInsurance: form.healthInsurance || null,
                  iban: form.iban || null,
                  hourlyWage: form.hourlyWage ? Number(form.hourlyWage) : null,
                }
              : {}),
          },
        });

        if (editContract) {
          await updateContract.mutateAsync({
            id: editContract.id,
            data: {
              weeklyHours: Number(form.weeklyHours),
              workdaysPerWeek: Number(form.workdaysPerWeek),
              vacationDays: Number(form.vacationDays),
              startDate: form.startDate,
              notes: form.notes || null,
            },
          });
        } else {
          await createContract.mutateAsync({
            data: {
              userId: editUser.id,
              weeklyHours: Number(form.weeklyHours),
              workdaysPerWeek: Number(form.workdaysPerWeek),
              vacationDays: Number(form.vacationDays),
              startDate: form.startDate,
              notes: form.notes || undefined,
              ...(selectedTeamId != null ? { teamId: selectedTeamId } : {}),
            },
          });
        }
      } else {
        const newUser = await createUser.mutateAsync({
          data: {
            name,
            email: form.email,
            role: "assistant",
            phone: form.phone || undefined,
            address: form.address,
            ...(canEditWageData
              ? {
                  birthDate: form.birthDate || undefined,
                  socialSecurityNumber: form.socialSecurityNumber || undefined,
                  taxId: form.taxId || undefined,
                  taxClass: form.taxClass || undefined,
                  healthInsurance: form.healthInsurance || undefined,
                  iban: form.iban || undefined,
                  hourlyWage: form.hourlyWage ? Number(form.hourlyWage) : undefined,
                }
              : {}),
            ...(selectedTeamId != null ? { teamId: selectedTeamId } : {}),
          },
        });

        await createContract.mutateAsync({
          data: {
            userId: newUser.id,
            weeklyHours: Number(form.weeklyHours),
            workdaysPerWeek: Number(form.workdaysPerWeek),
            vacationDays: Number(form.vacationDays),
            startDate: form.startDate,
            notes: form.notes || undefined,
            ...(selectedTeamId != null ? { teamId: selectedTeamId } : {}),
          },
        });
      }

      await queryClient.invalidateQueries({ queryKey: getListUsersQueryKey({ role: "assistant" }) });
      await queryClient.invalidateQueries({ queryKey: getListContractsQueryKey() });
      onClose();
    } catch (err) {
      const planMsg = planUpgradeMessage(err);
      if (planMsg) {
        setPlanError(planMsg);
      } else {
        setErrors({
          email: readableApiError(err, "Speichern fehlgeschlagen. Bitte pruefen und erneut versuchen."),
        });
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!editUser) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteUser.mutateAsync({ id: editUser.id });
      await queryClient.invalidateQueries({ queryKey: getListUsersQueryKey({ role: "assistant" }) });
      await queryClient.invalidateQueries({ queryKey: getListContractsQueryKey() });
      setConfirmDeleteOpen(false);
      onClose();
    } catch (err) {
      setDeleteError(
        readableApiError(err, "Loeschen fehlgeschlagen. Bitte erneut versuchen."),
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">
            {isEditing ? "Assistenzkraft bearbeiten" : "Neue Assistenzkraft anlegen"}
          </DialogTitle>
        </DialogHeader>

        {planError && (
          <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{planError}</p>
        )}

        <div className="space-y-6 py-2">
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              Personendaten
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <FieldRow label="Vorname *" error={errors.vorname}>
                <Input className="bg-card" value={form.vorname} onChange={(e) => set("vorname", e.target.value)} placeholder="Max" />
              </FieldRow>
              <FieldRow label="Nachname *" error={errors.nachname}>
                <Input className="bg-card" value={form.nachname} onChange={(e) => set("nachname", e.target.value)} placeholder="Mustermann" />
              </FieldRow>
            </div>

            <div className="mt-4 space-y-4">
              <FieldRow label="E-Mail *" error={errors.email}>
                <Input
                  className="bg-card"
                  type="email"
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                  placeholder="max@example.de"
                />
              </FieldRow>

              <FieldRow label="Telefon">
                <Input
                  className="bg-card"
                  value={form.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  placeholder="0171-1234567"
                />
              </FieldRow>

              <FieldRow label="Adresse *" error={errors.address}>
                <Input
                  className="bg-card"
                  value={form.address}
                  onChange={(e) => set("address", e.target.value)}
                  placeholder="Musterstr. 1, 12345 Musterstadt"
                />
              </FieldRow>
            </div>
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-2">
              Lohndaten / Sozialversicherung
              {!canEditWageData && (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium normal-case tracking-normal text-muted-foreground">
                  <Lock className="h-3 w-3" />
                  Premium
                </span>
              )}
            </h3>
            {/* Free-Konten: Felder deaktiviert mit kurzem Premium-Hinweis.
                Bereits erfasste Werte bleiben sichtbar (Bestandsschutz). */}
            {!canEditWageData && (
              <p
                className="text-xs text-muted-foreground mb-3 border-l-2 border-border pl-3"
                data-testid="wage-data-premium-hint"
              >
                Lohn- und Sozialversicherungsdaten lassen sich mit Premium erfassen
                und bearbeiten. Bereits gespeicherte Daten bleiben erhalten.{" "}
                <PlanUpgradeLink className="text-xs" />
              </p>
            )}
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FieldRow label="Geburtsdatum">
                  <DatePickerField
                    value={form.birthDate}
                    onChange={(v) => set("birthDate", v)}
                    disabled={!canEditWageData}
                    data-testid="assistant-birth-date"
                    yearsBack={90}
                    yearsForward={0}
                    clearable
                  />
                </FieldRow>
                <FieldRow label="Steuerklasse">
                  <Select
                    value={form.taxClass || undefined}
                    onValueChange={(v) => set("taxClass", v)}
                    disabled={!canEditWageData}
                  >
                    <SelectTrigger className="bg-card">
                      <SelectValue placeholder="Wählen" />
                    </SelectTrigger>
                    <SelectContent>
                      {["1", "2", "3", "4", "5", "6"].map((c) => (
                        <SelectItem key={c} value={c}>
                          Klasse {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FieldRow>
              </div>

              <FieldRow label="Sozialversicherungsnummer">
                <Input
                  className="bg-card"
                  value={form.socialSecurityNumber}
                  onChange={(e) => set("socialSecurityNumber", e.target.value)}
                  placeholder="12 123456 A 123"
                  disabled={!canEditWageData}
                />
              </FieldRow>

              <FieldRow label="Steuer-Identifikationsnummer">
                <Input
                  className="bg-card"
                  value={form.taxId}
                  onChange={(e) => set("taxId", e.target.value)}
                  placeholder="12 345 678 901"
                  disabled={!canEditWageData}
                />
              </FieldRow>

              <FieldRow label="Krankenkasse">
                <Input
                  className="bg-card"
                  value={form.healthInsurance}
                  onChange={(e) => set("healthInsurance", e.target.value)}
                  placeholder="z.B. AOK, TK, Barmer"
                  disabled={!canEditWageData}
                />
              </FieldRow>

              <FieldRow label="IBAN">
                <Input
                  className="bg-card"
                  value={form.iban}
                  onChange={(e) => set("iban", e.target.value)}
                  placeholder="DE00 0000 0000 0000 0000 00"
                  disabled={!canEditWageData}
                />
              </FieldRow>

              <FieldRow label="Stundenlohn">
                <div className="relative">
                  <Input
                    className="bg-card pr-10"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.hourlyWage}
                    onChange={(e) => set("hourlyWage", e.target.value)}
                    placeholder="z.B. 18,50"
                    disabled={!canEditWageData}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                    €/h
                  </span>
                </div>
              </FieldRow>
            </div>
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              Vertragliche Konditionen
            </h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FieldRow label="Wochenstunden *" error={errors.weeklyHours}>
                  <Input
                    className="bg-card"
                    type="number"
                    min="1"
                    max="40"
                    step="0.5"
                    value={form.weeklyHours}
                    onChange={(e) => set("weeklyHours", e.target.value)}
                  />
                </FieldRow>
                <FieldRow label="Urlaubsanspruch bei Vollzeit *" error={errors.vacationDays}>
                  <div className="relative">
                    <Input
                      className="bg-card"
                      type="number"
                      min="0"
                      max="365"
                      value={form.vacationDays}
                      onChange={(e) => set("vacationDays", e.target.value)}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                      Tage
                    </span>
                  </div>
                  {(() => {
                    const fulltimeWorkdays = allowanceSettings?.fulltimeWorkdaysPerWeek;
                    const weeklyHours = Number(form.weeklyHours);
                    const workdaysPerWeek = Number(form.workdaysPerWeek);
                    const vacationDays = Number(form.vacationDays);
                    if (
                      !fulltimeWorkdays ||
                      !(weeklyHours > 0) ||
                      !(workdaysPerWeek > 0) ||
                      Number.isNaN(vacationDays)
                    ) {
                      return null;
                    }
                    const eigeneUrlaubstage = vacationDays * (workdaysPerWeek / fulltimeWorkdays);
                    const vacationWeeksValue = vacationDays / fulltimeWorkdays;
                    const poolHours = vacationWeeksValue * weeklyHours;
                    return (
                      <p className="text-xs text-muted-foreground">
                        ≈ {eigeneUrlaubstage.toFixed(1)} eigene Urlaubstage · {poolHours.toFixed(1)} h im Jahr
                      </p>
                    );
                  })()}
                </FieldRow>
              </div>

              <FieldRow label="Arbeitstage pro Woche *" error={errors.workdaysPerWeek}>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Input
                      className="bg-card"
                      type="number"
                      min="0.1"
                      max="7"
                      step="any"
                      value={form.workdaysPerWeek}
                      onChange={(e) => set("workdaysPerWeek", e.target.value)}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                      Tage
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5 shrink-0"
                    onClick={() => setRechnerOpen(true)}
                    aria-label="Arbeitstage berechnen"
                    data-testid="workdays-rechner-open"
                  >
                    <Calculator className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Rechner</span>
                  </Button>
                </div>
              </FieldRow>
              {/* Rechner füllt beide Vertragswerte konsistent vor (Arbeitstage
                  + Wochenstunden); gespeichert wird erst über das Formular. */}
              <ArbeitstageRechnerDialog
                open={rechnerOpen}
                onOpenChange={setRechnerOpen}
                onApply={({ workdaysPerWeek, weeklyHours }) => {
                  set("weeklyHours", String(weeklyHours));
                  set("workdaysPerWeek", String(workdaysPerWeek));
                }}
              />

              <FieldRow label="Vertragsbeginn *" error={errors.startDate}>
                <DatePickerField
                  value={form.startDate}
                  onChange={(v) => set("startDate", v)}
                  invalid={Boolean(errors.startDate)}
                  data-testid="contract-start-date"
                  yearsBack={15}
                  yearsForward={3}
                />
              </FieldRow>

              <FieldRow label="Hinweise">
                <Input
                  className="bg-card"
                  value={form.notes}
                  onChange={(e) => set("notes", e.target.value)}
                  placeholder="z.B. Teilzeit Nachmittag"
                />
              </FieldRow>
            </div>
          </section>
        </div>

        <DialogFooter className="gap-2 pt-2 sm:justify-between">
          {isEditing ? (
            <Button
              variant="ghost"
              onClick={() => {
                setDeleteError(null);
                setConfirmDeleteOpen(true);
              }}
              disabled={saving || deleting}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
              Loeschen
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving || deleting}>
              Abbrechen
            </Button>
            <Button onClick={handleSave} disabled={saving || deleting}>
              {saving ? "Speichern..." : isEditing ? "Speichern" : "Anlegen"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog
      open={confirmDeleteOpen}
      onOpenChange={(v) => {
        if (!deleting) setConfirmDeleteOpen(v);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Assistenzkraft loeschen?</AlertDialogTitle>
          <AlertDialogDescription>
            {editUser?.name ? `"${editUser.name}"` : "Diese Assistenzkraft"} wird
            unwiderruflich entfernt – samt Vertrag, geplanten Schichten und
            erfasster Zeiten. Diese Aktion kann nicht rueckgaengig gemacht werden.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {deleteError && (
          <p className="text-sm text-destructive">{deleteError}</p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleDelete();
            }}
            disabled={deleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleting ? "Loeschen..." : "Endgueltig loeschen"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
