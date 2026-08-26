#!/bin/bash
set -e
# SICHERHEITSHINWEIS: Seed- und Test-Scripts (setup-test-accounts, setup-admin,
# setup-test-db, setup-superadmin, delete-account, seed-*, backdate-plan-change,
# set-plan, add-team-member, cleanup-test-accounts) laufen NIE gegen die
# Produktionsdatenbank. Sie enthalten assertNotProdDb() aus
# scripts/src/lib/normalize-db-url.ts: der Guard prueft ob DATABASE_URL auf
# denselben Host wie PROD_DATABASE_URL zeigt und bricht dann mit einem klaren
# Fehler ab. PROD_DATABASE_URL (nicht APP_DATABASE_URL) wird als Fingerprint
# genutzt, weil setup-test-db.ts APP_DATABASE_URL in Kind-Prozessen bewusst
# auf die Test-DB-URL ueberschreibt (damit normalize-db-url dort die Test-DB
# trifft); PROD_DATABASE_URL bleibt in Kind-Prozessen unveraendert.
# Explizites Opt-in nur via: ALLOW_PROD_SEED=1 <Skript>
# Echte Produktions-E-Mail-Adressen duerfen NIE in REAL_ASSISTANT_EMAILS stehen.
pnpm install --frozen-lockfile
pnpm --filter @workspace/scripts run migrate-teams
# Zuschlags-Einstellungen von der globalen Singleton-Zeile auf Pro-Konto-Zeilen
# migrieren (idempotent, VOR db push — sonst fragt push interaktiv nach
# NOT NULL/UNIQUE auf der befüllten Tabelle und bricht ohne TTY ab).
pnpm --filter @workspace/scripts run migrate-allowance-settings
# Bestands-Abwesenheiten (Urlaub/Krankheit) einmalig auf verbindlichen Status FIX
# korrigieren, damit sie in den Auswertungen erscheinen. Reine Daten-Migration
# (kein Schema-Prompt), idempotent — Reihenfolge unkritisch.
pnpm --filter @workspace/scripts run migrate-absences-fix
# Bestehende Teams OHNE ein einziges Schichtmodell bekommen die 5 Standard-
# Dienste nachgezogen (neue Teams werden seit dem Schicht-Dialog-Fix direkt
# beim Anlegen geseedet). Reine Daten-Migration, idempotent.
pnpm --filter @workspace/scripts run backfill-team-shift-models
# Idempotente SQL-Vorab-Schritte VOR db push (gemeinsame Quelle mit
# migrate-prod: scripts/src/lib/pre-push-sql.ts — neue Schritte NUR dort
# eintragen). Sie machen Bestands-DBs prompt-frei, weil drizzle-kit push bei
# neuen UNIQUE-Constraints/Spalten-Drops interaktiv nachfragt (kein TTY im
# Post-Merge => Abbruch).
pnpm --filter @workspace/scripts run pre-push-sql
# WICHTIG (verifiziert): Nach diesem Skript laeuft die Plattform-
# "Workflow-Reconciliation" und startet bereits laufende Workflows neu —
# und zwar SOWOHL bei Erfolg ALS AUCH bei Fehlschlag des Skripts. Der
# API-Server laedt also nach erfolgreichem db push garantiert den neuen
# Drizzle/Zod-Stand (kein manueller Restart hier noetig). Kehrseite: bei
# einem db-push-Fehlschlag laeuft der Server danach mit NEUEM Code gegen
# eine VERALTETE Dev-DB — deshalb muss dieses Skript hart abbrechen und
# den Fehler unten unmissverstaendlich benennen.
# drizzle-kit push beendet sich auch bei "Interactive prompts require a TTY"
# mit Exit-Code 0 (!) — der Exit-Code allein reicht also nicht. Die Dev-DB ist
# NICHT wegwerfbar (kein Drop+Recreate wie bei der Test-DB), deshalb wird die
# Ausgabe mitgeschnitten und auf die bekannten Fehlermuster geprüft; bei
# Treffern bricht post-merge hart ab, statt die Dev-DB still veralten zu lassen
# (sonst strippt der API-Server neue Felder still).
# stdin auf /dev/null: bei interaktiven Rückfragen soll push sofort mit
# "Interactive prompts require a TTY" abbrechen statt zu hängen.
push_status=0
push_output="$(pnpm --filter db push < /dev/null 2>&1)" || push_status=$?
printf '%s\n' "$push_output"
if [ "$push_status" -ne 0 ] \
  || printf '%s' "$push_output" | grep -qi 'Interactive prompts require a TTY' \
  || printf '%s' "$push_output" | grep -Eq '^[[:space:]]*Error:'; then
  echo "FEHLER: db push ist fehlgeschlagen (siehe Ausgabe oben)." >&2
  echo "Die Dev-DB ist jetzt moeglicherweise veraltet. Schema-Aenderung braucht" >&2
  echo "vermutlich einen idempotenten SQL-Vorab-Schritt (siehe calendar_token oben)." >&2
  echo "ACHTUNG: Die Workflow-Reconciliation startet den API-Server trotzdem neu —" >&2
  echo "er laeuft dann mit NEUEM Code gegen die VERALTETE Dev-DB (Laufzeitfehler/" >&2
  echo "still gestrippte Felder moeglich), bis db push repariert und erneut" >&2
  echo "ausgefuehrt wurde." >&2
  exit 1
fi
# Halbtägiger Urlaub (#862): is_partial_absence hat den Default false; Bestands-
# Abwesenheiten mit echten Teil-Tag-Uhrzeiten ("Von-bis") müssen auf true
# nachgezogen werden, sonst zeigt/blockiert die UI sie fälschlich als
# ganztägig. MUSS NACH db push laufen — vorher existiert die Spalte auf einer
# Bestands-DB noch gar nicht (Skript würde sie no-op überspringen und den
# Backfill nie mehr nachholen, da is_partial_absence danach ueberall den
# Spalten-Default false hat). Reine Daten-Migration (kein Schema-Prompt),
# idempotent — Reihenfolge nach dem Push ist unkritisch fuer alle uebrigen
# Skripte oben.
pnpm --filter @workspace/scripts run backfill-partial-absence-flag

# Prod-Schema-Drift-Check (#893): rein informativ, blockiert den Merge NIE.
# db push oben synct nur die Dev-DB — die externe Produktions-DB (Scaleway)
# bekommt Schema-Aenderungen ausschliesslich ueber migrate-prod, und bisher
# fiel eine hinterherhinkende Prod-DB erst beim naechsten Publish-Versuch auf
# (publish-preflight.sh, dort bewusst fail-closed). Dieser Schritt macht
# denselben, rein lesenden Check (check-prod-schema-drift.ts) direkt nach
# jedem Merge sichtbar, der eine Schema-Aenderung enthalten haben koennte —
# als lauter Hinweis statt einer spaeten Publish-Ueberraschung.
echo ""
echo "── Prod-Schema-Check (informativ, blockiert diesen Merge nicht) ──"
if [ -n "${PROD_DATABASE_URL:-}" ]; then
  if ! pnpm --filter @workspace/scripts run check-prod-schema-drift < /dev/null; then
    echo "" >&2
    echo "⚠️  HINWEIS: Die Produktions-Datenbank liegt jetzt hinter diesem Merge zurueck (Details oben)." >&2
    echo "   Ein Publish-Versuch schlaegt deshalb fehl, bis das Schema nachgezogen wird:" >&2
    echo "   pnpm --filter @workspace/scripts run migrate-prod --yes <dbname>" >&2
  fi
else
  echo "PROD_DATABASE_URL nicht gesetzt — Prod-Schema-Check uebersprungen (kein Produktions-Ziel konfiguriert)."
fi
