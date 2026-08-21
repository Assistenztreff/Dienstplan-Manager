import { useState } from "react";
import "./_group.css";

import {
  LayoutDashboard,
  CalendarDays,
  Users,
  CalendarOff,
  BarChart3,
  Settings,
  LogOut,
  UserRound,
  Plus,
  Pencil,
  Trash2,
  Building2,
  ArrowRightLeft,
  UserCog,
  ChevronDown,
  ChevronRight,
  Mail,
  Phone,
  MapPin,
  UserPlus,
  UserMinus,
  Send,
  Download,
  Ban,
  Calendar,
  ShieldCheck,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Statischer Nachbau der echten Team-Verwaltung (artifacts/dienstplan/src/
// pages/team-verwaltung.tsx + assistenzkraft-liste.tsx) im Mockup-Sandkasten.
// Alle API-/Auth-/Routing-Effekte sind durch realistische Mock-Daten ersetzt;
// Beschriftungen, Aktionen und Informationshierarchie bleiben originalgetreu.
// Sicht: Konto-Inhaber eines Dienstleister-Kontos (voller Admin) — so werden
// Team-Aktionen und der Teamkoordinatoren-Bereich sichtbar.
// ---------------------------------------------------------------------------

const BRAND = {
  cyan: "#3fb8cc",
  dark: "#092948",
  yellow: "#ebf18b",
};

const PLATFORM_LINKS = ["Über uns", "Handbuch", "Leistungen"];

const NAV_ITEMS = [
  { label: "Dashboard", icon: LayoutDashboard, active: false },
  { label: "Dienstplan", icon: CalendarDays, active: false },
  { label: "Assistenten", icon: Users, active: false },
  { label: "Abwesenheiten", icon: CalendarOff, active: false },
  { label: "Auswertungen", icon: BarChart3, active: false },
  { label: "Einstellungen", icon: Settings, active: true },
];

const FOOTER_LINKS = ["Impressum", "Datenschutz", "Kontakt", "Barrierefreiheit"];

// --- Mock-Daten ------------------------------------------------------------

type Vertrag = {
  weeklyHours: number;
  workdaysPerWeek: number;
  vacationDays: number;
  startDate: string;
  notes?: string;
};

type Assistenzkraft = {
  id: number;
  vorname: string;
  nachname: string;
  email: string;
  phone?: string;
  address?: string;
  isActive: boolean;
  isTeamleiter: boolean;
  contract?: Vertrag;
};

type MockTeam = {
  id: number;
  name: string;
  assistenzkraefte: Assistenzkraft[];
};

const TEAMS: MockTeam[] = [
  {
    id: 1,
    name: "Team Nord",
    assistenzkraefte: [
      {
        id: 11,
        vorname: "Lena",
        nachname: "Hoffmann",
        email: "lena.hoffmann@beispiel.de",
        phone: "0176 2345678",
        address: "Blumenweg 4, 24103 Kiel",
        isActive: true,
        isTeamleiter: true,
        contract: {
          weeklyHours: 30,
          workdaysPerWeek: 4,
          vacationDays: 24,
          startDate: "01.03.2023",
          notes: "Feste Nachtdienste am Wochenende.",
        },
      },
      {
        id: 12,
        vorname: "Jonas",
        nachname: "Weber",
        email: "jonas.weber@beispiel.de",
        phone: "0151 9876543",
        isActive: true,
        isTeamleiter: false,
        contract: {
          weeklyHours: 20,
          workdaysPerWeek: 3,
          vacationDays: 20,
          startDate: "15.09.2023",
        },
      },
      {
        id: 13,
        vorname: "Aylin",
        nachname: "Yıldız",
        email: "aylin.yildiz@beispiel.de",
        isActive: false,
        isTeamleiter: false,
      },
    ],
  },
  {
    id: 2,
    name: "Team Süd",
    assistenzkraefte: [
      {
        id: 21,
        vorname: "Marek",
        nachname: "Novak",
        email: "marek.novak@beispiel.de",
        phone: "0170 1122334",
        address: "Ringstraße 18, 81667 München",
        isActive: true,
        isTeamleiter: false,
        contract: {
          weeklyHours: 38.5,
          workdaysPerWeek: 5,
          vacationDays: 28,
          startDate: "01.01.2022",
        },
      },
      {
        id: 22,
        vorname: "Sophie",
        nachname: "Bauer",
        email: "sophie.bauer@beispiel.de",
        isActive: true,
        isTeamleiter: false,
      },
    ],
  },
];

type MockKoordinator = {
  id: number;
  name: string;
  email: string;
  isActive: boolean;
  hasLogin: boolean;
  teamIds: number[];
};

const KOORDINATOREN: MockKoordinator[] = [
  {
    id: 101,
    name: "Petra Schmidt",
    email: "petra.schmidt@beispiel.de",
    isActive: true,
    hasLogin: true,
    teamIds: [1],
  },
  {
    id: 102,
    name: "Daniel Krüger",
    email: "daniel.krueger@beispiel.de",
    isActive: true,
    hasLogin: false,
    teamIds: [1, 2],
  },
  {
    id: 103,
    name: "Miriam Voss",
    email: "miriam.voss@beispiel.de",
    isActive: false,
    hasLogin: true,
    teamIds: [2],
  },
];

// --- Kleine Bausteine (inline, Soft-UI) ------------------------------------

function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "primary" | "outline" | "danger";
}) {
  const toneStyle: React.CSSProperties =
    tone === "primary"
      ? { backgroundColor: BRAND.yellow, color: BRAND.dark }
      : tone === "danger"
        ? { backgroundColor: "hsl(var(--tm-destructive))", color: "#fff" }
        : tone === "outline"
          ? { backgroundColor: "transparent", color: BRAND.dark, boxShadow: "none", border: "1px solid rgba(9,41,72,0.25)" }
          : { backgroundColor: "#e6eaf2", color: BRAND.dark };
  return (
    <span
      className="neu-badge inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-medium"
      style={toneStyle}
    >
      {children}
    </span>
  );
}

function NeuButton({
  children,
  variant = "outline",
  size = "md",
  title,
  className = "",
}: {
  children: React.ReactNode;
  variant?: "outline" | "primary" | "ghost";
  size?: "sm" | "md";
  title?: string;
  className?: string;
}) {
  const base =
    "inline-flex items-center justify-center gap-1.5 font-medium transition-colors focus-visible:outline-none";
  const sizing = size === "sm" ? "min-h-9 px-3 text-xs" : "min-h-11 px-4 text-sm";
  const chrome =
    variant === "primary"
      ? "neu-btn-primary font-semibold"
      : variant === "ghost"
        ? "rounded-xl hover:bg-black/5"
        : "neu-btn";
  return (
    <button type="button" title={title} className={`${base} ${sizing} ${chrome} ${className}`}>
      {children}
    </button>
  );
}

function NeuSwitch({ checked }: { checked: boolean }) {
  return (
    <span
      role="switch"
      aria-checked={checked}
      className="neu-switch relative inline-flex h-6 w-11 shrink-0 items-center px-0.5"
      data-checked={checked ? "true" : "false"}
    >
      <span
        className="neu-switch__thumb block h-5 w-5"
        style={{ transform: checked ? "translateX(20px)" : "translateX(0)" }}
      />
    </span>
  );
}

// --- Assistenzkraft-Karte (personalakte) -----------------------------------

function InfoRow({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-[hsl(var(--tm-muted-foreground))]">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function AssistenzkraftKarte({ person }: { person: Assistenzkraft }) {
  const c = person.contract;
  return (
    <div className="neu-card flex flex-col overflow-hidden">
      {/* Kopf: Name + Kontaktdaten + Status-Badges */}
      <div className="flex items-start justify-between gap-3 px-5 py-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold leading-tight">
            {person.vorname} {person.nachname}
          </h3>
          <div className="mt-1.5 flex items-center gap-1.5 text-xs text-[hsl(var(--tm-muted-foreground))]">
            <Mail className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{person.email}</span>
          </div>
          {person.phone && (
            <div className="mt-1 flex items-center gap-1.5 text-xs text-[hsl(var(--tm-muted-foreground))]">
              <Phone className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span>{person.phone}</span>
            </div>
          )}
          {person.address && (
            <div className="mt-1 flex items-center gap-1.5 text-xs text-[hsl(var(--tm-muted-foreground))]">
              <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{person.address}</span>
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge tone={person.isActive ? "primary" : "neutral"}>
            {person.isActive ? "Aktiv" : "Inaktiv"}
          </Badge>
          {person.isTeamleiter && (
            <Badge tone="outline">
              <ShieldCheck className="h-3 w-3" aria-hidden="true" />
              Teamleiter
            </Badge>
          )}
        </div>
      </div>

      {/* Vertragsdaten */}
      <div className="flex flex-1 flex-col justify-between gap-4 px-5 pb-5">
        {c ? (
          <div className="space-y-2.5">
            <InfoRow label="Wochenstunden" value={`${c.weeklyHours} h`} />
            <InfoRow label="Arbeitstage/Woche" value={`${c.workdaysPerWeek} Tage`} />
            <InfoRow label="Urlaubsanspruch" value={`${c.vacationDays} Tage`} />
            <InfoRow
              label={
                <span className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" aria-hidden="true" /> Seit
                </span>
              }
              value={c.startDate}
            />
            {c.notes && (
              <p className="border-t border-black/10 pt-1 text-xs text-[hsl(var(--tm-muted-foreground))]">
                {c.notes}
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-black/15 px-3 py-4 text-center text-sm text-[hsl(var(--tm-muted-foreground))]">
            Arbeitszeiten sind noch nicht hinterlegt. Du kannst sie beim Bearbeiten ergänzen.
          </div>
        )}

        {/* Aktionen */}
        <div className="flex flex-wrap justify-end gap-2 border-t border-black/10 pt-3">
          <NeuButton variant="ghost" size="sm" title="Stundennachweis als PDF exportieren">
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Nachweis</span>
          </NeuButton>
          <NeuButton variant="ghost" size="sm" title="Einladungslink generieren">
            <Send className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Einladen</span>
          </NeuButton>
          <NeuButton size="sm">
            <Pencil className="h-3.5 w-3.5" />
            Bearbeiten
          </NeuButton>
          <NeuButton variant="ghost" size="sm" title="Aus diesem Team entfernen">
            <UserMinus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Aus Team entfernen</span>
          </NeuButton>
        </div>
      </div>
    </div>
  );
}

// --- Assistenzkräfte-Liste eines Teams -------------------------------------

function AssistenzkraftListe({ team }: { team: MockTeam }) {
  const count = team.assistenzkraefte.length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[hsl(var(--tm-muted-foreground))]">
          {count} {count === 1 ? "Assistenzkraft" : "Assistenzkräfte"}
        </p>
        <NeuButton variant="primary">
          <UserPlus className="h-4 w-4" />
          Assistenzkraft anlegen
        </NeuButton>
      </div>

      {count === 0 ? (
        <div className="neu-inset p-12 text-center">
          <p className="mb-4 text-[hsl(var(--tm-muted-foreground))]">
            Noch keine Assistenzkräfte in diesem Team.
          </p>
          <NeuButton>
            <UserPlus className="h-4 w-4" /> Erste Assistenzkraft anlegen
          </NeuButton>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {team.assistenzkraefte.map((p) => (
            <AssistenzkraftKarte key={p.id} person={p} />
          ))}
        </div>
      )}
    </div>
  );
}

// --- Team-Block (aufklappbar mit Aktionen) ---------------------------------

function TeamBlock({
  team,
  showTransfer,
  expanded,
  onToggle,
}: {
  team: MockTeam;
  showTransfer: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="neu-card overflow-hidden">
      {/* Kopfzeile: aufklappbarer Titel + Team-Aktionen */}
      <div className="flex flex-wrap items-center gap-2 border-b border-black/10 px-4 py-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex min-h-11 flex-1 items-center gap-2 rounded-md px-1 text-left transition-colors hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#092948]"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-[hsl(var(--tm-muted-foreground))]" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-[hsl(var(--tm-muted-foreground))]" aria-hidden="true" />
          )}
          <Building2 className="h-4 w-4 shrink-0 text-[hsl(var(--tm-muted-foreground))]/70" aria-hidden="true" />
          <span className="truncate font-medium">{team.name}</span>
        </button>

        <div className="flex flex-wrap items-center gap-2">
          {showTransfer && (
            <NeuButton size="sm" title="Assistenzkraft in ein anderes Team überführen">
              <ArrowRightLeft className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Überführen</span>
            </NeuButton>
          )}
          <NeuButton size="sm" title="Zugriffsrechte der Mitglieder verwalten">
            <UserCog className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Zugriffsrechte</span>
          </NeuButton>
          <NeuButton size="sm">
            <Pencil className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Bearbeiten</span>
          </NeuButton>
          <NeuButton variant="ghost" size="sm">
            <Trash2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Löschen</span>
          </NeuButton>
        </div>
      </div>

      {expanded && (
        <div className="p-4">
          <AssistenzkraftListe team={team} />
        </div>
      )}
    </div>
  );
}

// --- Teamkoordinatoren-Bereich ---------------------------------------------

function KoordinatorKarte({ k }: { k: MockKoordinator }) {
  const vorname = k.name.split(" ")[0] ?? k.name;
  return (
    <div className="neu-card p-4">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{k.name}</span>
          <span className="text-xs text-[hsl(var(--tm-muted-foreground))]">{k.email}</span>
          {!k.isActive ? (
            <Badge tone="danger">Gesperrt</Badge>
          ) : k.hasLogin ? (
            <Badge tone="neutral">Zugang aktiv</Badge>
          ) : (
            <Badge tone="outline">Noch kein Zugang</Badge>
          )}

          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <NeuButton
              size="sm"
              title={
                k.isActive
                  ? "Einladungslink für den eigenen Zugang generieren"
                  : "Zugang ist gesperrt — erst entsperren"
              }
            >
              <Mail className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Einladen</span>
            </NeuButton>
            <NeuButton
              size="sm"
              title={
                k.isActive
                  ? "Zugang sperren — die Person kann sich nicht mehr anmelden"
                  : "Zugang wieder entsperren"
              }
            >
              <Ban className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{k.isActive ? "Sperren" : "Entsperren"}</span>
            </NeuButton>
            <NeuButton
              variant="ghost"
              size="sm"
              title="Koordinator entfernen — Eintrag, Team-Zuweisungen und Zugang werden gelöscht"
              className="text-[hsl(var(--tm-destructive))]"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Entfernen</span>
            </NeuButton>
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-xs text-[hsl(var(--tm-muted-foreground))]">
            Zugewiesene Teams — dort hat {vorname} Teamleiter-Rechte:
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {TEAMS.map((team) => (
              <label key={team.id} className="flex cursor-pointer items-center gap-2">
                <NeuSwitch checked={k.teamIds.includes(team.id)} />
                <span className="text-sm">{team.name}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function KoordinatorenBereich() {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-serif text-lg font-bold" style={{ color: BRAND.dark }}>
            Teamkoordinatoren
          </h3>
          <p className="mt-0.5 text-sm text-[hsl(var(--tm-muted-foreground))]">
            Verwaltungspersonen mit eigenem Zugang — sie planen und verwalten die Teams, die du
            ihnen zuweist, tauchen aber nicht als Assistenzkraft im Dienstplan auf.
          </p>
        </div>
        <NeuButton title="Einladungslink für den eigenen Zugang generieren">
          <UserPlus className="h-4 w-4" />
          <span className="hidden sm:inline">Koordinator anlegen</span>
          <span className="sm:hidden">Neu</span>
        </NeuButton>
      </div>

      <div className="space-y-3">
        {KOORDINATOREN.map((k) => (
          <KoordinatorKarte key={k.id} k={k} />
        ))}
      </div>
    </section>
  );
}

// --- Seite -----------------------------------------------------------------

export function Current() {
  const [expanded, setExpanded] = useState<Record<number, boolean>>({ 1: true, 2: true });

  function toggle(id: number) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <div className="team-mgmt-neu flex min-h-screen w-full flex-col font-sans" style={{ color: BRAND.dark }}>
      {/* Plattform-Header (Cyan) */}
      <header className="flex h-20 shrink-0 items-center" style={{ backgroundColor: BRAND.cyan }}>
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-6 px-6">
          <a
            href="#"
            className="flex h-12 items-center gap-2.5 rounded-md px-2 text-white outline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
          >
            <span
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-lg font-bold"
              style={{ color: BRAND.dark }}
              aria-hidden="true"
            >
              A
            </span>
            <span className="text-xl font-bold tracking-tight">AssistenzPlaner</span>
          </a>

          <nav aria-label="Plattform" className="flex items-center gap-2">
            {PLATFORM_LINKS.map((label) => (
              <a
                key={label}
                href="#"
                className="hidden h-12 items-center rounded-md px-4 text-sm font-medium text-white hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white md:flex"
              >
                {label}
              </a>
            ))}
            <a
              href="#"
              className="flex h-12 items-center gap-1.5 rounded-md px-4 text-sm font-medium text-white hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            >
              <UserRound className="h-4 w-4" aria-hidden="true" />
              Profil
            </a>
            <a
              href="#"
              className="flex h-12 items-center gap-1.5 rounded-md px-4 text-sm font-semibold text-white hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Abmelden
            </a>
          </nav>
        </div>
      </header>

      {/* App-Menüleiste */}
      <div className="shrink-0 border-b border-slate-300/60" style={{ backgroundColor: "#f3f4f6" }}>
        <div className="mx-auto max-w-7xl px-6">
          <nav aria-label="Dienstplan-App" className="flex flex-wrap items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.label}
                type="button"
                aria-current={item.active ? "page" : undefined}
                className={`flex h-12 items-center gap-2 px-4 text-base transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#092948] ${
                  item.active
                    ? "font-semibold"
                    : "font-medium text-slate-600 hover:bg-slate-200 hover:text-slate-900"
                }`}
                style={item.active ? { backgroundColor: BRAND.yellow, color: BRAND.dark } : undefined}
              >
                <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Hauptcontent */}
      <main className="flex-1">
        <div className="mx-auto w-full max-w-7xl space-y-6 px-6 py-8">
          {/* Seitentitel + Neues Team */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="font-serif text-2xl font-bold md:text-3xl" style={{ color: BRAND.dark }}>
                Team-Verwaltung
              </h1>
              <p className="mt-1 text-sm text-[hsl(var(--tm-muted-foreground))]">
                Teams und Assistenzkräfte verwalten
              </p>
            </div>
            <NeuButton variant="primary">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Neues Team</span>
              <span className="sm:hidden">Neu</span>
            </NeuButton>
          </div>

          {/* Team-Blöcke */}
          <div className="space-y-4">
            {TEAMS.map((team) => (
              <TeamBlock
                key={team.id}
                team={team}
                showTransfer={TEAMS.length > 1}
                expanded={expanded[team.id] !== false}
                onToggle={() => toggle(team.id)}
              />
            ))}
          </div>

          {/* Teamkoordinatoren */}
          <KoordinatorenBereich />

          {/* Fußhinweis */}
          <p className="text-xs text-[hsl(var(--tm-muted-foreground))]">
            Teams strukturieren Assistenzkräfte und Dienstpläne. Ein Team kann nur gelöscht werden,
            wenn ihm keine Mitglieder oder Daten mehr zugeordnet sind. Ein Teamwechsel läuft immer
            über „Überführen“ — so wandern die Daten der Assistenzkraft in einem Schritt mit.
          </p>
        </div>
      </main>

      {/* Plattform-Footer */}
      <footer className="shrink-0 border-t border-slate-300/60" style={{ backgroundColor: "#f3f4f6" }}>
        <div className="mx-auto flex w-full max-w-7xl items-center justify-center px-6 py-6">
          <nav aria-label="Rechtliches" className="flex flex-wrap items-center justify-center gap-1">
            {FOOTER_LINKS.map((label, i) => (
              <span key={label} className="flex items-center">
                {i > 0 && <span className="px-1 text-slate-400">·</span>}
                <a
                  href="#"
                  className="flex h-11 items-center rounded-md px-2 text-sm font-medium text-slate-600 hover:text-[#092948] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#092948]"
                >
                  {label}
                </a>
              </span>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  );
}
