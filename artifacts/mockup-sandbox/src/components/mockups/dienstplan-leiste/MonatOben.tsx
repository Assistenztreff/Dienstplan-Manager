import React, { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  List,
  CalendarDays,
  Check,
  Download,
  CheckSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const SHIFTS = [
  { id: 1, name: "Anna Schmidt", time: "06:00–14:00", type: "Frühdienst", date: "Mi., 01. Juli", status: "FIX" },
  { id: 2, name: "Max Müller", time: "14:00–22:00", type: "Spätdienst", date: "Mi., 01. Juli", status: "FIX" },
  { id: 3, name: "Lisa Weber", time: "22:00–06:00", type: "Nachtdienst", date: "Mi., 01. Juli", status: "VORLAEUFIG" },
  { id: 4, name: "Anna Schmidt", time: "06:00–14:00", type: "Frühdienst", date: "Do., 02. Juli", status: "FIX" },
  { id: 5, name: "Tom Bauer", time: "14:00–22:00", type: "Spätdienst", date: "Do., 02. Juli", status: "ANGEBOTEN" },
  { id: 6, name: "Lisa Weber", time: "22:00–06:00", type: "Nachtdienst", date: "Do., 02. Juli", status: "FIX" },
  { id: 7, name: "Anna Schmidt", time: "08:00–16:00", type: "Tagdienst", date: "Fr., 03. Juli", status: "VORLAEUFIG" },
  { id: 8, name: "Max Müller", time: "16:00–00:00", type: "Spätdienst", date: "Fr., 03. Juli", status: "FIX" },
  { id: 9, name: "Lisa Weber", time: "Urlaub", type: "Abwesenheit", date: "Sa., 04. Juli", status: "FIX" },
  { id: 10, name: "Tom Bauer", time: "06:00–14:00", type: "Frühdienst", date: "Sa., 04. Juli", status: "FIX" },
];

export function MonatOben() {
  const [view, setView] = useState("list");

  return (
    <div className="min-h-screen w-full bg-background flex flex-col items-center">
      <div className="w-full max-w-[390px] min-h-screen bg-card sm:border-x border-border flex flex-col relative">
        
        {/* Sticky Header */}
        <div className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-border/40 flex flex-col">
          
          {/* Zeile 1: Titel + Monat */}
          <div className="flex items-center justify-between px-3 h-12 border-b border-border/20">
            <h1 className="font-serif text-xl font-bold text-foreground truncate">Dienstplan</h1>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground shrink-0" title="Vorheriger Monat" aria-label="Vorheriger Monat">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm font-semibold min-w-[70px] text-center text-foreground shrink-0 whitespace-nowrap">
                Juli 2026
              </span>
              <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground shrink-0" title="Nächster Monat" aria-label="Nächster Monat">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Zeile 2: Filter + Aktionen */}
          <div className="flex items-center gap-2 px-3 h-14">
            <Select defaultValue="all">
              <SelectTrigger className="h-9 flex-1 min-w-0 text-xs truncate">
                <SelectValue placeholder="Alle Assistenten" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Assistenten</SelectItem>
                <SelectItem value="1">Anna Schmidt</SelectItem>
                <SelectItem value="2">Max Müller</SelectItem>
              </SelectContent>
            </Select>

            <div className="flex items-center gap-1.5 shrink-0">
              {/* View Toggle */}
              <div className="flex items-center rounded-md border border-input p-0.5 bg-muted/30">
                <button 
                  onClick={() => setView("list")}
                  title="Listenansicht"
                  aria-label="Listenansicht"
                  aria-pressed={view === "list"}
                  className={`flex h-8 w-9 items-center justify-center rounded transition-colors ${view === "list" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  <List className="h-4 w-4"/>
                </button>
                <button 
                  onClick={() => setView("month")}
                  title="Monatsansicht"
                  aria-label="Monatsansicht"
                  aria-pressed={view === "month"}
                  className={`flex h-8 w-9 items-center justify-center rounded transition-colors ${view === "month" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  <CalendarDays className="h-4 w-4"/>
                </button>
              </div>

              {/* Actions */}
              <Button 
                variant="outline" 
                size="icon" 
                className="h-9 w-9 relative shrink-0" 
                aria-label="Alle bestätigen" 
                title="Alle bestätigen"
              >
                <Check className="h-4 w-4" />
                <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-[16px] px-1 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary border border-background">
                  3
                </span>
              </Button>
              <Button 
                variant="outline" 
                size="icon" 
                className="h-9 w-9 shrink-0" 
                aria-label="Monats-PDF" 
                title="Monats-PDF"
              >
                <Download className="h-4 w-4" />
              </Button>
              <Button 
                variant="outline" 
                size="icon" 
                className="h-9 w-9 shrink-0" 
                aria-label="Mehrfachauswahl" 
                title="Mehrfachauswahl"
              >
                <CheckSquare className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* List of Shifts (Dummy Content) */}
        <div className="flex-1 p-3 space-y-4 overflow-y-auto">
          {Array.from(new Set(SHIFTS.map(s => s.date))).map(date => {
            const dayShifts = SHIFTS.filter(s => s.date === date);
            return (
              <div key={date} className="space-y-2">
                <h3 className="text-sm font-medium text-muted-foreground pl-1">{date}</h3>
                <div className="space-y-2">
                  {dayShifts.map(shift => (
                    <div 
                      key={shift.id} 
                      className={`p-3 rounded-lg border flex flex-col gap-1.5 ${
                        shift.status === 'VORLAEUFIG' ? 'border-dashed opacity-70' : 
                        shift.status === 'ANGEBOTEN' ? 'border-dashed border-sky-200 bg-sky-50/30' : 'bg-card'
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <span className="font-medium text-sm">{shift.name}</span>
                        {shift.status === 'VORLAEUFIG' && (
                          <span className="text-[10px] uppercase font-semibold bg-foreground/10 text-foreground/70 px-1.5 py-0.5 rounded">Entwurf</span>
                        )}
                        {shift.status === 'ANGEBOTEN' && (
                          <span className="text-[10px] uppercase font-semibold bg-sky-200 text-sky-900 px-1.5 py-0.5 rounded">Vorschlag</span>
                        )}
                      </div>
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-muted-foreground">{shift.type}</span>
                        <span className="font-medium">{shift.time}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          <div className="py-8 text-center text-xs text-muted-foreground">
            Ende der Liste
          </div>
        </div>

      </div>
    </div>
  );
}
