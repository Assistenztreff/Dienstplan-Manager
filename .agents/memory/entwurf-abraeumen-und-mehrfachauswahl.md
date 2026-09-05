---
name: Was ein neuer Entwurf abraeumen darf
description: Regeln fuer starteAutomatik, die Mehrfachauswahl und die Belegungsrechnung im Raster
---

Kays Rueckmeldung 05.09.2026, alles rund um den Knopf „Neuer Entwurf".

**Abgeraeumt wird nach dem Zustand im Raster, nicht nach einem Ref.** Frueher
merkte sich `letzterLaufIds` die IDs des letzten Laufs. Nach einem
Monatswechsel war es leer: Der Knopf hiess wieder „Entwurf erstellen" und
meldete „Alles besetzt — es sind keine Plätze offen", obwohl der Monat voller
Entwuerfe stand. `abraeumbareEntwuerfe()` in `dienstplan.tsx` entscheidet
jetzt aus den Daten:

- nur **VORLAEUFIG** (Entwurf). ANGEBOTEN (versendet) und FIX (bestaetigt)
  sind eine Zusage an die Assistenzkraft — die fasst der Lauf nie an, auch
  nicht zum Loeschen-Versuch (der Server wuerde es zusaetzlich verweigern,
  aber die Oberflaeche darf es gar nicht erst anbieten).
- nur Dienste des Regelplans, ab heute, keine Abwesenheiten, keine Spiegel.
- **bei offener Mehrfachauswahl nur die ausgewaehlten**: Was per Haken
  abgewaehlt wurde, soll ein neuer Entwurf nicht wegwerfen.

`hatEntwurf` (Beschriftung des Knopfes) kommt aus derselben Quelle — ein
`useState` stimmte nach dem Monatswechsel nicht mehr.

**Die Mehrfachauswahl schliesst sich**, sobald sie ihren Zweck erfuellt hat:
beim Bestaetigen SOFORT (nicht erst nach der letzten Server-Antwort, sonst
steht sie bei 87 Diensten lange offen) und beim Monatswechsel (ihre IDs
gehoerten zum Vormonat und haetten dort gewirkt).

**Belegung immer gegen ALLE Schichten rechnen.** `MonthGrid` bekommt neben
`shifts` (was der Personenfilter uebrig laesst) das Prop `alleShifts`. Ohne
das erschienen offene Plaetze fuer Dienste, die laengst von jemand anderem
besetzt sind, sobald man im Stundenkonto eine einzelne Person auswaehlte —
im Drei-Schicht-Modell besonders auffaellig. Merksatz: Was die Zelle ZEIGT,
richtet sich nach dem Filter; was sie als BESETZT zaehlt, nie.

**Der alte Autoplanungs-Dialog ist geloescht** (Menuepunkt „Automatische
Planung", `autoplanung-dialog.tsx`, `lib/autoplanung.ts` und die zugehoerigen
Tests). Die automatische Planung sitzt ausschliesslich in der
Planungsmodus-Leiste.
