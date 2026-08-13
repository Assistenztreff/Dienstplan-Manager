---
name: Artifact paths Konflikt beim Publishing
description: Zwei Artifacts mit paths=["/"] blockieren den Publish-Vorgang — Plattform hängt ohne klare Fehlermeldung.
---

## Regel

Jeder Pfad darf in einem Monorepo-Deploy nur von **einem** Artifact-Service beansprucht werden.
Wenn zwei Services `paths = ["/"]` setzen, hängt der Publish-Vorgang ohne klare Fehlermeldung.

**Why:** Die Replit-Plattform kann Routing-Konflikte nicht auflösen und blockiert beim Erstellen des Autoscale-Services.

**How to apply:**

- Nur der Service, der in Production aktiv Requests bedient, setzt `paths`.
- Build-only-Services (kein `run`, kein `serve`) erhalten **kein** `paths`-Feld.
- In dev steuert `localPort` + `previewPath` die Preview-Weiterleitung — `paths` ist dafür nicht nötig.

**Beispiel (korrekt):**
```toml
# api-server: bedient "/" in Production
paths = ["/"]

# dienstplan: nur Build, kein paths-Eintrag
# [services] → kein paths-Feld
```
