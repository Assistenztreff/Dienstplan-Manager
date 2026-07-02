---
name: Drizzle raw-SQL correlated subqueries
description: Column refs interpolated into sql`` subqueries render unqualified and break the query
---

Interpolating a Drizzle column (e.g. `${usersTable.id}`) inside a raw `sql\`\`` correlated subquery within a `.select({...})` projection renders as bare `"id"` (no table qualifier). Inside the subquery that resolves against the subquery's own tables → runtime "Failed query" 500.

**Why:** Drizzle's selection context strips the table alias for projection columns; the raw SQL fragment inherits that rendering.

**How to apply:** In raw SQL subqueries, write the outer-table correlation explicitly (`WHERE t.owner_id = users.id`) instead of interpolating the column object. Same pattern already used in teams.ts `selectMembers` (there it works because it's interpolated where the outer alias is valid — verify rendering when in doubt by hitting the endpoint).
