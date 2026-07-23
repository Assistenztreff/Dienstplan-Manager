---
name: Externe Postgres-URL (Scaleway) — Kodierung & TLS
description: Umgang mit unkodierten Passwörtern in DATABASE_URL und selbstsignierten Zertifikaten externer Managed-Postgres.
---

- `normalizeDatabaseUrl` (lib/db) repariert unparsebare DATABASE_URLs (percent-kodiert user/password am letzten `@`); eingebunden in lib/db/src/index.ts (schreibt process.env zurück) und drizzle.config.ts.
- **Why:** Nutzer setzen Secrets mit rohen Sonderzeichen (#, ?, {, ;) — `new URL`/pg-connection-string werfen dann "Invalid URL" und ALLE DB-Zugriffe 500en.
- node-postgres prüft bei `sslmode=require` das Zertifikat (anders als psql/libpq). Scaleway nutzt selbstsignierte Zertifikate → "self-signed certificate"-Fehler.
- Lösung: expliziter Opt-in `DATABASE_SSL_NO_VERIFY=1` (shared Env-Var) rewritet require→no-verify. KEIN stiller Downgrade — Architect-Review hat pauschales Umschreiben als MITM-Risiko abgelehnt.
- **How to apply:** Bei "Invalid URL" oder "self-signed certificate" aus pg zuerst URL-Kodierung und diesen Schalter prüfen; Fehler-Reihenfolge bei kaputter Verbindung: Invalid URL → self-signed cert → password authentication failed (Auth kommt NACH TLS).
- Latenz-Folge: Endpunkte mit vielen sequenziellen Queries (z. B. vacation-balance ~2 s) sprengen 5-s-Playwright-Defaults; UI-Smoke-Assertions auf latenzabhängige Karten brauchen explizite Timeouts (~20 s).
