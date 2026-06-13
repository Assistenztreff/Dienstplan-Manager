import { useListTimeEntries, useListUsers, useConfirmTimeEntry } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { Check, X } from "lucide-react";
import { useAuth } from "@/context/auth";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export default function Zeiterfassung() {
  const { currentUser } = useAuth();
  const isAdmin = currentUser?.role === "admin";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: entries, isLoading: entriesLoading } = useListTimeEntries();
  const { data: users, isLoading: usersLoading } = useListUsers();
  const { mutate: confirmEntry, isPending: isConfirming } = useConfirmTimeEntry();

  const isLoading = entriesLoading || (isAdmin && usersLoading);

  const getUserName = (entry: { userId: number; user?: { name: string } | null }) => {
    if (entry.user?.name) return entry.user.name;
    return users?.find((u) => u.id === entry.userId)?.name ?? "Unbekannt";
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">Offen</Badge>;
      case "confirmed":
        return <Badge className="bg-green-100 text-green-800 hover:bg-green-100 text-green-800 border-0">Bestätigt</Badge>;
      case "rejected":
        return <Badge variant="destructive">Abgelehnt</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const handleConfirm = (id: number, status: "confirmed" | "rejected") => {
    confirmEntry(
      { id, data: { status, confirmedBy: currentUser?.id ?? 0 } },
      {
        onSuccess: () => {
          toast({ title: status === "confirmed" ? "Eintrag bestätigt" : "Eintrag abgelehnt" });
          void queryClient.invalidateQueries({ queryKey: ["/api/time-tracking"] });
        },
        onError: () => {
          toast({ title: "Fehler beim Aktualisieren", variant: "destructive" });
        },
      }
    );
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-serif font-bold text-foreground">Zeiterfassung</h2>
          <p className="text-muted-foreground mt-1">
            {isAdmin ? "Geleistete Stunden prüfen und genehmigen" : "Meine geleisteten Stunden"}
          </p>
        </div>
      </div>

      <Card className="border-border/50 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-8 space-y-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="p-4 text-left font-medium text-muted-foreground">Datum</th>
                  {isAdmin && (
                    <th className="p-4 text-left font-medium text-muted-foreground">Assistent</th>
                  )}
                  <th className="p-4 text-left font-medium text-muted-foreground">Von - Bis</th>
                  <th className="p-4 text-left font-medium text-muted-foreground">Stunden</th>
                  <th className="p-4 text-left font-medium text-muted-foreground">Status</th>
                  {isAdmin && (
                    <th className="p-4 text-right font-medium text-muted-foreground">Aktion</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {entries?.map((entry) => (
                  <tr key={entry.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="p-4">
                      <div className="font-medium">
                        {format(new Date(entry.actualStart), "dd.MM.yyyy", { locale: de })}
                      </div>
                    </td>
                    {isAdmin && (
                      <td className="p-4">{getUserName(entry)}</td>
                    )}
                    <td className="p-4">
                      {format(new Date(entry.actualStart), "HH:mm")} -{" "}
                      {format(new Date(entry.actualEnd), "HH:mm")}
                    </td>
                    <td className="p-4 font-medium">{entry.actualHours} h</td>
                    <td className="p-4">{getStatusBadge(entry.status)}</td>
                    {isAdmin && (
                      <td className="p-4 text-right">
                        {entry.status === "pending" && (
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 w-8 p-0 text-green-600 hover:text-green-700 hover:bg-green-50 border-green-200"
                              disabled={isConfirming}
                              onClick={() => handleConfirm(entry.id, "confirmed")}
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                              disabled={isConfirming}
                              onClick={() => handleConfirm(entry.id, "rejected")}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
                {(!entries || entries.length === 0) && (
                  <tr>
                    <td colSpan={isAdmin ? 6 : 4} className="p-8 text-center text-muted-foreground">
                      Keine Zeiteinträge gefunden.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
