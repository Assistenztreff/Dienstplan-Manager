---
name: Projected SELECT constant silently drops new columns
description: A shared column-projection object (e.g. CONTRACT_SELECT) omits newly added schema columns from API responses, and it never fails typecheck.
---

Routes that select via a shared projection constant (e.g. `CONTRACT_SELECT` in `routes/contracts.ts`) only return the columns listed there. Adding a column to the Drizzle schema does NOT auto-include it in these responses.

**Why:** the OpenAPI/generated field is usually `optional`, so a missing column produces `undefined` at runtime with NO typecheck error. The frontend then silently reads `?? 0` and computes wrong values (this bit the hours-based vacation display: `contract.vacationHoursUsed` was undefined → taken days = 0).

**How to apply:** whenever you add a schema column that a client reads, grep for the route's projection constant(s) and add the column there too. Do not trust typecheck to catch it — verify the actual JSON response (curl) contains the field.
