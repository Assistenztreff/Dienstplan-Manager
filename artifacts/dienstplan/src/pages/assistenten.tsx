import { useState } from "react";
import {
  useListUsers,
  useListContracts,
  useCreateUser,
  useUpdateUser,
  useCreateContract,
  useUpdateContract,
  getListUsersQueryKey,
  getListContractsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Plus, Mail, Phone, MapPin, Calendar, Pencil, UserPlus } from "lucide-react";
import { format } from "date-fns";

type User = {
  id: number;
  name: string;
  email: string;
  role: string;
  phone?: string | null;
  address?: string | null;
  isActive: boolean;
};

type Contract = {
  id: number;
  userId: number;
  weeklyHours: number;
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
  weeklyHours: string;
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
  weeklyHours: "20",
  vacationDays: "30",
  startDate: format(new Date(), "yyyy-MM-dd"),
  notes: "",
};

function splitName(name: string): { vorname: string; nachname: string } {
  const parts = name.trim().split(/\s+/);
  return {
    vorname: parts[0] ?? "",
    nachname: parts.slice(1).join(" "),
  };
}

function FieldRow({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
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
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const createContract = useCreateContract();
  const updateContract = useUpdateContract();

  const isEditing = !!editUser;

  const [form, setForm] = useState<FormState>(() => {
    if (editUser) {
      const { vorname, nachname } = splitName(editUser.name);
      return {
        vorname,
        nachname,
        email: editUser.email,
        phone: editUser.phone ?? "",
        address: editUser.address ?? "",
        weeklyHours: editContract ? String(editContract.weeklyHours) : "20",
        vacationDays: editContract ? String(editContract.vacationDays) : "30",
        startDate: editContract ? editContract.startDate : format(new Date(), "yyyy-MM-dd"),
        notes: editContract?.notes ?? "",
      };
    }
    return EMPTY_FORM;
  });

  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [saving, setSaving] = useState(false);

  function set(field: keyof FormState, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
  }

  function validate(): boolean {
    const errs: Partial<Record<keyof FormState, string>> = {};
    if (!form.vorname.trim()) errs.vorname = "Pflichtfeld";
    if (!form.nachname.trim()) errs.nachname = "Pflichtfeld";
    if (!form.email.trim()) errs.email = "Pflichtfeld";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = "Ungueltige E-Mail-Adresse";
    if (!form.address.trim()) errs.address = "Pflichtfeld";
    if (!form.weeklyHours || Number(form.weeklyHours) <= 0) errs.weeklyHours = "Muss groesser als 0 sein";
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
          params: { id: editUser.id },
          data: { name, email: form.email, phone: form.phone || null, address: form.address },
        });

        if (editContract) {
          await updateContract.mutateAsync({
            params: { id: editContract.id },
            data: {
              weeklyHours: Number(form.weeklyHours),
              vacationDays: Number(form.vacationDays),
              notes: form.notes || null,
            },
          });
        } else {
          await createContract.mutateAsync({
            data: {
              userId: editUser.id,
              weeklyHours: Number(form.weeklyHours),
              vacationDays: Number(form.vacationDays),
              startDate: form.startDate,
              notes: form.notes || undefined,
            },
          });
        }
      } else {
        const newUser = await createUser.mutateAsync({
          data: { name, email: form.email, role: "assistant", phone: form.phone || undefined, address: form.address },
        });

        await createContract.mutateAsync({
          data: {
            userId: newUser.id,
            weeklyHours: Number(form.weeklyHours),
            vacationDays: Number(form.vacationDays),
            startDate: form.startDate,
            notes: form.notes || undefined,
          },
        });
      }

      await queryClient.invalidateQueries({ queryKey: getListUsersQueryKey({ role: "assistant" }) });
      await queryClient.invalidateQueries({ queryKey: getListContractsQueryKey() });
      onClose();
    } catch {
      setErrors({ email: "Speichern fehlgeschlagen. Bitte pruefen und erneut versuchen." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">
            {isEditing ? "Assistenten bearbeiten" : "Neuen Assistenten anlegen"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-2">
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              Personendaten
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <FieldRow label="Vorname *" error={errors.vorname}>
                <Input value={form.vorname} onChange={(e) => set("vorname", e.target.value)} placeholder="Max" />
              </FieldRow>
              <FieldRow label="Nachname *" error={errors.nachname}>
                <Input value={form.nachname} onChange={(e) => set("nachname", e.target.value)} placeholder="Mustermann" />
              </FieldRow>
            </div>

            <div className="mt-4 space-y-4">
              <FieldRow label="E-Mail *" error={errors.email}>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                  placeholder="max@example.de"
                />
              </FieldRow>

              <FieldRow label="Telefon">
                <Input
                  value={form.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  placeholder="0171-1234567"
                />
              </FieldRow>

              <FieldRow label="Adresse *" error={errors.address}>
                <Input
                  value={form.address}
                  onChange={(e) => set("address", e.target.value)}
                  placeholder="Musterstr. 1, 12345 Musterstadt"
                />
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

              <FieldRow label="Vertragsbeginn *" error={errors.startDate}>
                <Input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => set("startDate", e.target.value)}
                />
              </FieldRow>

              <FieldRow label="Hinweise">
                <Input
                  value={form.notes}
                  onChange={(e) => set("notes", e.target.value)}
                  placeholder="z.B. Teilzeit Nachmittag"
                />
              </FieldRow>
            </div>
          </section>
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

export default function Assistenten() {
  const { data: users, isLoading: usersLoading } = useListUsers({ role: "assistant" });
  const { data: contracts, isLoading: contractsLoading } = useListContracts();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editUser, setEditUser] = useState<User | undefined>();
  const [editContract, setEditContract] = useState<Contract | undefined>();

  const isLoading = usersLoading || contractsLoading;

  function openCreate() {
    setEditUser(undefined);
    setEditContract(undefined);
    setDialogOpen(true);
  }

  function openEdit(user: User, contract?: Contract) {
    setEditUser(user);
    setEditContract(contract);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditUser(undefined);
    setEditContract(undefined);
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl md:text-3xl font-serif font-bold text-foreground">Assistenten</h2>
          <p className="text-muted-foreground mt-1 text-sm">Verwaltung der Mitarbeiter und Vertraege</p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <UserPlus className="h-4 w-4" />
          <span className="hidden sm:inline">Neu anlegen</span>
          <span className="sm:hidden">Neu</span>
        </Button>
      </div>

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

            return (
              <Card
                key={user.id}
                className="border-border/50 shadow-sm overflow-hidden flex flex-col hover:shadow-md transition-shadow"
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

                  <div className="flex justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => openEdit(user as User, activeContract as Contract | undefined)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Bearbeiten
                    </Button>
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
        open={dialogOpen}
        onClose={closeDialog}
        editUser={editUser}
        editContract={editContract}
      />
    </div>
  );
}
