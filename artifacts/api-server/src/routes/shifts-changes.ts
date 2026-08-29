// ---------------------------------------------------------------------------
// Letzte Aenderung je Dienst — Grundlage der Korrektur-Anzeige (Kay-Entscheidung
// 28.08.2026: Korrekturen des Planers gelten sofort, statt auf eine
// Rueckbestaetigung zu warten).
// ---------------------------------------------------------------------------
// Vorher war der Status ANGEBOTEN das Erkennungsmerkmal einer Korrektur. Da der
// Dienst jetzt bestaetigt bleibt, braucht die Oberflaeche eine eigene Quelle:
// welcher Dienst wurde zuletzt wodurch geaendert. Genau eine Zeile je Dienst —
// die juengste; die vollstaendige Historie bleibt in shift_changes und ist fuer
// den spaeteren Monats-Export gedacht, nicht fuer diese Ansicht.
//
// Sichtbarkeit: Team-Scope wie ueberall. Wer NICHT planen darf, sieht
// ausschliesslich die eigenen Zeilen — eine Assistenzkraft hat keinen Anlass,
// die Zeitkorrekturen ihrer Kolleginnen zu sehen.
// ---------------------------------------------------------------------------

import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { ListShiftChangesQueryParams, ListShiftChangeHistoryQueryParams } from "@workspace/api-zod";
import { requireAuth } from "../middleware/auth";
import { resolveReadTeamScope, parseTeamIdParam, getEffectiveAdminTeamIds } from "../lib/teams";

const router = Router();

// Muss VOR /shifts/:id stehen (s. Reihenfolgen-Hinweis in routes/index.ts).
router.get("/shifts/changes", requireAuth, async (req, res): Promise<void> => {
  const query = ListShiftChangesQueryParams.safeParse({
    teamId: req.query.teamId ? Number(req.query.teamId) : undefined,
  });
  if (!query.success) {
    res.status(400).json({ error: "Invalid query parameters" });
    return;
  }

  const userId = req.session.userId!;
  const teamScope = await resolveReadTeamScope(userId, parseTeamIdParam(req));
  if (teamScope === null) {
    res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
    return;
  }
  if (teamScope.length === 0) {
    res.json([]);
    return;
  }

  // Planungsrechte entscheiden ueber die Reichweite, nicht die Rolle allein:
  // dieselbe Quelle wie beim Annehmen/Widersprechen von Meldungen.
  const adminTeams = await getEffectiveAdminTeamIds(userId, req.session.role!);
  const darfPlanen = teamScope.some((t) => adminTeams.includes(t));

  // DISTINCT ON: juengste Zeile je Dienst. Bewusst als SQL statt zweier
  // Abfragen — die Menge waechst mit jeder Korrektur und soll nicht erst
  // vollstaendig in den Server geladen werden.
  const rows = await db.execute<{
    shift_id: number;
    change_source: string;
    changed_by: number;
    created_at: string;
    user_id: number;
  }>(sql`
    SELECT DISTINCT ON (shift_id)
      shift_id, change_source, changed_by, created_at, user_id
    FROM shift_changes
    WHERE team_id IN (${sql.join(teamScope.map((t) => sql`${t}`), sql`, `)})
      -- Zeilen geloeschter Dienste tragen shift_id = NULL (Loeschschutz,
      -- s. shift_changes.ts). Sie gehoeren in den Export, nicht in die
      -- Korrektur-Kennzeichnung eines Dienstplans, den es nicht mehr gibt;
      -- DISTINCT ON wuerde sie ausserdem alle zu einer Zeile zusammenfassen.
      AND shift_id IS NOT NULL
      ${darfPlanen ? sql`` : sql`AND user_id = ${userId}`}
    ORDER BY shift_id, id DESC
  `);

  res.json(
    rows.rows.map((r) => ({
      shiftId: Number(r.shift_id),
      changeSource: r.change_source,
      changedBy: Number(r.changed_by),
      userId: Number(r.user_id),
      createdAt: new Date(r.created_at).toISOString(),
    })),
  );
});

// ---------------------------------------------------------------------------
// Vollstaendige Historie eines Monats — Datenquelle des Vormonats-Blocks im
// Stundenlisten-Export (Stufe 4).
// ---------------------------------------------------------------------------
// Anders als /shifts/changes liefert diese Route JEDE Aenderung, nicht nur die
// juengste je Dienst: ein Dienst, der dreimal korrigiert wurde, hat drei
// Zeilen. Genau das macht die Aenderung nachvollziehbar (alter Wert, neuer
// Wert, wer, wann) und ist der Grund, warum das Excel die Anzeige ist und
// nicht der Speicherort — ein ueberschriebener Dienst waere ohne diese Tabelle
// unwiederbringlich weg.
//
// Monatszuordnung ueber das DIENST-Datum aus dem Snapshot, nicht ueber
// created_at: eine Korrektur im August an einem Juli-Dienst gehoert in den
// Juli-Block. `before ODER after im Monat` deckt zusaetzlich den Fall ab, dass
// ein Dienst ueber die Monatsgrenze verschoben wurde — er taucht dann in
// beiden Monaten auf, jeweils mit beiden Werten.
router.get("/shifts/changes/history", requireAuth, async (req, res): Promise<void> => {
  const query = ListShiftChangeHistoryQueryParams.safeParse({
    teamId: req.query.teamId ? Number(req.query.teamId) : undefined,
    month: req.query.month ? Number(req.query.month) : undefined,
    year: req.query.year ? Number(req.query.year) : undefined,
  });
  if (!query.success) {
    res.status(400).json({ error: "Invalid query parameters" });
    return;
  }

  const userId = req.session.userId!;
  const teamScope = await resolveReadTeamScope(userId, parseTeamIdParam(req));
  if (teamScope === null) {
    res.status(403).json({ error: "Kein Zugriff auf dieses Team" });
    return;
  }
  if (teamScope.length === 0) {
    res.json([]);
    return;
  }

  // Gleiche Sichtbarkeitsregel wie oben: ohne Planungsrecht nur eigene Zeilen.
  const adminTeams = await getEffectiveAdminTeamIds(userId, req.session.role!);
  const darfPlanen = teamScope.some((t) => adminTeams.includes(t));

  // Monatsgrenzen wie in shifts-list.ts (Date.UTC): die Snapshots stehen als
  // toISOString()-Strings im JSONB, der ::timestamptz-Cast liest sie als UTC.
  const rangeStart = new Date(Date.UTC(query.data.year, query.data.month - 1, 1)).toISOString();
  const rangeEnd = new Date(Date.UTC(query.data.year, query.data.month, 1)).toISOString();

  const rows = await db.execute<{
    id: number;
    shift_id: number | null;
    change_source: string;
    changed_by: number;
    changed_by_name: string | null;
    user_id: number;
    shift_type: string | null;
    created_at: string;
    before: unknown;
    after: unknown;
    before_user_name: string | null;
    after_user_name: string | null;
  }>(sql`
    SELECT
      c.id, c.shift_id, c.change_source, c.changed_by, c.user_id,
      c.created_at, c.before, c.after,
      cb.name AS changed_by_name,
      bu.name AS before_user_name,
      au.name AS after_user_name,
      s.type AS shift_type
    FROM shift_changes c
    LEFT JOIN users cb ON cb.id = c.changed_by
    LEFT JOIN users bu ON bu.id = (c.before->>'userId')::int
    LEFT JOIN users au ON au.id = (c.after->>'userId')::int
    LEFT JOIN shifts s ON s.id = c.shift_id
    WHERE c.team_id IN (${sql.join(teamScope.map((t) => sql`${t}`), sql`, `)})
      ${darfPlanen ? sql`` : sql`AND c.user_id = ${userId}`}
      AND (
        ((c.after->>'startTime')::timestamptz >= ${rangeStart}::timestamptz
          AND (c.after->>'startTime')::timestamptz < ${rangeEnd}::timestamptz)
        OR ((c.before->>'startTime')::timestamptz >= ${rangeStart}::timestamptz
          AND (c.before->>'startTime')::timestamptz < ${rangeEnd}::timestamptz)
      )
    ORDER BY (c.after->>'startTime')::timestamptz, c.id
  `);

  const snapshot = (raw: unknown, name: string | null) => {
    const v = (raw ?? {}) as {
      startTime?: string;
      endTime?: string;
      pauseMinutes?: number;
      userId?: number;
    };
    return {
      startTime: v.startTime ? new Date(v.startTime).toISOString() : "",
      endTime: v.endTime ? new Date(v.endTime).toISOString() : "",
      pauseMinutes: Number(v.pauseMinutes ?? 0),
      userId: Number(v.userId ?? 0),
      userName: name,
    };
  };

  res.json(
    rows.rows.map((r) => ({
      id: Number(r.id),
      shiftId: r.shift_id == null ? null : Number(r.shift_id),
      changeSource: r.change_source,
      changedBy: Number(r.changed_by),
      changedByName: r.changed_by_name,
      userId: Number(r.user_id),
      shiftType: r.shift_type,
      createdAt: new Date(r.created_at).toISOString(),
      before: snapshot(r.before, r.before_user_name),
      after: snapshot(r.after, r.after_user_name),
    })),
  );
});

export default router;
