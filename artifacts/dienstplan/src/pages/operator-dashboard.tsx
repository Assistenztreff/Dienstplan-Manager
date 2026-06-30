// ---------------------------------------------------------------------------
// Operator-Dashboard (nur fuer Rolle "superadmin")
// ---------------------------------------------------------------------------
// Interne Betreiber-Konsole zur Verwaltung der SaaS-Plattform. NICHT fuer
// Endkunden (Assistenznehmer/Dienstleister) gedacht — der Zugang ist auf die
// Rolle "superadmin" beschraenkt (Routing-Guard in App.tsx, versteckter Link
// im Footer nur fuer superadmin).
//
// Dieses Dashboard ist bewusst als PLATZHALTER mit klaren API-Andockpunkten
// angelegt. Die drei Kernbereiche:
//   1. Nutzer- & Team-Monitoring inkl. manueller Premium-Freischaltung
//   2. Lexware-Buchungs-Log (Rechnungsentwuerfe / Zahlungseingaenge)
//   3. Fehler-Tracking (Plattform-Health)
//
// Billing-Hintergrund: Abo-Buchungen erzeugen Rechnungsentwuerfe in Lexware.
// Die Premium-Freischaltung erfolgt MANUELL hier im Dashboard, sobald die
// Zahlung bestaetigt ist (kein Stripe / keine automatische Verlaengerung).
// ---------------------------------------------------------------------------

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Users, Receipt, AlertTriangle, ShieldCheck } from "lucide-react";

// --- Platzhalter-Daten -----------------------------------------------------
// Diese Demo-Datensaetze ersetzen spaeter echte API-Aufrufe (siehe
// Andock-Hinweise pro Bereich). Sie zeigen Struktur & Layout, ohne reale
// Daten zu kontaktieren.

type OperatorAccount = {
  id: number;
  name: string;
  email: string;
  accountType: "privat" | "dienstleister";
  plan: "free" | "premium";
  teams: number;
  assistants: number;
};

const PLACEHOLDER_ACCOUNTS: OperatorAccount[] = [
  { id: 1, name: "Maria Beispiel", email: "maria@example.com", accountType: "privat", plan: "free", teams: 1, assistants: 4 },
  { id: 2, name: "Pflegedienst Nord GmbH", email: "kontakt@nord.example", accountType: "dienstleister", plan: "premium", teams: 6, assistants: 38 },
  { id: 3, name: "Thomas Muster", email: "thomas@example.com", accountType: "privat", plan: "free", teams: 1, assistants: 6 },
];

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
  // ---- API-ANDOCKPUNKT (Premium-Freischaltung) --------------------------
  // Spaeter: Mutation gegen einen geschuetzten superadmin-Endpunkt, z. B.
  //   PATCH /api/operator/accounts/:id/plan { plan: "premium" | "free" }
  // der serverseitig requireSuperadmin erzwingt und users.plan setzt.
  // Aktuell nur Platzhalter (kein Netzwerkaufruf).
  function handleTogglePremium(account: OperatorAccount) {
    // eslint-disable-next-line no-console
    console.log(
      `[Operator] Premium-Umschaltung fuer Konto #${account.id} (${account.email}) — API noch nicht angebunden.`,
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-brand-dark p-2 text-brand-white">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <div>
          <h2 className="text-2xl md:text-3xl font-serif font-bold text-foreground">Operator-Dashboard</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Interne Betreiber-Konsole — nur für Superadmins. Platzhalter mit Andockpunkten.
          </p>
        </div>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Bereich 1: Nutzer- & Team-Monitoring + manuelle Premium-Schaltung */}
      {/* ----------------------------------------------------------------- */}
      {/* API-ANDOCKPUNKT: Liste aller Konten plattformweit (NICHT team-      */}
      {/* gescoped) ueber einen superadmin-Endpunkt, z. B.                   */}
      {/*   GET /api/operator/accounts                                       */}
      {/* mit Aggregaten (Team-/Assistenten-Anzahl, Plan).                   */}
      <Card className="border-border/50 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Users className="h-5 w-5 text-brand-cyan" />
            Nutzer- &amp; Team-Monitoring
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
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
                {PLACEHOLDER_ACCOUNTS.map((acc) => (
                  <tr key={acc.id} className="border-b border-border/30 last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{acc.name}</div>
                      <div className="text-xs text-muted-foreground">{acc.email}</div>
                    </td>
                    <td className="px-4 py-3 capitalize text-muted-foreground">{acc.accountType}</td>
                    <td className="px-4 py-3 text-muted-foreground">{acc.teams}</td>
                    <td className="px-4 py-3 text-muted-foreground">{acc.assistants}</td>
                    <td className="px-4 py-3">{planBadge(acc.plan)}</td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        size="sm"
                        variant={acc.plan === "premium" ? "outline" : "default"}
                        onClick={() => handleTogglePremium(acc)}
                      >
                        {acc.plan === "premium" ? "Auf Free zurücksetzen" : "Premium aktivieren"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
