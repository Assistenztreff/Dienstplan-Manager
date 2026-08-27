#!/bin/bash
# Macht einen frischen Claude-Code-Remote-Container startklar (Postgres,
# Playwright-Browser, Platzhalter-Asset). Idempotent: mehrfaches Ausfuehren ist
# gefahrlos, jeder Schritt prueft erst, ob er ueberhaupt noetig ist.
#
# WARUM: Ein frischer Container hat keine laufende Datenbank, die vorinstallierten
# Playwright-Browser passen nicht immer zur im Repo gepinnten Version, und
# attached_assets/ ist gitignored — ohne diese drei Handgriffe scheitert JEDER
# Agent an denselben Stellen, bevor der erste Test laeuft.
#
# NICHT fuer Replit oder Kays lokalen Rechner gedacht — dort ist alles vorhanden.
# Das Skript bricht deshalb ab, wenn es kein Wegwerf-Container ist.
#
# Aufruf:  bash scripts/setup-remote-container.sh
# Danach:  source /tmp/dienstplan-test-env.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="/tmp/dienstplan-test-env.sh"
PGPORT=5432
PGDATA=/home/user/pgdata
PGLOG=/home/user/pgdata.log
PGBIN=/usr/lib/postgresql/16/bin
DB_NAME=dienstplan

say() { printf '\n\033[1m── %s\033[0m\n' "$1"; }
ok()  { printf '   ✅ %s\n' "$1"; }
warn(){ printf '   ⚠️  %s\n' "$1"; }

# ── Sicherheitsgurt ────────────────────────────────────────────────────────────
# Nur in einem Wegwerf-Container laufen. Auf Replit gibt es REPL_ID, dort waere
# ein eigener Postgres-Cluster falsch und wuerde die echte Dev-DB verwirren.
if [ -n "${REPL_ID:-}" ] || [ -n "${REPLIT_DOMAINS:-}" ]; then
  echo "Abbruch: Das hier ist eine Replit-Umgebung, nicht ein Wegwerf-Container." >&2
  echo "Dort sind Datenbank und Assets bereits vorhanden — nichts zu tun." >&2
  exit 1
fi

# ── 1. Abhaengigkeiten ────────────────────────────────────────────────────────
say "1/4  Abhaengigkeiten"
if [ -d "$REPO_ROOT/node_modules" ]; then
  ok "node_modules vorhanden — pnpm install uebersprungen"
else
  (cd "$REPO_ROOT" && pnpm install --frozen-lockfile) || {
    warn "pnpm install fehlgeschlagen — bitte Ausgabe oben pruefen"; exit 1; }
  ok "pnpm install fertig"
fi

# ── 2. Postgres ───────────────────────────────────────────────────────────────
say "2/4  Postgres"
if [ ! -x "$PGBIN/pg_ctl" ]; then
  warn "Kein Postgres 16 unter $PGBIN gefunden — DB-Schritte uebersprungen"
else
  id pg >/dev/null 2>&1 || useradd -m pg 2>/dev/null
  if [ ! -s "$PGDATA/PG_VERSION" ]; then
    mkdir -p "$PGDATA" && chown pg:pg "$PGDATA"
    su pg -c "$PGBIN/initdb -D $PGDATA -U postgres --auth=trust" >/dev/null 2>&1 \
      && ok "Cluster angelegt" || warn "initdb fehlgeschlagen"
  else
    ok "Cluster existiert bereits"
  fi

  if su pg -c "$PGBIN/pg_ctl -D $PGDATA status" >/dev/null 2>&1; then
    ok "Server laeuft bereits"
  else
    touch "$PGLOG" && chown pg:pg "$PGLOG"
    su pg -c "$PGBIN/pg_ctl -D $PGDATA -l $PGLOG -o '-p $PGPORT -k /tmp' start" >/dev/null 2>&1
    # pg_ctl kehrt zurueck, sobald der Postmaster reagiert; kurz gegenpruefen.
    if psql -h /tmp -p "$PGPORT" -U postgres -c 'SELECT 1' >/dev/null 2>&1; then
      ok "Server gestartet (Port $PGPORT)"
    else
      warn "Server startet nicht — Log: $PGLOG"
    fi
  fi

  if psql -h /tmp -p "$PGPORT" -U postgres -lqt 2>/dev/null | cut -d'|' -f1 | grep -qw "$DB_NAME"; then
    ok "Datenbank '$DB_NAME' existiert bereits"
  else
    psql -h /tmp -p "$PGPORT" -U postgres -c "CREATE DATABASE $DB_NAME" >/dev/null 2>&1 \
      && ok "Datenbank '$DB_NAME' angelegt" || warn "CREATE DATABASE fehlgeschlagen"
  fi
fi

# ── 3. Playwright-Browser ─────────────────────────────────────────────────────
# Das Image bringt eine Chromium-Version mit, die nicht zwingend zur im Repo
# gepinnten Playwright-Version passt. Playwright sucht dann einen Ordner, den es
# nicht gibt, und "playwright install" ist hier bewusst nicht erlaubt. Loesung:
# die erwarteten Pfade auf die vorhandene Version zeigen lassen.
say "3/4  Playwright-Browser"
PW_ROOT="${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}"
if [ ! -d "$PW_ROOT" ]; then
  warn "$PW_ROOT existiert nicht — Browser-Schritt uebersprungen"
else
  # Vorhandene (irgendeine) Chromium- und Headless-Shell-Version ermitteln.
  HAVE_SHELL="$(ls -d "$PW_ROOT"/chromium_headless_shell-* 2>/dev/null | grep -v -- '-0*$' | head -1)"
  HAVE_FULL="$(ls -d "$PW_ROOT"/chromium-[0-9]* 2>/dev/null | head -1)"
  # Erwartete Version aus Playwright selbst auslesen (statt zu raten). pnpm legt
  # playwright-core nur im .pnpm-Store ab, deshalb per find statt require.resolve.
  BROWSERS_JSON="$(find "$REPO_ROOT/node_modules/.pnpm" -maxdepth 4 -name browsers.json -path '*playwright-core*' 2>/dev/null | head -1)"
  WANT="$(node -e '
    try {
      const j = require(process.argv[1]);
      const g = n => (j.browsers.find(b => b.name === n) || {}).revision || "";
      console.log(g("chromium-headless-shell") + " " + g("chromium"));
    } catch { console.log(" "); }
  ' "$BROWSERS_JSON" 2>/dev/null)"
  WANT_SHELL="$(echo "$WANT" | cut -d' ' -f1)"
  WANT_FULL="$(echo "$WANT" | cut -d' ' -f2)"

  link_browser() {  # $1=vorhandener Ordner  $2=Zielversion  $3=Unterordnername  $4=Binaername
    local have="$1" want="$2" sub="$3" bin="$4" target
    [ -z "$have" ] || [ -z "$want" ] && return 0
    target="$PW_ROOT/$(basename "$have" | sed "s/-[0-9]*$/-$want/")"
    [ "$target" = "$have" ] && { ok "$(basename "$have") passt bereits"; return 0; }
    [ -e "$target/$sub/$bin" ] && { ok "$(basename "$target") bereits verknuepft"; return 0; }
    mkdir -p "$target"
    ln -sfn "$have/chrome-linux" "$target/$sub"
    # Aeltere Builds nennen das Binaer anders als neuere Playwright-Versionen erwarten.
    [ -e "$have/chrome-linux/$bin" ] || ln -sfn "$have/chrome-linux/headless_shell" "$have/chrome-linux/$bin" 2>/dev/null
    touch "$target/INSTALLATION_COMPLETE" "$target/DEPENDENCIES_VALIDATED"
    ok "$(basename "$target") -> $(basename "$have")"
  }
  link_browser "$HAVE_SHELL" "$WANT_SHELL" "chrome-headless-shell-linux64" "chrome-headless-shell"
  link_browser "$HAVE_FULL"  "$WANT_FULL"  "chrome-linux"                  "chrome"
  [ -z "$WANT_SHELL$WANT_FULL" ] && warn "Playwright-Version nicht ermittelbar — Browser-Schritt uebersprungen"
fi

# ── 4. Platzhalter fuer das gitignorete Logo ──────────────────────────────────
# artifacts/dienstplan importiert attached_assets/assistenzplaner-logo-getrimmt.png
# an drei Stellen. Der Ordner ist gitignored, die Datei liegt nur im Replit-
# Workspace — ohne sie bricht JEDER Vite-Build und damit jeder UI-Test.
# Hier reicht ein 1x1-Platzhalter: die Tests pruefen Verhalten, nicht das Logo.
say "4/4  Fehlendes Logo-Asset"
LOGO="$REPO_ROOT/attached_assets/assistenzplaner-logo-getrimmt.png"
if [ -f "$LOGO" ]; then
  ok "Logo vorhanden — nichts zu tun"
else
  mkdir -p "$(dirname "$LOGO")"
  # 1x1 transparentes PNG, base64
  printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' \
    | base64 -d > "$LOGO"
  warn "PLATZHALTER angelegt (1x1 transparent) — nicht das echte Logo!"
  echo "      Reicht fuer Build und Tests. Fuer optische Abnahme das echte"
  echo "      Logo aus dem Replit-Workspace an dieselbe Stelle kopieren."
fi

# ── Env-Datei schreiben ───────────────────────────────────────────────────────
# PROD_DATABASE_URL ist ein reiner Fingerabdruck: setup-test-db verweigert den
# Start ohne bekannte Prod-Identitaet, damit es sich nie gegen echte Daten
# richten kann. Der Wert unten zeigt bewusst ins Leere.
cat > "$ENV_FILE" <<EOF
export DATABASE_URL=postgresql://postgres@localhost:$PGPORT/$DB_NAME
export SESSION_SECRET=local-container-test-secret
export PROD_DATABASE_URL=postgresql://unused:unused@prod.invalid:5432/never-used
export PLAYWRIGHT_BROWSERS_PATH=${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
EOF

say "Fertig"
cat <<EOF
   Umgebungsvariablen laden (in JEDER neuen Shell noetig):

       source $ENV_FILE

   Danach z. B.:
       pnpm run typecheck
       pnpm --filter @workspace/scripts run setup-test-db   # einmalig, legt <dbname>_test an
       pnpm --filter @workspace/dienstplan run test:e2e:api
EOF
