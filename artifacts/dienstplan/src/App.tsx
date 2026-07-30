import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "@workspace/api-client-react";
import { toast } from "sonner";
import { resyncAuthAfter401 } from "@/context/auth";
import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import { OfflineBanner } from "@/components/offline-banner";
import { AuthProvider, useAuth } from "@/context/auth";
import { TeamProvider } from "@/context/team";
import Dashboard from "@/pages/dashboard";
import Dienstplan from "@/pages/dienstplan";
import Assistenten from "@/pages/assistenten";
import Zeiterfassung from "@/pages/zeiterfassung";
import Abwesenheiten from "@/pages/abwesenheiten";
import Auswertungen from "@/pages/auswertungen";
import Einstellungen from "@/pages/einstellungen";
import TeamVerwaltung from "@/pages/team-verwaltung";
import Preise from "@/pages/preise";
import OperatorDashboard from "@/pages/operator-dashboard";
import Login from "@/pages/login";
import Registrierung from "@/pages/registrierung";
import Einladung from "@/pages/einladung";
import PasswortVergessen from "@/pages/passwort-vergessen";
import { Impressum, Datenschutz, Kontakt, Barrierefreiheit } from "@/pages/rechtliches";
import {
  HandbuchStart,
  HandbuchDienstplan,
  HandbuchTeamVerwaltung,
  HandbuchRegistrierung,
  HandbuchRollen,
  HandbuchDashboard,
  HandbuchAssistenten,
  HandbuchZeiterfassung,
  HandbuchAbwesenheiten,
  HandbuchAuswertungen,
  HandbuchEinstellungen,
} from "@/pages/handbuch";
import Startseite from "@/pages/startseite";
import NotFound from "@/pages/not-found";
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

const PUBLIC_PATHS = [
  "/login",
  "/registrierung",
  "/einladung",
  "/passwort-vergessen",
  "/impressum",
  "/datenschutz",
  "/kontakt",
  "/barrierefreiheit",
  "/handbuch",
];

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
      <Switch>
        <Route path="/" component={Startseite} />
        <Route path="/login" component={Login} />
        <Route path="/registrierung" component={Registrierung} />
        <Route path="/einladung" component={Einladung} />
        <Route path="/passwort-vergessen" component={PasswortVergessen} />
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
    );
  }

  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/dienstplan" component={Dienstplan} />
        <Route path="/zeiterfassung" component={Zeiterfassung} />
        {isAdminRole(currentUser.role) && (
          <Route path="/abwesenheiten" component={Abwesenheiten} />
        )}
        {isAdminRole(currentUser.role) && (
          <Route path="/assistenten" component={Assistenten} />
        )}
        {isAdminRole(currentUser.role) && (
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
        {isAdminRole(currentUser.role) && currentUser.accountType === "dienstleister" && (
          <Route path="/team-verwaltung" component={TeamVerwaltung} />
        )}
        {/* Operator-Dashboard ausschliesslich fuer Superadmins (Betreiber). */}
        {currentUser.role === "superadmin" && (
          <Route path="/operator-dashboard" component={OperatorDashboard} />
        )}
        <Route component={NotFound} />
      </Switch>
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
