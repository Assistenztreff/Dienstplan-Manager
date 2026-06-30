// ---------------------------------------------------------------------------
// Zentrale Entitlement-Schicht (SaaS: Free vs. Premium)
// ---------------------------------------------------------------------------
// Single Source of Truth fuer alle Rechte (Features) und Limits der Abo-Plaene.
// KEINE UI- und KEINE API-Logik hier — nur die reine Plan-Definition plus die
// Lese-Helfer hasAccess() / getLimit() / isWithinLimit(). So bleibt die
// Geschaeftslogik an genau einer Stelle und wird nicht ueber die App verstreut.
//
// WICHTIG (Durchsetzung): Diese Datei liefert die Konfiguration fuer die
// FRONTEND-Sicht (UX: Buttons sperren, Hinweise zeigen). Die autoritative
// Durchsetzung der Limits muss zusaetzlich serverseitig erfolgen — dem Client
// darf nie vertraut werden. Beim Andocken der API-Enforcement dieselbe
// Konfiguration spiegeln (bzw. spaeter in ein gemeinsames lib/-Paket ziehen).
//
// ---------------------------------------------------------------------------
// VERBINDLICHE REGEL: BESTANDSSCHUTZ
// ---------------------------------------------------------------------------
// Free-Limits beschraenken AUSSCHLIESSLICH das Anlegen von NEUEM (bzw. das
// Ausloesen neuer Aktionen). Bereits vorhandene Daten — Teams, Lohndaten,
// bereits geplante/vergangene Monate, vorhandene Schichtmodelle — duerfen
// NIEMALS ausgeblendet, gesperrt oder geloescht werden, nur weil ein Konto auf
// dem Free-Plan ist.
//
// Beim Implementieren eines neuen Gates IMMER so vorgehen:
//  - maxShiftModels: vorhandene Modelle bleiben editierbar/umbenennbar/
//    loeschbar; nur das Anlegen eines WEITEREN Modells ueber dem Limit sperren.
//  - maxAssistants / maxTeams: nur das Anlegen ueber dem Limit blockieren,
//    vorhandene Assistenten/Teams nie verbergen.
//  - historyMonths: nur die NEUE Planung/Vorwaerts-Navigation begrenzen;
//    bereits erfasste Monate bleiben vollstaendig sichtbar.
//  - advancedPersonnelFile / payrollExport: bereits erfasste Lohndaten bleiben
//    sichtbar; gegated wird hoechstens das Bearbeiten/Exportieren neuer Daten.
// `isWithinLimit(user, limit, currentCount)` ist genau dafuer da: es prueft, ob
// ein WEITERER Eintrag erlaubt ist — es ist KEIN Filter fuer die Anzeige.
//
// ---------------------------------------------------------------------------
// ARCHITEKTUR-NOTIZ: Authentifizierung (hybrid)
// ---------------------------------------------------------------------------
// Die App authentifiziert hybrid:
//  1. Plattform-Nutzer kommen ueber die AssistenzTreff-Plattform via
//     SSO-Token (signiertes JWT). Der Token wird serverseitig validiert und in
//     eine lokale Session uebersetzt (Just-in-Time-Provisioning des Nutzers).
//  2. Lokale Assistenzkraefte (Standalone) melden sich klassisch per
//     E-Mail/Passwort oder ueber einen Einladungslink an.
// Beide Wege muenden in denselben lokalen Nutzer-/Session-Zustand; der
// `plan` (free|premium) haengt am Konto und steuert die Entitlements.
//
// ---------------------------------------------------------------------------
// ARCHITEKTUR-NOTIZ: Rechnungsstellung / Abo-Verwaltung (Billing)
// ---------------------------------------------------------------------------
// Billing laeuft vorerst NICHT ueber externe Anbieter wie Stripe, sondern ueber
// die Lexware API: Bei einer Abo-Buchung wird ein Rechnungs-ENTWURF in Lexware
// erstellt. Die tatsaechliche Freischaltung auf `premium` erfolgt anschliessend
// MANUELL ueber das Operator-Dashboard, sobald die Zahlung eingegangen ist.
// ---------------------------------------------------------------------------

export type Plan = "free" | "premium";

/** Boolesche Rechte (Feature an/aus pro Plan). */
export type PlanFeature =
  | "basicPersonnelFile" // Personalakte (nur Vorname, Nachname, E-Mail, Adresse)
  | "basicExport" // Einfacher Stunden-Export als PDF
  | "bulkEdit" // Mehrfachauswahl/Massenbearbeitung im Kalender
  | "advancedPersonnelFile" // Personalakte inkl. Stundenlohn (Lohnabrechnung)
  | "payrollExport" // PDF Lohn-Export
  | "advancedAnalytics" // Soll/Ist-Berechnung, Abwesenheits-Management
  | "strictTimeTracking" // Strikte Arbeitszeiterfassung
  | "calendarSync" // Export in eigene Kalender-App
  | "caregiverLogin"; // Assistenzkraefte erhalten Zugang zur Team-Ansicht

/** Numerische Limits pro Plan (`null` = unbegrenzt). */
export type PlanLimit =
  | "maxAssistants"
  | "maxTeams"
  | "maxShiftModels"
  | "historyMonths";

type PlanConfig = {
  features: Record<PlanFeature, boolean>;
  limits: Record<PlanLimit, number | null>;
};

export const PLAN_CONFIG: Record<Plan, PlanConfig> = {
  free: {
    features: {
      basicPersonnelFile: true,
      basicExport: true,
      bulkEdit: false,
      advancedPersonnelFile: false,
      payrollExport: false,
      advancedAnalytics: false,
      strictTimeTracking: false,
      calendarSync: false,
      caregiverLogin: false,
    },
    limits: {
      maxAssistants: 6,
      maxTeams: 1,
      maxShiftModels: 3,
      historyMonths: 1, // nur aktueller und naechster Monat sichtbar
    },
  },
  premium: {
    features: {
      basicPersonnelFile: true,
      basicExport: true,
      bulkEdit: true,
      advancedPersonnelFile: true,
      payrollExport: true,
      advancedAnalytics: true,
      strictTimeTracking: true,
      calendarSync: true,
      caregiverLogin: true,
    },
    limits: {
      maxAssistants: null, // unbegrenzt
      maxTeams: null, // unbegrenzt (Dienstleister-Verwaltung)
      maxShiftModels: null, // unbegrenzt
      historyMonths: 12, // Rueckblick der letzten 12 Monate
    },
  },
};

/** Minimaler Nutzer-Shape, den die Entitlement-Helfer benoetigen. */
type EntitledUser = { plan?: Plan | null } | null | undefined;

/** Ermittelt den effektiven Plan eines Nutzers; Default ist sicher "free". */
export function resolvePlan(user: EntitledUser): Plan {
  return user?.plan === "premium" ? "premium" : "free";
}

/** Prueft, ob der Plan des Nutzers ein boolesches Feature freischaltet. */
export function hasAccess(user: EntitledUser, feature: PlanFeature): boolean {
  return PLAN_CONFIG[resolvePlan(user)].features[feature];
}

/** Liefert den Limit-Wert (`number`) oder `null` (= unbegrenzt) fuer den Plan. */
export function getLimit(user: EntitledUser, limit: PlanLimit): number | null {
  return PLAN_CONFIG[resolvePlan(user)].limits[limit];
}

/**
 * Prueft, ob bei aktueller Anzahl `currentCount` noch ein weiterer Eintrag
 * unter dem Limit erlaubt ist. `null` (unbegrenzt) ist immer erlaubt.
 */
export function isWithinLimit(
  user: EntitledUser,
  limit: PlanLimit,
  currentCount: number,
): boolean {
  const max = getLimit(user, limit);
  if (max === null) return true;
  return currentCount < max;
}

/** Ist der Nutzer auf dem unbegrenzten Premium-Plan? */
export function isPremium(user: EntitledUser): boolean {
  return resolvePlan(user) === "premium";
}
