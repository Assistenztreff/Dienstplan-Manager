#!/bin/bash
set -euo pipefail

# Only relevant for Claude Code on the web (remote sessions) - locally Kay
# has the Obsidian vault mounted directly, no repo needed.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cat <<'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "CONTAINER SETUP: this fresh container has no running database, its preinstalled Playwright browsers may not match the pinned version, and attached_assets/ is gitignored so the Vite build fails on a missing logo import. Do NOT solve these by hand and do NOT run 'playwright install' - run 'bash scripts/setup-remote-container.sh' once (idempotent, ~1 min with node_modules present), then 'source /tmp/dienstplan-test-env.sh' in every shell that runs typecheck, tests or the app. It writes DATABASE_URL, SESSION_SECRET and a dummy PROD_DATABASE_URL (a fingerprint the seed scripts require before they will start). E2E additionally needs 'pnpm --filter @workspace/scripts run setup-test-db' once. Skip all of this for tasks that touch no code. Note the logo it creates is a 1x1 placeholder, fine for builds and tests but not for judging UI appearance.\n\nVAULT: Kay keeps a private Obsidian vault called Mein Gehirn as a git repo: github.com/Assistenztreff/mein-gehirn. This is a remote session, so the vault is not mounted as a device - attach it as a repo instead. Before other work, unless the task is clearly unrelated to Kay's personal/business context: 1) call add_repo with owner=Assistenztreff, repo=mein-gehirn, access=push. 2) git clone --depth 1 https://github.com/Assistenztreff/mein-gehirn /home/user/mein-gehirn. 3) call register_repo_root for it so its CLAUDE.md loads as a system-reminder. Then follow that CLAUDE.md own Bei Session-Start routine (read 00 Kontext/Ueber mich.md, check 01 Inbox for unsorted notes, git pull in the vault clone before committing there) and its Bei Session-Ende routine (session log plus daily note, per skill session-speichern) when the session wraps up. Do this once per session, not on every turn."
  }
}
EOF
