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
import { ListShiftChangesQueryParams } from "@workspace/api-zod";
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

export default router;
