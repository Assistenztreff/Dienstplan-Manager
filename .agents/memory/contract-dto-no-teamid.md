---
name: Contract DTO has no teamId
description: Client-side Contract type/DTO omits teamId; code needing a contract's team must not assume the field exists.
---

The generated `Contract` type (api-zod) and the `CONTRACT_SELECT` projection in
`artifacts/api-server/src/routes/contracts.ts` do not include `teamId` — it's
intentionally stripped from the DTO (see `dienstplan-absence-display-contract.md`-adjacent
scoping patterns). Client components that have a `contract` object cannot read
`contract.teamId` (TS2339, only caught by tsc, not runtime).

**Why:** contracts are read across team-scoped and account-scoped call sites; the
DTO shape assumes callers already know their team context (e.g. from a page-level
`selectedTeamId`), not from the contract row itself.

**How to apply:** when a client component needs a per-team value (e.g. team-scoped
allowance settings) alongside a `contract` prop, either (a) accept an explicit
`teamId` prop from the parent instead of reading `contract.teamId`, or (b) if the
underlying setting is actually account-scope-only (check the server route's PUT
logic for which fields are team-overridable), fetch it without a teamId at all.
