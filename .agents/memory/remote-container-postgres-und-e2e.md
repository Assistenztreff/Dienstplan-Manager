---
name: Frischer Remote-Container — Postgres, DATABASE_URL, Playwright-Arbeitsverzeichnis
description: Die vier Stolpersteine, die in einem frisch gestarteten Container jedes Mal auftreten, bevor Tests überhaupt laufen können
---

Ein frisch gestarteter Remote-Container bringt weder eine laufende Datenbank
noch gesetzte Umgebungsvariablen mit. Diese vier Punkte kosten sonst jedes Mal
denselben Umweg.

**1. Postgres läuft nicht und stirbt zwischen Sessions.**
`pg_ctl` verweigert als root den Dienst — es braucht den Eigentümer-Nutzer des
Clusters. **Datenordner und Nutzer unterscheiden sich je Container**: gesehen
wurden `/var/lib/pgtest` mit Nutzer `postgres` und `/home/user/pgdata` mit
Nutzer `pg`. Deshalb nicht abschreiben, sondern suchen — der Datenordner ist
der, der eine `PG_VERSION` enthält, und sein Eigentümer ist der richtige Nutzer:

```
ls -d /var/lib/pgtest /home/user/pgdata 2>/dev/null   # Kandidaten
stat -c '%U %n' <gefundener-ordner>                   # Eigentümer = Startnutzer
su <nutzer> -c "/usr/lib/postgresql/*/bin/pg_ctl -D <ordner> \
  -o '-c listen_addresses=127.0.0.1' -l /tmp/pg.log start"
```

`listen_addresses=127.0.0.1` ist Pflicht, sobald ein Client über TCP kommt:
Ohne den Schalter lauscht der Server nur auf dem Unix-Socket, und jede
`postgres://…@127.0.0.1:5432` bekommt `ECONNREFUSED`. Wo der Socket liegt,
variiert ebenfalls (`/tmp` per `-k /tmp` gesehen) — auch das ist ein Grund,
über TCP zu gehen statt über den Socket-Pfad zu raten.

**2. `pg_isready` ohne `-h` lügt.**
Es schaut auf `/var/run/postgresql`, der Server lauscht aber woanders (`/tmp`
oder nur TCP) — Antwort „no response", obwohl er läuft. Immer
`pg_isready -h 127.0.0.1` prüfen. Wer sich davon täuschen lässt, hält einen
laufenden Server für tot und löscht ihm die `postmaster.pid` weg; das ist in
einer früheren Session genau so passiert.

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

Frühere Sessions haben sich diese Variablen in ein `/tmp/dienstplan-test-env.sh`
gelegt und es per `source` geladen. Die Datei liegt in `/tmp` und ist damit nach
einem Containerwechsel weg — ist sie nicht da, die Variablen direkt vor den
Befehl schreiben, statt sie zu suchen.

**4. Playwright muss aus `artifacts/dienstplan` laufen.**
Von woanders aus findet es die Config nicht, nimmt das aktuelle Verzeichnis als
`testDir` und scheitert mit *„Playwright Test did not expect test.describe() to
be called here"* plus *„No tests found"* — eine Fehlermeldung, die nach einem
kaputten Spec aussieht, aber nur das falsche Arbeitsverzeichnis meint. Da das
Bash-Arbeitsverzeichnis zwischen Aufrufen stehen bleibt und jederzeit
zurückspringen kann, den Wechsel in denselben Aufruf schreiben, nicht in einen
vorherigen.
