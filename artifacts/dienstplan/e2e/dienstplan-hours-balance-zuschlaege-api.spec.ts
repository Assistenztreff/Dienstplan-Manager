import { test, expect } from "@playwright/test";
import {
  TeamTestHarness,
  addTeamMemberViaDb,
  deleteFreeAccount,
  registerFreeAccount,
  type FreeAccount,
} from "./helpers/teams";

/**
 * API-E2E-Beweis: Der Admin-Zweig von GET /api/dashboard/hours-balance lädt die
 * richtigen Roh-Kennzahlen aus der DB (richtige Schichten/Zeiteinträge je Team
 * und Monat) und wendet die konfigurierten Zuschlags-Prozentsätze korrekt auf
 * die GESPEICHERTEN Roh-Stunden an.
 *
 * Die reine Summierungslogik (computeHoursBalanceRow) ist per Unit-Test
 * abgesichert; hier wird der ungetestete DB-Lade-/Scoping-Pfad des
 * Route-Handlers gegen den echten Server geprüft.
 *
 * Aufbau (fester Monat Oktober 2026, keine "aktueller Monat"-Flakes):
 * - Eigene Zuschlags-Prozente werden VOR dem Anlegen der Schichten gesetzt
 *   (Nacht 30 %, Sonntag 60 %, Feiertag 90 %, Nachtfenster 22:00-06:00) und im
 *   Cleanup wiederhergestellt. Die Einstellungen sind PRO KONTO gespeichert
 *   (owner_id = Admin-Konto) — die Mutation betrifft also nur den Test-Admin,
 *   das Restore ist reine Hygiene für nachfolgende Specs desselben Admins.
 * - Team A mit Assistent A bekommt drei FIX-Schichten, die jeweils genau einen
 *   Zuschlags-Topf treffen:
 *   - Nachtdienst  Mi 07.10. 20:00 -> Do 08.10. 06:00 (10h, Nachtstunden > 0)
 *   - Sonntag      So 04.10. 08:00-16:00 (8h, Sonntagsstunden > 0)
 *   - Feiertag     Sa 03.10. 08:00-14:00 (6h, Tag der Deutschen Einheit,
 *     bundesweit -> Feiertagsstunden > 0 unabhängig vom Bundesland)
 * - Stördaten, die bei einem Scoping-Fehler auffallen MÜSSEN (alle bewusst
 *   Sonntage 08:00-16:00, ein Leak würde sundayHours/plannedHours aufblähen):
 *   - Team B mit eigenem Assistenten B + Sonntagsschicht am 04.10. (fremdes Team)
 *   - Assistent A: Sonntagsschicht am 15.11. (falscher Monat)
 * - Ist-Zeiten Assistent A im Oktober: 8h bestätigt + 4h offen -> nur die
 *   bestätigten 8h dürfen als workedHours zählen (hours-balance ist immer
 *   strikt, unabhängig vom Plan).
 * - Vertrag für Assistent A (28 Urlaubstage) -> Vertragsauflösung des Handlers.
 *
 * Erwartungswerte werden aus den GESPEICHERTEN Roh-Kennzahlen der Schichten
 * (GET /api/shifts/:id) abgeleitet — genau das ist der Vertrag des Endpunkts:
 * Zuschlagsstunden = gespeicherte Roh-Stunden x aktueller Prozentsatz. Die
 * Korrektheit der Roh-Berechnung selbst ist separat abgesichert (Task #127).
 */

const YEAR = 2026;
const MONTH = 10;

const NIGHT_PERCENT = 30;
const SUNDAY_PERCENT = 60;
const HOLIDAY_PERCENT = 90;

const round2 = (n: number) => Math.round(n * 100) / 100;

interface StoredShiftMetrics {
  valuedHours: number;
  nightHours: number;
  sundayHours: number;
  holidayHours: number;
}

interface BalanceRow {
  userId: number;
  plannedHours: number;
  workedHours: number;
  valuedHours: number;
  nightHours: number;
  nightSurchargeHours: number;
  sundayHours: number;
  sundaySurchargeHours: number;
  holidayHours: number;
  holidaySurchargeHours: number;
  nightPercent: number;
  sundayPercent: number;
  holidayPercent: number;
  vacationDaysUsed: number;
  vacationDaysRemaining: number;
}

let h: TeamTestHarness;
let teamA: number;
let teamB: number;
let assistantA: number;
let assistantB: number;
let nightShiftId: number;
let sundayShiftId: number;
let holidayShiftId: number;
let foreignShiftId: number;
let originalAllowance: Record<string, unknown> | null = null;
let foreignAccount: FreeAccount | null = null;

async function fetchStoredMetrics(shiftId: number): Promise<StoredShiftMetrics> {
  const res = await h.ctx.get(`/api/shifts/${shiftId}`);
  expect(res.ok(), `Schicht ${shiftId} laden fehlgeschlagen (${res.status()})`).toBe(true);
  const body = (await res.json()) as Partial<StoredShiftMetrics>;
  return {
    valuedHours: body.valuedHours ?? 0,
    nightHours: body.nightHours ?? 0,
    sundayHours: body.sundayHours ?? 0,
    holidayHours: body.holidayHours ?? 0,
  };
}

test.beforeAll(async () => {
  h = await TeamTestHarness.login();
  await h.becomeDienstleister();

  // Prozente + Nachtfenster VOR dem Anlegen der Schichten setzen: das Fenster
  // bestimmt die gespeicherten Roh-Nachtstunden, die Prozente werden erst beim
  // Abruf (rückwirkend) angewandt. Original merken für die Wiederherstellung.
  const getRes = await h.ctx.get("/api/allowance-settings");
  expect(getRes.ok(), "Zuschlags-Einstellungen laden fehlgeschlagen").toBe(true);
  originalAllowance = (await getRes.json()) as Record<string, unknown>;
  const putRes = await h.ctx.put("/api/allowance-settings", {
    data: {
      nightPercent: NIGHT_PERCENT,
      sundayPercent: SUNDAY_PERCENT,
      holidayPercent: HOLIDAY_PERCENT,
      nightStart: "22:00",
      nightEnd: "06:00",
    },
  });
  expect(putRes.ok(), "Zuschlags-Einstellungen setzen fehlgeschlagen").toBe(true);

  teamA = await h.createTeam(`E2E Zuschlag A ${h.run}`);
  teamB = await h.createTeam(`E2E Zuschlag B ${h.run}`);
  assistantA = await h.createUser({ teamId: teamA, role: "assistant" });
  assistantB = await h.createUser({ teamId: teamB, role: "assistant" });

  await h.createContract(teamA, assistantA, {
    weeklyHours: 40,
    vacationDays: 28,
    startDate: "2026-01-01",
  });

  // Drei FIX-Schichten (Default), je genau ein Zuschlags-Topf.
  nightShiftId = await h.createShift(teamA, assistantA, "2026-10-07", {
    startTime: "2026-10-07T20:00:00.000Z",
    endTime: "2026-10-08T06:00:00.000Z",
  });
  sundayShiftId = await h.createShift(teamA, assistantA, "2026-10-04", {
    startTime: "2026-10-04T08:00:00.000Z",
    endTime: "2026-10-04T16:00:00.000Z",
  });
  holidayShiftId = await h.createShift(teamA, assistantA, "2026-10-03", {
    startTime: "2026-10-03T08:00:00.000Z",
    endTime: "2026-10-03T14:00:00.000Z",
  });

  // Stördaten: fremdes Team (gleicher Monat) + falscher Monat (gleiches Team).
  foreignShiftId = await h.createShift(teamB, assistantB, "2026-10-04", {
    startTime: "2026-10-04T08:00:00.000Z",
    endTime: "2026-10-04T16:00:00.000Z",
  });
  await h.createShift(teamA, assistantA, "2026-11-15", {
    startTime: "2026-11-15T08:00:00.000Z",
    endTime: "2026-11-15T16:00:00.000Z",
  });

  // Ist-Zeiten: 8h werden bestätigt, 4h bleiben offen (dürfen nicht zählen).
  const confirmedEntry = await h.createTimeEntry(teamA, assistantA, "2026-10-06", {
    actualStart: "2026-10-06T08:00:00.000Z",
    actualEnd: "2026-10-06T16:00:00.000Z",
  });
  await h.createTimeEntry(teamA, assistantA, "2026-10-07", {
    actualStart: "2026-10-07T08:00:00.000Z",
    actualEnd: "2026-10-07T12:00:00.000Z",
  });
  const confirmRes = await h.ctx.patch(`/api/time-tracking/${confirmedEntry}/confirm`, {
    data: { status: "confirmed", confirmedBy: h.adminId },
  });
  expect(confirmRes.ok(), `Ist-Zeit bestätigen fehlgeschlagen (${confirmRes.status()})`).toBe(true);
});

test.afterAll(async () => {
  // Registriertes Fremdkonto samt Standard-Team per SQL-Bereinigung entfernen
  // (DELETE /api/users scheitert am Team-FK-Baum).
  await deleteFreeAccount(foreignAccount);
  // Zuschlags-Einstellungen des Test-Admins zurücksetzen (pro Konto gespeichert;
  // Hygiene für nachfolgende Specs), bevor die Fixture-Daten fallen.
  if (originalAllowance) {
    try {
      await h.ctx.put("/api/allowance-settings", {
        data: {
          nightPercent: originalAllowance.nightPercent,
          sundayPercent: originalAllowance.sundayPercent,
          holidayPercent: originalAllowance.holidayPercent,
          nightStart: originalAllowance.nightStart,
          nightEnd: originalAllowance.nightEnd,
        },
      });
    } catch {
      /* Best effort — Cleanup darf nicht am Restore scheitern. */
    }
  }
  await h.cleanup();
});

test.describe("hours-balance: Aggregation der Roh-Kennzahlen zu Zuschlägen", () => {
  test("summiert gespeicherte Roh-Stunden des richtigen Teams/Monats und wendet die konfigurierten Prozente an", async () => {
    // Gespeicherte Roh-Kennzahlen der drei relevanten Schichten laden — daraus
    // ergeben sich die Erwartungswerte für die Aggregation.
    const night = await fetchStoredMetrics(nightShiftId);
    const sunday = await fetchStoredMetrics(sundayShiftId);
    const holiday = await fetchStoredMetrics(holidayShiftId);

    // Sanity: jede Fixture-Schicht trifft ihren Zuschlags-Topf wirklich —
    // sonst würde der Test die Prozent-Anwendung an 0-Werten "beweisen".
    expect(night.nightHours).toBeGreaterThan(0);
    expect(sunday.sundayHours).toBeGreaterThan(0);
    expect(holiday.holidayHours).toBeGreaterThan(0);

    const expectedValued = night.valuedHours + sunday.valuedHours + holiday.valuedHours;
    const expectedNight = night.nightHours + sunday.nightHours + holiday.nightHours;
    const expectedSunday = night.sundayHours + sunday.sundayHours + holiday.sundayHours;
    const expectedHoliday = night.holidayHours + sunday.holidayHours + holiday.holidayHours;

    const res = await h.ctx.get(
      `/api/dashboard/hours-balance?teamId=${teamA}&month=${MONTH}&year=${YEAR}`,
    );
    expect(res.ok(), `hours-balance fehlgeschlagen (${res.status()})`).toBe(true);
    const rows = (await res.json()) as BalanceRow[];

    // Genau eine Zeile: der Assistent aus Team A. Assistent B (Team B) und der
    // Admin selbst (kein "assistant") dürfen nicht auftauchen.
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.userId).toBe(assistantA);

    // Roh-Summen = exakt die gespeicherten Werte der drei Oktober-Schichten in
    // Team A. Die Sonntags-Störschichten (Team B am 04.10., Team A am 15.11.)
    // würden bei einem Scoping-Fehler sundayHours/plannedHours aufblähen.
    expect(row.valuedHours).toBeCloseTo(round2(expectedValued), 2);
    expect(row.nightHours).toBeCloseTo(round2(expectedNight), 2);
    expect(row.sundayHours).toBeCloseTo(round2(expectedSunday), 2);
    expect(row.holidayHours).toBeCloseTo(round2(expectedHoliday), 2);
    expect(row.plannedHours).toBeCloseTo(24, 2); // 10h + 8h + 6h

    // Zuschlagsstunden = Roh-Stunden x konfigurierter Prozentsatz.
    expect(row.nightPercent).toBe(NIGHT_PERCENT);
    expect(row.sundayPercent).toBe(SUNDAY_PERCENT);
    expect(row.holidayPercent).toBe(HOLIDAY_PERCENT);
    expect(row.nightSurchargeHours).toBeCloseTo(
      round2((expectedNight * NIGHT_PERCENT) / 100),
      2,
    );
    expect(row.sundaySurchargeHours).toBeCloseTo(
      round2((expectedSunday * SUNDAY_PERCENT) / 100),
      2,
    );
    expect(row.holidaySurchargeHours).toBeCloseTo(
      round2((expectedHoliday * HOLIDAY_PERCENT) / 100),
      2,
    );

    // Ist-Zeiten: nur der BESTÄTIGTE 8h-Eintrag zählt, der offene 4h-Eintrag
    // nicht (hours-balance ist plan-unabhängig strikt).
    expect(row.workedHours).toBeCloseTo(8, 2);

    // Vertragsauflösung: aktiver Vertrag des Assistenten liefert die Urlaubstage.
    expect(row.vacationDaysUsed).toBe(0);
    expect(row.vacationDaysRemaining).toBe(28);
  });

  test("Gegenprobe Team B: enthält nur die eigene Schicht, nichts aus Team A", async () => {
    const foreign = await fetchStoredMetrics(foreignShiftId);

    const res = await h.ctx.get(
      `/api/dashboard/hours-balance?teamId=${teamB}&month=${MONTH}&year=${YEAR}`,
    );
    expect(res.ok(), `hours-balance (Team B) fehlgeschlagen (${res.status()})`).toBe(true);
    const rows = (await res.json()) as BalanceRow[];

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.userId).toBe(assistantB);

    // Nur die eine Sonntagsschicht aus Team B — keine Nacht-/Feiertagsstunden
    // aus Team A dürfen hier durchsickern.
    expect(row.sundayHours).toBeCloseTo(round2(foreign.sundayHours), 2);
    expect(row.sundaySurchargeHours).toBeCloseTo(
      round2((foreign.sundayHours * SUNDAY_PERCENT) / 100),
      2,
    );
    expect(row.nightHours).toBeCloseTo(0, 2);
    expect(row.holidayHours).toBeCloseTo(0, 2);
    expect(row.plannedHours).toBeCloseTo(8, 2);
  });

  test("Mandanten-Isolation: fremdes Konto sieht Default-Prozente, nicht die mutierten Werte", async () => {
    // Der Test-Admin hat oben 30/60/90 gesetzt. Ein FRISCH registriertes,
    // fremdes Admin-Konto muss trotzdem die Defaults (25/50/100) sehen — vor
    // Task #288 waren die Settings eine globale Singleton-Zeile, die JEDER
    // Admin für ALLE Konten überschreiben konnte.
    foreignAccount = await registerFreeAccount("privat", "allowance-isolation");

    const res = await foreignAccount.ctx.get("/api/allowance-settings");
    expect(res.ok(), `GET allowance-settings (Fremdkonto) fehlgeschlagen (${res.status()})`).toBe(
      true,
    );
    const settings = (await res.json()) as {
      nightPercent: number;
      sundayPercent: number;
      holidayPercent: number;
      nightStart: string;
      nightEnd: string;
    };
    expect(settings.nightPercent).toBe(25);
    expect(settings.sundayPercent).toBe(50);
    expect(settings.holidayPercent).toBe(100);
    expect(settings.nightStart).toBe("23:00");
    expect(settings.nightEnd).toBe("06:00");

    // Gegenrichtung: Mutation durch das Fremdkonto darf den Test-Admin nicht treffen.
    const putRes = await foreignAccount.ctx.put("/api/allowance-settings", {
      data: {
        nightPercent: 11,
        nightStart: "21:00",
        nightEnd: "05:00",
        sundayPercent: 22,
        holidayPercent: 33,
        state: null,
      },
    });
    expect(putRes.ok(), `PUT allowance-settings (Fremdkonto) fehlgeschlagen (${putRes.status()})`).toBe(
      true,
    );

    const ownRes = await h.ctx.get("/api/allowance-settings");
    expect(ownRes.ok()).toBe(true);
    const own = (await ownRes.json()) as { nightPercent: number; sundayPercent: number };
    expect(own.nightPercent).toBe(NIGHT_PERCENT);
    expect(own.sundayPercent).toBe(SUNDAY_PERCENT);
  });

  test("Fremdes Team ohne Settings-Zeile: Defaults gelten, nie die Prozente des Anfragers", async () => {
    // Kanten-Fall aus dem Review: Der Eigentümer eines fremden Teams hat noch
    // KEINE allowance_settings-Zeile (wird erst lazy bei GET angelegt). Wertet
    // der Test-Admin (Mitglied, eigene Prozente 30/60/90) dieses Team aus,
    // müssen die DEFAULTS (Sonntag 50 %) gelten — niemals seine eigenen Sätze.
    const owner = await registerFreeAccount("dienstleister", "allowance-norow");
    try {
      // WICHTIG: kein GET /allowance-settings über owner.ctx — sonst würde die
      // Zeile lazy angelegt und der Kanten-Fall wäre weg.
      const teamsRes = await owner.ctx.get("/api/teams");
      expect(teamsRes.ok(), `GET /teams (Eigentümer) fehlgeschlagen (${teamsRes.status()})`).toBe(
        true,
      );
      const ownerTeams = (await teamsRes.json()) as Array<{ id: number }>;
      expect(ownerTeams.length).toBeGreaterThan(0);
      const foreignTeam = ownerTeams[0].id;

      // Test-Admin als Mitglied aufnehmen, damit er das Team auswerten darf.
      // DB-direkt: Die Members-API nimmt aus Sicherheitsgründen nur Nutzer aus
      // Teams DESSELBEN Eigentümers an (Annexions-Schutz); der hier geprüfte
      // Kanten-Fall einer fremden Mitgliedschaft ist ein historischer/DB-
      // seitiger Zustand, den die Auswertung dennoch korrekt behandeln muss.
      addTeamMemberViaDb(foreignTeam, h.adminId);

      // Assistent + FIX-Sonntagsschicht (So 03.05.2026, 8h) im fremden Team —
      // vergangener Monat, damit das Free-historyMonths-Limit nicht greift.
      const assistantRes = await owner.ctx.post("/api/users", {
        data: {
          name: "E2E NoRow Assistent",
          email: `e2e.norow.${Date.now()}@dienstplan.test`,
          role: "assistant",
          teamId: foreignTeam,
        },
      });
      expect(assistantRes.ok(), `Assistent anlegen fehlgeschlagen (${assistantRes.status()})`).toBe(
        true,
      );
      const assistantId = ((await assistantRes.json()) as { id: number }).id;

      const shiftRes = await owner.ctx.post("/api/shifts", {
        data: {
          userId: assistantId,
          teamId: foreignTeam,
          startTime: "2026-05-03T08:00:00.000Z",
          endTime: "2026-05-03T16:00:00.000Z",
          type: "active",
        },
      });
      expect(shiftRes.ok(), `Schicht anlegen fehlgeschlagen (${shiftRes.status()})`).toBe(true);

      // Auswertung durch den Test-Admin (Mitglied): Sonntagszuschlag muss mit
      // dem DEFAULT (50 %) berechnet sein, nicht mit seinen eigenen 60 %.
      const res = await h.ctx.get(
        `/api/dashboard/hours-balance?teamId=${foreignTeam}&month=5&year=2026`,
      );
      expect(res.ok(), `hours-balance (fremdes Team) fehlgeschlagen (${res.status()})`).toBe(true);
      const rows = (await res.json()) as BalanceRow[];
      const row = rows.find((r) => r.userId === assistantId);
      expect(row, "Zeile des fremden Assistenten fehlt").toBeTruthy();
      expect(row!.sundayHours).toBeGreaterThan(0);
      expect(row!.sundaySurchargeHours).toBeCloseTo(
        round2((row!.sundayHours * 50) / 100),
        2,
      );
      // Gegenprobe: mit den Anfrager-Prozenten (60 %) wäre der Wert ein anderer.
      expect(row!.sundaySurchargeHours).not.toBeCloseTo(
        round2((row!.sundayHours * SUNDAY_PERCENT) / 100),
        2,
      );
    } finally {
      // Mitgliedschaft des Test-Admins wieder entfernen, damit nachfolgende
      // Specs keinen erweiterten Team-Scope sehen; danach Konto + Team +
      // Daten per SQL-Bereinigung entfernen (DELETE /api/users scheitert am
      // Team-FK-Baum).
      try {
        const teamsRes = await owner.ctx.get("/api/teams");
        if (teamsRes.ok()) {
          const ownerTeams = (await teamsRes.json()) as Array<{ id: number }>;
          for (const t of ownerTeams) {
            await owner.ctx.delete(`/api/teams/${t.id}/members/${h.adminId}`);
          }
        }
      } catch {
        /* ignore */
      }
      await deleteFreeAccount(owner);
    }
  });
});
