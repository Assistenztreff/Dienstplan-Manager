import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/context/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2 } from "lucide-react";
import logoUrl from "@assets/20260626_094418_0000_1782459883949.png";

export default function Registrierung() {
  const { register } = useAuth();
  const [, navigate] = useLocation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accountType, setAccountType] = useState<"privat" | "dienstleister">("privat");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Passwort muss mindestens 8 Zeichen lang sein");
      return;
    }
    setLoading(true);
    try {
      await register({ name: name.trim(), email: email.trim(), password, accountType });
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registrierung fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <img src={logoUrl} alt="AssistenzTreff" className="h-20 w-auto" />
          <p className="text-sm text-muted-foreground">Konto erstellen</p>
        </div>

        <Card className="border-border/50 shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Registrieren</CardTitle>
            <CardDescription>Konto-Typ wählen und Zugangsdaten festlegen</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
              {error && (
                <div className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  autoComplete="name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Vor- und Nachname"
                  disabled={loading}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">E-Mail</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@beispiel.de"
                  disabled={loading}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Passwort</Label>
                <Input
                  id="password"
                  type="password"
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
                <Label>Konto-Typ</Label>
                <RadioGroup
                  value={accountType}
                  onValueChange={(v) => setAccountType(v as "privat" | "dienstleister")}
                  className="space-y-2"
                  disabled={loading}
                >
                  <label
                    htmlFor="rt-privat"
                    className="flex items-start gap-3 rounded-md border border-border/60 p-3 cursor-pointer hover:bg-muted/40"
                  >
                    <RadioGroupItem id="rt-privat" value="privat" className="mt-0.5" />
                    <span className="space-y-0.5">
                      <span className="block text-sm font-medium text-foreground">Privat</span>
                      <span className="block text-xs text-muted-foreground">
                        Einzelner Assistenznehmer im Arbeitgebermodell.
                      </span>
                    </span>
                  </label>
                  <label
                    htmlFor="rt-dienstleister"
                    className="flex items-start gap-3 rounded-md border border-border/60 p-3 cursor-pointer hover:bg-muted/40"
                  >
                    <RadioGroupItem id="rt-dienstleister" value="dienstleister" className="mt-0.5" />
                    <span className="space-y-0.5">
                      <span className="block text-sm font-medium text-foreground">
                        Gewerblich (Dienstleister)
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        Assistenzdienst mit Verwaltung mehrerer Teams.
                      </span>
                    </span>
                  </label>
                </RadioGroup>
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Konto wird erstellt...
                  </>
                ) : (
                  "Registrieren"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Bereits ein Konto?{" "}
          <button
            type="button"
            onClick={() => navigate("/login")}
            className="text-foreground underline-offset-2 hover:underline"
          >
            Zur Anmeldung
          </button>
        </p>
      </div>
    </div>
  );
}
