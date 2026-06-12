import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  CalendarDays, 
  Users, 
  Clock, 
  BarChart3,
  Menu
} from "lucide-react";
import { Button } from "./ui/button";
import { Sheet, SheetContent, SheetTrigger } from "./ui/sheet";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dienstplan", label: "Dienstplan", icon: CalendarDays },
  { href: "/assistenten", label: "Assistenten", icon: Users },
  { href: "/zeiterfassung", label: "Zeiterfassung", icon: Clock },
  { href: "/auswertungen", label: "Auswertungen", icon: BarChart3 },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const NavLinks = ({ onNav }: { onNav?: () => void } = {}) => (
    <>
      {NAV_ITEMS.map((item) => (
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

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row font-sans text-foreground">
      {/* Mobile header */}
      <header className="md:hidden flex items-center justify-between p-4 border-b bg-sidebar text-sidebar-foreground">
        <h1 className="font-serif text-xl font-semibold text-sidebar-foreground">Dienstplan PA</h1>
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-4 bg-sidebar text-sidebar-foreground border-sidebar-border">
            <h2 className="font-serif text-lg font-semibold text-sidebar-foreground mb-6">Dienstplan PA</h2>
            <nav className="flex flex-col gap-2">
              <NavLinks />
            </nav>
          </SheetContent>
        </Sheet>
      </header>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-64 border-r border-sidebar-border bg-sidebar p-6">
        <h1 className="font-serif text-2xl font-semibold text-sidebar-foreground mb-8 px-2">Dienstplan PA</h1>
        <nav className="flex flex-col gap-2 flex-1">
          <NavLinks />
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-4 md:p-8 overflow-auto">
        <div className="max-w-6xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
