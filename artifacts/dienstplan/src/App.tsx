import { Switch, Route, Redirect, Router as WouterRouter, useLocation } from "wouter";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "@workspace/api-client-react";
import { toast } from "sonner";
import { registerUserSwitchHandler, resyncAuthAfter401 } from "@/context/auth";
import { lazy, Suspense, useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import { OfflineBanner } from "@/components/offline-banner";
import { AuthProvider, useAuth, hasTeamAccessLevel } from "@/context/auth";
import { TeamProvider } from "@/context/team";
// Kleine öffentliche Seiten: bleiben im Haupt-Bundle (direkt nach dem Öffnen nötig)
import Login from "@/pages/login";
import Registrierung from "@/pages/registrierung";
import Einladung from "@/pages/einladung";
import PasswortVergessen from "@/pages/passwort-vergessen";
import PasswortZuruecksetzen from "@/pages/passwort-zuruecksetzen";
import EmailBestaetigen from "@/pages/email-bestaetigen";
import { Impressum, Datenschutz, Kontakt, Barrierefreiheit } from "@/pages/rechtliches";
import Startseite from "@/pages/startseite";
import NotFound from "@/pages/not-found";

// Schwere Seiten: lazy-loaded → Vite erzeugt separate JS-Chunks pro Seite.
// Der initiale Bundle schrumpft von ~1 MB auf ~150 KB; jede Seite wird erst
// beim ersten Besuch nachgeladen (danach Browser-gecacht).
const Dashboard = lazy(() => import("@/pages/dashboard"));
const Dienstplan = lazy(() => import("@/pages/dienstplan"));
const Zeiterfassung = lazy(() => import("@/pages/zeiterfassung"));
const Abwesenheiten = lazy(() => import("@/pages/abwesenheiten"));
const Auswertungen = lazy(() => import("@/pages/auswertungen"));
const Einstellungen = lazy(() => import("@/pages/einstellungen"));
const TeamVerwaltung = lazy(() => import("@/pages/team-verwaltung"));
const Preise = lazy(() => import("@/pages/preise"));
const OperatorDashboard = lazy(() => import("@/pages/operator-dashboard"));
// Handbuch-Seiten: alle aus derselben Datei → ein gemeinsamer Chunk
const HandbuchStart = lazy(() => import("@/pages/handbuch").then((m) => ({ default: m.HandbuchStart })));
const HandbuchDienstplan = lazy(() => import("@/pages/handbuch").then((m) => ({ default: m.HandbuchDienstplan })));
const HandbuchTeamVerwaltung = lazy(() => import("@/pages/handbuch").then((m) => ({ default: m.HandbuchTeamVerwaltung })));
const HandbuchRegistrierung = lazy(() => import("@/pages/handbuch").then((m) => ({ default: m.HandbuchRegistrierung })));
const HandbuchRollen = lazy(() => import("@/pages/handbuch").then((m) => ({ default: m.HandbuchRollen })));
const HandbuchDashboard = lazy(() => import("@/pages/handbuch").then((m) => ({ default: m.HandbuchDashboard })));
const HandbuchAssistenten = lazy(() => import("@/pages/handbuch").then((m) => ({ default: m.HandbuchAssistenten })));
const HandbuchZeiterfassung = lazy(() => import("@/pages/handbuch").then((m) => ({ default: m.HandbuchZeiterfassung })));
const HandbuchAbwesenheiten = lazy(() => import("@/pages/handbuch").then((m) => ({ default: m.HandbuchAbwesenheiten })));
const HandbuchAuswertungen = lazy(() => import("@/pages/handbuch").then((m) => ({ default: m.HandbuchAuswertungen })));
const HandbuchEinstellungen = lazy(() => import("@/pages/handbuch").then((m) => ({ default: m.HandbuchEinstellungen })));

import { isAdminRole } from "@/lib/roles";
import { Loader2 } from "lucide-react";

// Selbstheilung bei toter Session: Liefert eine Abfrage 401 (Session-Cookie
// zeigt z. B. nach einem Datenbank-Reset auf eine nicht mehr existierende
// Session), wird einmalig eine erneute Anmeldung angestoßen (me → Dev-Login)
// und bei Erfolg alle Abfragen neu geladen. Scheitert die Anmeldung, leert der
// Auth-Kontext den Zustand und die App wechselt zur Login-Seite — statt endlos
// leere Seiten mit 401-Fehlern zu zeigen.
// Cooldown gegen Endlosschleifen: Wenn die Neuanmeldung zwar gelingt, die
// Abfragen aber weiterhin 401 liefern (z. B. weil der Browser Cookies für die
// eingebettete Vorschau blockiert), darf sich resync → invalidate → 401 →
// resync nicht ewig drehen.
let lastResyncAt = 0;
const RESYNC_COOLDOWN_MS = 15_000;

// Kontowechsel-Verdacht bei 403: Wenn eine Abfrage/Aktion mit 403 scheitert,
// kann im selben Browser inzwischen ein anderes Konto angemeldet sein (z. B.
// weil der Inhaber einen Einladungslink selbst geöffnet hat). Dann prüfen wir
// die Session einmal frisch (gedrosselt) — bei geänderter Nutzer-ID greift der
// unten registrierte Kontowechsel-Handler. Ein legitimes 403 desselben
// Nutzers bleibt folgenlos.
let lastSessionCheckAt = 0;
const SESSION_CHECK_COOLDOWN_MS = 10_000;

function maybeRecheckSessionAfter403(error: unknown): void {
  if (!(error instanceof ApiError) || error.status !== 403) return;
  const now = Date.now();
  if (now - lastSessionCheckAt < SESSION_CHECK_COOLDOWN_MS) return;
  lastSessionCheckAt = now;
  // bootstrap() holt /auth/me frisch; applyUser meldet eine geänderte
  // Nutzer-ID an den Kontowechsel-Handler.
  void resyncAuthAfter401();
}

// Netzwerkfehler (fetch TypeError) von echten API-Fehlern unterscheiden.
function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError;
}

// Deduplizierungs-Schlüssel, damit offline-Toasts nicht für jede Abfrage
// einzeln erscheinen (nur eine Meldung alle 10 Sekunden).
let lastOfflineToastAt = 0;
const OFFLINE_TOAST_COOLDOWN_MS = 10_000;

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) {
        const now = Date.now();
        if (now - lastResyncAt < RESYNC_COOLDOWN_MS) return;
        const resync = resyncAuthAfter401();
        if (!resync) return; // Auth-Kontext gerade nicht montiert — kein Cooldown starten
        lastResyncAt = now;
        void resync.then((ok) => {
          if (ok) void queryClient.invalidateQueries();
        });
        return;
      }
      maybeRecheckSessionAfter403(error);
      // Netzwerkfehler: nur anzeigen, wenn das Banner noch nicht sichtbar ist
      // (navigator.onLine true, aber API nicht erreichbar).
      if (isNetworkError(error) && navigator.onLine) {
        const now = Date.now();
        if (now - lastOfflineToastAt < OFFLINE_TOAST_COOLDOWN_MS) return;
        lastOfflineToastAt = now;
        toast.info("Verbindung zum Server unterbrochen", {
          description: "Bitte prüfen Sie Ihre Internetverbindung.",
        });
      }
    },
  }),
  mutationCache: new MutationCache({
    onError: (error) => {
      maybeRecheckSessionAfter403(error);
      // Netzwerkfehler bei Mutations: Das Offline-Banner zeigt bereits einen
      // Hinweis wenn navigator.onLine===false. Kein zusätzlicher Toast nötig.
      if (isNetworkError(error) && !navigator.onLine) return;
      // Netzwerkfehler bei online (API nicht erreichbar): zentrale Meldung.
      if (isNetworkError(error) && navigator.onLine) {
        const now = Date.now();
        if (now - lastOfflineToastAt < OFFLINE_TOAST_COOLDOWN_MS) return;
        lastOfflineToastAt = now;
        toast.info("Verbindung zum Server unterbrochen", {
          description: "Bitte prüfen Sie Ihre Internetverbindung.",
        });
      }
    },
  }),
  defaultOptions: {
    queries: {
      // 5 Minuten Cache: Navigation zwischen Seiten (Dashboard → Dienstplan →
      // Auswertungen) löst keinen erneuten API-Aufruf aus, solange die Daten
      // nicht älter als 5 Minuten sind. Mutations rufen invalidateQueries auf
      // und erzwingen so sofortige Aktualisierungen nach Schreiboperationen.
      staleTime: 5 * 60 * 1000,
      retry: false,
      refetchOnWindowFocus: false,
    },
    mutations: {
      // Mutations, die gestartet werden während das Gerät offline ist, werden
      // pausiert statt sofort zu scheitern. Das OfflineBanner ruft
      // resumePausedMutations() auf, sobald die Verbindung wiederhergestellt
      // ist, und überträgt die ausstehenden Änderungen automatisch.
      networkMode: "offlineFirst",
    },
  },
});

// Kontowechsel-Handler: Meldet /auth/me eine andere Nutzer-ID als zuvor
// (Einladungslink im selben Browser geöffnet, Dev-Nutzerwechsel, …), gehören
// alle zwischengespeicherten Daten dem vorherigen Konto — vollständig
// verwerfen (inkl. pausierter Offline-Mutationen) und kurz erklären, warum
// sich die Ansicht gerade ändert.
registerUserSwitchHandler((next) => {
  // Task #744: Alle laufenden Abfragen vor dem Leeren abbrechen, damit
  // verspätete Antworten der alten Session nicht in den Cache des neuen Kontos
  // schreiben. cancelQueries() sendet Abort-Signale an fetch()-Aufrufe, die
  // signal propagieren — übrige Request liefern zwar noch ab, aber da der
  // Cache-Eintrag durch clear() entfernt wurde, wird das Ergebnis verworfen.
  void queryClient.cancelQueries();
  queryClient.clear();
  toast.info("Anmeldung gewechselt", {
    description: `Du bist jetzt als ${next.name} angemeldet. Die Ansicht wurde entsprechend aktualisiert.`,
  });
});

const PUBLIC_PATHS = [
  "/login",
  "/registrierung",
  "/einladung",
  "/passwort-vergessen",
  "/passwort-zuruecksetzen",
  "/email-bestaetigen",
  "/impressum",
  "/datenschutz",
  "/kontakt",
  "/barrierefreiheit",
  "/handbuch",
];

/** Wird angezeigt, während ein lazy-geladener Seiten-Chunk heruntergeladen wird. */
function PageLoader() {
  return (
    <div className="flex h-full items-center justify-center py-24">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function Router() {
  const { currentUser, isLoading } = useAuth();
  const [location, navigate] = useLocation();

  useEffect(() => {
    if (isLoading) return;
    // "/" ist ausgeloggt die oeffentliche Startseite (Landingpage).
    const isPublic =
      location === "/" || PUBLIC_PATHS.some((p) => location.startsWith(p));
    if (!currentUser && !isPublic) {
      navigate("/login");
    } else if (currentUser && location === "/login") {
      navigate("/");
    }
  }, [isLoading, currentUser, location]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!currentUser) {
    return (
      <Suspense fallback={<PageLoader />}>
        <Switch>
          <Route path="/" component={Startseite} />
        <Route path="/login" component={Login} />
        <Route path="/registrierung" component={Registrierung} />
        <Route path="/einladung" component={Einladung} />
        <Route path="/passwort-vergessen" component={PasswortVergessen} />
        <Route path="/passwort-zuruecksetzen" component={PasswortZuruecksetzen} />
        <Route path="/email-bestaetigen" component={EmailBestaetigen} />
        <Route path="/impressum" component={Impressum} />
        <Route path="/datenschutz" component={Datenschutz} />
        <Route path="/kontakt" component={Kontakt} />
        <Route path="/barrierefreiheit" component={Barrierefreiheit} />
        <Route path="/handbuch" component={HandbuchStart} />
        <Route path="/handbuch/dienstplan" component={HandbuchDienstplan} />
        <Route path="/handbuch/team-verwaltung" component={HandbuchTeamVerwaltung} />
        <Route path="/handbuch/registrierung" component={HandbuchRegistrierung} />
        <Route path="/handbuch/rollen" component={HandbuchRollen} />
        <Route path="/handbuch/dashboard" component={HandbuchDashboard} />
        <Route path="/handbuch/assistenten" component={HandbuchAssistenten} />
        <Route path="/handbuch/zeiterfassung" component={HandbuchZeiterfassung} />
        <Route path="/handbuch/abwesenheiten" component={HandbuchAbwesenheiten} />
        <Route path="/handbuch/auswertungen" component={HandbuchAuswertungen} />
        <Route path="/handbuch/einstellungen" component={HandbuchEinstellungen} />
        <Route>{() => null}</Route>
        </Switch>
      </Suspense>
    );
  }

  return (
    <Layout>
      <Suspense fallback={<PageLoader />}>
        <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/dienstplan" component={Dienstplan} />
        <Route path="/zeiterfassung" component={Zeiterfassung} />
        {/* Abwesenheiten für alle Rollen: Assistenzkräfte sehen und verwalten
            dort nur die EIGENEN Einträge (Scoping in der Seite + Server). */}
        <Route path="/abwesenheiten" component={Abwesenheiten} />
        {/* Alte Assistenzkraft-Route: Die Seite ist in der Team-Verwaltung
            aufgegangen. Bestehende Links und Lesezeichen landen dort statt
            auf einer 404-Seite; der ?highlight-Parameter bleibt erhalten. */}
        <Route path="/assistenten">
          {() => <Redirect to={`/team-verwaltung${window.location.search}`} replace />}
        </Route>
        {(isAdminRole(currentUser.role) || currentUser.isTeamleiter) && (
          <Route path="/auswertungen" component={Auswertungen} />
        )}
        {/* Einstellungen auch fuer Assistenten: die Seite zeigt ihnen nur die
            fuer sie relevanten Bereiche (Profil + Kalender-Abo-Karte). Admin-
            Bereiche (Schichtmodelle, Zuschlaege, Logo) sind in der Seite selbst
            per isAdminRole gegatet. */}
        <Route path="/einstellungen" component={Einstellungen} />
        <Route path="/impressum" component={Impressum} />
        <Route path="/datenschutz" component={Datenschutz} />
        <Route path="/kontakt" component={Kontakt} />
        <Route path="/barrierefreiheit" component={Barrierefreiheit} />
        <Route path="/handbuch" component={HandbuchStart} />
        <Route path="/handbuch/dienstplan" component={HandbuchDienstplan} />
        <Route path="/handbuch/team-verwaltung" component={HandbuchTeamVerwaltung} />
        <Route path="/handbuch/registrierung" component={HandbuchRegistrierung} />
        <Route path="/handbuch/rollen" component={HandbuchRollen} />
        <Route path="/handbuch/dashboard" component={HandbuchDashboard} />
        <Route path="/handbuch/assistenten" component={HandbuchAssistenten} />
        <Route path="/handbuch/zeiterfassung" component={HandbuchZeiterfassung} />
        <Route path="/handbuch/abwesenheiten" component={HandbuchAbwesenheiten} />
        <Route path="/handbuch/auswertungen" component={HandbuchAuswertungen} />
        <Route path="/handbuch/einstellungen" component={HandbuchEinstellungen} />
        {/* Preise & Premium: Ziel der Free-Limit-Hinweise (Upgrade-Anfrage). */}
        {isAdminRole(currentUser.role) && <Route path="/preise" component={Preise} />}
        {/* Team-Verwaltung: Admin ODER Teamleiter, bewusst UNABHÄNGIG vom
            accountType (Teamleiter sind Assistenzkräfte in Dienstleister-
            Teams; der Nav-Punkt war nie auf Dienstleister beschränkt). */}
        {/* Ab Stufe 1, weil dort die Assistenzkraft-Pflege liegt. Team-Struktur
            (anlegen/bearbeiten/löschen, Zugriffsrechte) bleibt in der Seite
            selbst den Konto-Admins vorbehalten. */}
        {(isAdminRole(currentUser.role) ||
          currentUser.isTeamleiter ||
          hasTeamAccessLevel(currentUser, "stufe1")) && (
          <Route path="/team-verwaltung" component={TeamVerwaltung} />
        )}
        {/* Operator-Dashboard ausschliesslich fuer Superadmins (Betreiber). */}
        {currentUser.role === "superadmin" && (
          <Route path="/operator-dashboard" component={OperatorDashboard} />
        )}
        <Route component={NotFound} />
        </Switch>
      </Suspense>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        {/* Offline-Hinweis global über allen Seiten (auch Login/Startseite). */}
        <OfflineBanner />
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <TeamProvider>
              <Router />
            </TeamProvider>
          </AuthProvider>
        </WouterRouter>
        <Toaster />
        {/* Sonner-Toaster: mehrere Seiten (Dienstplan, Assistenten, Auswertungen)
            nutzen `toast` aus "sonner" — ohne gemountete <SonnerToaster/> würden
            diese Hinweise (z.B. Free-Limit beim Vorausplanen) still verschluckt. */}
        <SonnerToaster position="top-center" />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
