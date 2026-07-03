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
// Bereich 2 (Lexware-Buchungs-Log) bleibt Platzhalter mit DEMO-DATEN
// (deutlich gekennzeichnet), bis die echte Lexware-Anbindung kommt.
//
// Billing-Hintergrund: Abo-Buchungen erzeugen Rechnungsentwuerfe in Lexware.
// Die Premium-Freischaltung erfolgt MANUELL hier im Dashboard, sobald die
// Zahlung bestaetigt ist (kein Stripe / keine automatische Verlaengerung).
// ---------------------------------------------------------------------------

import { useState } from "react";
import {
  useListOperatorAccounts,
  useUpdateOperatorAccountPlan,
  useListOperatorPlanChanges,
  useListOperatorErrors,
  useUpdateOperatorError,
  useResolveAllOperatorErrors,
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
import { Users, Receipt, AlertTriangle, ShieldCheck, History, Check, CheckCheck, Undo2 } from "lucide-react";
import { readableApiError } from "@/lib/api-error";
import { useToast } from "@/hooks/use-toast";

// --- Platzhalter-Daten (nur Bereich 2: Lexware, als Demo gekennzeichnet) ---

type LexwareBooking = {
  id: string;
  accountName: string;
  type: "Rechnungsentwurf" | "Zahlungseingang";
  amount: string;
  date: string;
  status: "offen" | "bezahlt" | "storniert";
};

const PLACEHOLDER_BOOKINGS: LexwareBooking[] = [
  { id: "LX-2026-0042", accountName: "Pflegedienst Nord GmbH", type: "Zahlungseingang", amount: "49,00 €", date: "2026-06-28", status: "bezahlt" },
  { id: "LX-2026-0041", accountName: "Maria Beispiel", type: "Rechnungsentwurf", amount: "19,00 €", date: "2026-06-27", status: "offen" },
];

function planBadge(plan: "free" | "premium") {
  return plan === "premium" ? (
    <Badge className="bg-brand-yellow text-brand-dark hover:bg-brand-yellow">Premium</Badge>
  ) : (
    <Badge variant="outline">Free</Badge>
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

  const accountsQuery = useListOperatorAccounts();
  const planChangesQuery = useListOperatorPlanChanges();
  const errorsQuery = useListOperatorErrors();
  const updatePlan = useUpdateOperatorAccountPlan();
  const updateError = useUpdateOperatorError();
  const resolveAllErrors = useResolveAllOperatorErrors();
  // Filter der Fehlerliste: "open" (Default) blendet erledigte aus, "all"
  // zeigt alles (erledigte ausgegraut).
  const [errorFilter, setErrorFilter] = useState<"open" | "all">("open");
  const [pendingErrorId, setPendingErrorId] = useState<number | null>(null);
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
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <History className="h-5 w-5 text-brand-cyan" />
            Plan-Änderungsprotokoll
          </CardTitle>
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
              Noch keine Plan-Änderungen protokolliert.
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
      {/* Bereich 2: Lexware-Buchungs-Log                                    */}
      {/* ----------------------------------------------------------------- */}
      {/* API-ANDOCKPUNKT: Rechnungsentwuerfe & Zahlungseingaenge aus Lexware */}
      {/* spiegeln, z. B. GET /api/operator/lexware/bookings (serverseitig   */}
      {/* gegen die Lexware-API). Premium-Freischaltung erfolgt manuell in    */}
      {/* Bereich 1, sobald hier ein Zahlungseingang bestaetigt ist.          */}
      <Card className="border-border/50 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Receipt className="h-5 w-5 text-brand-cyan" />
            Lexware-Buchungs-Log
            <Badge variant="outline" className="ml-1 border-amber-400 bg-amber-50 text-amber-700" data-testid="badge-lexware-demo">
              Demo-Daten
            </Badge>
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Beispieldaten zur Veranschaulichung — die echte Lexware-Anbindung
            folgt. Diese Einträge sind KEINE realen Buchungen.
          </p>
        </CardHeader>
        <CardContent className="p-0">
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
                {PLACEHOLDER_BOOKINGS.map((b) => (
                  <tr key={b.id} className="border-b border-border/30 last:border-0">
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{b.id}</td>
                    <td className="px-4 py-3 text-foreground">{b.accountName}</td>
                    <td className="px-4 py-3 text-muted-foreground">{b.type}</td>
                    <td className="px-4 py-3 text-foreground">{b.amount}</td>
                    <td className="px-4 py-3 text-muted-foreground">{b.date}</td>
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
              {(errorsQuery.data ?? []).some((e) => !e.resolved) && (
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
            const allErrors = errorsQuery.data ?? [];
            const visibleErrors =
              errorFilter === "open" ? allErrors.filter((e) => !e.resolved) : allErrors;
            if (visibleErrors.length === 0) {
              // Leerzustand greift auch, wenn alle Fehler erledigt sind
              // (Filter "Offene"). Bei "Alle" nur, wenn wirklich nichts da ist.
              return (
                <p className="text-sm text-muted-foreground" data-testid="text-operator-errors-empty">
                  {allErrors.length === 0
                    ? "Keine Fehler im Betrieb — alles läuft rund."
                    : "Keine offenen Fehler — alle Einträge sind erledigt."}
                </p>
              );
            }
            return visibleErrors.map((e) => (
              <div
                key={e.id}
                className={`flex items-start gap-3 rounded-md border border-border/40 p-3 ${
                  e.resolved ? "opacity-50" : ""
                }`}
                data-testid={`row-operator-error-${e.id}`}
              >
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
            ));
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
