---
name: Ad-hoc-Skript-Verbindung zur echten Prod-DB (Scaleway)
description: Wie ein einmaliges tsx-Skript sich korrekt mit der echten Scaleway-Produktionsdatenbank verbindet, ohne DATABASE_URL zu verbiegen.
---

Für eine einmalige Lese-Untersuchung/Migration gegen die echte Scaleway-Prod-DB (nicht die Replit-interne `heliumdb`/Staging) ein Ad-hoc-`tsx`-Skript in `scripts/src/` schreiben, das `resolveDatabaseUrl()` aus `@workspace/db/database-url` nutzt — NICHT `process.env.DATABASE_URL` direkt lesen oder die URL manuell zusammenbauen.

**Why:** `resolveDatabaseUrl()` kapselt bereits die Vorrangkette (APP_DATABASE_URL-Override) und berücksichtigt ein rotiertes Scaleway-Passwort über `SCALEWAY_DB_PASSWORD`, falls das in `PROD_DATABASE_URL` eingebettete Passwort veraltet ist. Wer die URL selbst zusammensetzt, verbindet sich entweder gegen die falsche DB oder scheitert an einem stillen Auth-Fehler nach TLS (siehe `scaleway-db-url-tls.md` zur Fehlerreihenfolge).

**How to apply:** `import { resolveDatabaseUrl } from "@workspace/db/database-url";` → `const url = resolveDatabaseUrl()` → `new pg.Client({ connectionString: url })`. Für reine Prod-Lesezugriffe `PROD_DATABASE_URL` als Basis nehmen (nicht `APP_DATABASE_URL`, das ist Staging). Bestehende Skripte wie `scripts/src/anonymize-staging.ts` oder `scripts/src/check-prod-schema-drift.ts` als Vorlage nehmen statt neu zu erfinden.
