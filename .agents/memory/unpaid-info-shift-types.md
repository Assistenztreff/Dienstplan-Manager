---
name: Unpaid info-only shift types
description: How kind_krank/abgesagt_an/urlaubsabgeltung flow through metrics vs. hours-balance
---
Unpaid info categories (kind_krank, abgesagt_an) store valuedHours like other absences (plain full-day ⇒ contract daily target, not raw 24h duration) but zero surcharges; urlaubsabgeltung values normally.
**Why:** zeroing valuedHours at write-time made info hours unrecoverable in the Auswertung (a full-day entry summed as 0 or raw 24h).
**How to apply:** exclusion from Soll/Erfüllt/Lohn happens ONLY in dashboard-hours-balance via the INFO_ONLY_SHIFT_TYPES filter — never re-zero valuedHours in resolveShiftMetrics for these types. New consumers of stored valuedHours must filter info types themselves.
