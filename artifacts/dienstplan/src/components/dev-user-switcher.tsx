import { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { useAuth, type AuthUser } from "@/context/auth";

// Dezenter Dev-only Umschalter, um schnell als anderer vorhandener Test-Nutzer
// zu agieren (Assistent / zweiter Admin / anderer Mandant). Wird durch den
// `import.meta.env.DEV`-Guard im Production-Build vollständig entfernt.
export function DevUserSwitcher() {
  if (!import.meta.env.DEV) return null;
  return <DevUserSwitcherInner />;
}

function roleLabel(u: AuthUser): string {
  if (u.role === "assistant") return "Assistent";
  return u.accountType === "dienstleister" ? "Admin · Dienstleister" : "Admin · Privat";
}

function DevUserSwitcherInner() {
  const { currentUser, devListUsers, devSwitchUser } = useAuth();
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void devListUsers().then((list) => {
      if (!cancelled) setUsers(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (users.length === 0) return null;

  const handleSwitch = async (value: string) => {
    const id = Number(value);
    if (!Number.isFinite(id) || id === currentUser?.id) return;
    setSwitching(true);
    try {
      await devSwitchUser(id);
      // Sauberer Neustart, damit alle teams-/rollengebundenen Queries neu laden.
      window.location.reload();
    } catch {
      setSwitching(false);
    }
  };

  return (
    <div className="hidden items-center gap-1.5 md:flex">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Dev</span>
      <Select
        value={currentUser ? String(currentUser.id) : undefined}
        onValueChange={(v) => void handleSwitch(v)}
        disabled={switching}
      >
        <SelectTrigger className="h-8 w-auto min-w-[10rem] text-xs" aria-label="Test-Nutzer wechseln">
          <SelectValue placeholder="Test-Nutzer wählen" />
        </SelectTrigger>
        <SelectContent>
          {users.map((u) => (
            <SelectItem key={u.id} value={String(u.id)}>
              {u.name} ({roleLabel(u)})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
