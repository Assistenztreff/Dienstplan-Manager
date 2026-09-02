---
name: Frischer Remote-Container — Postgres, DATABASE_URL, Playwright-Arbeitsverzeichnis
description: Die vier Stolpersteine, die in einem frisch gestarteten Container jedes Mal auftreten, bevor Tests überhaupt laufen können
---

Ein frisch gestarteter Remote-Container bringt weder eine laufende Datenbank
noch gesetzte Umgebungsvariablen mit. Diese vier Punkte kosten sonst jedes Mal
denselben Umweg.

**1. Postgres läuft nicht und stirbt zwischen Sessions.**
Das Cluster liegt unter `/var/lib/pgtest` und muss als Nutzer `postgres`
gestartet werden — als root verweigert `pg_ctl` den Dienst:

```
su postgres -c "/usr/lib/postgresql/*/bin/pg_ctl -D /var/lib/pgtest \
  -o '-c listen_addresses=127.0.0.1' -l /tmp/pg.log start"
```

`listen_addresses=127.0.0.1` ist Pflicht: Ohne den Schalter lauscht der Server
nur auf dem Unix-Socket, und jeder Client mit `postgres://…@127.0.0.1:5432`
bekommt `ECONNREFUSED`.

**2. `pg_isready` ohne `-h` lügt.**
Es schaut auf `/var/run/postgresql`, der Server lauscht aber woanders — Antwort
„no response", obwohl er läuft. Immer `pg_isready -h 127.0.0.1` prüfen. Wer
sich davon täuschen lässt, löscht am Ende die `postmaster.pid` eines laufenden
Servers.

**3. `DATABASE_URL` ist nicht gesetzt.**
`scripts/post-merge.sh` bricht sonst in `migrate-teams` ab, und zwar mit einer
irreführenden Meldung (`no PostgreSQL user name specified in startup packet`,
nicht etwa „Variable fehlt"). Immer explizit mitgeben:

```
DATABASE_URL="postgres://postgres@127.0.0.1:5432/dienstplan" bash scripts/post-merge.sh
```

Dieselbe Variable brauchen alle E2E-Läufe, dazu `ALLOW_PROD_SEED=1` (der
Sicherheitsabbruch von `setup-test-db` verlangt eine bekannte Produktions-
Identität; die lokale Wegwerf-DB hat keine) und
`REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE`, weil Playwright einen Chromium-Build
sucht, den der Container nicht hat:

```
REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1)
```

**4. Playwright muss aus `artifacts/dienstplan` laufen.**
Von woanders aus findet es die Config nicht, nimmt das aktuelle Verzeichnis als
`testDir` und scheitert mit *„Playwright Test did not expect test.describe() to
be called here"* plus *„No tests found"* — eine Fehlermeldung, die nach einem
kaputten Spec aussieht, aber nur das falsche Arbeitsverzeichnis meint. Da das
Bash-Arbeitsverzeichnis zwischen Aufrufen stehen bleibt und jederzeit
zurückspringen kann, den Wechsel in denselben Aufruf schreiben, nicht in einen
vorherigen.
