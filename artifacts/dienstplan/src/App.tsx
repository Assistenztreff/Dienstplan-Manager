import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
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
import NotFound from "@/pages/not-found";
import { isAdminRole } from "@/lib/roles";
import { Loader2 } from "lucide-react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

const PUBLIC_PATHS = ["/login", "/registrierung", "/einladung", "/passwort-vergessen"];

function Router() {
  const { currentUser, isLoading } = useAuth();
  const [location, navigate] = useLocation();

  useEffect(() => {
    if (isLoading) return;
    const isPublic = PUBLIC_PATHS.some((p) => location.startsWith(p));
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
        <Route path="/login" component={Login} />
        <Route path="/registrierung" component={Registrierung} />
        <Route path="/einladung" component={Einladung} />
        <Route path="/passwort-vergessen" component={PasswortVergessen} />
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
