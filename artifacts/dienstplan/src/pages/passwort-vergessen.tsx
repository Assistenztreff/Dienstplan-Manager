import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ArrowLeft, KeyRound } from "lucide-react";
import logoUrl from "@assets/20260626_094418_0000_1782459883949.png";

export default function PasswortVergessen() {
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <img src={logoUrl} alt="AssistenzTreff" className="h-20 w-auto" />
          <p className="text-sm text-muted-foreground">Passwort zurücksetzen</p>
        </div>

        <Card className="border-border/50 shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Passwort vergessen</CardTitle>
            <CardDescription>So erhalten Sie wieder Zugang zu Ihrem Konto.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-3 rounded-md bg-muted/40 border border-border/50 px-3 py-3">
              <KeyRound className="h-5 w-5 shrink-0 text-muted-foreground mt-0.5" />
              <p className="text-sm text-muted-foreground">
                Aus Sicherheitsgründen kann Ihr Passwort nicht automatisch per E-Mail
                zurückgesetzt werden. Bitte wenden Sie sich an Ihren Administrator
                (Assistenznehmer bzw. Assistenzdienst). Dieser kann Ihnen einen neuen
                Einladungslink senden, mit dem Sie ein neues Passwort vergeben.
              </p>
            </div>

            <Button variant="outline" className="w-full gap-2" onClick={() => navigate("/login")}>
              <ArrowLeft className="h-4 w-4" />
              Zurück zur Anmeldung
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
