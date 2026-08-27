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
    "additionalContext": "Kay keeps a private Obsidian vault called Mein Gehirn as a git repo: github.com/Assistenztreff/mein-gehirn. This is a remote session, so the vault is not mounted as a device - attach it as a repo instead. Before other work, unless the task is clearly unrelated to Kay's personal/business context: 1) call add_repo with owner=Assistenztreff, repo=mein-gehirn, access=push. 2) git clone --depth 1 https://github.com/Assistenztreff/mein-gehirn /home/user/mein-gehirn. 3) call register_repo_root for it so its CLAUDE.md loads as a system-reminder. Then follow that CLAUDE.md own Bei Session-Start routine (read 00 Kontext/Ueber mich.md, check 01 Inbox for unsorted notes, git pull in the vault clone before committing there) and its Bei Session-Ende routine (session log plus daily note, per skill session-speichern) when the session wraps up. Do this once per session, not on every turn."
  }
}
EOF
