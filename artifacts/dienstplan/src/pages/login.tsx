import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/context/auth";
import { Lock, Mail } from "lucide-react";
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
  const { login } = useAuth();
  const [, navigate] = useLocation();
  // Vorbefüllung z. B. aus der Registrierung („E-Mail bereits verwendet" → Zur Anmeldung).
  const [email, setEmail] = useState(
    () => new URLSearchParams(window.location.search).get("email") ?? "",
  );
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email.trim(), password);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Anmeldung fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="Login">
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
        {error && <AuthErrorBox>{error}</AuthErrorBox>}

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
