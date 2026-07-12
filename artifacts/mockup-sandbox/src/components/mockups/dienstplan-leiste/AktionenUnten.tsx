import { useState } from "react";
import { 
  ChevronLeft, 
  ChevronRight, 
  List, 
  CalendarDays, 
  Check, 
  Download, 
  CheckSquare,
  Users
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

// Dummy-Daten für die Liste
const DUMMY_SHIFTS = [
  { id: 1, name: "Anna Schmidt", type: "Frühdienst", time: "06:00–14:00", date: "01. Juli 2026", color: "bg-blue-100 text-blue-900 border-blue-200" },
  { id: 2, name: "Max Mustermann", type: "Spätdienst", time: "14:00–22:00", date: "01. Juli 2026", color: "bg-emerald-100 text-emerald-900 border-emerald-200" },
  { id: 3, name: "Lisa Müller", type: "Nachtdienst", time: "22:00–06:00", date: "01. Juli 2026", color: "bg-indigo-100 text-indigo-900 border-indigo-200" },
  { id: 4, name: "Anna Schmidt", type: "Frühdienst", time: "06:00–14:00", date: "02. Juli 2026", color: "bg-blue-100 text-blue-900 border-blue-200" },
  { id: 5, name: "Tom Weber", type: "Spätdienst", time: "14:00–22:00", date: "02. Juli 2026", color: "bg-emerald-100 text-emerald-900 border-emerald-200" },
  { id: 6, name: "Lisa Müller", type: "Nachtdienst", time: "22:00–06:00", date: "02. Juli 2026", color: "bg-indigo-100 text-indigo-900 border-indigo-200" },
  { id: 7, name: "Tom Weber", type: "Frühdienst", time: "06:00–14:00", date: "03. Juli 2026", color: "bg-blue-100 text-blue-900 border-blue-200" },
  { id: 8, name: "Anna Schmidt", type: "Spätdienst", time: "14:00–22:00", date: "03. Juli 2026", color: "bg-emerald-100 text-emerald-900 border-emerald-200" },
  { id: 9, name: "Max Mustermann", type: "Nachtdienst", time: "22:00–06:00", date: "03. Juli 2026", color: "bg-indigo-100 text-indigo-900 border-indigo-200" },
];

export function AktionenUnten() {
  const [view, setView] = useState("list");

  return (
    // Max-width Container simuliert die 390px Smartphone-Ansicht zentriert auf großen Bildschirmen
    <div className="mx-auto w-full max-w-[390px] min-h-screen bg-background border-x border-border shadow-sm flex flex-col relative overflow-hidden">
      
      {/* Sticky Header - 2 Zeilen */}
      <div className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-border/40 pb-2 px-3 pt-3 flex flex-col gap-3">
        
        {/* Zeile 1: Identität & Filter */}
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-serif font-bold text-xl text-foreground truncate">
            Dienstplan
          </h1>
          <div className="flex-1 max-w-[180px]">
            <Select defaultValue="all">
              <SelectTrigger className="h-9 w-full bg-white px-2 truncate" aria-label="Assistent wählen">
                <Users className="w-4 h-4 mr-1.5 opacity-50 shrink-0" />
                <SelectValue placeholder="Alle Assistenten" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Assistenten</SelectItem>
                <SelectItem value="1">Anna Schmidt</SelectItem>
                <SelectItem value="2">Max Mustermann</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Zeile 2: Aktionen Unten - extrem platzsparend */}
        <div className="flex items-center justify-between gap-1.5 w-full">
          
          {/* View Toggle */}
          <ToggleGroup type="single" value={view} onValueChange={(v) => v && setView(v)} className="bg-muted/50 p-0.5 rounded-md border border-border/50 shrink-0 h-9">
            <ToggleGroupItem value="list" aria-label="Listenansicht" className="h-full w-8 p-0 rounded-sm data-[state=on]:bg-white data-[state=on]:shadow-sm">
              <List className="h-4 w-4" />
            </ToggleGroupItem>
            <ToggleGroupItem value="calendar" aria-label="Monatsansicht" className="h-full w-8 p-0 rounded-sm data-[state=on]:bg-white data-[state=on]:shadow-sm">
              <CalendarDays className="h-4 w-4" />
            </ToggleGroupItem>
          </ToggleGroup>

          {/* Action Buttons Container */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Alle bestätigen */}
            <Button variant="outline" size="sm" className="h-9 w-9 px-0 bg-white relative shrink-0" title="Alle bestätigen" aria-label="Alle bestätigen">
              <Check className="h-4 w-4" />
              <span className="absolute -top-1.5 -right-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary/10 px-1 text-[10px] font-medium text-primary ring-1 ring-primary/20">
                3
              </span>
            </Button>

            {/* Monats-PDF */}
            <Button variant="outline" size="sm" className="h-9 w-9 px-0 bg-white shrink-0" title="Monats-PDF herunterladen" aria-label="Monats-PDF herunterladen">
              <Download className="h-4 w-4" />
            </Button>

            {/* Mehrfachauswahl */}
            <Button variant="outline" size="sm" className="h-9 w-9 px-0 bg-white shrink-0" title="Mehrfachauswahl" aria-label="Mehrfachauswahl">
              <CheckSquare className="h-4 w-4" />
            </Button>
          </div>

          {/* Monatswechsler (rechts außen) */}
          <div className="flex items-center justify-end shrink-0 ml-auto gap-0.5">
            <Button variant="ghost" size="sm" className="h-9 w-7 px-0 hover:bg-muted shrink-0" title="Vorheriger Monat" aria-label="Vorheriger Monat">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-xs sm:text-sm font-medium text-center tracking-tight truncate min-w-[64px]">
              Juli 2026
            </span>
            <Button variant="ghost" size="sm" className="h-9 w-7 px-0 hover:bg-muted shrink-0" title="Nächster Monat" aria-label="Nächster Monat">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

        </div>
      </div>

      {/* Content / Context Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-muted/10 pb-20">
        {DUMMY_SHIFTS.map((shift, idx) => {
          const showDateHeader = idx === 0 || shift.date !== DUMMY_SHIFTS[idx - 1].date;
          
          return (
            <div key={shift.id} className="space-y-2">
              {showDateHeader && (
                <h3 className="text-sm font-semibold text-muted-foreground pt-2 first:pt-0">
                  {shift.date}
                </h3>
              )}
              <div className="bg-card border border-border rounded-lg p-3 shadow-sm flex flex-col gap-1 cursor-pointer hover:border-primary/30 transition-colors">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{shift.name}</span>
                  <span className="text-xs font-mono text-muted-foreground">{shift.time}</span>
                </div>
                <div className={`text-xs px-2 py-0.5 rounded border inline-flex w-fit ${shift.color}`}>
                  {shift.type}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      
    </div>
  );
}
