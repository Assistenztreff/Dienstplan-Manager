import { useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, CheckCircle2, Mail } from "lucide-react";
import {
  AuthErrorBox,
  AuthInput,
  AuthLabel,
  AuthLayout,
  AuthSubmitButton,
  AuthTextLink,
} from "@/components/auth/auth-layout";

export default function PasswortVergessen() {
  const [, navigate] = useLocation();
  const initialEmail = new URLSearchParams(window.location.search).get("email")?.trim() ?? "";

  const [email, setEmail] = useState(initialEmail);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const r = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Fehler beim Anfordern des Reset-Links");
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Anfordern des Reset-Links");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="Passwort zurücksetzen">
      <div className="space-y-6">
        {sent ? (
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <CheckCircle2 className="h-10 w-10 text-green-600" aria-hidden />
            <p className="text-sm font-semibold text-brand-dark">
              Falls diese E-Mail-Adresse bei uns registriert ist, wurde ein Reset-Link gesendet.
            </p>
            <p className="text-sm text-slate-600">Bitte prüfen Sie Ihr Postfach (inkl. Spam-Ordner).</p>
          </div>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
            <p className="text-center text-sm text-brand-dark">
              Geben Sie Ihre E-Mail-Adresse ein. Wir senden Ihnen einen Link zum Zurücksetzen des Passworts.
            </p>
            {error && <AuthErrorBox>{error}</AuthErrorBox>}

            <div className="space-y-2">
              <AuthLabel htmlFor="email">E-Mail-Adresse</AuthLabel>
              <AuthInput
                id="email"
                icon={<Mail className="h-5 w-5" />}
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Ihre E-Mail-Adresse"
                disabled={loading}
              />
            </div>

            <div className="pt-2">
              <AuthSubmitButton loading={loading} loadingText="Wird gesendet…">
                Reset-Link anfordern
              </AuthSubmitButton>
            </div>
          </form>
        )}

        <button
          type="button"
          onClick={() =>
            navigate(email.trim() ? `/login?email=${encodeURIComponent(email.trim())}` : "/login")
          }
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
