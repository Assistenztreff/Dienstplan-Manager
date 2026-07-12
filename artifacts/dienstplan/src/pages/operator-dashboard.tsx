// ---------------------------------------------------------------------------
// Operator-Dashboard (nur fuer Rolle "superadmin")
// ---------------------------------------------------------------------------
// Interne Betreiber-Konsole zur Verwaltung der SaaS-Plattform. NICHT fuer
// Endkunden (Assistenznehmer/Dienstleister) gedacht — der Zugang ist auf die
// Rolle "superadmin" beschraenkt (Routing-Guard in App.tsx, versteckter Link
// im Footer nur fuer superadmin). Der Frontend-Guard ist reine UX: die
// Autorisierung erzwingt der Server per requireSuperadmin auf allen
// /api/operator/*-Endpunkten (Nicht-Superadmins erhalten 403).
//
// Bereich 1 (Nutzer-Monitoring + Premium-Freischaltung) ist LIVE angebunden:
//   GET  /api/operator/accounts            — alle Konten mit Aggregaten
//   PATCH /api/operator/accounts/:id/plan  — manueller Plan-Flip free/premium
// Die Wirkung ist sofort, da die Plan-Durchsetzung (lib/plan.ts) users.plan
// pro Request frisch aus der DB liest.
//
// Bereich 3 (Fehler-Tracking) ist LIVE angebunden:
//   GET /api/operator/errors — echte Serverfehler aus platform_errors,
//   befuellt vom zentralen Express-Error-Handler (recordPlatformError).
//   Bei Level "error" geht zusaetzlich eine gedrosselte Warn-E-Mail an den
//   Betreiber (lib/alert-mailer.ts im api-server).
//
// Bereich 2 (Lexware-Buchungs-Log) ist an den Endpunkt
// GET /api/operator/lexware/bookings angebunden. Die echte Lexware-Anbindung
// ist bewusst verschoben, bis die Datenbank auf einen deutschen Server
// migriert ist: bis dahin liefert serverseitig ein Mock-Adapter
// (lib/lexware.ts im api-server) Beispieldaten mit source = "demo" — die
// Karte kennzeichnet das deutlich per "Demo-Daten"-Badge. Sobald der echte
// Client (Secret LEXWARE_API_KEY) antwortet, kommt source = "live" in
// identischer Form; Badge und Hinweis verschwinden ohne Frontend-Umbau.
//
// Billing-Hintergrund: Abo-Buchungen erzeugen Rechnungsentwuerfe in Lexware.
// Die Premium-Freischaltung erfolgt MANUELL hier im Dashboard, sobald die
// Zahlung bestaetigt ist (kein Stripe / keine automatische Verlaengerung).
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import {
  useListOperatorAccounts,
  useUpdateOperatorAccountPlan,
  useListOperatorPlanChanges,
  useListOperatorErrors,
  useUpdateOperatorError,
  useResolveAllOperatorErrors,
  useListOperatorLexwareBookings,
  getListOperatorAccountsQueryKey,
  getListOperatorPlanChangesQueryKey,
  getListOperatorErrorsQueryKey,
  type OperatorAccount,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Users, Receipt, AlertTriangle, ShieldCheck, History, Check, CheckCheck, Undo2, ChevronDown, ChevronUp, Search } from "lucide-react";
import { readableApiError } from "@/lib/api-error";
import { useToast } from "@/hooks/use-toast";

// Euro-Formatierung fuer Lexware-Betraege (z. B. 49 → "49,00 €").
const euroFormat = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
});

function planBadge(plan: "free" | "premium") {
  return plan === "premium" ? (
    <Badge className="bg-brand-yellow text-brand-dark hover:bg-brand-yellow">Premium</Badge>
  ) : (
    <Badge variant="outline">Free</Badge>
  );
}

// Wandelt einen YYYY-MM-DD-Wert der Datums-Eingabe in ein Date-Objekt am
// LOKALEN Tagesbeginn (00:00:00.000 Ortszeit) um. Rückgabe null bei
// unbrauchbarem Eingabewert.
function parseLocalDayStart(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Wie parseLocalDayStart, aber für das LOKALE Tagesende (23:59:59.999
// Ortszeit), damit der gewählte Tag einschließlich gefiltert wird.
function parseLocalDayEnd(value: string): Date | null {
  const start = parseLocalDayStart(value);
  if (!start) return null;
  return new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate(),
    23,
    59,
    59,
    999,
  );
}

export default function OperatorDashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pendingId, setPendingId] = useState<number | null>(null);
  // Bestätigungs-Dialog vor dem Plan-Flip: hier kann optional eine
  // Rechnungs-/Zahlungsreferenz (z. B. Lexware-Belegnummer) erfasst werden,
  // die im Audit-Log (plan_changes.note) landet.
  const [confirmAccount, setConfirmAccount] = useState<OperatorAccount | null>(null);
  const [note, setNote] = useState("");

  // Suche im Plan-Änderungsprotokoll (nach Konto Name/E-Mail oder Notiz).
  // Der Eingabewert wird entkoppelt (debounced) an die Query übergeben, damit
  // nicht bei jedem Tastendruck ein Request feuert.
  const [planSearchInput, setPlanSearchInput] = useState("");
  const [planSearch, setPlanSearch] = useState("");
  useEffect(() => {
    const handle = window.setTimeout(() => {
      setPlanSearch(planSearchInput.trim());
    }, 300);
    return () => window.clearTimeout(handle);
  }, [planSearchInput]);

  // Zeitraum-Filter (von/bis) im Plan-Änderungsprotokoll. Die Datums-Eingaben
  // liefern YYYY-MM-DD; daraus werden ISO-Zeitstempel für den LOKALEN
  // Tagesbeginn (von) bzw. das LOKALE Tagesende (bis, einschließlich) gebaut,
  // damit ein ganzer Tag aus Sicht des Betreibers (z. B. deutsche Zeitzone)
  // vollständig im Zeitraum liegt. Ein fixes Z-Suffix (UTC-Tagesgrenzen) würde
  // Einträge kurz nach Mitternacht lokaler Zeit dem falschen Tag zuordnen.
  const [planFrom, setPlanFrom] = useState("");
  const [planTo, setPlanTo] = useState("");

  // Schnellauswahl-Presets für den Zeitraum-Filter: befüllen von/bis in einem
  // Klick. Berechnung auf Basis des lokalen Datums (wie die Datums-Eingaben
  // selbst, die ebenfalls lokale YYYY-MM-DD-Werte liefern).
  function toDateInputValue(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  function applyPlanRangePreset(preset: "thisMonth" | "lastMonth" | "last30Days") {
    const today = new Date();
    let from: Date;
    let to: Date;
    if (preset === "thisMonth") {
      from = new Date(today.getFullYear(), today.getMonth(), 1);
      to = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    } else if (preset === "lastMonth") {
      from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      to = new Date(today.getFullYear(), today.getMonth(), 0);
    } else {
      from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29);
      to = today;
    }
    setPlanFrom(toDateInputValue(from));
    setPlanTo(toDateInputValue(to));
  }
  const planChangesParams = useMemo(() => {
    const params: { search?: string; from?: string; to?: string } = {};
    if (planSearch) params.search = planSearch;
    if (planFrom) {
      const from = parseLocalDayStart(planFrom);
      if (from) params.from = from.toISOString();
    }
    if (planTo) {
      const to = parseLocalDayEnd(planTo);
      if (to) params.to = to.toISOString();
    }
    return Object.keys(params).length > 0 ? params : undefined;
  }, [planSearch, planFrom, planTo]);
  const hasPlanFilter = Boolean(planSearch || planFrom || planTo);

  const accountsQuery = useListOperatorAccounts();
  const planChangesQuery = useListOperatorPlanChanges(planChangesParams);
  const errorsQuery = useListOperatorErrors();
  const lexwareQuery = useListOperatorLexwareBookings();
  const updatePlan = useUpdateOperatorAccountPlan();
  const updateError = useUpdateOperatorError();
  const resolveAllErrors = useResolveAllOperatorErrors();
  // Filter der Fehlerliste: "open" (Default) blendet erledigte aus, "all"
  // zeigt alles (erledigte ausgegraut).
  const [errorFilter, setErrorFilter] = useState<"open" | "all">("open");
  const [pendingErrorId, setPendingErrorId] = useState<number | null>(null);
  // Aufgeklappte Fehler-Details (Stacktrace des letzten Auftretens);
  // mehrere Eintraege koennen gleichzeitig offen sein.
  const [expandedErrorIds, setExpandedErrorIds] = useState<Set<number>>(new Set());

  function toggleErrorDetails(errorId: number) {
    setExpandedErrorIds((prev) => {
      const next = new Set(prev);
      if (next.has(errorId)) {
        next.delete(errorId);
      } else {
        next.add(errorId);
      }
      return next;
    });
  }
  // Bestätigungs-Dialog vor dem Sammel-Abhaken aller offenen Fehler.
  const [confirmResolveAllOpen, setConfirmResolveAllOpen] = useState(false);

  // Alle offenen Fehler in einem Schritt abhaken (nach Bestätigung). Nach
  // einem Vorfall mit vielen gleichartigen Einträgen erspart das das
  // Einzel-Klicken; erledigte Einträge bleiben unverändert erhalten.
  async function handleResolveAllErrors() {
    try {
      const result = await resolveAllErrors.mutateAsync();
      await queryClient.invalidateQueries({ queryKey: getListOperatorErrorsQueryKey() });
      setConfirmResolveAllOpen(false);
      toast({
        title: "Alle offenen Fehler abgehakt",
        description:
          result.resolvedCount === 1
            ? "1 Eintrag wurde als erledigt markiert."
            : `${result.resolvedCount} Einträge wurden als erledigt markiert.`,
      });
    } catch (err) {
      toast({
        title: "Abhaken fehlgeschlagen",
        description: readableApiError(err, "Bitte erneut versuchen."),
        variant: "destructive",
      });
    }
  }

  // Erledigt-Status eines Fehler-Eintrags umschalten (abhaken / wieder
  // oeffnen). Serverseitig requireSuperadmin; danach Liste neu laden.
  async function handleToggleErrorResolved(errorId: number, resolved: boolean) {
    setPendingErrorId(errorId);
    try {
      await updateError.mutateAsync({ id: errorId, data: { resolved } });
      await queryClient.invalidateQueries({ queryKey: getListOperatorErrorsQueryKey() });
    } catch (err) {
      toast({
        title: "Status konnte nicht geändert werden",
        description: readableApiError(err, "Bitte erneut versuchen."),
        variant: "destructive",
      });
    } finally {
      setPendingErrorId(null);
    }
  }

  function openConfirmDialog(account: OperatorAccount) {
    setNote("");
    setConfirmAccount(account);
  }

  // Manuelle Premium-Freischaltung bzw. Rueckstufung. Serverseitig durch
  // requireSuperadmin geschuetzt; getUserPlan liest frisch → wirkt sofort.
  async function handleTogglePlan(account: OperatorAccount, noteValue: string) {
    const nextPlan = account.plan === "premium" ? "free" : "premium";
    setPendingId(account.id);
    try {
      const trimmed = noteValue.trim();
      await updatePlan.mutateAsync({
        id: account.id,
        data: { plan: nextPlan, ...(trimmed ? { note: trimmed } : {}) },
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListOperatorAccountsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListOperatorPlanChangesQueryKey() }),
      ]);
      setConfirmAccount(null);
      toast({
        title: nextPlan === "premium" ? "Premium aktiviert" : "Auf Free zurückgesetzt",
        description: `${account.name} (${account.email}) ist jetzt auf dem ${nextPlan === "premium" ? "Premium" : "Free"}-Plan. Die Umstellung wirkt sofort.`,
      });
    } catch (err) {
      toast({
        title: "Plan-Umschaltung fehlgeschlagen",
        description: readableApiError(err, "Bitte erneut versuchen."),
        variant: "destructive",
      });
    } finally {
      setPendingId(null);
    }
  }

  const accounts = accountsQuery.data ?? [];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-brand-dark p-2 text-brand-white">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <div>
          <h2 className="text-2xl md:text-3xl font-serif font-bold text-foreground">Operator-Dashboard</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Interne Betreiber-Konsole — nur für Superadmins.
          </p>
        </div>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Bereich 1: Nutzer- & Team-Monitoring + manuelle Premium-Schaltung */}
      {/* ----------------------------------------------------------------- */}
      <Card className="border-border/50 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Users className="h-5 w-5 text-brand-cyan" />
            Nutzer- &amp; Team-Monitoring
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {accountsQuery.isLoading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : accountsQuery.isError ? (
            <p className="p-4 text-sm text-destructive" data-testid="text-operator-accounts-error">
              Konten konnten nicht geladen werden:{" "}
              {readableApiError(accountsQuery.error, "Unbekannter Fehler.")}
            </p>
          ) : accounts.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Noch keine Konten vorhanden.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border/50 bg-slate-50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Konto</th>
                    <th className="px-4 py-3 font-medium">Typ</th>
                    <th className="px-4 py-3 font-medium">Teams</th>
                    <th className="px-4 py-3 font-medium">Assistenten</th>
                    <th className="px-4 py-3 font-medium">Plan</th>
                    <th className="px-4 py-3 font-medium text-right">Aktion</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((acc) => (
                    <tr key={acc.id} className="border-b border-border/30 last:border-0" data-testid={`row-operator-account-${acc.id}`}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{acc.name}</div>
                        <div className="text-xs text-muted-foreground">{acc.email}</div>
                      </td>
                      <td className="px-4 py-3 capitalize text-muted-foreground">{acc.accountType}</td>
                      <td className="px-4 py-3 text-muted-foreground">{acc.teams}</td>
                      <td className="px-4 py-3 text-muted-foreground">{acc.assistants}</td>
                      <td className="px-4 py-3" data-testid={`badge-operator-plan-${acc.id}`}>{planBadge(acc.plan)}</td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant={acc.plan === "premium" ? "outline" : "default"}
                          disabled={pendingId !== null}
                          onClick={() => openConfirmDialog(acc)}
                          data-testid={`button-toggle-plan-${acc.id}`}
                        >
                          {pendingId === acc.id
                            ? "Wird umgestellt…"
                            : acc.plan === "premium"
                              ? "Auf Free zurücksetzen"
                              : "Premium aktivieren"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bestätigungs-Dialog vor dem Plan-Flip: optionale Rechnungs-/       */}
      {/* Zahlungsreferenz (z. B. Lexware-Belegnummer) für das Audit-Log.     */}
      <Dialog
        open={confirmAccount !== null}
        onOpenChange={(open) => {
          if (!open && pendingId === null) setConfirmAccount(null);
        }}
      >
        <DialogContent data-testid="dialog-plan-confirm">
          <DialogHeader>
            <DialogTitle>
              {confirmAccount?.plan === "premium"
                ? "Auf Free zurücksetzen?"
                : "Premium aktivieren?"}
            </DialogTitle>
            <DialogDescription>
              {confirmAccount
                ? `${confirmAccount.name} (${confirmAccount.email}) wird auf den ${confirmAccount.plan === "premium" ? "Free" : "Premium"}-Plan umgestellt. Die Umstellung wirkt sofort und wird im Plan-Änderungsprotokoll festgehalten.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="plan-change-note">
              Rechnungs-/Zahlungsreferenz (optional)
            </Label>
            <Input
              id="plan-change-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              placeholder="z. B. Lexware-Beleg LX-2026-0042, Zahlungseingang 28.06."
              data-testid="input-plan-change-note"
            />
            <p className="text-xs text-muted-foreground">
              Wird im Plan-Änderungsprotokoll gespeichert und dokumentiert den
              Grund der Umstellung (z. B. bei Zahlungs-Streitfällen).
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pendingId !== null}
              onClick={() => setConfirmAccount(null)}
              data-testid="button-plan-confirm-cancel"
            >
              Abbrechen
            </Button>
            <Button
              disabled={pendingId !== null}
              onClick={() => confirmAccount && handleTogglePlan(confirmAccount, note)}
              data-testid="button-plan-confirm-submit"
            >
              {pendingId !== null
                ? "Wird umgestellt…"
                : confirmAccount?.plan === "premium"
                  ? "Auf Free zurücksetzen"
                  : "Premium aktivieren"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ----------------------------------------------------------------- */}
      {/* Plan-Änderungsprotokoll (Audit-Log der Premium-Freischaltungen)    */}
      {/* ----------------------------------------------------------------- */}
      {/* Jeder manuelle Plan-Flip schreibt einen Audit-Eintrag — hier sind   */}
      {/* die letzten Änderungen belegbar (wer, wann, welches Konto).         */}
      <Card className="border-border/50 shadow-sm">
        <CardHeader className="gap-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <History className="h-5 w-5 text-brand-cyan" />
            Plan-Änderungsprotokoll
          </CardTitle>
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={planSearchInput}
              onChange={(e) => setPlanSearchInput(e.target.value)}
              maxLength={200}
              placeholder="Nach Konto oder Belegnummer/Notiz suchen…"
              className="pl-9"
              data-testid="input-plan-change-search"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Schnellauswahl:</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => applyPlanRangePreset("thisMonth")}
              data-testid="button-plan-change-preset-this-month"
            >
              Dieser Monat
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => applyPlanRangePreset("lastMonth")}
              data-testid="button-plan-change-preset-last-month"
            >
              Letzter Monat
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => applyPlanRangePreset("last30Days")}
              data-testid="button-plan-change-preset-last-30-days"
            >
              Letzte 30 Tage
            </Button>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="plan-change-from" className="text-xs text-muted-foreground">
                Zeitraum von
              </Label>
              <Input
                id="plan-change-from"
                type="date"
                value={planFrom}
                max={planTo || undefined}
                onChange={(e) => setPlanFrom(e.target.value)}
                className="w-auto"
                data-testid="input-plan-change-from"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="plan-change-to" className="text-xs text-muted-foreground">
                Zeitraum bis
              </Label>
              <Input
                id="plan-change-to"
                type="date"
                value={planTo}
                min={planFrom || undefined}
                onChange={(e) => setPlanTo(e.target.value)}
                className="w-auto"
                data-testid="input-plan-change-to"
              />
            </div>
            {(planFrom || planTo) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPlanFrom("");
                  setPlanTo("");
                }}
                data-testid="button-plan-change-clear-range"
              >
                Zeitraum zurücksetzen
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {planChangesQuery.isLoading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : planChangesQuery.isError ? (
            <p className="p-4 text-sm text-destructive" data-testid="text-operator-plan-changes-error">
              Protokoll konnte nicht geladen werden:{" "}
              {readableApiError(planChangesQuery.error, "Unbekannter Fehler.")}
            </p>
          ) : (planChangesQuery.data ?? []).length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground" data-testid="text-operator-plan-changes-empty">
              {hasPlanFilter
                ? "Keine Plan-Änderungen für die aktuelle Filterung gefunden."
                : "Noch keine Plan-Änderungen protokolliert."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border/50 bg-slate-50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Zeitpunkt</th>
                    <th className="px-4 py-3 font-medium">Konto</th>
                    <th className="px-4 py-3 font-medium">Änderung</th>
                    <th className="px-4 py-3 font-medium">Referenz / Notiz</th>
                    <th className="px-4 py-3 font-medium">Ausgeführt von</th>
                  </tr>
                </thead>
                <tbody>
                  {(planChangesQuery.data ?? []).map((change) => (
                    <tr
                      key={change.id}
                      className="border-b border-border/30 last:border-0"
                      data-testid={`row-plan-change-${change.id}`}
                    >
                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                        {new Date(change.createdAt).toLocaleString("de-DE", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}{" "}
                        Uhr
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{change.accountName}</div>
                        <div className="text-xs text-muted-foreground">{change.accountEmail}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5">
                          {planBadge(change.oldPlan)}
                          <span className="text-muted-foreground">→</span>
                          {planBadge(change.newPlan)}
                        </span>
                      </td>
                      <td
                        className="px-4 py-3 max-w-[16rem] text-muted-foreground"
                        data-testid={`text-plan-change-note-${change.id}`}
                      >
                        {change.note ? (
                          <span className="break-words">{change.note}</span>
                        ) : (
                          <span className="text-muted-foreground/60">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{change.changedByName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ----------------------------------------------------------------- */}
      {/* Bereich 2: Lexware-Buchungs-Log (Endpunkt live, Daten via Adapter)  */}
      {/* ----------------------------------------------------------------- */}
      {/* GET /api/operator/lexware/bookings — heute Mock-Adapter mit         */}
      {/* Beispieldaten (source = "demo", deutlich gekennzeichnet), nach der  */}
      {/* Server-Migration echter Lexware-Client in identischer Form          */}
      {/* (source = "live"). Premium-Freischaltung erfolgt manuell in         */}
      {/* Bereich 1, sobald hier ein Zahlungseingang bestaetigt ist.          */}
      <Card className="border-border/50 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Receipt className="h-5 w-5 text-brand-cyan" />
            Lexware-Buchungs-Log
            {lexwareQuery.data?.source === "demo" && (
              <Badge variant="outline" className="ml-1 border-amber-400 bg-amber-50 text-amber-700" data-testid="badge-lexware-demo">
                Demo-Daten
              </Badge>
            )}
          </CardTitle>
          {lexwareQuery.data?.source === "demo" && (
            <p className="text-xs text-muted-foreground">
              Beispieldaten zur Veranschaulichung — die echte Lexware-Anbindung
              folgt nach der Server-Migration. Diese Einträge sind KEINE realen
              Buchungen.
            </p>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {lexwareQuery.isLoading ? (
            <div className="space-y-2 p-6">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-2/3" />
            </div>
          ) : lexwareQuery.isError ? (
            <p className="p-6 text-sm text-destructive" data-testid="text-lexware-error">
              Buchungs-Log konnte nicht geladen werden:{" "}
              {readableApiError(lexwareQuery.error, "Unbekannter Fehler")}
            </p>
          ) : (lexwareQuery.data?.bookings.length ?? 0) === 0 ? (
            <p className="p-6 text-sm text-muted-foreground" data-testid="text-lexware-empty">
              Keine Buchungen vorhanden.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border/50 bg-slate-50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Beleg</th>
                    <th className="px-4 py-3 font-medium">Konto</th>
                    <th className="px-4 py-3 font-medium">Art</th>
                    <th className="px-4 py-3 font-medium">Betrag</th>
                    <th className="px-4 py-3 font-medium">Datum</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {lexwareQuery.data?.bookings.map((b) => (
                    <tr key={b.id} className="border-b border-border/30 last:border-0" data-testid={`row-lexware-booking-${b.id}`}>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{b.id}</td>
                      <td className="px-4 py-3 text-foreground">
                        {b.accountName}
                        <span className="block text-xs text-muted-foreground">{b.accountEmail}</span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{b.type}</td>
                      <td className="px-4 py-3 text-foreground">{euroFormat.format(b.amount)}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {new Date(b.date).toLocaleDateString("de-DE")}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant={b.status === "bezahlt" ? "default" : b.status === "offen" ? "outline" : "destructive"}
                          className={b.status === "bezahlt" ? "bg-brand-cyan text-brand-white hover:bg-brand-cyan" : ""}
                        >
                          {b.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ----------------------------------------------------------------- */}
      {/* Bereich 3: Fehler-Tracking (LIVE)                                  */}
      {/* ----------------------------------------------------------------- */}
      {/* Echte Serverfehler aus platform_errors (GET /api/operator/errors),  */}
      {/* befuellt vom zentralen Express-Error-Handler. Bei Level "error"     */}
      {/* geht zusaetzlich eine gedrosselte Warn-E-Mail an den Betreiber.     */}
      <Card className="border-border/50 shadow-sm">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-lg">
              <AlertTriangle className="h-5 w-5 text-brand-cyan" />
              Fehler-Tracking
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              {/* Sammel-Abhaken: nur sichtbar, wenn offene Einträge existieren.
                  Öffnet einen Bestätigungs-Dialog vor dem Abhaken. */}
              {(errorsQuery.data?.errors ?? []).some((e) => !e.resolved) && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-2.5 text-xs"
                  onClick={() => setConfirmResolveAllOpen(true)}
                  data-testid="button-error-resolve-all"
                >
                  <CheckCheck className="mr-1 h-3.5 w-3.5" />
                  Alle abhaken
                </Button>
              )}
              {/* Filter: offene (Default) / alle — erledigte werden bei "alle"
                  ausgegraut angezeigt statt ausgeblendet. */}
              <div className="flex items-center gap-1 rounded-md border border-border/50 p-0.5">
                <Button
                  variant={errorFilter === "open" ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  onClick={() => setErrorFilter("open")}
                  data-testid="button-error-filter-open"
                >
                  Offene
                </Button>
                <Button
                  variant={errorFilter === "all" ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  onClick={() => setErrorFilter("all")}
                  data-testid="button-error-filter-all"
                >
                  Alle
                </Button>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {errorsQuery.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : errorsQuery.isError ? (
            <p className="text-sm text-destructive" data-testid="text-operator-errors-error">
              Fehlerliste konnte nicht geladen werden:{" "}
              {readableApiError(errorsQuery.error, "Unbekannter Fehler.")}
            </p>
          ) : (() => {
            const allErrors = errorsQuery.data?.errors ?? [];
            const visibleErrors =
              errorFilter === "open" ? allErrors.filter((e) => !e.resolved) : allErrors;
            // Dezenter Hinweis, wenn die Tabelle am Aufbewahrungslimit steht:
            // beim Beschneiden (prune nach jedem Insert) wurden dann mit an
            // Sicherheit grenzender Wahrscheinlichkeit bereits aelteste
            // Eintraege verworfen — die Liste ist NICHT vollstaendig.
            const retentionLimit = errorsQuery.data?.retentionLimit ?? 0;
            const retentionReached =
              retentionLimit > 0 && (errorsQuery.data?.totalStored ?? 0) >= retentionLimit;
            const retentionNotice = retentionReached ? (
              <p
                className="text-xs text-muted-foreground"
                data-testid="text-error-retention-notice"
              >
                Hinweis: Das Aufbewahrungslimit von {retentionLimit} Einträgen ist
                erreicht — älteste Einträge wurden bereits entfernt, die Liste ist
                nicht vollständig.
              </p>
            ) : null;
            if (visibleErrors.length === 0) {
              // Leerzustand greift auch, wenn alle Fehler erledigt sind
              // (Filter "Offene"). Bei "Alle" nur, wenn wirklich nichts da ist.
              return (
                <>
                  {retentionNotice}
                  <p className="text-sm text-muted-foreground" data-testid="text-operator-errors-empty">
                    {allErrors.length === 0
                      ? "Keine Fehler im Betrieb — alles läuft rund."
                      : "Keine offenen Fehler — alle Einträge sind erledigt."}
                  </p>
                </>
              );
            }
            const errorRows = visibleErrors.map((e) => {
              const detailsOpen = expandedErrorIds.has(e.id);
              return (
                <div
                  key={e.id}
                  className={`rounded-md border border-border/40 p-3 ${
                    e.resolved ? "opacity-50" : ""
                  }`}
                  data-testid={`row-operator-error-${e.id}`}
                >
                  <div className="flex items-start gap-3">
                    <Badge variant={e.level === "error" ? "destructive" : "outline"} className="mt-0.5 shrink-0">
                      {e.level === "error" ? "Fehler" : "Warnung"}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <p
                        className={`text-sm font-medium break-words ${
                          e.resolved ? "text-muted-foreground line-through" : "text-foreground"
                        }`}
                      >
                        {e.message}
                      </p>
                      {/* Wiederkehrende Fehler sind serverseitig gebuendelt:
                          Zaehler + Zeitpunkt des LETZTEN Auftretens. */}
                      <p className="text-xs text-muted-foreground">
                        <span className="font-mono">{e.context}</span>
                        {e.count > 1 ? (
                          <span
                            className="ml-2 inline-block rounded-full bg-muted px-1.5 py-0.5 font-medium text-foreground/80"
                            data-testid={`badge-error-count-${e.id}`}
                          >
                            {e.count}×
                          </span>
                        ) : null}{" "}
                        · {e.count > 1 ? "zuletzt " : ""}
                        {new Date(e.lastSeenAt).toLocaleString("de-DE", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}{" "}
                        Uhr
                        {e.resolved ? " · Erledigt" : ""}
                      </p>
                    </div>
                    {/* Detail-Ansicht (Stacktrace des letzten Auftretens) nur
                        anbieten, wenn Details vorhanden sind. */}
                    {e.lastStack ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 shrink-0 px-2 text-xs"
                        onClick={() => toggleErrorDetails(e.id)}
                        data-testid={`button-error-details-${e.id}`}
                        title={detailsOpen ? "Details ausblenden" : "Details anzeigen (Stacktrace)"}
                      >
                        {detailsOpen ? (
                          <>
                            <ChevronUp className="mr-1 h-3.5 w-3.5" />
                            <span className="hidden sm:inline">Details</span>
                          </>
                        ) : (
                          <>
                            <ChevronDown className="mr-1 h-3.5 w-3.5" />
                            <span className="hidden sm:inline">Details</span>
                          </>
                        )}
                      </Button>
                    ) : null}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 shrink-0 px-2 text-xs"
                      disabled={pendingErrorId === e.id}
                      onClick={() => handleToggleErrorResolved(e.id, !e.resolved)}
                      data-testid={`button-error-toggle-${e.id}`}
                      title={e.resolved ? "Wieder auf offen setzen" : "Als erledigt abhaken"}
                    >
                      {e.resolved ? (
                        <>
                          <Undo2 className="mr-1 h-3.5 w-3.5" />
                          <span className="hidden sm:inline">Wieder öffnen</span>
                        </>
                      ) : (
                        <>
                          <Check className="mr-1 h-3.5 w-3.5" />
                          <span className="hidden sm:inline">Erledigt</span>
                        </>
                      )}
                    </Button>
                  </div>
                  {/* Aufklappbare Details: Stacktrace/Detailtext des LETZTEN
                      Auftretens (serverseitig gekuerzt, nur superadmin). */}
                  {detailsOpen && e.lastStack ? (
                    <pre
                      className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-2 font-mono text-xs whitespace-pre-wrap break-words text-muted-foreground"
                      data-testid={`text-error-stack-${e.id}`}
                    >
                      {e.lastStack}
                    </pre>
                  ) : null}
                </div>
              );
            });
            return (
              <>
                {retentionNotice}
                {errorRows}
              </>
            );
          })()}
        </CardContent>
      </Card>

      {/* Bestätigungs-Dialog: Sammel-Abhaken aller offenen Fehler. */}
      <Dialog
        open={confirmResolveAllOpen}
        onOpenChange={(open) => {
          if (!resolveAllErrors.isPending) setConfirmResolveAllOpen(open);
        }}
      >
        <DialogContent data-testid="dialog-error-resolve-all">
          <DialogHeader>
            <DialogTitle>Alle offenen Fehler abhaken?</DialogTitle>
            <DialogDescription>
              Alle aktuell offenen Fehler-Einträge werden als erledigt markiert. Die Einträge
              bleiben erhalten und können einzeln wieder geöffnet werden.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmResolveAllOpen(false)}
              disabled={resolveAllErrors.isPending}
              data-testid="button-error-resolve-all-cancel"
            >
              Abbrechen
            </Button>
            <Button
              onClick={handleResolveAllErrors}
              disabled={resolveAllErrors.isPending}
              data-testid="button-error-resolve-all-confirm"
            >
              <CheckCheck className="mr-1 h-4 w-4" />
              {resolveAllErrors.isPending ? "Wird abgehakt…" : "Alle abhaken"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
