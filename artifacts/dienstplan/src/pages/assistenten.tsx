import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "wouter";
import {
  useListUsers,
  useListContracts,
  useCreateUser,
  useUpdateUser,
  useDeleteUser,
  useCreateContract,
  useUpdateContract,
  useInviteUser,
  useListTeamMembers,
  useRemoveTeamMember,
  getHoursBalance,
  getListUsersQueryKey,
  getListContractsQueryKey,
  getListTeamMembersQueryKey,
} from "@workspace/api-client-react";
import { useTeam } from "@/context/team";
import { TeamSwitcher } from "@/components/team-switcher";
import { useAuth } from "@/context/auth";
import { isWithinLimit, getLimit, hasAccess } from "@/lib/entitlements";
import { readableApiError, planUpgradeMessage, planFeatureMessage, PLAN_FEATURE_MESSAGES } from "@/lib/api-error";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Mail, Phone, MapPin, Calendar, Pencil, UserPlus, UserMinus, Send, Copy, Check, Download, ChevronLeft, ChevronRight, Trash2, Lock } from "lucide-react";
import { PlanLimitBanner } from "@/components/plan-limit-banner";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { toast } from "sonner";
import { exportStatementSectionsPdf } from "@/lib/pdf-export";

type User = {
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

type Contract = {
  id: number;
  userId: number;
  weeklyHours: number;
  workdaysPerWeek?: number;
  vacationDays: number;
  startDate: string;
  endDate?: string | null;
  notes?: string | null;
  billingMethod?: "SOLL" | "IST" | null;
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
  billingMethod: string;
};

// Sonderwert für "erbt" (Abrechnungsart nicht auf Assistenten-Ebene gesetzt →
// Fallback auf Team-/Konto-Regelung).
const INHERIT_BILLING = "inherit";

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
  billingMethod: INHERIT_BILLING,
};

function splitName(name: string): { vorname: string; nachname: string } {
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

function InviteDialog({ open, onClose, userId, userName }: InviteDialogProps) {
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
  editUser?: User;
  editContract?: Contract;
};

function AssistentDialog({ open, onClose, editUser, editContract }: AssistentDialogProps) {
  const queryClient = useQueryClient();
  const { selectedTeamId } = useTeam();
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
        billingMethod: editContract?.billingMethod ?? INHERIT_BILLING,
      };
    }
    return EMPTY_FORM;
  });

  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [planError, setPlanError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
    if (
      !form.workdaysPerWeek ||
      !Number.isInteger(Number(form.workdaysPerWeek)) ||
      Number(form.workdaysPerWeek) < 1 ||
      Number(form.workdaysPerWeek) > 7
    )
      errs.workdaysPerWeek = "Ganze Zahl zwischen 1 und 7";
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
              billingMethod: (form.billingMethod === INHERIT_BILLING
                ? null
                : form.billingMethod) as "SOLL" | "IST" | null,
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
              billingMethod: (form.billingMethod === INHERIT_BILLING
                ? null
                : form.billingMethod) as "SOLL" | "IST" | null,
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
            billingMethod: (form.billingMethod === INHERIT_BILLING
              ? null
              : form.billingMethod) as "SOLL" | "IST" | null,
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
            {isEditing ? "Assistenten bearbeiten" : "Neuen Assistenten anlegen"}
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
                und bearbeiten. Bereits gespeicherte Daten bleiben erhalten.
              </p>
            )}
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FieldRow label="Geburtsdatum">
                  <Input
                    className="bg-card"
                    type="date"
                    value={form.birthDate}
                    onChange={(e) => set("birthDate", e.target.value)}
                    disabled={!canEditWageData}
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
                <FieldRow label="Urlaubsanspruch *" error={errors.vacationDays}>
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
                </FieldRow>
              </div>

              <FieldRow label="Arbeitstage pro Woche *" error={errors.workdaysPerWeek}>
                <div className="relative">
                  <Input
                    className="bg-card"
                    type="number"
                    min="1"
                    max="7"
                    step="1"
                    value={form.workdaysPerWeek}
                    onChange={(e) => set("workdaysPerWeek", e.target.value)}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                    Tage
                  </span>
                </div>
              </FieldRow>

              <FieldRow label="Vertragsbeginn *" error={errors.startDate}>
                <Input
                  className="bg-card"
                  type="date"
                  value={form.startDate}
                  onChange={(e) => set("startDate", e.target.value)}
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

              <FieldRow label="Abrechnungsart">
                <Select
                  value={form.billingMethod}
                  onValueChange={(v) => set("billingMethod", v)}
                >
                  <SelectTrigger
                    className="bg-card"
                    data-testid="contract-billing-method-select"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={INHERIT_BILLING}>
                      Team-/Konto-Regelung übernehmen
                    </SelectItem>
                    <SelectItem value="SOLL">Soll – nach geplanten Schichten</SelectItem>
                    <SelectItem value="IST">Ist – nach erfassten Zeiten</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1.5">
                  Legt fest, ob Stunden und Zuschläge für diese Assistenzkraft aus den geplanten
                  Schichten (Soll) oder den tatsächlich erfassten Zeiten (Ist) berechnet werden.
                  Ohne eigene Wahl gilt die Team- bzw. Konto-Regelung.
                </p>
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
          <AlertDialogTitle>Assistenten loeschen?</AlertDialogTitle>
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

type ExportDialogProps = {
  open: boolean;
  onClose: () => void;
  userId: number;
  userName: string;
};

function monthIndex(date: Date): number {
  return date.getFullYear() * 12 + date.getMonth();
}

function ExportDialog({ open, onClose, userId, userName }: ExportDialogProps) {
  const { selectedTeamId } = useTeam();
  const [fromDate, setFromDate] = useState(new Date());
  const [toDate, setToDate] = useState(new Date());
  const [isExporting, setIsExporting] = useState(false);

  const fromIndex = monthIndex(fromDate);
  const toIndex = monthIndex(toDate);
  const rangeInvalid = toIndex < fromIndex;
  const monthCount = rangeInvalid ? 0 : toIndex - fromIndex + 1;

  const fromLabel = format(fromDate, "MMMM yyyy", { locale: de });
  const toLabel = format(toDate, "MMMM yyyy", { locale: de });

  const stepFrom = (delta: number) =>
    setFromDate((d) => new Date(d.getFullYear(), d.getMonth() + delta, 1));
  const stepTo = (delta: number) =>
    setToDate((d) => new Date(d.getFullYear(), d.getMonth() + delta, 1));

  async function handleExport() {
    if (rangeInvalid) {
      toast.error("Der Bis-Monat darf nicht vor dem Von-Monat liegen.");
      return;
    }
    setIsExporting(true);
    try {
      const sections: Array<{ balance: any; month: number; year: number; monthLabel: string }> = [];

      for (let i = 0; i < monthCount; i++) {
        const cursor = new Date(fromDate.getFullYear(), fromDate.getMonth() + i, 1);
        const month = cursor.getMonth() + 1;
        const year = cursor.getFullYear();
        const monthLabel = format(cursor, "MMMM yyyy", { locale: de });

        const balances = await getHoursBalance({
          month,
          year,
          ...(selectedTeamId != null ? { teamId: selectedTeamId } : {}),
        });
        const balance = (balances as any[]).find((b) => b.userId === userId);
        if (balance) {
          sections.push({ balance, month, year, monthLabel });
        }
      }

      if (sections.length === 0) {
        toast.error("Keine Auswertungsdaten fuer den gewaehlten Zeitraum gefunden.");
        return;
      }

      const safeName = userName.replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "");
      const first = sections[0];
      const last = sections[sections.length - 1];
      const rangePart =
        sections.length === 1
          ? `${first.year}_${String(first.month).padStart(2, "0")}`
          : `${first.year}_${String(first.month).padStart(2, "0")}-${last.year}_${String(last.month).padStart(2, "0")}`;

      await exportStatementSectionsPdf({
        sections,
        teamId: selectedTeamId,
        filename: `Stundennachweis_${safeName}_${rangePart}.pdf`,
      });
      onClose();
    } catch (err) {
      toast.error("PDF-Export fehlgeschlagen.");
      console.error(err);
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">Stundennachweis exportieren</DialogTitle>
        </DialogHeader>

        <div className="py-2 space-y-4">
          <p className="text-sm text-muted-foreground">
            Einzelnachweis fuer{" "}
            <span className="font-medium text-foreground">{userName}</span> als PDF.
            Waehle den gewuenschten Zeitraum – pro Monat entsteht eine Seite.
          </p>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Von-Monat</Label>
              <div className="flex items-center justify-between gap-2">
                <Button variant="outline" size="icon" onClick={() => stepFrom(-1)} disabled={isExporting}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="font-medium text-sm flex-1 text-center" data-testid="export-from-label">
                  {fromLabel}
                </span>
                <Button variant="outline" size="icon" onClick={() => stepFrom(1)} disabled={isExporting}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Bis-Monat</Label>
              <div className="flex items-center justify-between gap-2">
                <Button variant="outline" size="icon" onClick={() => stepTo(-1)} disabled={isExporting}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="font-medium text-sm flex-1 text-center" data-testid="export-to-label">
                  {toLabel}
                </span>
                <Button variant="outline" size="icon" onClick={() => stepTo(1)} disabled={isExporting}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          {rangeInvalid ? (
            <p className="text-xs text-destructive">
              Der Bis-Monat darf nicht vor dem Von-Monat liegen.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {monthCount === 1 ? "1 Monat" : `${monthCount} Monate`} werden exportiert.
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={isExporting}>
            Abbrechen
          </Button>
          <Button onClick={handleExport} disabled={isExporting || rangeInvalid} className="gap-2">
            <Download className="h-4 w-4" />
            {isExporting ? "Exportiere..." : "Als PDF exportieren"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Assistenten() {
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();
  const { isDienstleister, selectedTeamId } = useTeam();

  // Dienstleister sehen die Liste team-gescoped (globaler Team-Kontext aus dem
  // TeamSwitcher); fuer alle anderen bleibt die Abfrage unveraendert ungefiltert.
  const teamScope = isDienstleister && selectedTeamId != null;
  const { data: users, isLoading: usersLoading } = useListUsers(
    teamScope ? { role: "assistant", teamId: selectedTeamId } : { role: "assistant" },
  );
  const { data: contracts, isLoading: contractsLoading } = useListContracts();

  // Mitgliederliste des gewaehlten Teams: liefert teamCount je Nutzer, damit wir
  // vor dem Entfernen der LETZTEN Mitgliedschaft warnen koennen.
  const { data: teamMembers } = useListTeamMembers(selectedTeamId ?? 0, {
    query: { enabled: teamScope },
  } as Parameters<typeof useListTeamMembers>[1]) as {
    data?: { userId: number; teamCount: number }[];
  };
  const removeMember = useRemoveTeamMember();

  const [removeUser, setRemoveUser] = useState<User | undefined>();
  const [memberBusy, setMemberBusy] = useState(false);

  const teamCountByUserId = new Map(
    (teamMembers ?? []).map((m) => [m.userId, m.teamCount]),
  );

  async function invalidateMemberQueries() {
    await queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
    await queryClient.invalidateQueries({ queryKey: getListContractsQueryKey() });
    if (selectedTeamId != null) {
      await queryClient.invalidateQueries({
        queryKey: getListTeamMembersQueryKey(selectedTeamId),
      });
    }
  }

  async function handleRemoveFromTeam() {
    if (!removeUser || selectedTeamId == null) return;
    setMemberBusy(true);
    try {
      await removeMember.mutateAsync({ id: selectedTeamId, userId: removeUser.id });
      setRemoveUser(undefined);
      await invalidateMemberQueries();
      toast.success("Assistenzkraft aus dem Team entfernt.");
    } catch (err) {
      toast.error(readableApiError(err, "Entfernen fehlgeschlagen. Bitte erneut versuchen."));
    } finally {
      setMemberBusy(false);
    }
  }

  // Free-Plan begrenzt die Anzahl der Assistenten (Free = 6). Ist das Limit
  // erreicht, wird das Anlegen gesperrt (Durchsetzung zusaetzlich serverseitig).
  // `null` = unbegrenzt (Premium). Bestandsschutz: vorhandene Assistenten bleiben
  // sichtbar/editierbar; nur das Anlegen ueber dem Limit ist gesperrt.
  const assistantCount = (users ?? []).length;
  const assistantLimit = getLimit(currentUser, "maxAssistants");
  const canAddAssistant = isWithinLimit(currentUser, "maxAssistants", assistantCount);

  // Premium-Features (UX-Gates; serverseitige Durchsetzung ist autoritativ):
  // PDF-Stundennachweis (payrollExport) und Einladungslinks (caregiverLogin).
  const canPayrollExport = hasAccess(currentUser, "payrollExport");
  const canInvite = hasAccess(currentUser, "caregiverLogin");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editUser, setEditUser] = useState<User | undefined>();
  const [editContract, setEditContract] = useState<Contract | undefined>();
  const [dialogOpenToken, setDialogOpenToken] = useState(0);
  const [inviteUser, setInviteUser] = useState<User | undefined>();
  const [exportUser, setExportUser] = useState<User | undefined>();

  const isLoading = usersLoading || contractsLoading;

  // Hervorheben eines Assistenten (z.B. vom Dashboard-Hinweis "wenig Resturlaub").
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

  function openEdit(user: User, contract?: Contract) {
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
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl md:text-3xl font-serif font-bold text-foreground">Assistenten</h2>
          <p className="text-muted-foreground mt-1 text-sm">Verwaltung der Mitarbeiter und Verträge</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Team-Auswahl (rendert nur fuer Dienstleister mit Teams) — die Liste
              unten ist auf das hier gewaehlte Team gefiltert. */}
          <TeamSwitcher />
        {canAddAssistant ? (
          <Button onClick={openCreate} className="gap-2">
            <UserPlus className="h-4 w-4" />
            <span className="hidden sm:inline">Neu anlegen</span>
            <span className="sm:hidden">Neu</span>
          </Button>
        ) : (
          <Button
            disabled
            className="gap-2"
            title={`Im Free-Plan sind max. ${assistantLimit} Assistenten möglich. Upgrade auf Premium für unbegrenzte Assistenten.`}
          >
            <Lock className="h-4 w-4" />
            <span className="hidden sm:inline">Neu anlegen</span>
            <span className="sm:hidden">Neu</span>
          </Button>
        )}
        </div>
      </div>

      {/* Limit-Hinweis (Free-Plan). Bei Premium ist assistantLimit null. */}
      {!canAddAssistant && assistantLimit !== null && (
        <PlanLimitBanner>
          Im Free-Plan sind maximal {assistantLimit} Assistenten möglich. Für unbegrenzte
          Assistenten ist ein Upgrade auf Premium nötig.
        </PlanLimitBanner>
      )}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-52 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(users ?? []).map((user) => {
            const userContracts = (contracts ?? []).filter((c) => c.userId === user.id);
            const activeContract = userContracts.find(
              (c) => !c.endDate || new Date(c.endDate) > new Date()
            );

            const { vorname, nachname } = splitName(user.name);
            const isHighlighted = highlightId != null && String(user.id) === highlightId;

            return (
              <Card
                key={user.id}
                ref={isHighlighted ? highlightRef : undefined}
                data-testid={`assistant-card-${user.id}`}
                data-highlighted={isHighlighted && highlightActive ? "true" : "false"}
                className={`border-border/50 shadow-sm overflow-hidden flex flex-col hover:shadow-md transition-shadow ${
                  isHighlighted && highlightActive ? "ring-2 ring-primary ring-offset-2" : ""
                }`}
              >
                <div className="px-5 py-4 border-b border-border/40 bg-muted/30 flex items-start justify-between gap-3">
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
                  <Badge
                    variant={user.isActive ? "default" : "secondary"}
                    className="shrink-0 text-xs"
                  >
                    {user.isActive ? "Aktiv" : "Inaktiv"}
                  </Badge>
                </div>

                <CardContent className="p-5 flex-1 flex flex-col justify-between gap-4">
                  {activeContract ? (
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Wochenstunden</span>
                        <span className="font-medium">{activeContract.weeklyHours} h</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Arbeitstage/Woche</span>
                        <span className="font-medium">{activeContract.workdaysPerWeek ?? 5} Tage</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Urlaubsanspruch</span>
                        <span className="font-medium">{activeContract.vacationDays} Tage</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5" /> Seit
                        </span>
                        <span className="font-medium">
                          {format(new Date(activeContract.startDate), "dd.MM.yyyy")}
                        </span>
                      </div>
                      {activeContract.notes && (
                        <p className="text-xs text-muted-foreground pt-1 border-t border-border/40">
                          {activeContract.notes}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground py-4 text-center border border-dashed rounded-lg">
                      Kein aktiver Vertrag hinterlegt
                    </div>
                  )}

                  <div className="flex justify-end gap-2 flex-wrap">
                    {/* Premium-Gates (reine UX — autoritativ setzt der Server durch):
                        PDF-Stundennachweis = payrollExport, Einladungslink = caregiverLogin. */}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 text-muted-foreground hover:text-foreground"
                      onClick={() => setExportUser(user as User)}
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
                      onClick={() => setInviteUser(user as User)}
                      disabled={!canInvite}
                      title={
                        canInvite
                          ? "Einladungslink generieren"
                          : PLAN_FEATURE_MESSAGES.caregiverLogin
                      }
                    >
                      <Send className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Einladen</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => openEdit(user as User, activeContract as Contract | undefined)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Bearbeiten
                    </Button>
                    {teamScope && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1.5 text-muted-foreground hover:text-destructive"
                        onClick={() => setRemoveUser(user as User)}
                        title="Aus dem gewählten Team entfernen"
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
              <p className="text-muted-foreground mb-4">Noch keine Assistenten angelegt.</p>
              <Button onClick={openCreate} variant="outline" className="gap-2">
                <Plus className="h-4 w-4" /> Ersten Assistenten anlegen
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
        <ExportDialog
          open={!!exportUser}
          onClose={() => setExportUser(undefined)}
          userId={exportUser.id}
          userName={exportUser.name}
        />
      )}
      {/* Bestaetigung vor dem Entfernen aus dem Team; bei der LETZTEN
          Team-Zuordnung zusaetzliche Warnung (Person verschwindet aus allen
          team-gescopten Listen, Daten bleiben erhalten). */}
      <AlertDialog open={!!removeUser} onOpenChange={(v) => !v && setRemoveUser(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Aus dem Team entfernen?</AlertDialogTitle>
            <AlertDialogDescription>
              {removeUser && (
                <>
                  {removeUser.name} wird aus dem aktuell gewählten Team entfernt.{" "}
                  {(teamCountByUserId.get(removeUser.id) ?? 0) <= 1 ? (
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
