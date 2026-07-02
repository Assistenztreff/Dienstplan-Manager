import { test, expect, type APIRequestContext } from "@playwright/test";
import { deleteFreeAccount, registerFreeAccount, type FreeAccount } from "./helpers/teams";

/**
 * API-Test für die SERVERSEITIG durchgesetzten Free-Limits (Task #205/#214).
 *
 * Die Free-Limits maxAssistants (6), maxTeams (1) und historyMonths (1) wurden
 * bisher nur manuell per curl verifiziert. Ein Refactor der users-/teams-/
 * shifts-Routen könnte die Durchsetzung still entfernen und Free-Konten wieder
 * über die API über ihre Limits hinaus lassen — genau die Lücke, die #205
 * geschlossen hat. Dieser Test sichert die Durchsetzung automatisiert ab.
 *
 * Wichtig: Der Setup-Admin wird von `setup-test-db` bewusst auf Premium gehoben,
 * damit die übrigen Specs nicht an Free-Limits scheitern. Die Free-Gates werden
 * deshalb mit FRISCH registrierten Konten getestet (`registerFreeAccount`), die
 * garantiert auf dem Free-Plan starten.
 *
 * Jeder Test prüft sowohl die erlaubte Grenze (Bestandsschutz) als auch das
 * Blockieren des ersten Schritts darüber hinaus (403 `plan_limit_reached`).
 */

type LimitError = { code?: string; limit?: string };

/**
 * Liefert den 15. eines Monats relativ zum aktuellen Monat (offset 0 = aktuell,
 * 1 = nächster Monat, -1 = Vormonat, 2 = übernächster Monat). Tag 15 ist robust
 * gegen Monatslängen und Zeitzonen-Verschiebungen an Monatsgrenzen.
 */
function monthDay(offset: number): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 15);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}-15`;
}

let accounts: FreeAccount[] = [];

/** Registriert ein Free-Konto und merkt es sich zum Aufräumen des Kontexts. */
async function freeAccount(accountType: "privat" | "dienstleister", label: string): Promise<FreeAccount> {
  const acc = await registerFreeAccount(accountType, label);
  accounts.push(acc);
  return acc;
}

test.afterEach(async () => {
  // Registrierte Konten samt Standard-Team + Daten per SQL-Bereinigung
  // entfernen (DELETE /api/users scheitert am Team-FK-Baum) und Kontext freigeben.
  for (const acc of accounts) {
    await deleteFreeAccount(acc);
  }
  accounts = [];
});

test("POST /api/users: 6 Assistenten erlaubt, der 7. wird im Free-Tarif mit 403 blockiert", async () => {
  const acc = await freeAccount("privat", "max-assistants");

  // Grenze (Bestandsschutz): die ersten 6 Assistenten werden angelegt.
  for (let i = 0; i < 6; i++) {
    const res = await acc.ctx.post("/api/users", {
      data: {
        name: `E2E Assistent ${i}`,
        email: `e2e.assi.${acc.id}.${i}@dienstplan.test`,
        role: "assistant",
      },
    });
    expect(res.status(), `Assistent ${i + 1} sollte 201 liefern`).toBe(201);
  }

  // Über dem Limit: der 7. Assistent wird mit 403 abgelehnt.
  const seventh = await acc.ctx.post("/api/users", {
    data: {
      name: "E2E Assistent 7",
      email: `e2e.assi.${acc.id}.6@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(seventh.status(), "7. Assistent sollte 403 liefern").toBe(403);
  const body = (await seventh.json()) as LimitError;
  expect(body.code).toBe("plan_limit_reached");
  expect(body.limit).toBe("maxAssistants");
});

test("POST /api/teams: das 2. Team wird im Free-Tarif mit 403 blockiert", async () => {
  // POST /teams verlangt requireDienstleister -> Dienstleister-Konto.
  const acc = await freeAccount("dienstleister", "max-teams");

  // Grenze (Bestandsschutz): die Registrierung hat bereits genau 1 Team angelegt
  // (= das erlaubte Free-Limit), das unangetastet sichtbar bleibt.
  const before = await acc.ctx.get("/api/teams");
  expect(before.ok(), "GET /api/teams fehlgeschlagen").toBe(true);
  const teams = (await before.json()) as { id: number }[];
  expect(teams.length, "Free-Konto sollte mit genau 1 Team starten").toBe(1);

  // Über dem Limit: das 2. Team wird mit 403 abgelehnt.
  const res = await acc.ctx.post("/api/teams", {
    data: { name: `E2E Zweites Team ${acc.id}` },
  });
  expect(res.status(), "2. Team sollte 403 liefern").toBe(403);
  const body = (await res.json()) as LimitError;
  expect(body.code).toBe("plan_limit_reached");
  expect(body.limit).toBe("maxTeams");

  // Bestandsschutz: das erste Team bleibt unverändert vorhanden.
  const after = await acc.ctx.get("/api/teams");
  expect(((await after.json()) as unknown[]).length).toBe(1);
});

test("POST /api/shifts: Vorausplanung im Free-Tarif begrenzt (aktuell + nächster Monat + Vergangenheit ok, 2 Monate voraus 403)", async () => {
  const acc = await freeAccount("privat", "history-months");

  // Assistent im Standard-Team anlegen (default teamId via resolveWriteTeamId).
  const userRes = await acc.ctx.post("/api/users", {
    data: {
      name: "E2E Hist Assistent",
      email: `e2e.hist.${acc.id}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(userRes.status(), "Assistent anlegen fehlgeschlagen").toBe(201);
  const assistantId = ((await userRes.json()) as { id: number }).id;

  const makeShift = (day: string) =>
    acc.ctx.post("/api/shifts", {
      data: {
        userId: assistantId,
        startTime: `${day}T08:00:00.000Z`,
        endTime: `${day}T16:00:00.000Z`,
        type: "active",
      },
    });

  // Erlaubte Grenzen (Bestandsschutz + Free-Limit historyMonths = 1):
  // aktueller Monat, nächster Monat und ein vergangener Monat sind erlaubt.
  const current = await makeShift(monthDay(0));
  expect(current.status(), "Aktueller Monat sollte 201 liefern").toBe(201);

  const next = await makeShift(monthDay(1));
  expect(next.status(), "Nächster Monat sollte 201 liefern").toBe(201);

  const past = await makeShift(monthDay(-1));
  expect(past.status(), "Vergangener Monat sollte 201 liefern (Bestandsschutz)").toBe(201);

  // Über dem Limit: zwei Monate voraus wird mit 403 abgelehnt.
  const future = await makeShift(monthDay(2));
  expect(future.status(), "2 Monate voraus sollte 403 liefern").toBe(403);
  const body = (await future.json()) as LimitError;
  expect(body.code).toBe("plan_limit_reached");
  expect(body.limit).toBe("historyMonths");
});

test("PATCH /api/shifts: eine erlaubt angelegte Schicht kann im Free-Tarif nicht per Edit weit in die Zukunft verschoben werden (Move-Forward-Bypass)", async () => {
  const acc = await freeAccount("privat", "history-months-patch");

  const userRes = await acc.ctx.post("/api/users", {
    data: {
      name: "E2E Hist Patch Assistent",
      email: `e2e.histpatch.${acc.id}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(userRes.status(), "Assistent anlegen fehlgeschlagen").toBe(201);
  const assistantId = ((await userRes.json()) as { id: number }).id;

  // Erlaubt angelegte Schicht im aktuellen Monat (innerhalb des Free-Fensters).
  const createRes = await acc.ctx.post("/api/shifts", {
    data: {
      userId: assistantId,
      startTime: `${monthDay(0)}T08:00:00.000Z`,
      endTime: `${monthDay(0)}T16:00:00.000Z`,
      type: "active",
    },
  });
  expect(createRes.status(), "Schicht im aktuellen Monat sollte 201 liefern").toBe(201);
  const shiftId = ((await createRes.json()) as { id: number }).id;

  // Bestandsschutz: Verschieben innerhalb des Fensters (nächster Monat) bleibt erlaubt.
  const withinRes = await acc.ctx.patch(`/api/shifts/${shiftId}`, {
    data: {
      startTime: `${monthDay(1)}T08:00:00.000Z`,
      endTime: `${monthDay(1)}T16:00:00.000Z`,
    },
  });
  expect(withinRes.status(), "Verschieben in den nächsten Monat sollte 200 liefern").toBe(200);

  // Move-Forward-Bypass: Verschieben über das Fenster hinaus (2 Monate voraus)
  // wird auch per PATCH mit 403 plan_limit_reached abgelehnt.
  const beyondRes = await acc.ctx.patch(`/api/shifts/${shiftId}`, {
    data: {
      startTime: `${monthDay(2)}T08:00:00.000Z`,
      endTime: `${monthDay(2)}T16:00:00.000Z`,
    },
  });
  expect(beyondRes.status(), "Verschieben 2 Monate voraus sollte 403 liefern").toBe(403);
  const beyondBody = (await beyondRes.json()) as LimitError;
  expect(beyondBody.code).toBe("plan_limit_reached");
  expect(beyondBody.limit).toBe("historyMonths");

  // Bestandsschutz: die Schicht steht weiterhin im erlaubten (nächsten) Monat,
  // der abgelehnte Verschiebe-Versuch hat nichts verändert.
  const checkRes = await acc.ctx.get(`/api/shifts/${shiftId}`);
  expect(checkRes.ok(), "GET der Schicht fehlgeschlagen").toBe(true);
  const shift = (await checkRes.json()) as { startTime: string };
  expect(
    shift.startTime.startsWith(monthDay(1).slice(0, 7)),
    "Abgelehntes PATCH darf die Schicht nicht verschoben haben",
  ).toBe(true);
});
