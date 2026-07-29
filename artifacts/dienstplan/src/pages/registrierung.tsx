import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/context/auth";
import { Check, Lock, Mail, User } from "lucide-react";
import {
  AuthErrorBox,
  AuthInput,
  AuthLabel,
  AuthLayout,
  AuthPasswordInput,
  AuthSubmitButton,
  AuthTextLink,
} from "@/components/auth/auth-layout";

const KONTO_TYPEN = [
  { value: "privat", label: "Privat", hinweis: "Einzelner Assistenznehmer im Arbeitgebermodell." },
  {
    value: "dienstleister",
    label: "Gewerblich",
    hinweis: "Assistenzdienst (Dienstleister) mit Verwaltung mehrerer Teams.",
  },
] as const;

type KontoTyp = (typeof KONTO_TYPEN)[number]["value"];

export default function Registrierung() {
  const { register } = useAuth();
  const [, navigate] = useLocation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordRepeat, setPasswordRepeat] = useState("");
  const [accountType, setAccountType] = useState<KontoTyp>("privat");
  const [error, setError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setEmailError("");
    if (password.length < 8) {
      setError("Passwort muss mindestens 8 Zeichen lang sein");
      return;
    }
    if (password !== passwordRepeat) {
      setError("Passwörter stimmen nicht überein");
      return;
    }
    setLoading(true);
    try {
      await register({ name: name.trim(), email: email.trim(), password, accountType });
      navigate("/");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Registrierung fehlgeschlagen";
      const status = err instanceof Error ? (err as { status?: number }).status : undefined;
      // Eine bereits vergebene E-Mail (409) direkt am E-Mail-Feld anzeigen —
      // analog zum Anlege-/Bearbeiten-Pfad für Assistenten.
      if (status === 409) {
        setEmailError(message);
      } else if (status === 429) {
        // Rate-Limit (Task #553): verständliche Meldung mit Wartezeit aus
        // dem Retry-After-Header statt des generischen Sammel-Fehlers.
        const retryAfterSeconds =
          err instanceof Error
            ? (err as { retryAfterSeconds?: number }).retryAfterSeconds
            : undefined;
        if (typeof retryAfterSeconds === "number" && retryAfterSeconds > 0) {
          const minuten = Math.max(1, Math.ceil(retryAfterSeconds / 60));
          setError(
            minuten === 1
              ? "Zu viele Versuche — bitte in 1 Minute erneut versuchen."
              : `Zu viele Versuche — bitte in ${minuten} Minuten erneut versuchen.`,
          );
        } else {
          setError("Zu viele Versuche — bitte später erneut versuchen.");
        }
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  const aktiverTyp = KONTO_TYPEN.find((t) => t.value === accountType);

  return (
    <AuthLayout title="Registrieren">
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
        {error && <AuthErrorBox>{error}</AuthErrorBox>}

        {/* Konto-Typ-Auswahl als Segmentleiste im Stil der Vorlage */}
        <fieldset className="space-y-3">
          <legend className="mx-auto text-center text-lg font-bold text-brand-dark">
            Wie möchtest du dein Account benutzen?
          </legend>
          <div
            role="radiogroup"
            aria-label="Konto-Typ"
            className="flex w-full items-center gap-1 rounded-full border border-slate-300 bg-white p-1.5"
          >
            {KONTO_TYPEN.map((typ) => {
              const aktiv = typ.value === accountType;
              return (
                <button
                  key={typ.value}
                  type="button"
                  role="radio"
                  aria-checked={aktiv}
                  id={`rt-${typ.value}`}
                  data-testid={`registrierung-typ-${typ.value}`}
                  disabled={loading}
                  onClick={() => setAccountType(typ.value)}
                  className={
                    aktiv
                      ? "flex flex-1 items-center justify-center gap-2 rounded-full bg-brand-dark px-4 py-2.5 text-sm font-bold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-dark"
                      : "flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold text-brand-dark hover:bg-brand-hellblau/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-dark"
                  }
                >
                  {typ.label}
                  {aktiv && (
                    <span
                      className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-yellow"
                      aria-hidden
                    >
                      <Check className="h-3.5 w-3.5 text-brand-dark" strokeWidth={3} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {aktiverTyp && (
            <p className="text-center text-xs text-slate-600">{aktiverTyp.hinweis}</p>
          )}
        </fieldset>

        <div className="space-y-2">
          <AuthLabel htmlFor="name">Vor- und Nachname</AuthLabel>
          <AuthInput
            id="name"
            icon={<User className="h-5 w-5" />}
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Dein Vor- und Nachname"
            disabled={loading}
          />
        </div>

        <div className="space-y-2">
          <AuthLabel htmlFor="email">E-Mail</AuthLabel>
          <AuthInput
            id="email"
            icon={<Mail className="h-5 w-5" />}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setEmailError("");
            }}
            placeholder="E-Mail-Adresse"
            disabled={loading}
            aria-invalid={emailError ? true : undefined}
          />
          {emailError && (
            <div className="space-y-1">
              <p className="text-sm text-destructive" data-testid="registrierung-email-error">
                {emailError}
              </p>
              <p className="text-sm text-slate-600">
                Sie haben vermutlich schon ein Konto.{" "}
                <AuthTextLink
                  data-testid="registrierung-zur-anmeldung"
                  onClick={() =>
                    navigate(
                      email.trim()
                        ? `/login?email=${encodeURIComponent(email.trim())}`
                        : "/login",
                    )
                  }
                >
                  Zur Anmeldung
                </AuthTextLink>{" "}
                — oder{" "}
                <AuthTextLink
                  onClick={() =>
                    navigate(
                      email.trim()
                        ? `/passwort-vergessen?email=${encodeURIComponent(email.trim())}`
                        : "/passwort-vergessen",
                    )
                  }
                >
                  Passwort vergessen?
                </AuthTextLink>
              </p>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <AuthLabel htmlFor="password">Passwort</AuthLabel>
          <AuthPasswordInput
            id="password"
            icon={<Lock className="h-5 w-5" />}
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mindestens 8 Zeichen"
            disabled={loading}
          />
        </div>

        <div className="space-y-2">
          <AuthLabel htmlFor="password-repeat">Passwort wiederholen</AuthLabel>
          <AuthPasswordInput
            id="password-repeat"
            icon={<Lock className="h-5 w-5" />}
            autoComplete="new-password"
            required
            value={passwordRepeat}
            onChange={(e) => setPasswordRepeat(e.target.value)}
            placeholder="Passwort wiederholen"
            disabled={loading}
            aria-invalid={
              passwordRepeat.length > 0 && passwordRepeat !== password ? true : undefined
            }
          />
        </div>

        <div className="pt-2">
          <AuthSubmitButton loading={loading} loadingText="Konto wird erstellt...">
            Jetzt registrieren
          </AuthSubmitButton>
        </div>

        <p className="pt-2 text-center text-sm text-brand-dark">
          Du hast bereits ein Profil?{" "}
          <AuthTextLink onClick={() => navigate("/login")}>Login</AuthTextLink>
        </p>
      </form>
    </AuthLayout>
  );
}
