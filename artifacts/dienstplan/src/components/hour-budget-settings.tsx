// ---------------------------------------------------------------------------
// Zielvereinbarungen (Stundenbudget) — Einstellungen-Karte (Premium).
// ---------------------------------------------------------------------------
// Bedarfsseite: genehmigte Assistenzstunden pro Monat mit Gültigkeitszeitraum
// (von/bis). Eine neue Zielvereinbarung löst die alte zeitraumbezogen ab —
// die Historie bleibt erhalten (Nachberechnungen/Monatsabschlüsse).
// Überlappende Zeiträume lehnt der Server mit 409 budget_overlap ab.
// Free-Konten sehen die Karte gesperrt mit Premium-Verweis (UX-Gate; der
// Server setzt das Gate autoritativ mit 403 plan_feature_required durch).
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListHourBudgets,
  useCreateHourBudget,
  useUpdateHourBudget,
  useDeleteHourBudget,
  getListHourBudgetsQueryKey,
  type HourBudget,
} from "@workspace/api-client-react";
import { useAuth } from "@/context/auth";
import { useTeam } from "@/context/team";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePickerField } from "@/components/date-picker-field";
import { PlanLimitBanner } from "@/components/plan-limit-banner";
import { Plus, Pencil, Trash2, Lock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { readableApiError } from "@/lib/api-error";
import { hasAccess } from "@/lib/entitlements";
import { formatHours } from "@/lib/utils";
import { format, parseISO } from "date-fns";
import { de } from "date-fns/locale";

type BudgetFormState = {
  monthlyHours: string;
  startDate: string;
  endDate: string; // "" = unbefristet
  notes: string;
};

function emptyBudgetForm(): BudgetFormState {
  return { monthlyHours: "", startDate: "", endDate: "", notes: "" };
}

function formFromBudget(b: HourBudget): BudgetFormState {
  return {
    monthlyHours: String(b.monthlyHours).replace(".", ","),
    startDate: b.startDate,
    endDate: b.endDate ?? "",
    notes: b.notes ?? "",
  };
}

function formatDateDE(iso: string): string {
  return format(parseISO(iso), "dd.MM.yyyy", { locale: de });
}

function BudgetDialog({
  open,
  onClose,
  editBudget,
  targetTeamId,
}: {
  open: boolean;
  onClose: () => void;
  editBudget?: HourBudget;
  targetTeamId: number | null;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createBudget = useCreateHourBudget();
  const updateBudget = useUpdateHourBudget();
  const [form, setForm] = useState<BudgetFormState>(() =>
    editBudget ? formFromBudget(editBudget) : emptyBudgetForm(),
  );
  const [error, setError] = useState<string | null>(null);

  const monthlyHours = Number(form.monthlyHours.replace(",", "."));
  const hoursValid = Number.isFinite(monthlyHours) && monthlyHours > 0;
  const datesValid =
    form.startDate !== "" && (form.endDate === "" || form.endDate >= form.startDate);
  const isValid = hoursValid && datesValid;
  const saving = createBudget.isPending || updateBudget.isPending;

  async function handleSave() {
    if (!isValid) return;
    setError(null);
    const payload = {
      monthlyHours,
      startDate: form.startDate,
      ...(form.endDate !== "" ? { endDate: form.endDate } : {}),
      ...(form.notes.trim() !== "" ? { notes: form.notes.trim() } : {}),
    };
    try {
      if (editBudget) {
        await updateBudget.mutateAsync({
          id: editBudget.id,
          data: {
            ...payload,
            // Explizites Leeren des Endes ("unbefristet") muss als null durchgehen.
            ...(form.endDate === "" ? { endDate: null } : {}),
          },
        });
      } else {
        await createBudget.mutateAsync({
          data: {
            ...payload,
            ...(targetTeamId != null ? { teamId: targetTeamId } : {}),
          },
        });
      }
      await queryClient.invalidateQueries({ queryKey: getListHourBudgetsQueryKey() });
      toast({
        title: editBudget ? "Stundenbudget aktualisiert" : "Stundenbudget angelegt",
      });
      onClose();
    } catch (err) {
      if (!navigator.onLine) return; // Banner erklärt den Grund bereits.
      // Fachliche Ablehnung (z. B. 409 budget_overlap) direkt im Dialog zeigen.
      setError(readableApiError(err, "Bitte erneut versuchen."));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {/* max-h + Scroll: sonst sind die Footer-Buttons mobil unerreichbar. */}
      <DialogContent className="max-h-[90vh] overflow-y-auto" data-testid="budget-dialog">
        <DialogHeader>
          <DialogTitle>
            {editBudget ? "Stundenbudget bearbeiten" : "Neues Stundenbudget"}
          </DialogTitle>
          <DialogDescription>
            Genehmigte Assistenzstunden pro Monat. Zeiträume dürfen sich nicht überlappen —
            ein neues Stundenbudget löst das alte ab, die Historie bleibt erhalten.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="budget-monthly-hours">Stunden pro Monat</Label>
            <Input
              id="budget-monthly-hours"
              data-testid="budget-monthly-hours"
              inputMode="decimal"
              placeholder="z. B. 46,5"
              value={form.monthlyHours}
              onChange={(e) => setForm((f) => ({ ...f, monthlyHours: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Gültig ab</Label>
              <DatePickerField
                data-testid="budget-start-date"
                value={form.startDate}
                onChange={(iso) => setForm((f) => ({ ...f, startDate: iso }))}
                yearsBack={5}
                yearsForward={5}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Gültig bis (leer = unbefristet)</Label>
              <DatePickerField
                data-testid="budget-end-date"
                value={form.endDate}
                onChange={(iso) => setForm((f) => ({ ...f, endDate: iso }))}
                yearsBack={5}
                yearsForward={5}
                clearable
              />
            </div>
          </div>
          {form.startDate !== "" && form.endDate !== "" && form.endDate < form.startDate && (
            <p className="text-sm text-destructive" data-testid="budget-date-error">
              Das Enddatum liegt vor dem Beginndatum — bitte korrigieren.
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="budget-notes">Notiz (optional)</Label>
            <Input
              id="budget-notes"
              data-testid="budget-notes"
              placeholder="z. B. Zielvereinbarung vom 01.01.2026"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>
          {error && (
            <p className="text-sm text-destructive" data-testid="budget-error">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Abbrechen
          </Button>
          <Button onClick={handleSave} disabled={!isValid || saving} data-testid="budget-save">
            {saving
              ? "Speichern…"
              : editBudget
                ? "Änderungen speichern"
                : "Stundenbudget anlegen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function HourBudgetSettingsCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();
  const { teams, isDienstleister, selectedTeamId, isTeamScopeReady } = useTeam();

  // Team-Filter wie im Dienste-Bereich: initial dem globalen Team-Switcher
  // folgen, lokale Auswahl übersteuert nur diese Karte.
  const [teamOverride, setTeamOverride] = useState<number | null>(null);
  const showTeamFilter = isDienstleister && teams.length > 0;
  const budgetTeamId = showTeamFilter
    ? teamOverride != null && teams.some((t) => t.id === teamOverride)
      ? teamOverride
      : selectedTeamId
    : null;

  const hasBudgetFeature = hasAccess(currentUser, "advancedAnalytics");
  const { data: budgetsRaw, isLoading: budgetsLoading } = useListHourBudgets(
    budgetTeamId != null ? { teamId: budgetTeamId } : undefined,
    { query: { enabled: isTeamScopeReady && hasBudgetFeature } } as Parameters<
      typeof useListHourBudgets
    >[1],
  );
  const budgets: HourBudget[] = (budgetsRaw ?? []) as HourBudget[];
  const isLoading = !isTeamScopeReady || (hasBudgetFeature && budgetsLoading);
  const deleteBudget = useDeleteHourBudget();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editBudget, setEditBudget] = useState<HourBudget | undefined>();
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  function openCreate() {
    setEditBudget(undefined);
    setDialogOpen(true);
  }

  function openEdit(budget: HourBudget) {
    setEditBudget(budget);
    setDialogOpen(true);
  }

  async function handleDelete(id: number) {
    if (confirmDelete !== id) {
      setConfirmDelete(id);
      return;
    }
    try {
      await deleteBudget.mutateAsync({ id });
      await queryClient.invalidateQueries({ queryKey: getListHourBudgetsQueryKey() });
      toast({ title: "Stundenbudget gelöscht" });
    } catch (err) {
      if (!navigator.onLine) return;
      toast({
        title: "Stundenbudget kann nicht gelöscht werden",
        description: readableApiError(err, "Bitte erneut versuchen."),
        variant: "destructive",
      });
    } finally {
      setConfirmDelete(null);
    }
  }

  // Free-Gate: Karte bleibt sichtbar, Funktion gesperrt (Premium-Verweis nach
  // PlanLimitBanner-Muster; der Server lehnt zusätzlich mit 403 ab).
  if (!hasBudgetFeature) {
    return (
      <Card className="border-border/50 shadow-sm" data-testid="hour-budget-card-locked">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Lock className="h-4 w-4 text-muted-foreground" />
            Monatliches Stundenbudget
          </CardTitle>
          <CardDescription>
            Hinterlege, wie viele Assistenzstunden pro Monat genehmigt sind. Das Dashboard zeigt
            dir dann genehmigte, verbrauchte und verbleibende Stunden plus Jahressaldo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PlanLimitBanner>
            Das monatliche Stundenbudget und die Stundenbilanz sind im Premium-Tarif enthalten.
          </PlanLimitBanner>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50 shadow-sm" data-testid="hour-budget-card">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="text-lg">Monatliches Stundenbudget</CardTitle>
          <CardDescription>
            Genehmigte Assistenzstunden pro Monat mit Gültigkeitszeitraum. Ein neues
            Stundenbudget löst das alte zeitraumbezogen ab — die Historie bleibt erhalten.
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {showTeamFilter && (
            <Select
              value={budgetTeamId == null ? undefined : String(budgetTeamId)}
              onValueChange={(v) => setTeamOverride(Number(v))}
            >
              <SelectTrigger
                className="w-40 sm:w-56"
                data-testid="budget-team-filter"
                aria-label="Team für Stundenbudget auswählen"
              >
                <SelectValue placeholder="Team auswählen" />
              </SelectTrigger>
              <SelectContent>
                {teams.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            onClick={openCreate}
            className="gap-2"
            data-testid="budget-create"
            disabled={!isTeamScopeReady}
          >
            <Plus className="h-4 w-4" />
            {/* Kein Kurz-Label ("Neu") auf Mobile: kollidiert sonst per
                getByRole(/^Neu$/) mit dem Dienste-Button (smoke-Spec).
                Wortlaut: erstes Budget = "Stundenbudget anlegen", danach
                "Neues Stundenbudget". */}
            {budgets.length === 0 ? "Stundenbudget anlegen" : "Neues Stundenbudget"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-4 space-y-3">
            {[1, 2].map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : budgets.length === 0 ? (
          <div className="p-8 text-center" data-testid="budget-empty">
            <p className="text-muted-foreground mb-4">
              Noch kein Stundenbudget hinterlegt. Lege an, wie viele Stunden pro Monat
              genehmigt sind — das Dashboard zeigt dann die Stundenbilanz.
            </p>
            <Button onClick={openCreate} variant="outline" className="gap-2">
              <Plus className="h-4 w-4" /> Stundenbudget anlegen
            </Button>
          </div>
        ) : (
          <ul className="divide-y divide-border/50" data-testid="budget-list">
            {budgets.map((budget) => (
              <li
                key={budget.id}
                className="flex items-center gap-3 px-4 py-3 hover:bg-muted/20 transition-colors"
                data-testid={`budget-item-${budget.id}`}
              >
                <div className="min-w-0 flex-1">
                  <span className="font-medium">{formatHours(budget.monthlyHours)} pro Monat</span>
                  <p className="text-xs text-muted-foreground">
                    {formatDateDE(budget.startDate)} –{" "}
                    {budget.endDate ? formatDateDE(budget.endDate) : "unbefristet"}
                    {budget.notes ? ` · ${budget.notes}` : ""}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => openEdit(budget)}
                  data-testid={`budget-edit-${budget.id}`}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Bearbeiten</span>
                </Button>
                <Button
                  variant={confirmDelete === budget.id ? "destructive" : "ghost"}
                  size="sm"
                  className="gap-1.5"
                  onClick={() => handleDelete(budget.id)}
                  onBlur={() => setConfirmDelete(null)}
                  data-testid={`budget-delete-${budget.id}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">
                    {confirmDelete === budget.id ? "Wirklich?" : "Löschen"}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {dialogOpen && (
        <BudgetDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          editBudget={editBudget}
          targetTeamId={budgetTeamId}
        />
      )}
    </Card>
  );
}
