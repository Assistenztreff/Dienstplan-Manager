# Design Guidelines – AssistenzPlaner

Gilt für den gesamten AssistenzPlaner-Code (`artifacts/dienstplan`, `artifacts/api-server`, `artifacts/mobile`). Wird von `replit.md` referenziert – der Agent berücksichtigt diese Regeln bei jedem Task automatisch, ohne dass sie erneut in die Arbeitsanweisung geschrieben werden müssen.

Quelle/Pflege: [[00 Kontext/Schreibstil-Plattformen]] im Obsidian-Vault des Auftraggebers ist die führende Version für den Text-Teil. Bei Abweichungen zählt die Vault-Datei, diese Datei hier bitte danach synchron halten.

---

## 1. Wer nutzt die Plattform

1. **Menschen mit Behinderung** (Assistenznehmer, oft im Arbeitgebermodell) – erwarten Selbstbestimmung auf Augenhöhe, keine Fürsorge-Sprache, kein Mitleid, kein Amtsdeutsch.
2. **Assistenzkräfte** – nutzen die App nebenbei am Handy, wollen schnell verstehen, was zu tun ist.
3. **B2B: Assistenzdienste & Unternehmen** – erwarten Professionalität und klaren Nutzen, aber keine Konzern-Floskeln.

Barrierefreiheit ist hier kein Nice-to-have, sondern Kernanforderung – ein relevanter Teil der Nutzer ist auf zugängliche Bedienung angewiesen.

---

## 2. Tonalität & Texte

**Modern und selbstbewusst wie ein junges Startup – aber immer in einfacher Sprache.**

- Direkt und auf Augenhöhe, erklären statt belehren.
- Kurze Sätze, ein Gedanke pro Satz, aktiv statt Passiv.
- Selbstbewusst ohne Übertreibung: kein „revolutionär", „einzigartig", „disruptiv".
- Locker, aber nie albern – kein Kalauer-Humor in Überschriften. Es geht um Löhne und Verträge, Vertrauen geht vor Witz.
- Konkret statt abstrakt: „PDF-Stundennachweis für dein Lohnbüro" statt „umfassende Abrechnungslösungen".
- **Ansprache:** durchgängig Du, auch im B2B. Ausnahme: Rechtstexte (Impressum, Datenschutz, AGB) und individuelle B2B-Angebote dürfen siezen.

### Feste Begriffe (immer gleich verwenden)

| Begriff | Nicht verwenden |
|---|---|
| Assistenzkraft | Mitarbeiter, Pfleger, Betreuer, Helfer |
| Assistenznehmer | Klient, Patient, Betroffener, Pflegebedürftiger |
| Assistenzdienst | Pflegedienst, Anbieter |
| Arbeitgebermodell | (nicht umschreiben, ggf. kurz erklären) |
| Dienst / Dienstplan | Schicht / Schichtplan (nur intern im Code ok) |
| Team | Gruppe |
| Teamleiter | Manager, Vorgesetzter |

### UI-Texte

- **Buttons:** Verb zuerst, sagen was passiert – „Dienst anlegen", „Jetzt kostenlos registrieren". Nie „OK", „Absenden", „Weiter" ohne Kontext.
- **Fehlermeldungen:** immer zweiteilig – was ist passiert + was kann der Nutzer tun. Nie Schuldzuweisung, nie nackte Technik-Codes.
- **Leere Zustände:** freundlich + nächste Aktion anbieten.
- **Bestätigungen:** kurz und positiv, höchstens ein Ausrufezeichen.

**Beispiele:**
- So ja: „Dein Team meldet sich selbst an und sieht die eigenen Dienste immer aktuell – ganz ohne Gruppenchat und Zettel."
- So nicht (zu bürokratisch): „Die Mitarbeitenden erhalten die Möglichkeit, nach erfolgter Registrierung ihre jeweiligen Einsatzzeiten einzusehen."
- So nicht (zu flapsig): „Stundenzettel? Geschichte. Dienstplan? Digital."

---

## 3. Barrierefreiheit – technischer Stand & Regeln

### Umgesetzt: barrierefreies Farbsystem

- **8 feste Hell/Dunkel-Paarungen** (`lib/barrierefreie-farben.ts`): Mint, Hellgelb, Grün, Pfirsich, Lila, Rosa, Terrakotta, Salbei. Jede Paarung kombiniert eine helle Fläche mit einer geprüften Textfarbe (≥ 4,5:1 Kontrast, WCAG AA) – `assistenz-brand` (#05305B) oder `assistenz-darkText` (#26092E). Je drei Varianten: Badge, Dot, Initials.
- **`getBarrierefreieFarbe(key)` ist die einzige erlaubte Quelle für Personenfarben.** Kein neuer Code baut eigene Farbklassen für Personen/Status – immer diese Funktion verwenden. Aliase decken Status-Keys ab (`draft` → gelb, `confirmed` → grün usw.).
- CSS-Tokens als `@theme`-Variablen in `index.css` (`--color-assistenz-mint` usw. + dunkle Pendants) für Tailwind v4.
- Abwesenheiten (Urlaub, Krank, Freizeitausgleich) haben eigene semantische Farben außerhalb der 8er-Palette – Gelb bedeutet nie gleichzeitig „Person" und „Urlaub".
- `text-primary` (Hellgelb) nie als Textfarbe verwenden, stattdessen `text-assistenz-brand`.
- Automatischer Test `barrierefreie-farben.test.ts` prüft alle 8 Paarungen auf WCAG-AA-Konformität – **muss bei jeder Änderung an der Palette grün bleiben.**

### Noch offen (bei neuen Features mitdenken, nicht ignorieren)

- **Nie Information nur über Farbe transportieren** – farbige Badges/Chips brauchen zusätzlich Text oder Icon.
- **Tastaturbedienbarkeit:** alle interaktiven Elemente per Tab erreichbar und bedienbar.
- **Screenreader:** aussagekräftige `aria-label`s, besonders bei Icon-only-Buttons und farbigen Badges. Linktexte sagen, wohin sie führen („Zum Handbuch", nicht „hier klicken").
- **Sichtbarer Fokus-Zustand** auf allen interaktiven Elementen.
- **Touch-Ziele auf Mobile** ausreichend groß (mind. 44×44px).

Für eine strukturierte Prüfung dieser Punkte: `design:accessibility-review` nutzen, sobald ein größerer a11y-Durchgang ansteht.

---

## 4. Pflegehinweis

Diese Datei wird von `replit.md` referenziert und sollte bei Änderungen an Tonalität, Begriffen oder Barrierefreiheits-Stand aktualisiert werden. Führende Quelle für den Text-Teil ist [[00 Kontext/Schreibstil-Plattformen]] im Vault des Auftraggebers.
