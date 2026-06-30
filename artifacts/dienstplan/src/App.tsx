import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
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
import OperatorDashboard from "@/pages/operator-dashboard";
import Login from "@/pages/login";
import Registrierung from "@/pages/registrierung";
import Einladung from "@/pages/einladung";
import PasswortVergessen from "@/pages/passwort-vergessen";
import NotFound from "@/pages/not-found";
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
        {currentUser.role === "admin" && (
          <Route path="/abwesenheiten" component={Abwesenheiten} />
        )}
        {currentUser.role === "admin" && (
          <Route path="/assistenten" component={Assistenten} />
        )}
        {currentUser.role === "admin" && (
          <Route path="/auswertungen" component={Auswertungen} />
        )}
        {currentUser.role === "admin" && (
          <Route path="/einstellungen" component={Einstellungen} />
        )}
        {currentUser.role === "admin" && currentUser.accountType === "dienstleister" && (
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
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
