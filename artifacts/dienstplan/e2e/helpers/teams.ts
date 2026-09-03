import {
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";
import {
  dbAddTeamMember,
  dbDeleteAccountByEmail,
  dbMarkEmailVerified,
  dbSeedAdmin,
  dbSetAccountPlan,
  dbSetUserActive,
} from "./db";

/**
 * Wiederverwendbare Test-Hilfen für das Aufsetzen von Teams, Assistenten und
 * Testdaten in den E2E-/API-Tests (Multi-Team, #44/#52).
 *
 * Kapselt das, was sonst in jedem Isolations-Test per Copy-Paste landet:
 * - Dienstleister-Kontext über ein FRISCH registriertes Dienstleister-Konto
 *   (accountType ist seit dem Lockdown NICHT mehr per API änderbar),
 * - Team-/Nutzer-/Schicht-/Vertrags-/Ist-Zeit-Erstellung (mit Tracking),
 * - FK-sicheres Cleanup (erst Daten, dann Nutzer, dann Teams),
 * - das Seeden eines zweiten "fremden" Admins über das setup-admin-Skript
 *   (accountType + Rolle lassen sich NICHT über die öffentliche API setzen).
 *
 * Typische Nutzung:
 *
 *   let h: TeamTestHarness;
 *   test.beforeAll(async () => {
 *     h = await TeamTestHarness.login();
 *     await h.becomeDienstleister();
 *     const teamA = await h.createTeam("Team A");
 *     const alice = await h.createUser({ teamId: teamA, role: "assistant" });
 *     const shiftA = await h.createShift(teamA, alice, "2026-07-01");
 *   });
 *   test.afterAll(async () => { await h.cleanup(); });
 */

export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
export const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

/** Passwort aller über `registerFreeAccount` registrierten Test-Konten. */
export const FREE_ACCOUNT_PASSWORD = "free12345";

export type AccountType = "privat" | "dienstleister";

type Entity = { id: number };
type LoginResponse = { id: number; accountType: AccountType };

/** Ein frisch über /api/auth/register angelegtes Free-Konto inkl. Session-Kontext. */
export interface FreeAccount {
  ctx: APIRequestContext;
  id: number;
  email: string;
}

/**
 * Registriert über den öffentlichen Self-Service ein FRISCHES Konto und gibt
 * dessen eingeloggten Request-Kontext zurück.
 *
 * Hintergrund: Der Setup-Admin (`admin@dienstplan.local`) wird von
 * `setup-test-db` bewusst auf `plan = 'premium'` gehoben, damit die übrigen
 * E2E-Specs nicht an Free-Limits scheitern. Zum Testen der Free-Gates braucht es
 * daher ein frisch registriertes Konto, das garantiert auf dem Free-Plan startet
 * (Premium wird nur manuell im Operator-Dashboard freigeschaltet).
 *
 * Die Registrierung legt serverseitig direkt ein „Standard-Team" an (owner =
 * neues Konto, inkl. Mitgliedschaft), sodass `resolveWriteTeamId` ohne explizite
 * `teamId` greift — POST /users und POST /shifts funktionieren also ohne dass der
 * Test die Team-ID kennen muss (GET /teams ist für `privat`-Konten ohnehin
 * gesperrt).
 */
export async function registerFreeAccount(
  accountType: AccountType = "privat",
  label = "free",
): Promise<FreeAccount> {
  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const email = `e2e.${label}.${stamp}@dienstplan.test`;
  const res = await ctx.post("/api/auth/register", {
    data: {
      name: `E2E ${label} ${stamp}`,
      email,
      password: FREE_ACCOUNT_PASSWORD,
      accountType,
    },
  });
  expect(res.status(), `Registrierung fehlgeschlagen (${res.status()})`).toBe(201);
  const body = (await res.json()) as { id: number; plan: string; emailVerificationSent?: boolean };
  // Absicherung: Ein frisch registriertes Konto MUSS auf dem Free-Plan starten,
  // sonst würden die Free-Gate-Assertions dieses Specs nichts beweisen.
  expect(body.plan, "Frisch registriertes Konto muss Free sein").toBe("free");
  // Wenn RESEND_API_KEY gesetzt ist, setzt die Registrierung emailVerified=false
  // und legt keine Session an. Im Test-Stack brauchen wir immer ein sofort
  // nutzbares Konto — daher direkt verifizieren und einloggen, damit ctx eine
  // echte Session hat und API-Calls nicht mit 401/403 scheitern.
  if (body.emailVerificationSent) {
    await dbMarkEmailVerified(email);
    const loginRes = await ctx.post("/api/auth/login", {
      data: { email, password: FREE_ACCOUNT_PASSWORD },
    });
    expect(
      loginRes.status(),
      `Auto-Login nach E-Mail-Verifikation fehlgeschlagen (${loginRes.status()})`,
    ).toBe(200);
  }
  return { ctx, id: body.id, email };
}

/**
 * Hebt ein bestehendes Konto direkt in der (Test-)DB auf einen Plan
 * (`premium` | `free`) — der einzige Weg, eine manuelle Premium-Freischaltung
 * im Test nachzustellen (in Produktion erfolgt sie im Operator-Dashboard, kein
 * Stripe). Laeuft in-process gegen die Test-DB (`E2E_TEST_DATABASE_URL`,
 * Fallback `DATABASE_URL`) — frueher ein ~3s teurer Skript-Spawn pro Aufruf.
 */
export async function setAccountPlan(
  email: string,
  plan: "premium" | "free",
): Promise<void> {
  await dbSetAccountPlan(email, plan);
}

/**
 * Aktiviert den konto-weiten Schalter „Zeiterfassung aktivieren" für das
 * eingeloggte Admin-Konto des übergebenen Kontexts (Standard ist AUS, alle
 * Schreibrouten der Zeiterfassung antworten sonst 403 `time_tracking_disabled`).
 *
 * Liest zuerst die aktuellen Einstellungen und schreibt sie unverändert mit
 * `timeTrackingEnabled: true` zurück, damit keine Zuschlags-Werte des Specs
 * überschrieben werden.
 */
export async function enableTimeTracking(ctx: APIRequestContext): Promise<void> {
  const getRes = await ctx.get("/api/allowance-settings");
  expect(getRes.ok(), `Zuschlags-Einstellungen lesen fehlgeschlagen (${getRes.status()})`).toBe(true);
  const s = (await getRes.json()) as {
    nightPercent: number;
    nightStart: string;
    nightEnd: string;
    sundayPercent: number;
    holidayPercent: number;
  };
  const putRes = await ctx.put("/api/allowance-settings", {
    data: {
      nightPercent: s.nightPercent,
      nightStart: s.nightStart,
      nightEnd: s.nightEnd,
      sundayPercent: s.sundayPercent,
      holidayPercent: s.holidayPercent,
      timeTrackingEnabled: true,
    },
  });
  expect(putRes.ok(), `Zeiterfassung aktivieren fehlgeschlagen (${putRes.status()})`).toBe(true);
}

/**
 * Fügt eine Team-Mitgliedschaft direkt in der (Test-)DB ein. Nur für Specs,
 * die den Kanten-Fall einer MANDANTENÜBERGREIFENDEN Mitgliedschaft brauchen:
 * POST /api/teams/:id/members nimmt aus Sicherheitsgründen nur Nutzer aus
 * Teams desselben Eigentümers an (Schutz vor Annexion per ID-Enumeration),
 * historische/DB-seitige Fremd-Mitgliedschaften sind aber weiterhin ein
 * gültiger Zustand, den die Auswertungs-Routen korrekt behandeln müssen.
 * Idempotent; nutzt dasselbe DB-Targeting wie `setAccountPlan` (in-process).
 */
export async function addTeamMemberViaDb(
  teamId: number,
  userId: number,
): Promise<void> {
  await dbAddTeamMember(teamId, userId);
}

/**
 * Löscht ein (Test-)Konto samt Standard-Team + team-gebundener Daten direkt in
 * der (Test-)DB — der einzige zuverlässige Weg für selbst-registrierte Konten:
 * `DELETE /api/users/:id` scheitert dort am FK-Baum des bei der Registrierung
 * angelegten „Standard-Teams" (teams.owner_id kaskadiert zwar, aber
 * shift_models/shifts/contracts/time_tracking referenzieren teams.id OHNE
 * Cascade — allein die 4 geseedeten Schichtmodelle blockieren jedes Konto).
 * Nutzt dasselbe DB-Targeting wie `setAccountPlan` (in-process). Idempotent.
 */
export async function deleteAccountByEmail(email: string): Promise<void> {
  await dbDeleteAccountByEmail(email);
}

/**
 * Best-effort-Cleanup für ein via `registerFreeAccount` angelegtes Konto:
 * entfernt Konto + Standard-Team + team-gebundene Daten + verwaiste
 * Assistenten aus der Test-DB und gibt den Request-Kontext frei. Für
 * `afterAll` gedacht — Fehler werden geschluckt, damit das Cleanup andere
 * Schritte nie blockiert.
 */
export async function deleteFreeAccount(acc: FreeAccount | undefined): Promise<void> {
  if (!acc) return;
  try {
    await deleteAccountByEmail(acc.email);
  } catch {
    /* Best effort — Testlauf nicht am Cleanup scheitern lassen. */
  }
  try {
    await acc.ctx.dispose();
  } catch {
    /* ignore */
  }
}

/** Ein über das setup-admin-Skript geseedeter, "fremder" Admin (ohne Teams). */
export interface SeededAdmin {
  ctx: APIRequestContext;
  id: number;
  email: string;
  password: string;
}

export interface CreateUserInput {
  name?: string;
  email?: string;
  role?: "admin" | "assistant";
  /** Optionale Team-Zuordnung (Mitgliedschaft) für den neuen Nutzer. */
  teamId?: number;
}

export interface ShiftOptions {
  type?: string;
  startTime?: string;
  endTime?: string;
}

export interface ContractOptions {
  weeklyHours?: number;
  vacationDays?: number;
  startDate?: string;
}

export interface TimeEntryOptions {
  actualStart?: string;
  actualEnd?: string;
}

/**
 * Bündelt einen eingeloggten Dienstleister-Kontext, alle erzeugten Testdaten
 * (zur FK-sicheren Bereinigung) und etwaige geseedete Fremd-Admins.
 */
export class TeamTestHarness {
  /** Eindeutiger Suffix, damit parallele/wiederholte Läufe nicht kollidieren. */
  readonly run: number;
  /**
   * Aktiver Request-Kontext. Nach `becomeDienstleister()` ist dies der Kontext
   * des frisch registrierten Dienstleister-Kontos (NICHT mehr der Setup-Admin).
   */
  ctx: APIRequestContext;
  adminId = 0;
  /** Zugangsdaten des aktiven Kontos (z.B. für programmatische Browser-Logins). */
  email: string = ADMIN_EMAIL;
  password: string = ADMIN_PASSWORD;

  /** Ursprünglicher Setup-Admin-Kontext (zum Freigeben im Cleanup). */
  private baseCtx: APIRequestContext;
  private dienstleisterEmail: string | null = null;
  private readonly teams: number[] = [];
  private readonly users: number[] = [];
  private readonly shifts: number[] = [];
  private readonly contracts: number[] = [];
  private readonly timeEntries: number[] = [];
  private readonly seededAdmins: SeededAdmin[] = [];
  /** Zeiterfassung ist konto-weit standardmäßig AUS — pro aktivem Konto einmal aktivieren. */
  private timeTrackingEnabled = false;

  private constructor(ctx: APIRequestContext, run: number) {
    this.ctx = ctx;
    this.baseCtx = ctx;
    this.run = run;
  }

  /**
   * Loggt den Setup-Admin ein und merkt sich dessen ID.
   */
  static async login(): Promise<TeamTestHarness> {
    const run = Date.now();
    const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    const loginRes = await ctx.post("/api/auth/login", {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(loginRes.ok(), "Admin-Login fehlgeschlagen").toBe(true);
    const login = (await loginRes.json()) as LoginResponse;

    const h = new TeamTestHarness(ctx, run);
    h.adminId = login.id;
    return h;
  }

  /**
   * Stellt einen Dienstleister-Kontext bereit, indem ein FRISCHES
   * Dienstleister-Konto registriert und (per set-plan-Skript direkt in der
   * Test-DB) auf Premium gehoben wird. Der aktive Kontext des Harness
   * (`ctx`, `adminId`, `email`, `password`) wechselt auf dieses Konto.
   *
   * Hintergrund: `accountType` ist seit dem Security-Lockdown über
   * PATCH /api/users NICHT mehr änderbar (403) — der frühere Weg, den
   * Setup-Admin umzuschalten, existiert nicht mehr. Premium ist nötig, damit
   * die Specs (wie zuvor mit dem Premium-Setup-Admin) mehrere Teams,
   * mehr als 6 Assistenten und Schichten in der Zukunft anlegen können.
   * Das Konto samt Datenbaum wird im `cleanup()` wieder entfernt.
   */
  async becomeDienstleister(): Promise<void> {
    const acc = await registerFreeAccount("dienstleister", "harness");
    await setAccountPlan(acc.email, "premium");
    this.dienstleisterEmail = acc.email;
    this.ctx = acc.ctx;
    this.adminId = acc.id;
    this.email = acc.email;
    this.password = FREE_ACCOUNT_PASSWORD;
    // Kontextwechsel = anderes Konto → Zeiterfassung dort ggf. neu aktivieren.
    this.timeTrackingEnabled = false;
  }

  async createTeam(name?: string): Promise<number> {
    const res = await this.ctx.post("/api/teams", {
      data: { name: name ?? `E2E Team ${this.run}-${this.teams.length}` },
    });
    expect(res.ok(), `Team anlegen fehlgeschlagen (${res.status()})`).toBe(true);
    const id = ((await res.json()) as Entity).id;
    this.teams.push(id);
    return id;
  }

  async createUser(input: CreateUserInput = {}): Promise<number> {
    const suffix = `${this.run}-${this.users.length}`;
    const data: Record<string, unknown> = {
      name: input.name ?? `E2E Nutzer ${suffix}`,
      email: input.email ?? `e2e.user.${suffix}@dienstplan.test`,
      role: input.role ?? "assistant",
    };
    if (input.teamId != null) data.teamId = input.teamId;

    const res = await this.ctx.post("/api/users", { data });
    expect(res.ok(), `Nutzer anlegen fehlgeschlagen (${res.status()})`).toBe(true);
    const id = ((await res.json()) as Entity).id;
    this.users.push(id);
    return id;
  }

  async createShift(
    teamId: number,
    userId: number,
    day: string,
    opts: ShiftOptions = {},
  ): Promise<number> {
    const res = await this.ctx.post("/api/shifts", {
      data: {
        userId,
        teamId,
        startTime: opts.startTime ?? `${day}T08:00:00.000Z`,
        endTime: opts.endTime ?? `${day}T16:00:00.000Z`,
        type: opts.type ?? "active",
      },
    });
    expect(res.ok(), `Schicht anlegen fehlgeschlagen (${res.status()})`).toBe(true);
    const id = ((await res.json()) as Entity).id;
    this.shifts.push(id);
    return id;
  }

  async createContract(
    teamId: number,
    userId: number,
    opts: ContractOptions = {},
  ): Promise<number> {
    const res = await this.ctx.post("/api/contracts", {
      data: {
        userId,
        teamId,
        weeklyHours: opts.weeklyHours ?? 40,
        vacationDays: opts.vacationDays ?? 30,
        startDate: opts.startDate ?? "2026-01-01",
      },
    });
    expect(res.ok(), `Vertrag anlegen fehlgeschlagen (${res.status()})`).toBe(true);
    const id = ((await res.json()) as Entity).id;
    this.contracts.push(id);
    return id;
  }

  async createTimeEntry(
    teamId: number,
    userId: number,
    day: string,
    opts: TimeEntryOptions = {},
  ): Promise<number> {
    // Konto-Schalter „Zeiterfassung aktivieren" (Standard AUS) einmal pro
    // aktivem Konto einschalten, sonst 403 `time_tracking_disabled`.
    if (!this.timeTrackingEnabled) {
      await enableTimeTracking(this.ctx);
      this.timeTrackingEnabled = true;
    }
    const res = await this.ctx.post("/api/time-tracking", {
      data: {
        userId,
        teamId,
        actualStart: opts.actualStart ?? `${day}T08:00:00.000Z`,
        actualEnd: opts.actualEnd ?? `${day}T16:00:00.000Z`,
      },
    });
    expect(res.ok(), `Ist-Zeit anlegen fehlgeschlagen (${res.status()})`).toBe(true);
    const id = ((await res.json()) as Entity).id;
    this.timeEntries.push(id);
    return id;
  }

  /**
   * Seedet einen zweiten echten Admin direkt in der (Test-)DB und loggt ihn
   * in einem eigenen Request-Kontext ein. Da accountType + Rolle NICHT über die
   * öffentliche API gesetzt werden können, ist dies der einzige Weg an einen
   * zweiten Admin. Idempotent; legt KEIN Team an, solange bereits Teams
   * existieren -> der Admin ist Mitglied/Besitzer in keinem Team.
   */
  async seedForeignAdmin(
    opts: { email?: string; password?: string; name?: string } = {},
  ): Promise<SeededAdmin> {
    const email = opts.email ?? `e2e.attacker.${this.run}@dienstplan.test`;
    const password = opts.password ?? "attacker1234";
    const name = opts.name ?? `E2E Attacker ${this.run}`;

    // Gegen den isolierten Test-Stack muss der Admin in die `_test`-DB geseedet
    // werden (sonst landet er via Dev-`DATABASE_URL` in der falschen DB und der
    // Login gegen die Test-DB schlägt fehl). Die Config stellt die Test-DB-URL
    // als `E2E_TEST_DATABASE_URL` bereit; gegen einen externen Stack (Proxy/Dev)
    // ist sie nicht gesetzt und die vorhandene `DATABASE_URL` greift.
    // In-process (Verhalten identisch zum setup-admin-Skript, ohne Spawn-Kosten).
    await dbSeedAdmin(email, password, name);

    const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    const loginRes = await ctx.post("/api/auth/login", {
      data: { email, password },
    });
    expect(loginRes.ok(), "Fremd-Admin-Login fehlgeschlagen").toBe(true);
    const me = await ctx.get("/api/auth/me");
    const id = ((await me.json()) as Entity).id;

    const seeded: SeededAdmin = { ctx, id, email, password };
    this.seededAdmins.push(seeded);
    return seeded;
  }

  /**
   * Best-effort-Cleanup in FK-sicherer Reihenfolge: erst Daten (Ist-Zeiten,
   * Verträge, Schichten), dann geseedete Fremd-Admins, dann Nutzer, dann Teams.
   * Entfernt anschließend das ggf. registrierte Dienstleister-Konto samt
   * Datenbaum per SQL-Bereinigung und gibt alle Kontexte frei. Fehlschläge
   * einzelner Schritte blockieren die übrigen nicht.
   */
  async cleanup(): Promise<void> {
    const tryDelete = async (path: string) => {
      try {
        await this.ctx.delete(path);
      } catch {
        /* ignore */
      }
    };

    for (const id of this.timeEntries) await tryDelete(`/api/time-tracking/${id}`);
    for (const id of this.contracts) await tryDelete(`/api/contracts/${id}`);
    for (const id of this.shifts) await tryDelete(`/api/shifts/${id}`);

    // Fremd-Admins können nur gelöscht werden, wenn sie in einem erlaubten Team
    // liegen (IDOR-Schutz auf DELETE /users). Kurz dem ersten Team zuweisen,
    // dann löschen (cascade entfernt die Mitgliedschaft wieder).
    const anchorTeam = this.teams[0];
    for (const admin of this.seededAdmins) {
      if (anchorTeam) {
        try {
          await this.ctx.post(`/api/teams/${anchorTeam}/members`, {
            data: { userId: admin.id },
          });
        } catch {
          /* ignore */
        }
      }
      await tryDelete(`/api/users/${admin.id}`);
      await admin.ctx.dispose();
    }

    for (const id of this.users) await tryDelete(`/api/users/${id}`);
    for (const id of this.teams) await tryDelete(`/api/teams/${id}`);

    // Das für den Dienstleister-Kontext registrierte Konto samt Standard-Team
    // und restlichem Datenbaum entfernen (DELETE /api/users scheitert dort am
    // FK-Baum des bei der Registrierung angelegten Teams).
    if (this.dienstleisterEmail) {
      try {
        await deleteAccountByEmail(this.dienstleisterEmail);
      } catch {
        /* ignore */
      }
    }

    if (this.ctx !== this.baseCtx) {
      try {
        await this.ctx.dispose();
      } catch {
        /* ignore */
      }
    }
    await this.baseCtx.dispose();
  }
}

/**
 * Schaltet „Mit Vertretungen planen" fuer das Konto (oder ein Team) ein.
 *
 * Seit dem 03.09.2026 haengt der Vertretungsplatz im Raster NICHT mehr am
 * einzelnen Dienst, sondern an dieser Team-Einstellung — ein Spec, das
 * `standbySlot: true` am Schichtmodell setzt, bekommt ohne diesen Aufruf keine
 * Vertretungszeile und keine vorgemerkte Vertretung mehr.
 *
 * PUT /allowance-settings ist ein VOLL-Ersetzen: Die fuenf Zuschlagsfelder
 * sind im Schema Pflicht. Der Helfer liest deshalb erst den aktuellen Stand
 * und schickt ihn unveraendert mit, genau wie das Einstellungs-Formular.
 */
export async function setVertretungEnabled(
  ctx: APIRequestContext,
  wert: boolean,
  teamId?: number,
): Promise<void> {
  const url =
    teamId === undefined
      ? "/api/allowance-settings"
      : `/api/allowance-settings?teamId=${teamId}`;
  const gelesen = await ctx.get(url);
  expect(gelesen.ok(), `${url}: ${await gelesen.text()}`).toBe(true);
  const aktuell = (await gelesen.json()) as {
    nightPercent: number;
    nightStart: string;
    nightEnd: string;
    sundayPercent: number;
    holidayPercent: number;
  };
  const res = await ctx.put(url, {
    data: {
      nightPercent: aktuell.nightPercent,
      nightStart: aktuell.nightStart,
      nightEnd: aktuell.nightEnd,
      sundayPercent: aktuell.sundayPercent,
      holidayPercent: aktuell.holidayPercent,
      vertretungEnabled: wert,
    },
  });
  expect(res.ok(), `${url}: ${await res.text()}`).toBe(true);
}
