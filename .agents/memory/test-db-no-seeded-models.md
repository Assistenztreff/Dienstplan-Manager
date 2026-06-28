---
name: Test DB lacks seeded shift models
description: Why e2e specs cannot assume the default "24h Dienst"/Frühdienst/etc. shift models exist in the isolated test DB.
---

The isolated e2e test DB is provisioned by `setup-test-db`, which runs schema push + `setup-admin` + `migrate-teams`. Default shift models (Frühdienst, Spätdienst, "24h Dienst", Bereitschaft) are seeded ONLY on user register and dev-login team creation — NOT by `setup-admin`.

**Why:** The test admin is created via the seed script, which bypasses the register/dev-login seeding path, so its team starts with zero shift models.

**How to apply:** Any e2e spec that needs a shift model (e.g. selecting it in the ShiftDialog type dropdown) must ensure-or-create it via `POST /api/shift-models` first (mirror the `ensureAssistant` pattern), rather than relying on a seeded model being present.
