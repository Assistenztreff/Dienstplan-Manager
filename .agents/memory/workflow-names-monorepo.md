---
name: Workflow names in artifact monorepo
description: How to address artifact workflows with restart_workflow in this pnpm monorepo.
---

Workflows created from artifact registration are named `artifacts/<dir>: <service name>`, e.g. `artifacts/dienstplan: web` and `artifacts/api-server: API Server` — NOT the artifact slug or title.

**Why:** `restart_workflow("dienstplan")` and `restart_workflow("Dienstplan-App")` both fail with RUN_COMMAND_NOT_FOUND.

**How to apply:** When a restart fails with RUN_COMMAND_NOT_FOUND, call `listWorkflows()` in code_execution to get the exact names instead of guessing.
