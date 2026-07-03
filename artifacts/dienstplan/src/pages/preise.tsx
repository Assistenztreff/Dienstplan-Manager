// ---------------------------------------------------------------------------
// Preise & Premium — Vergleichs- und Upgrade-Seite (Route /preise)
// ---------------------------------------------------------------------------
// Ziel: Die Free-Limit-Hinweise in der App (Assistenten, Teams, Dienste,
// Vorausplanung) sollen keine Sackgasse sein, sondern hierher fuehren.
// Die Feature-/Limit-Tabelle wird DIREKT aus PLAN_CONFIG
// (@workspace/entitlements) abgeleitet — die Seite kann also nie von der
// tatsaechlich durchgesetzten Konfiguration abweichen.
//
// Upgrade-Weg (siehe Architektur-Notiz in lib/entitlements): Billing laeuft
// ueber die Lexware-API (Rechnungsentwurf), die Freischaltung auf Premium
// erfolgt MANUELL durch den Betreiber nach Zahlungseingang. Deshalb ist der
// Call-to-Action hier eine Upgrade-ANFRAGE per E-Mail (kein Self-Service-
// Checkout wie Stripe).
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/auth";
import {
  PLAN_CONFIG,
  isPremium,
  type Plan,
  type PlanFeature,
  type PlanLimit,
} from "@/lib/entitlements";
import { Check, Minus, Mail, Sparkles, BadgeCheck } from "lucide-react";

// Kontaktadresse fuer Upgrade-Anfragen (Betreiber). Bei Bedarf hier zentral
// anpassen — es gibt bewusst keinen Self-Service-Checkout (siehe oben).
const UPGRADE_CONTACT_EMAIL = "premium@assistenz-treff.de";

// Anzeige-Reihenfolge + deutsche Labels fuer die Limits aus PLAN_CONFIG.
const LIMIT_ROWS: { key: PlanLimit; label: string }[] = [
  { key: "maxAssistants", label: "Assistenten" },
  { key: "maxTeams", label: "Teams" },
  { key: "maxShiftModels", label: "Dienste (Schichtmodelle)" },
  { key: "historyMonths", label: "Planungshorizont" },
];

// Anzeige-Reihenfolge + deutsche Labels fuer die Features aus PLAN_CONFIG.
const FEATURE_ROWS: { key: PlanFeature; label: string }[] = [
  { key: "basicPersonnelFile", label: "Personalakte (Basisdaten & Kontakt)" },
  { key: "basicExport", label: "Einfacher Monats-Export als PDF (inkl. Urlaub/Krank)" },
  { key: "bulkEdit", label: "Massenbearbeitung im Dienstplan" },
  { key: "advancedPersonnelFile", label: "Erweiterte Personalakte (Lohn- & SV-Daten)" },
  { key: "payrollExport", label: "Lohn-Export als PDF" },
  { key: "advancedAnalytics", label: "Soll/Ist-Auswertungen & Stundenkonto" },
  { key: "strictTimeTracking", label: "Strikte Arbeitszeiterfassung" },
  { key: "calendarSync", label: "Export in die eigene Kalender-App" },
  { key: "caregiverLogin", label: "Zugang für Assistenzkräfte (Team-Ansicht)" },
  { key: "absenceTracking", label: "Urlaubs- & Krankheits-Tracking (Resturlaub-Konto)" },
];

/** Limit-Wert menschenlesbar formatieren (null = unbegrenzt). */
function formatLimit(plan: Plan, key: PlanLimit): string {
  const value = PLAN_CONFIG[plan].limits[key];
  if (key === "historyMonths") {
    // Semantik: Free plant nur aktuellen + naechsten Monat voraus.
    return value === null || value >= 12
      ? "12 Monate"
      : "Aktueller + nächster Monat";
  }
  return value === null ? "Unbegrenzt" : String(value);
}

function FeatureCell({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <Check className="h-4 w-4 text-primary mx-auto" aria-label="enthalten" />
  ) : (
    <Minus className="h-4 w-4 text-muted-foreground/50 mx-auto" aria-label="nicht enthalten" />
  );
}

export default function Preise() {
  const { currentUser } = useAuth();
  const alreadyPremium = isPremium(currentUser);

  const mailtoHref = `mailto:${UPGRADE_CONTACT_EMAIL}?subject=${encodeURIComponent(
    "Premium-Upgrade anfragen (Dienstplan-App)",
  )}&body=${encodeURIComponent(
    `Hallo,\n\nich möchte mein Konto auf Premium umstellen.\n\nKonto-E-Mail: ${currentUser?.email ?? ""}\nName: ${currentUser?.name ?? ""}\n\nBitte senden Sie mir die Rechnung zu.\n\nViele Grüße`,
  )}`;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl mx-auto">
      <div>
        <h2 className="text-2xl md:text-3xl font-serif font-bold text-foreground">
          Preise &amp; Premium
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Vergleich der Tarife Free und Premium
        </p>
      </div>

      {alreadyPremium && (
        <div
          className="rounded-md border border-brand-yellow/40 bg-brand-yellow/10 px-4 py-3 text-sm text-foreground flex items-center gap-2"
          data-testid="already-premium-banner"
        >
          <BadgeCheck className="h-4 w-4 shrink-0" />
          Ihr Konto nutzt bereits den Premium-Tarif — alle Funktionen sind freigeschaltet.
        </div>
      )}

      {/* Vergleichstabelle: Limits + Features direkt aus PLAN_CONFIG. */}
      <Card className="border-border/50 shadow-sm">
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm" data-testid="plan-comparison-table">
            <thead>
              <tr className="border-b border-border/60">
                <th className="text-left font-medium text-muted-foreground px-4 py-3 w-1/2">
                  Leistung
                </th>
                <th className="text-center font-semibold px-4 py-3">
                  <div className="flex flex-col items-center gap-1">
                    <Badge variant="outline">Free</Badge>
                    <span className="text-xs font-normal text-muted-foreground">kostenlos</span>
                  </div>
                </th>
                <th className="text-center font-semibold px-4 py-3">
                  <div className="flex flex-col items-center gap-1">
                    <Badge className="bg-brand-yellow text-brand-dark hover:bg-brand-yellow">
                      Premium
                    </Badge>
                    <span className="text-xs font-normal text-muted-foreground">auf Anfrage</span>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {LIMIT_ROWS.map(({ key, label }) => (
                <tr key={key} className="border-b border-border/40">
                  <td className="px-4 py-2.5 text-foreground">{label}</td>
                  <td className="px-4 py-2.5 text-center text-muted-foreground">
                    {formatLimit("free", key)}
                  </td>
                  <td className="px-4 py-2.5 text-center font-medium text-foreground">
                    {formatLimit("premium", key)}
                  </td>
                </tr>
              ))}
              {FEATURE_ROWS.map(({ key, label }) => (
                <tr key={key} className="border-b border-border/40 last:border-b-0">
                  <td className="px-4 py-2.5 text-foreground">{label}</td>
                  <td className="px-4 py-2.5 text-center">
                    <FeatureCell enabled={PLAN_CONFIG.free.features[key]} />
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <FeatureCell enabled={PLAN_CONFIG.premium.features[key]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Call-to-Action: Upgrade-Anfrage (manuelle Freischaltung, s. o.). */}
      {!alreadyPremium && (
        <Card className="border-brand-yellow/40 bg-brand-yellow/5 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              So werden Sie Premium
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-foreground">
            <ol className="list-decimal ml-5 space-y-1.5">
              <li>
                Senden Sie uns eine kurze Upgrade-Anfrage per E-Mail — Ihre Kontodaten werden
                automatisch vorausgefüllt.
              </li>
              <li>Sie erhalten von uns eine Rechnung für den Premium-Tarif.</li>
              <li>
                Nach Zahlungseingang schalten wir Ihr Konto frei — alle Premium-Funktionen sind
                dann sofort verfügbar, ganz ohne Neuinstallation.
              </li>
            </ol>
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <Button asChild className="gap-2 self-start" data-testid="request-upgrade-button">
                <a href={mailtoHref}>
                  <Mail className="h-4 w-4" />
                  Upgrade per E-Mail anfragen
                </a>
              </Button>
              <span className="text-muted-foreground">
                oder direkt an{" "}
                <a
                  href={`mailto:${UPGRADE_CONTACT_EMAIL}`}
                  className="underline underline-offset-4 hover:no-underline"
                >
                  {UPGRADE_CONTACT_EMAIL}
                </a>
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Hinweis: Ihre bestehenden Daten bleiben in jedem Tarif vollständig erhalten — die
              Free-Limits betreffen ausschließlich das Anlegen neuer Einträge.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
