import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/context/auth";
import { CheckCircle2, Lock } from "lucide-react";
import {
  AuthErrorBox,
  AuthLabel,
  AuthLayout,
  AuthPasswordInput,
  AuthSubmitButton,
  AuthTextLink,
} from "@/components/auth/auth-layout";

export default function Einladung() {
  const { setPassword } = useAuth();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") ?? "";

  const [password, setPasswordValue] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  if (!token) {
    return (
      <AuthLayout title="Einladung">
        <div className="space-y-4 text-center">
          <p className="text-sm text-destructive">
            Ungültiger Einladungslink. Bitte fordern Sie einen neuen an.
          </p>
          <p className="text-sm text-brand-dark">
            <AuthTextLink onClick={() => navigate("/login")}>Zum Login</AuthTextLink>
          </p>
        </div>
      </AuthLayout>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Passwort muss mindestens 8 Zeichen lang sein.");
      return;
    }
    if (password !== confirm) {
      setError("Passwörter stimmen nicht überein.");
      return;
    }

    setLoading(true);
    try {
      await setPassword(token, password);
      setDone(true);
      setTimeout(() => navigate("/"), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Setzen des Passworts");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="Passwort setzen">
      {done ? (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <CheckCircle2 className="h-10 w-10 text-green-600" aria-hidden />
          <p className="text-sm font-semibold text-brand-dark">
            Passwort gesetzt! Sie werden weitergeleitet...
          </p>
        </div>
      ) : (
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
          <p className="text-center text-sm text-brand-dark">
            Willkommen — wählen Sie ein sicheres Passwort für Ihr Konto.
          </p>
          {error && <AuthErrorBox>{error}</AuthErrorBox>}

          <div className="space-y-2">
            <AuthLabel htmlFor="password">Neues Passwort</AuthLabel>
            <AuthPasswordInput
              id="password"
              icon={<Lock className="h-5 w-5" />}
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPasswordValue(e.target.value)}
              placeholder="Mindestens 8 Zeichen"
              disabled={loading}
            />
          </div>

          <div className="space-y-2">
            <AuthLabel htmlFor="confirm">Passwort wiederholen</AuthLabel>
            <AuthPasswordInput
              id="confirm"
              icon={<Lock className="h-5 w-5" />}
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Passwort wiederholen"
              disabled={loading}
            />
          </div>

          <div className="pt-2">
            <AuthSubmitButton loading={loading} loadingText="Wird gesetzt...">
              Passwort setzen und anmelden
            </AuthSubmitButton>
          </div>
        </form>
      )}
    </AuthLayout>
  );
}
