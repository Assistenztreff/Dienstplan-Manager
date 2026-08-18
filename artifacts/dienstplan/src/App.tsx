import { Switch, Route, Redirect, Router as WouterRouter, useLocation } from "wouter";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider, type Persister } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { ApiError } from "@workspace/api-client-react";
import { toast } from "sonner";
import {
  registerSignOutHandler,
  registerUserSwitchHandler,
  resyncAuthAfter401,
  storedSessionUserId,
} from "@/context/auth";
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
          if (ok) {
            // Nach 401-Recovery mit GLEICHER Identität: nur die Abfragen,
            // die tatsächlich im Fehlerzustand sind, neu laden — nicht den
            // gesamten Cache verwerfen. Referenzdaten (Teams, Users, …) bleiben
            // gültig; ihr staleTime schützt vor unnötigen Roundtrips.
            void queryClient.invalidateQueries({
              predicate: (q) => q.state.status === "error",
            });
          }
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

// ---------------------------------------------------------------------------
// Persistenter Query-Cache (Stale-While-Revalidate über Seiten-Reloads):
// Dashboard, Dienstplan und Auswertungen zeigen beim Öffnen sofort die zuletzt
// gesehenen Werte aus localStorage; sind die Daten älter als staleTime, lädt
// React Query im Hintergrund nach und die Zahlen aktualisieren sich von selbst.
// ---------------------------------------------------------------------------

// Nur unkritische, wiederverwendbare Anzeigedaten persistieren. Bewusst NICHT
// dabei: /api/operator/* (Betreiber-Daten), /api/calendar-token (Geheimnis),
// /api/storage/* und /api/healthz.
const PERSIST_KEY_PREFIXES = [
  "/api/shifts",
  "/api/dashboard",
  "/api/users",
  "/api/teams",
  "/api/shift-models",
  "/api/contracts",
  "/api/time-tracking", // deckt auch /api/time-tracking-status ab
  "/api/month-closings",
  "/api/hour-budgets",
  "/api/allowance-settings",
  "/api/branding-settings",
  "/api/koordinatoren",
] as const;

function isPersistableQueryKey(key: unknown): boolean {
  return (
    typeof key === "string" &&
    PERSIST_KEY_PREFIXES.some(
      (p) => key === p || key.startsWith(`${p}/`) || key.startsWith(`${p}-`),
    )
  );
}

/**
 * Cache-Eigentümer-Kennung ("u:<id>" bzw. "u:anon"). Muss bei JEDEM Aufruf
 * frisch berechnet werden: Der PersistQueryClientProvider friert seine
 * Optionen beim Mount ein — ein beim App-Start (Login-Seite) berechneter
 * Wert wäre für die gesamte Sitzung "u:anon". Alles, was nach einem Login
 * in derselben Sitzung persistiert würde, trüge dann den falschen Stempel,
 * und der nächste Reload würde den kompletten Cache verwerfen statt nutzen.
 */
function cacheOwnerTag(): string {
  return `u:${storedSessionUserId() ?? "anon"}`;
}

const baseQueryPersister = createSyncStoragePersister({
  storage: typeof window !== "undefined" ? window.localStorage : undefined,
  key: "dienstplan.query-cache",
  // Schreibvorgänge bündeln: höchstens alle 2 s in localStorage serialisieren.
  throttleTime: 2_000,
});

// Wrapper um den Persister: stempelt den Cache-Eigentümer zum Zeitpunkt des
// SCHREIBENS (statt des beim Mount eingefrorenen Options-Busters). Nach einem
// Login/Kontowechsel in laufender Sitzung tragen neue Persist-Vorgänge damit
// sofort die richtige Nutzer-ID, und der nächste Reload kann den Cache nutzen.
const queryPersister: Persister = {
  persistClient: (client) =>
    baseQueryPersister.persistClient({ ...client, buster: cacheOwnerTag() }),
  restoreClient: () => baseQueryPersister.restoreClient(),
  removeClient: () => baseQueryPersister.removeClient(),
};

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
  // Persistierten Cache des vorherigen Kontos ebenfalls verwerfen.
  void queryPersister.removeClient();
  toast.info("Anmeldung gewechselt", {
    description: `Du bist jetzt als ${next.name} angemeldet. Die Ansicht wurde entsprechend aktualisiert.`,
  });
});

// Abmeldung (Logout oder tote Session): zwischengespeicherte Daten dürfen —
// gerade auf geteilten Geräten — nicht bis zur nächsten Anmeldung überleben.
registerSignOutHandler(() => {
  void queryClient.cancelQueries();
  queryClient.clear();
  void queryPersister.removeClient();
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
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: queryPersister,
        // Ein Tag: Danach gelten gespeicherte Werte als zu alt für die
        // Sofort-Anzeige — die App lädt dann wieder klassisch mit Skeletons.
        maxAge: 24 * 60 * 60 * 1000,
        // Cache-Eigentümer: Ein unter anderer Nutzer-ID (oder abgemeldet)
        // geschriebener Cache wird beim Start verworfen statt angezeigt.
        // Nur für die Restore-Prüfung beim Mount relevant — beim Schreiben
        // stempelt der queryPersister-Wrapper den Eigentümer dynamisch.
        buster: cacheOwnerTag(),
        dehydrateOptions: {
          // Nur erfolgreich geladene, unkritische Anzeigedaten speichern —
          // Fehlerzustände und alles außerhalb der Allowlist bleiben außen vor.
          shouldDehydrateQuery: (query) =>
            query.state.status === "success" && isPersistableQueryKey(query.queryKey[0]),
        },
      }}
    >
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
    </PersistQueryClientProvider>
  );
}

export default App;
