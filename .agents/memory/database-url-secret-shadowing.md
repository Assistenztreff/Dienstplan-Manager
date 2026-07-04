---
name: DATABASE_URL secret shadows managed DB
description: A user-added DATABASE_URL secret overrides Replit's managed DB URL; a malformed value breaks all DB access. Agent cannot delete secrets; env changes need a workflow restart.
---

A user-created secret named `DATABASE_URL` **shadows** Replit's managed database URL for the app process. If that secret value is malformed (e.g. a placeholder connection string still containing `[ ]`, `{ }`, `#`, `?`), every DB operation throws `TypeError: Invalid URL` (pg-connection-string, base `postgres://base`) — login and everything else return 500, even though `checkDatabase()` reports provisioned and the code-execution `executeSql` sandbox still works (it uses a separate connection, not `process.env.DATABASE_URL`).

**Why:** the app builds its pool with `new Pool({ connectionString: process.env.DATABASE_URL })` (`lib/db/src/index.ts`), and `connect-pg-simple` gets `conString: process.env.DATABASE_URL` (`api-server app.ts`). Both fail identically when the injected value isn't a valid URL.

**How to apply / recovery:**
- Diagnose without exposing the secret: `node -e` reading `process.env.DATABASE_URL` and printing only `{len, scheme, validURL, problematicCharsPresent}` — never print the value.
- `deleteEnvVars({keys:["DATABASE_URL"]})` targets a **shared env var**, NOT the global secret — it returns success but does NOT remove the secret; the bad value persists. The agent **cannot delete/modify secrets directly**. Ask the USER to delete the secret in the Secrets tab.
- Env/secret changes do NOT propagate to the running repl env until a **workflow restart** (and even then the supervisor env can lag; the shell `process.env` the agent sees also lags). After the user removes the secret, restart the API workflow, then verify: managed URL becomes valid (shorter, `validURL:true`) and `POST /api/auth/login` returns 401 for wrong creds instead of 500.
- `createDatabase()` re-provisions the managed `DATABASE_URL`/`PG*` but does NOT override a still-present user secret.
