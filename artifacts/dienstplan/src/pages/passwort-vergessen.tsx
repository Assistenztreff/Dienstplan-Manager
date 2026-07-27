import { useLocation } from "wouter";
import { ArrowLeft, KeyRound } from "lucide-react";
import { AuthLayout, AuthTextLink } from "@/components/auth/auth-layout";

export default function PasswortVergessen() {
  const [, navigate] = useLocation();
  const email = new URLSearchParams(window.location.search).get("email")?.trim() ?? "";

  return (
    <AuthLayout title="Passwort zurücksetzen">
      <div className="space-y-6">
        <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-brand-hellblau/40 px-4 py-4">
          <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-brand-dark" aria-hidden />
          <p className="text-sm text-brand-dark">
            {email ? (
              <>
                Aus Sicherheitsgründen kann das Passwort für{" "}
                <span className="break-all font-bold" data-testid="passwort-vergessen-email">
                  {email}
                </span>{" "}
                nicht automatisch per E-Mail zurückgesetzt werden.
              </>
            ) : (
              <>
                Aus Sicherheitsgründen kann Ihr Passwort nicht automatisch per E-Mail
                zurückgesetzt werden.
              </>
            )}{" "}
            Bitte wenden Sie sich an Ihren Administrator (Assistenznehmer bzw. Assistenzdienst).
            Dieser kann Ihnen einen neuen Einladungslink senden, mit dem Sie ein neues Passwort
            vergeben.
          </p>
        </div>

        <button
          type="button"
          onClick={() => navigate(email ? `/login?email=${encodeURIComponent(email)}` : "/login")}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-full border-2 border-brand-dark bg-white px-6 text-base font-semibold text-brand-dark transition-colors hover:bg-brand-hellblau/60 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-brand-dark"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden />
          Zurück zum Login
        </button>

        <p className="text-center text-sm text-brand-dark">
          Noch nicht registriert?{" "}
          <AuthTextLink onClick={() => navigate("/registrierung")}>Registrieren</AuthTextLink>
        </p>
      </div>
    </AuthLayout>
  );
}
