import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  CalendarDays,
  Users,
  Clock,
  CalendarOff,
  BarChart3,
  Settings,
  Building2,
  Menu,
  LogOut,
} from "lucide-react";
import { Button } from "./ui/button";
import logoUrl from "@assets/Arbeitgebermodell oder Assistenzdienst.png";
import { Sheet, SheetContent, SheetTrigger } from "./ui/sheet";
import { useAuth } from "@/context/auth";
import { useToast } from "@/hooks/use-toast";
import { isEmbedded } from "@/lib/embed";

const ALL_NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, adminOnly: false, dienstleisterOnly: false },
  { href: "/dienstplan", label: "Dienstplan", icon: CalendarDays, adminOnly: false, dienstleisterOnly: false },
  { href: "/assistenten", label: "Assistenten", icon: Users, adminOnly: true, dienstleisterOnly: false },
  { href: "/zeiterfassung", label: "Zeiterfassung", icon: Clock, adminOnly: false, dienstleisterOnly: false },
  { href: "/abwesenheiten", label: "Abwesenheiten", icon: CalendarOff, adminOnly: true, dienstleisterOnly: false },
  { href: "/auswertungen", label: "Auswertungen", icon: BarChart3, adminOnly: true, dienstleisterOnly: false },
  { href: "/team-verwaltung", label: "Team-Verwaltung", icon: Building2, adminOnly: true, dienstleisterOnly: true },
  { href: "/einstellungen", label: "Einstellungen", icon: Settings, adminOnly: true, dienstleisterOnly: false },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { currentUser, logout } = useAuth();
  const { toast } = useToast();
  const embedded = isEmbedded();

  const navItems = ALL_NAV_ITEMS.filter(
    (item) =>
      (!item.adminOnly || currentUser?.role === "admin") &&
      (!item.dienstleisterOnly || currentUser?.accountType === "dienstleister")
  );

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      toast({ title: "Fehler beim Abmelden", variant: "destructive" });
    }
  };

  const NavLinks = ({ onNav }: { onNav?: () => void } = {}) => (
    <>
      {navItems.map((item) => (
        <Link key={item.href} href={item.href} onClick={onNav}>
          <div
            className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors cursor-pointer ${
              location === item.href
                ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            }`}
          >
            <item.icon className="h-4 w-4" />
            <span>{item.label}</span>
          </div>
        </Link>
      ))}
    </>
  );

  const UserSection = () => (
    <div className="pt-4 border-t border-sidebar-border space-y-3">
      <div className="px-3">
        <p className="text-sm font-medium text-sidebar-foreground leading-tight">{currentUser?.name}</p>
        <p className="text-xs text-sidebar-foreground/50 capitalize">
          {currentUser?.role === "admin" ? "Administrator" : "Assistent"}
        </p>
      </div>
      <button
        onClick={() => void handleLogout()}
        className="flex items-center gap-3 px-3 py-2 rounded-md w-full text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors text-sm"
      >
        <LogOut className="h-4 w-4" />
        <span>Abmelden</span>
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row font-sans text-foreground">
      {/* Mobile header */}
      <header className="md:hidden flex items-center justify-between p-4 border-b bg-sidebar text-sidebar-foreground">
        {embedded ? (
          <span />
        ) : (
          <img src={logoUrl} alt="AssistenzTreff" className="h-11 w-auto max-w-full object-contain" />
        )}
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-4 bg-sidebar text-sidebar-foreground border-sidebar-border flex flex-col">
            {!embedded && (
              <img src={logoUrl} alt="AssistenzTreff" className="h-12 w-auto max-w-full object-contain mb-6 self-start" />
            )}
            <nav className="flex flex-col gap-2 flex-1">
              <NavLinks />
            </nav>
            <UserSection />
          </SheetContent>
        </Sheet>
      </header>

      {/* Desktop sidebar - fest fixiert, volle Höhe */}
      <aside className="hidden md:flex md:flex-col md:fixed md:inset-y-0 md:left-0 md:w-64 md:h-screen border-r border-sidebar-border bg-sidebar p-6">
        {!embedded && (
          <img src={logoUrl} alt="AssistenzTreff" className="h-14 w-auto max-w-full object-contain mb-8 px-2 self-start shrink-0" />
        )}
        <nav className="flex flex-col gap-2 flex-1 min-h-0 overflow-y-auto">
          <NavLinks />
        </nav>
        <div className="shrink-0">
          <UserSection />
        </div>
      </aside>

      {/* Main content - unabhängig scrollbar, Platz für fixierte Sidebar */}
      <main className="flex-1 p-4 md:p-8 md:ml-64 overflow-y-auto">
        <div className="max-w-6xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
