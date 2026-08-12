import { useState } from "react";
import { useLocation } from "wouter";
import { CheckCircle2, Lock } from "lucide-react";
import {
  AuthErrorBox,
  AuthLabel,
  AuthLayout,
  AuthPasswordInput,
  AuthSubmitButton,
  AuthTextLink,
} from "@/components/auth/auth-layout";

export default function PasswortZuruecksetzen() {
  const [, navigate] = useLocation();
  const token = new URLSearchParams(window.location.search).get("token") ?? "";

  const [password, setPasswordValue] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  if (!token) {
    return (
      <AuthLayout title="Passwort zurücksetzen">
        <div className="space-y-4 text-center">
          <p className="text-sm text-destructive">
            Ungültiger Reset-Link. Bitte fordern Sie einen neuen an.
          </p>
          <p className="text-sm text-brand-dark">
            <AuthTextLink onClick={() => navigate("/passwort-vergessen")}>
              Neuen Link anfordern
            </AuthTextLink>
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
      const r = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ token, password }),
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Fehler beim Zurücksetzen des Passworts");
      }
      setDone(true);
      setTimeout(() => navigate("/login"), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Zurücksetzen des Passworts");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="Neues Passwort vergeben">
      {done ? (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <CheckCircle2 className="h-10 w-10 text-green-600" aria-hidden />
          <p className="text-sm font-semibold text-brand-dark">
            Passwort erfolgreich geändert! Sie werden zum Login weitergeleitet…
          </p>
        </div>
      ) : (
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
          <p className="text-center text-sm text-brand-dark">
            Wählen Sie ein neues sicheres Passwort für Ihr Konto.
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
            <AuthSubmitButton loading={loading} loadingText="Wird gespeichert…">
              Passwort speichern
            </AuthSubmitButton>
          </div>
        </form>
      )}
    </AuthLayout>
  );
}
