import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/context/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CalendarDays, Loader2 } from "lucide-react";

export default function Login() {
  const { login } = useAuth();
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
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
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-12 h-12 rounded-xl bg-sidebar flex items-center justify-center">
            <CalendarDays className="h-6 w-6 text-sidebar-foreground" />
          </div>
          <h1 className="text-2xl font-serif font-bold text-foreground">Dienstplan PA</h1>
          <p className="text-sm text-muted-foreground">Melden Sie sich mit Ihrer E-Mail an</p>
        </div>

        <Card className="border-border/50 shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Anmelden</CardTitle>
            <CardDescription>E-Mail und Passwort eingeben</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
              {error && (
                <div className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}
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
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  disabled={loading}
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Wird angemeldet...
                  </>
                ) : (
                  "Anmelden"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Noch kein Passwort? Nutzen Sie den Einladungslink per E-Mail.
        </p>
      </div>
    </div>
  );
}
