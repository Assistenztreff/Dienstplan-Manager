import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/context/auth";
import { Lock, Mail, MailCheck } from "lucide-react";
import {
  AuthErrorBox,
  AuthInput,
  AuthLabel,
  AuthLayout,
  AuthPasswordInput,
  AuthSubmitButton,
  AuthTextLink,
} from "@/components/auth/auth-layout";

export default function Login() {
  const { login, resendVerification } = useAuth();
  const [, navigate] = useLocation();
  // Vorbefüllung z. B. aus der Registrierung („E-Mail bereits verwendet" → Zur Anmeldung).
  const [email, setEmail] = useState(
    () => new URLSearchParams(window.location.search).get("email") ?? "",
  );
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [verificationRequired, setVerificationRequired] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendDone, setResendDone] = useState(false);
  const [resendError, setResendError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setVerificationRequired(false);
    setLoading(true);
    try {
      await login(email.trim(), password);
      navigate("/");
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "email_not_verified") {
        setVerificationRequired(true);
        setError("Bitte bestätige zuerst deine E-Mail-Adresse.");
      } else {
        setError(err instanceof Error ? err.message : "Anmeldung fehlgeschlagen");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResendLoading(true);
    setResendError("");
    try {
      const result = await resendVerification(email.trim());
      if (result.emailDeliveryFailed) {
        // Zustellfehler: dem Nutzer helfen, bevor er dauerhaft ausgesperrt bleibt.
        setResendError(
          "E-Mail konnte nicht zugestellt werden — bitte E-Mail-Adresse prüfen oder Support kontaktieren.",
        );
      } else {
        setResendDone(true);
      }
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 429) {
        // Rate-Limit: Wartezeit anzeigen statt falscher Erfolgsmeldung.
        const retryAfterSeconds = (err as { retryAfterSeconds?: number }).retryAfterSeconds;
        if (typeof retryAfterSeconds === "number" && retryAfterSeconds > 0) {
          const minuten = Math.max(1, Math.ceil(retryAfterSeconds / 60));
          setResendError(
            minuten === 1
              ? "Zu viele Versuche — bitte in 1 Minute erneut versuchen."
              : `Zu viele Versuche — bitte in ${minuten} Minuten erneut versuchen.`,
          );
        } else {
          setResendError("Zu viele Versuche — bitte später erneut versuchen.");
        }
      } else {
        // Alle anderen Fehler: Existenz-Orakel schützen, als "gesendet" anzeigen.
        setResendDone(true);
      }
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <AuthLayout title="Login">
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
        {error && <AuthErrorBox>{error}</AuthErrorBox>}

        {verificationRequired && (
          <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
            <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" aria-hidden />
            <div className="space-y-1 text-sm">
              {resendDone ? (
                <p className="text-blue-800 font-medium">
                  Bestätigungsmail wurde erneut gesendet — bitte prüfen Sie Ihr Postfach (inkl. Spam).
                </p>
              ) : resendError ? (
                <p className="text-amber-800 font-medium">{resendError}</p>
              ) : (
                <>
                  <p className="text-blue-800">Keine Bestätigungsmail erhalten?</p>
                  <button
                    type="button"
                    onClick={() => void handleResend()}
                    disabled={resendLoading}
                    className="font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-900 disabled:opacity-50"
                  >
                    {resendLoading ? "Wird gesendet…" : "Erneut senden"}
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <AuthLabel htmlFor="email">E-Mail</AuthLabel>
          <AuthInput
            id="email"
            icon={<Mail className="h-5 w-5" />}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="E-Mail-Adresse"
            disabled={loading}
          />
        </div>

        <div className="space-y-2">
          <AuthLabel htmlFor="password">Passwort</AuthLabel>
          <AuthPasswordInput
            id="password"
            icon={<Lock className="h-5 w-5" />}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Passwort"
            disabled={loading}
          />
        </div>

        <div className="pt-2">
          <AuthSubmitButton loading={loading} loadingText="Wird angemeldet...">
            Login
          </AuthSubmitButton>
        </div>

        <div className="space-y-2 pt-2 text-center text-sm text-brand-dark">
          <p>
            Noch nicht registriert?{" "}
            <AuthTextLink onClick={() => navigate("/registrierung")}>Registrieren</AuthTextLink>
          </p>
          <p>
            Passwort vergessen?{" "}
            <AuthTextLink
              onClick={() =>
                navigate(
                  email.trim()
                    ? `/passwort-vergessen?email=${encodeURIComponent(email.trim())}`
                    : "/passwort-vergessen",
                )
              }
            >
              Passwort zurücksetzen
            </AuthTextLink>
          </p>
          <p className="text-xs text-slate-600">
            Noch kein Passwort? Nutzen Sie den Einladungslink per E-Mail.
          </p>
        </div>
      </form>
    </AuthLayout>
  );
}
