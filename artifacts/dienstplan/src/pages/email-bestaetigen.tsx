import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { AuthLayout, AuthTextLink } from "@/components/auth/auth-layout";

type State = "loading" | "success" | "error";

export default function EmailBestaetigen() {
  const [, navigate] = useLocation();
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const [state, setState] = useState<State>("loading");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setState("error");
      setErrorMessage("Ungültiger Bestätigungslink.");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/auth/verify-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ token }),
        });
        if (cancelled) return;
        if (r.ok) {
          setState("success");
          setTimeout(() => navigate("/"), 2500);
        } else {
          const data = (await r.json().catch(() => ({}))) as { error?: string };
          setState("error");
          setErrorMessage(data.error ?? "Bestätigung fehlgeschlagen.");
        }
      } catch {
        if (!cancelled) {
          setState("error");
          setErrorMessage("Netzwerkfehler. Bitte versuche es erneut.");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [token, navigate]);

  return (
    <AuthLayout title="E-Mail bestätigen">
      <div className="flex flex-col items-center gap-4 py-4 text-center">
        {state === "loading" && (
          <>
            <Loader2 className="h-10 w-10 animate-spin text-brand-dark" aria-hidden />
            <p className="text-sm text-brand-dark">E-Mail-Adresse wird bestätigt…</p>
          </>
        )}
        {state === "success" && (
          <>
            <CheckCircle2 className="h-10 w-10 text-green-600" aria-hidden />
            <p className="text-sm font-semibold text-brand-dark">
              E-Mail-Adresse erfolgreich bestätigt! Sie werden angemeldet…
            </p>
          </>
        )}
        {state === "error" && (
          <>
            <XCircle className="h-10 w-10 text-destructive" aria-hidden />
            <p className="text-sm text-destructive">{errorMessage}</p>
            <p className="text-sm text-brand-dark">
              <AuthTextLink onClick={() => navigate("/login")}>Zum Login</AuthTextLink>
            </p>
          </>
        )}
      </div>
    </AuthLayout>
  );
}
