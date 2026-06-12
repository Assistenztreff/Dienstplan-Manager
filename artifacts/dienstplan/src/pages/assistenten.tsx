import { useListUsers, useListContracts } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Plus, Mail, Phone, Calendar } from "lucide-react";
import { format } from "date-fns";
import { de } from "date-fns/locale";

export default function Assistenten() {
  const { data: users, isLoading: usersLoading } = useListUsers({ role: "assistant" });
  const { data: contracts, isLoading: contractsLoading } = useListContracts();

  const isLoading = usersLoading || contractsLoading;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-serif font-bold text-foreground">Assistenten</h2>
          <p className="text-muted-foreground mt-1">Verwaltung der Mitarbeiter und Vertraege</p>
        </div>
        <Button className="gap-2">
          <Plus className="h-4 w-4" /> Neu anlegen
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-48 w-full rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {users?.map(user => {
            const userContracts = contracts?.filter(c => c.userId === user.id) || [];
            const activeContract = userContracts.find(c => !c.endDate || new Date(c.endDate) > new Date());

            return (
              <Card key={user.id} className="border-border/50 shadow-sm overflow-hidden flex flex-col">
                <div className="p-6 pb-4 border-b border-border/50 bg-muted/30">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-lg font-semibold">{user.name}</h3>
                      <div className="flex items-center gap-2 mt-2 text-sm text-muted-foreground">
                        <Mail className="h-3 w-3" />
                        <span>{user.email}</span>
                      </div>
                      {user.phone && (
                        <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                          <Phone className="h-3 w-3" />
                          <span>{user.phone}</span>
                        </div>
                      )}
                    </div>
                    <Badge variant={user.isActive ? "default" : "secondary"}>
                      {user.isActive ? "Aktiv" : "Inaktiv"}
                    </Badge>
                  </div>
                </div>
                
                <CardContent className="p-6 flex-1 flex flex-col justify-between">
                  {activeContract ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground flex items-center gap-2">
                          <Calendar className="h-4 w-4" /> Wochenstunden
                        </span>
                        <span className="font-medium">{activeContract.weeklyHours} h</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground flex items-center gap-2">
                          <Calendar className="h-4 w-4" /> Urlaubstage
                        </span>
                        <span className="font-medium">{activeContract.vacationDays} Tage</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground flex items-center gap-2">
                          <Calendar className="h-4 w-4" /> Vertragsbeginn
                        </span>
                        <span className="font-medium">{format(new Date(activeContract.startDate), 'dd.MM.yyyy')}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground py-4 text-center border border-dashed rounded-md">
                      Kein aktiver Vertrag hinterlegt
                    </div>
                  )}
                  
                  <div className="mt-6 pt-4 border-t flex justify-end gap-2">
                    <Button variant="outline" size="sm">Details</Button>
                    <Button variant="secondary" size="sm">Vertrag bearbeiten</Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {(!users || users.length === 0) && (
            <div className="col-span-full p-12 text-center border rounded-xl bg-card">
              <p className="text-muted-foreground">Keine Assistenten gefunden.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
