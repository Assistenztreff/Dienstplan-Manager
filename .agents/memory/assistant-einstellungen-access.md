---
name: Assistant access to Einstellungen page
description: Why /einstellungen is reachable for assistants and how admin-only sections stay gated
---

The `/einstellungen` route and its nav entry are reachable for ALL authenticated
users, not just admins. The Einstellungen page hosts the assistant-facing
Kalender-Abo-Karte (CalendarExportCard), whose access is gated on the employer's
plan via the `GET /api/calendar-token` probe.

**Why:** The assistant calendar-sync feature (probe logic in CalendarExportCard)
was added while the settings route was still admin-only, so assistants could
never actually reach the card — a latent dead-feature bug. Opening the route +
nav fixed reachability.

**How to apply:** Within `einstellungen.tsx`, every management section
(Schichtmodelle CRUD + "Neuen Dienst" button, AllowanceSettingsForm,
LogoSettingsCard, their helper texts, and the ModelDialog) is wrapped in
`isAdmin` (= `isAdminRole(currentUser?.role)`). Assistants see ONLY ProfileCard +
CalendarExportCard. If you add a new management section, gate it behind `isAdmin`
or it will leak to assistants. Server-side scoping still enforces the real
boundary; these gates are UX only.
