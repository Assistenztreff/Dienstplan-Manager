---
name: Vacation contract guard vs. multi-team contracts
description: Interplay of the team-scoped vacation guard, activeContractFor booking, and cross-team e2e fixtures.
---

Rule: vacation coverage is checked ONLY against contracts of the effective shift team (POST: resolved write team, PATCH: the shift's team); the generic error (no ab/bis hint) is used when the team has no contract, to avoid leaking foreign-team contract dates. Users with zero contracts anywhere stay unblocked.

**Why:** a contract in another team must not authorize vacation here (counter would book on the wrong tenant-team contract), and error hints must not reflect non-scoped data.

**How to apply:** e2e fixtures that create vacation via a second team now need a contract IN that team too. Booking side (`adjustVacationHours` → `activeContractFor`) is NOT team-scoped and picks the active contract with the LATEST startDate — give auxiliary-team contracts an EARLIER startDate if counter assertions must stay on the primary contract.
