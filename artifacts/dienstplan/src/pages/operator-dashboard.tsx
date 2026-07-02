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
// Bereiche 2+3 bleiben Platzhalter mit API-Andockpunkten:
//   2. Lexware-Buchungs-Log (Rechnungsentwuerfe / Zahlungseingaenge)
//   3. Fehler-Tracking (Plattform-Health)
//
// Billing-Hintergrund: Abo-Buchungen erzeugen Rechnungsentwuerfe in Lexware.
// Die Premium-Freischaltung erfolgt MANUELL hier im Dashboard, sobald die
// Zahlung bestaetigt ist (kein Stripe / keine automatische Verlaengerung).
// ---------------------------------------------------------------------------

import { useState } from "react";
import {
  useListOperatorAccounts,
  useUpdateOperatorAccountPlan,
  getListOperatorAccountsQueryKey,
  type OperatorAccount,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Receipt, AlertTriangle, ShieldCheck } from "lucide-react";
import { readableApiError } from "@/lib/api-error";
import { useToast } from "@/hooks/use-toast";

// --- Platzhalter-Daten (nur Bereiche 2+3) ----------------------------------

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

type PlatformError = {
  id: string;
  level: "error" | "warning";
  message: string;
  context: string;
  timestamp: string;
};

const PLACEHOLDER_ERRORS: PlatformError[] = [
  { id: "e1", level: "error", message: "Lexware-API Timeout beim Erstellen eines Rechnungsentwurfs", context: "billing/createDraft", timestamp: "2026-06-29 14:22" },
  { id: "e2", level: "warning", message: "SSO-Token-Validierung verzoegert (> 2s)", context: "auth/sso", timestamp: "2026-06-29 09:10" },
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

  const accountsQuery = useListOperatorAccounts();
  const updatePlan = useUpdateOperatorAccountPlan();

  // Manuelle Premium-Freischaltung bzw. Rueckstufung. Serverseitig durch
  // requireSuperadmin geschuetzt; getUserPlan liest frisch → wirkt sofort.
  async function handleTogglePlan(account: OperatorAccount) {
    const nextPlan = account.plan === "premium" ? "free" : "premium";
    setPendingId(account.id);
    try {
      await updatePlan.mutateAsync({ id: account.id, data: { plan: nextPlan } });
      await queryClient.invalidateQueries({ queryKey: getListOperatorAccountsQueryKey() });
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
                          onClick={() => handleTogglePlan(acc)}
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
          </CardTitle>
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
      {/* Bereich 3: Fehler-Tracking                                         */}
      {/* ----------------------------------------------------------------- */}
      {/* API-ANDOCKPUNKT: Plattform-Fehler/Health aus zentralem Logging,    */}
      {/* z. B. GET /api/operator/errors (oder Anbindung an einen externen    */}
      {/* Error-Tracker). Dient der schnellen Reaktion auf Stoerungen.        */}
      <Card className="border-border/50 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <AlertTriangle className="h-5 w-5 text-brand-cyan" />
            Fehler-Tracking
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {PLACEHOLDER_ERRORS.map((e) => (
            <div
              key={e.id}
              className="flex items-start gap-3 rounded-md border border-border/40 p-3"
            >
              <Badge variant={e.level === "error" ? "destructive" : "outline"} className="mt-0.5 shrink-0">
                {e.level === "error" ? "Fehler" : "Warnung"}
              </Badge>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{e.message}</p>
                <p className="text-xs text-muted-foreground">
                  <span className="font-mono">{e.context}</span> · {e.timestamp}
                </p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
