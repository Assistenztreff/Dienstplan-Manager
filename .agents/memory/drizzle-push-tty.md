---
name: Drizzle push needs TTY
description: Why drizzle-kit push fails here and how to apply schema changes instead
---

`pnpm --filter @workspace/db run push` (drizzle-kit push, even with --force) hangs
or fails because it prompts interactively and there is no TTY in this environment.

**Why:** drizzle-kit's interactive confirmation prompts cannot be answered from the
agent shell.

**How to apply:** For additive, low-risk changes (new table, `ALTER TYPE ... ADD
VALUE`, `ADD COLUMN ... NULL`, new FK), apply the DDL directly with the executeSql
tool, then keep the Drizzle schema files in sync so codegen/types match. Reserve
drizzle push for local interactive use only. Always update the `lib/db/src/schema/`
files regardless, since the rest of the stack derives types from them.
