import { execSync } from "node:child_process";
import {
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";

/**
 * Wiederverwendbare Test-Hilfen für das Aufsetzen von Teams, Assistenten und
 * Testdaten in den E2E-/API-Tests (Multi-Team, #44/#52).
 *
 * Kapselt das, was sonst in jedem Isolations-Test per Copy-Paste landet:
 * - Dienstleister-Login + accountType-Umschaltung (mit Rücksetzung im Cleanup),
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

export type AccountType = "privat" | "dienstleister";

type Entity = { id: number };
type LoginResponse = { id: number; accountType: AccountType };

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
  readonly ctx: APIRequestContext;
  adminId = 0;

  private originalAccountType: AccountType = "privat";
  private readonly teams: number[] = [];
  private readonly users: number[] = [];
  private readonly shifts: number[] = [];
  private readonly contracts: number[] = [];
  private readonly timeEntries: number[] = [];
  private readonly seededAdmins: SeededAdmin[] = [];

  private constructor(ctx: APIRequestContext, run: number) {
    this.ctx = ctx;
    this.run = run;
  }

  /**
   * Loggt den Setup-Admin ein und merkt sich dessen ID + ursprünglichen
   * Konto-Typ (für die Rücksetzung im Cleanup).
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
    h.originalAccountType = login.accountType;
    return h;
  }

  /** Schaltet den eingeloggten Admin auf accountType "dienstleister". */
  async becomeDienstleister(): Promise<void> {
    const res = await this.ctx.patch(`/api/users/${this.adminId}`, {
      data: { accountType: "dienstleister" },
    });
    expect(res.ok(), "Konto-Typ-Wechsel fehlgeschlagen").toBe(true);
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
   * Seedet einen zweiten echten Admin über das setup-admin-Skript und loggt ihn
   * in einem eigenen Request-Kontext ein. Da accountType + Rolle NICHT über die
   * öffentliche API gesetzt werden können, ist dies der einzige Weg an einen
   * zweiten Admin. Das Skript ist idempotent und legt KEIN Team an, solange
   * bereits Teams existieren -> der Admin ist Mitglied/Besitzer in keinem Team.
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
    const seedEnv: NodeJS.ProcessEnv = {
      ...process.env,
      ADMIN_EMAIL: email,
      ADMIN_PASSWORD: password,
      ADMIN_NAME: name,
    };
    if (process.env.E2E_TEST_DATABASE_URL) {
      seedEnv.DATABASE_URL = process.env.E2E_TEST_DATABASE_URL;
    }
    execSync("pnpm --filter @workspace/scripts run setup-admin", {
      env: seedEnv,
      stdio: "pipe",
    });

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
   * Setzt anschließend den Konto-Typ des Admins zurück und gibt alle Kontexte
   * frei. Fehlschläge einzelner Schritte blockieren die übrigen nicht.
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

    if (this.adminId && this.originalAccountType) {
      try {
        await this.ctx.patch(`/api/users/${this.adminId}`, {
          data: { accountType: this.originalAccountType },
        });
      } catch {
        /* ignore */
      }
    }

    await this.ctx.dispose();
  }
}
