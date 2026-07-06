---
name: Allowance account-global vs team-override fields
description: Which allowance_settings fields are account-global vs team-overridable, and how they resolve.
---

allowance_settings holds BOTH an account row (team_id IS NULL) and optional per-team override rows (team_id set). Two classes of columns live in this one table:

- **Team-overridable**: surcharge percents (night/sunday/holiday + night window), `state` (Bundesland), `billingMethod`. These may legitimately differ per team; the override row wins.
- **Account-global ("Konto-weite Regeln")**: `autoApproveTimesheets`, vacation calc (`vacationMethod`/`vacationHoursPerDay`/`vacationFactor`), and `ersatzruhetagEnabled`. Intended to apply account-wide.

**Rule:** the team-scope `PUT /allowance-settings?teamId=` must whitelist ONLY the team-overridable fields into the override upsert — never spread the whole body — or a client can set account-global fields per team. The settings UI already sends account-global fields only at account scope; the server whitelist is the enforcement.

**Known limitation (pre-existing):** `resolveAllowanceOps` returns the override row wholesale when a team has one, so for a team WITH an override row the account-global ops come from that row's column DEFAULTS, not the account row. In practice override rows are created only for surcharge differences and the account-global columns stay at default (ersatzruhetag default=true). So an account-level toggle (e.g. turning the Ersatzruhetag-Konto OFF) does NOT propagate to teams that have their own override row. Primary `privat` accounts have no override rows, so it works there. Fixing this properly means sourcing account-global ops from the account row inside resolveAllowanceOps — deferred (would change autoApprove/vacation behavior for override teams too).
