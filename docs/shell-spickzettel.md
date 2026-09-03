# Shell-Spickzettel

Die Befehle, die im Alltag immer wieder gebraucht werden. Alle laufen im
Hauptordner `Dienstplan-Manager` — also dort, wo die `package.json` liegt.
Die Shell steht normalerweise schon dort.

Ein Befehl = eine Zeile. Kopieren, einfügen, Enter.

---

## 1. Wo bin ich gerade?

**Auf welchem Ast steht mein Rechner?**

```bash
git branch --show-current
```

**Alles auf einen Blick — Ast, Änderungen, letzter Stand:**

```bash
git status
```

**Welche Äste gibt es überhaupt?** (der eigene hat einen Stern davor)

```bash
git branch -a
```

---

## 2. Ast wechseln

**Auf den Arbeits-Ast dieser Session:**

```bash
git switch claude/session-starten-y2rf79
```

**Zurück auf den Hauptast:**

```bash
git switch main
```

**Ein Ast ist noch nicht auf dem Rechner?** Erst holen, dann wechseln:

```bash
git fetch origin
git switch claude/session-starten-y2rf79
```

---

## 3. Nach jedem Ast-Wechsel

Diese drei Zeilen der Reihe nach. Sie kosten eine Minute und ersparen die
meisten „Preview ist leer"-Momente:

```bash
pnpm install
rm -rf artifacts/dienstplan/node_modules/.vite
pnpm run db:push
```

Danach die Workflows neu starten (Frontend **und** API-Server) und die Seite
im Browser neu laden.

Warum jede Zeile nötig ist:

- `pnpm install` — Äste haben unterschiedliche Pakete. Fehlt eines, bricht die
  App beim Laden ab.
- `rm -rf ... .vite` — löscht den Zwischenspeicher. Ohne das arbeitet die
  Vorschau mit Dateien vom alten Ast weiter.
- `pnpm run db:push` — bringt die Datenbank auf den Stand des Asts.

**Fragt `db:push` nach Datenverlust?** Beim Wechsel **auf** einen Ast mit neuen
Feldern: bestätigen. Beim Wechsel **zurück auf `main`**: mit „No, abort"
abbrechen. Die zusätzlichen Spalten stören `main` nicht, und beim nächsten
Wechsel sind sie noch da.

---

## 4. Neuesten Stand holen

**Änderungen vom Server auf den aktuellen Ast holen:**

```bash
git pull origin $(git branch --show-current)
```

Danach die drei Zeilen aus Abschnitt 3.

---

## 5. Wenn die Vorschau leer bleibt oder Fehler zeigt

Der Reihe nach, bis es geht:

```bash
pnpm install
rm -rf artifacts/dienstplan/node_modules/.vite
```

Workflows neu starten, Seite neu laden.

Hilft das nicht: `F12` drücken, oben auf „Console" klicken und die erste rote
Zeile abschreiben. Da steht der eigentliche Grund.

---

## 6. Eigene Änderungen sichern

**Was habe ich verändert?**

```bash
git status
```

**Alles sichern und hochladen:**

```bash
git add -A
git commit -m "Kurz beschreiben, was geändert wurde"
git push origin $(git branch --show-current)
```

---

## 7. Tests laufen lassen

**Die schnellen Rechen-Tests** (ein paar Sekunden):

```bash
pnpm --filter @workspace/dienstplan exec vitest run
```

**Ein einzelner Oberflächen-Test**, hier die automatische Planung:

```bash
cd artifacts/dienstplan && pnpm exec playwright test dienstplan-automatik-verteilung
```

Wichtig: Oberflächen-Tests müssen aus `artifacts/dienstplan` starten. Deshalb
steht das `cd` im selben Befehl.

**Zurück in den Hauptordner:**

```bash
cd ~/Dienstplan-Manager
```

---

## 8. Notfall: alles zurück auf Anfang

**Eigene, noch nicht gesicherte Änderungen wegwerfen** — Achtung, das ist
endgültig:

```bash
git restore .
```

**Ganz von vorn mit den Paketen:**

```bash
rm -rf node_modules artifacts/dienstplan/node_modules
pnpm install
```
