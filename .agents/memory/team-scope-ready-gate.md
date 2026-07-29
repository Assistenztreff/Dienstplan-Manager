---
name: Team-Scope-Readiness vor scope-abhängigen Writes
description: UI-Flows, die je nach selectedTeamId Konto- vs. Team-Zeile schreiben, müssen auf isTeamScopeReady warten
---

Die TeamSwitcher-Auto-Auswahl (erstes Team) läuft einen Render NACH dem Laden der Team-Liste. Bis dahin ist `selectedTeamId` null — eine Karte, die scope-abhängig schreibt (Konto-Zeile ohne teamId vs. Team-Zeile mit teamId, z.B. Branding/Logo), schreibt in diesem Fenster in den FALSCHEN Scope und zeigt danach dauerhaft den leeren Ziel-Scope ("Kein Logo"), obwohl der Write 200 war.

**Why:** Logo-Upload-E2E war deterministisch rot: Upload direkt nach Render traf das Fenster, schrieb die Konto-Zeile, UI sprang danach auf den (leeren) Team-Scope um.

**How to apply:** TeamContext exponiert `isTeamScopeReady`; scope-abhängige Karten gated ihre Query (`enabled`) und zeigen Skeleton, bis der Scope settled ist. Specs für Dienstleister-Konten müssen API-Assertions im TEAM-Scope (`?teamId=`) machen — Team-ID via GET /teams (Owner darf das).
