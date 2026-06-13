import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/context/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CalendarDays, CheckCircle2, Loader2 } from "lucide-react";

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
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-sm border-border/50 shadow-sm">
          <CardContent className="pt-6 text-center">
            <p className="text-destructive text-sm">Ungültiger Einladungslink. Bitte anfordern Sie einen neuen.</p>
            <Button variant="link" className="mt-2" onClick={() => navigate("/login")}>
              Zur Anmeldung
            </Button>
          </CardContent>
        </Card>
      </div>
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
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-12 h-12 rounded-xl bg-sidebar flex items-center justify-center">
            <CalendarDays className="h-6 w-6 text-sidebar-foreground" />
          </div>
          <h1 className="text-2xl font-serif font-bold text-foreground">Dienstplan PA</h1>
          <p className="text-sm text-muted-foreground">Willkommen — bitte setzen Sie Ihr Passwort</p>
        </div>

        <Card className="border-border/50 shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Passwort setzen</CardTitle>
            <CardDescription>Wählen Sie ein sicheres Passwort für Ihr Konto.</CardDescription>
          </CardHeader>
          <CardContent>
            {done ? (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <CheckCircle2 className="h-10 w-10 text-green-600" />
                <p className="text-sm font-medium">Passwort gesetzt! Sie werden weitergeleitet...</p>
              </div>
            ) : (
              <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
                {error && (
                  <div className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive">
                    {error}
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="password">Neues Passwort</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPasswordValue(e.target.value)}
                    placeholder="Mindestens 8 Zeichen"
                    disabled={loading}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirm">Passwort bestätigen</Label>
                  <Input
                    id="confirm"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="••••••••"
                    disabled={loading}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Wird gesetzt...
                    </>
                  ) : (
                    "Passwort setzen und anmelden"
                  )}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
