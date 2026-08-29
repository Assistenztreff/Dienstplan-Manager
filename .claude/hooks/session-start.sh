#!/bin/bash
set -euo pipefail

# ---------------------------------------------------------------------------
# SessionStart-Hook fuer Claude Code on the web.
# ---------------------------------------------------------------------------
# Zwei Aufgaben:
#   1. Umgebung arbeitsfaehig machen (pnpm install, Postgres, DATABASE_URL,
#      Playwright-Chromium) — sonst scheitern Lint/Typecheck/Tests im
#      frischen Container an banalen Dingen.
#   2. Kontext-Hinweis auf Kays Obsidian-Vault ausgeben.
#
# Lokal passiert nichts: dort hat Kay Vault und Datenbank ohnehin eingerichtet.
#
# WICHTIG: Auf stdout darf am Ende NUR das JSON stehen. Der gesamte
# Einrichtungs-Krach geht deshalb nach stderr (fd 3 haelt das echte stdout).
# ---------------------------------------------------------------------------

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

exec 3>&1 1>&2

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$PROJECT_DIR"

# --- Umgebungsvariablen fuer die Session -----------------------------------
# Der Container hat Chromium 1194, Playwright sucht standardmaessig eine
# andere Build-Nummer. Ohne diese Variable laufen die E2E-Tests hier gar
# nicht (playwright.config.ts liest sie als executablePath).
CHROMIUM_PATH="/opt/pw-browsers/chromium"
DB_NAME="dienstplan"
DB_URL="postgresql://postgres:postgres@127.0.0.1:5432/${DB_NAME}"

export REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE="$CHROMIUM_PATH"
export DATABASE_URL="$DB_URL"
export SESSION_SECRET="${SESSION_SECRET:-dev-session-secret-local-only}"

# Idempotent anhaengen: der Hook laeuft auch bei resume/clear/compact erneut,
# eine wachsende Liste identischer exports will niemand lesen.
append_env() {
  local line="$1"
  [ -n "${CLAUDE_ENV_FILE:-}" ] || return 0
  touch "$CLAUDE_ENV_FILE"
  grep -qxF "$line" "$CLAUDE_ENV_FILE" || echo "$line" >> "$CLAUDE_ENV_FILE"
}

append_env "export REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE=\"$CHROMIUM_PATH\""
append_env "export DATABASE_URL=\"$DB_URL\""
append_env "export SESSION_SECRET=\"$SESSION_SECRET\""

# --- Abhaengigkeiten --------------------------------------------------------
# Muss klappen: ohne node_modules geht weder Lint noch Typecheck noch Test.
echo "==> pnpm install"
pnpm install --frozen-lockfile

# --- Postgres ---------------------------------------------------------------
# Ab hier best effort: schlaegt die Datenbank fehl, sollen Lint/Typecheck/
# Unit-Tests trotzdem laufen koennen. Der Status landet im Kontext-Hinweis.
DB_STATUS="bereit"

setup_db() {
  if ! command -v pg_ctlcluster > /dev/null 2>&1; then
    DB_STATUS="kein Postgres im Container"
    return 1
  fi

  if ! pg_lsclusters -h 2> /dev/null | grep -q online; then
    echo "==> Postgres starten"
    pg_ctlcluster 16 main start || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      pg_isready -q && break
      sleep 1
    done
  fi

  if ! pg_isready -q; then
    DB_STATUS="Postgres startet nicht"
    return 1
  fi

  # Passwort setzen, weil pg_hba fuer 127.0.0.1 scram-sha-256 verlangt; der
  # Unix-Socket-Peer-Zugang taugt nicht als DATABASE_URL fuer die App.
  sudo -u postgres psql -q -c "ALTER ROLE postgres PASSWORD 'postgres'" > /dev/null

  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
    echo "==> Datenbank ${DB_NAME} anlegen"
    sudo -u postgres createdb "$DB_NAME"
  fi

  # Erstbefuellung: post-merge.sh faehrt die Daten-Migrationen VOR dem
  # Schema-Push (so ist es fuer eine gewachsene Dev-DB richtig). Auf einer
  # frischen, leeren DB gibt es aber noch keine Tabellen — migrate-teams
  # bricht dann mit 42P01 ab. Deshalb hier zuerst das Schema anlegen.
  local tables
  tables="$(sudo -u postgres psql -tAd "$DB_NAME" \
    -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
  if [ "${tables:-0}" -eq 0 ]; then
    echo "==> Leere Datenbank: Schema anlegen (db push)"
    if ! pnpm --filter db push < /dev/null; then
      DB_STATUS="Datenbank da, aber Schema-Push fehlgeschlagen"
      return 1
    fi
  fi

  # Daten-Migrationen + erneuter Schema-Push in der Reihenfolge des Repos.
  echo "==> post-merge.sh (Migrationen + db push)"
  if ! bash scripts/post-merge.sh; then
    DB_STATUS="Datenbank da, aber post-merge.sh fehlgeschlagen"
    return 1
  fi

  return 0
}

setup_db || echo "==> Datenbank-Einrichtung unvollstaendig: $DB_STATUS"

# --- Kontext-Ausgabe --------------------------------------------------------
exec 1>&3 3>&-

cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "Umgebung eingerichtet: pnpm install erledigt, Playwright nutzt REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE=${CHROMIUM_PATH}, DATABASE_URL zeigt auf die lokale Dev-Datenbank ${DB_NAME}. Status der Datenbank: ${DB_STATUS}. Faellt Postgres mitten in der Session aus, hilft 'pg_ctlcluster 16 main start'. Kay keeps a private Obsidian vault called Mein Gehirn as a git repo: github.com/Assistenztreff/mein-gehirn. This is a remote session, so the vault is not mounted as a device - attach it as a repo instead. Before other work, unless the task is clearly unrelated to Kay's personal/business context: 1) call add_repo with owner=Assistenztreff, repo=mein-gehirn, access=push. 2) git clone --depth 1 https://github.com/Assistenztreff/mein-gehirn /home/user/mein-gehirn. 3) call register_repo_root for it so its CLAUDE.md loads as a system-reminder. Then follow that CLAUDE.md own Bei Session-Start routine (read 00 Kontext/Ueber mich.md, check 01 Inbox for unsorted notes, git pull in the vault clone before committing there) and its Bei Session-Ende routine (session log plus daily note, per skill session-speichern) when the session wraps up. Do this once per session, not on every turn."
  }
}
EOF
