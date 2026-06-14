---
name: Curl test ID parsing on shifts
description: Why ad-hoc curl tests against /api/shifts can delete the wrong row
---
Shift API responses embed a nested `user` object that has its own `id` (e.g. `{"id":60,...,"user":{"id":4,...}}`). A greedy `sed`/regex like `s/.*"id":\([0-9]*\).*/\1/` matches the LAST `id` (the user's), not the shift's. Using that value in a follow-up DELETE/PATCH hits the wrong shift.

**Why:** This actually caused an accidental DELETE of a pre-existing demo shift during cross-team shift-model testing.

**How to apply:** When extracting the shift id from a create response in shell, use `jq '.id'` or a non-greedy match anchored to the start (`head` the first `"id":N`), and prefer a DB-side cleanup (`DELETE ... WHERE id = <known>`) over re-parsing. Better still: capture the id returned directly by the INSERT/RETURNING when seeding via SQL.
