---
tags: [projekt, dienstplan, arbeitsanweisung, menue-neustrukturierung]
date: 2026-08-05
status: bereit-fuer-replit
---

# Arbeitsanweisung für Replit: Menü-Neustrukturierung AssistenzPlaner

**Geltungsbereich:** ausschließlich Navigationsstruktur (`artifacts/dienstplan/src/components/layout.tsx` + zugehörige Mobile-/Header-Komponenten). **Kein Eingriff** in Kalender-, Pillen-, Icon- oder Tabellen-Design (siehe §8 „Was unangetastet bleibt").

**Basis:** UX-Analyse `UX-Analyse-AssistenzPlaner-Menue-IA.md`, Aufwandsschätzung `Aufwandsschaetzung-Menue-Neustrukturierung.md`, Gegenprüfung gegen den echten Code-Stand (GitHub, Stand 2026-08-05). Alle Rollen-/Sichtbarkeitsangaben unten sind 1:1 aus dem aktuellen `layout.tsx` übernommen, nicht neu erfunden.

---

## §0 Ziel

Die aktuelle flache 8-Punkte-Navigation (Dashboard · Dienstplan · Assistenten · Zeiterfassung · Abwesenheiten · Auswertungen · Team-Verwaltung · Einstellungen) wird auf **5 aufgabenbasierte Hauptpunkte** reduziert, ohne dass eine einzige Funktion, Route oder Berechtigungsregel verloren geht. Zwei der 5 Punkte bekommen eine zweite Tab-Ebene.

## §1 Ziel-Struktur

| Neuer Hauptpunkt | Enthält (bisherige Einzelpunkte) | Icon (Top-Nav, Emoji laut Icon-Design-Entscheidung) |
|---|---|---|
| **Start** | Dashboard | 🏠 |
| **Planen** | Dienstplan (Tab „Kalender/Tabelle", wie im Kalender-Redesign bereits vorgesehen) + Abwesenheiten (als 2. Tab) | 📅 |
| **Erfassen** | Zeiterfassung | 🕐 |
| **Auswerten** | Auswertungen | 📊 |
| **Verwalten** | Assistenten + Team-Verwaltung + Einstellungen (als 3 Tabs) | ⚙️ |

## §2 Datenmodell-Umbau `ALL_NAV_ITEMS`

**Ist-Zustand (Zitat aus `layout.tsx`, Zeile 29–37):**

```ts
const ALL_NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, adminOnly: false, dienstleisterOnly: false, teamleiterAllowed: false },
  { href: "/dienstplan", label: "Dienstplan", icon: CalendarDays, adminOnly: false, dienstleisterOnly: false, teamleiterAllowed: false },
  { href: "/assistenten", label: "Assistenten", icon: Users, adminOnly: true, dienstleisterOnly: false, teamleiterAllowed: true },
  { href: "/zeiterfassung", label: "Zeiterfassung", icon: Clock, adminOnly: false, dienstleisterOnly: false, teamleiterAllowed: false },
  { href: "/abwesenheiten", label: "Abwesenheiten", icon: CalendarOff, adminOnly: true, dienstleisterOnly: false, teamleiterAllowed: true },
  { href: "/auswertungen", label: "Auswertungen", icon: BarChart3, adminOnly: true, dienstleisterOnly: false, teamleiterAllowed: true },
  { href: "/team-verwaltung", label: "Team-Verwaltung", icon: Building2, adminOnly: true, dienstleisterOnly: false, teamleiterAllowed: true },
  { href: "/einstellungen", label: "Einstellungen", icon: Settings, adminOnly: false, dienstleisterOnly: false, teamleiterAllowed: false },
];
```

**Neu:** Struktur um eine optionale `children`-Ebene erweitern, Top-Level-Filterlogik bleibt für die Gruppe maßgeblich, jedes Kind behält seine eigenen Flags 1:1:

```ts
const ALL_NAV_ITEMS = [
  { href: "/", label: "Start", icon: LayoutDashboard, adminOnly: false, dienstleisterOnly: false, teamleiterAllowed: false },
  {
    label: "Planen", icon: CalendarDays,
    children: [
      { href: "/dienstplan", label: "Dienstplan", adminOnly: false, dienstleisterOnly: false, teamleiterAllowed: false },
      { href: "/abwesenheiten", label: "Abwesenheiten", adminOnly: false, dienstleisterOnly: false, teamleiterAllowed: false },
    ],
  },
  { href: "/zeiterfassung", label: "Erfassen", icon: Clock, adminOnly: false, dienstleisterOnly: false, teamleiterAllowed: false },
  { href: "/auswertungen", label: "Auswerten", icon: BarChart3, adminOnly: true, dienstleisterOnly: false, teamleiterAllowed: true },
  {
    label: "Verwalten", icon: Settings,
    children: [
      { href: "/assistenten", label: "Assistenten", adminOnly: true, dienstleisterOnly: false, teamleiterAllowed: true },
      { href: "/team-verwaltung", label: "Team-Verwaltung", adminOnly: true, dienstleisterOnly: false, teamleiterAllowed: true },
      { href: "/einstellungen", label: "Einstellungen", adminOnly: false, dienstleisterOnly: false, teamleiterAllowed: false },
    ],
  },
];
```

**Wichtig — bewusst KEINE Änderung an den Flag-Werten selbst.** Jedes Kind trägt exakt seine bisherigen `adminOnly`/`dienstleisterOnly`/`teamleiterAllowed`-Werte weiter. Die vorhandene Filterfunktion (Zeile 301–304 bzw. 492–495) bleibt inhaltlich identisch, wird nur rekursiv auf `children` angewendet:

```ts
(!item.adminOnly || isAdminRole(currentUser?.role) || (item.teamleiterAllowed && currentUser?.isTeamleiter))
  && (!item.dienstleisterOnly || currentUser?.accountType === "dienstleister")
  && (item.href !== "/zeiterfassung" || timeTrackingEnabled)
```

Eine Gruppe (Planen/Verwalten) wird nur angezeigt, wenn **mindestens ein** Kind nach Filterung sichtbar bleibt.

## §3 Entscheidung von Oli — Sichtbarkeit „Abwesenheiten" für reine Assistenzkräfte

**Gefunden bei der Code-Gegenprüfung:** „Abwesenheiten" ist im Ist-Zustand `adminOnly: true` (nur Admin oder Teamleiter sehen den Menüpunkt). Eine reine Assistenzkraft ohne Teamleiter-Status hat aktuell **keinen Menüzugriff** auf Abwesenheiten.

**Entschieden: Option B (Erweiterung).** Assistenzkräfte bekommen Zugriff auf den „Abwesenheiten"-Tab. Konkret bedeutet das über die reine Nav-Struktur hinaus (§2 setzt dafür `adminOnly: false`, damit der Tab im Menü grundsätzlich sichtbar wird):

- **Nav-Ebene (Teil dieser Arbeitsanweisung):** Tab „Abwesenheiten" ist für alle Rollen sichtbar, keine Sonderlogik mehr über `adminOnly`.
- **Seiten-Ebene (`abwesenheiten.tsx`) — zusätzlicher Scope, mit umzusetzen:**
  - Assistenzkraft sieht standardmäßig **nur eigene** Abwesenheitseinträge und den Abwesenheitskalender lesend (analog zur bestehenden Server-Regel bei `GET /contracts/:id/vacation-balance`: „Assistenten NUR eigene Bilanz, fremder Vertrag → 404" — dasselbe Muster hier für die Listenansicht anwenden).
  - **Anlegen/Bearbeiten fremder Einträge bleibt Admin/Teamleiter vorbehalten.** Eigene Urlaub/Krankheit-Einträge darf die Assistenzkraft weiterhin anlegen (serverseitig laut `replit.md` ohnehin für alle Pläne/Rollen offen: „Eintragen von Urlaub/Krankheit… bleiben für ALLE Pläne zugänglich").
  - Direktanlage im Kalender (aus `HANDOFF-abwesenheiten-menue.md`) gilt entsprechend: Assistenzkraft kann eigene Abwesenheit direkt im Kalender anlegen, keine fremden.
- **API-Server:** prüfen, ob `GET /shifts`/Abwesenheiten-Endpunkte für Assistenten bereits korrekt auf „eigene Daten" scopen (laut Rollen-Modell `assistant: nur eigene Daten` sollte das schon serverseitig gelten) — falls nicht, ist das ein Backend-Fix, kein reines Frontend-Nav-Thema, bitte in der Umsetzung kurz gegenprüfen und ggf. als Zusatzaufwand melden.

## §4 Tab-Ebene „Planen"

- Zwei Tabs: **Kalender/Tabelle** (bestehende `/dienstplan`-Seite, Umschalter Kalender↔Tabelle bleibt wie im Kalender-Redesign) und **Abwesenheiten** (bestehende `/abwesenheiten`-Seite inkl. neuem Abwesenheitskalender aus `HANDOFF-abwesenheiten-menue.md`).
- **URLs bleiben bestehen**: `/dienstplan` und `/abwesenheiten` bleiben eigene Routen. Die Tab-Umschaltung ändert nur die Menü-Zuordnung/Optik, keine Routenzusammenlegung — vermeidet Breaking Changes bei Bookmarks/Deep-Links (siehe §7).
- Sticky-Header-Anker (§6) wandert auf die Tab-Leiste „Planen".

## §5 Tab-Ebene „Verwalten"

- Drei Tabs: **Assistenten**, **Team-Verwaltung**, **Einstellungen** — analog §4, URLs bleiben `/assistenten`, `/team-verwaltung`, `/einstellungen`.
- **Team-Verwaltung-Sichtbarkeit (Korrektur nach Code-Gegenprüfung):** NICHT auf Dienstleister-Konten beschränkt. Sichtbar für Admin ODER Teamleiter, unabhängig vom `accountType`. Teamleiter-Feature ist bereits vollständig umgesetzt (`is_teamleiter`/`can_view_payroll` in `team_members`, siehe `docs/umgesetzt-teamleiter-feature.md`). `replit.md` ist an dieser Stelle veraltet (dort steht fälschlich „geplant, noch nicht implementiert") — bei dieser Aufgabe nicht mehr berücksichtigen.
- Eine reine Assistenzkraft ohne Teamleiter-Status sieht unter „Verwalten" nur den Tab „Einstellungen" (eigenes Profil).

## §6 Sticky-Header

Bestehende Mechanik (`useHeaderTier`, `PageStickyHeader`, §1 der Kalender-Arbeitsanweisung) bleibt vollständig erhalten. Nur der Anker wechselt von einzelnen Menüpunkten auf die jeweils aktive Tab-Gruppe („Planen"/„Verwalten"). Keine neue Sticky-Logik nötig.

## §7 Deep-Links, Bookmarks, Bestandsschutz

- Da `/abwesenheiten`, `/assistenten`, `/team-verwaltung`, `/einstellungen` als Routen bestehen bleiben (§4/§5), sind KEINE Redirects nötig — bestehende Links/Bookmarks/etwaige E-Mail-Benachrichtigungen funktionieren unverändert weiter.
- Beim Direktaufruf einer Kind-Route (z. B. Lesezeichen auf `/abwesenheiten`) muss die neue Navigation automatisch die richtige Tab-Gruppe („Planen") als aktiv markieren — kurzer Test dafür in §10 aufnehmen.

## §8 Was unangetastet bleibt (explizit NICHT Teil dieser Aufgabe)

- Kalender-/Pillen-/Icon-Design (3px-Farbbalken, Status-Icons, Uhrzeit-Anzeige, responsives Verhalten Desktop/Tablet/Smartphone) — vollständig in der bestehenden Arbeitsanweisung `Dienstplan-Kalenderansicht-Kompaktierung-Replit-Auftrag.md` geregelt, hier nicht anfassen.
- Inhalt/Funktionsumfang von Abwesenheitskalender, Direktanlage im Kalender, Verknüpfung Tagesleiste→Abwesenheitskalender — eigenes Arbeitspaket laut `HANDOFF-abwesenheiten-menue.md`.
- Tabellenansicht-Design (noch nicht begonnen, separates Arbeitspaket).
- **Handbuch-Skill „Handbuch aktualisieren"** (`.agents/skills/handbuch-aktualisieren`): NICHT im Rahmen dieses Auftrags ausführen. Diese Funktion ändert zusätzlich zu Screenshots auch Handbuch-**Texte** „auf Aktualität" — das ist Scope-Creep-Risiko und gehört als eigener, späterer Schritt NACH der Menü-Umsetzung separat beauftragt, nicht automatisch nebenbei.

## §9 Mobile-Vollbildmenü (`MobileFullMenu`)

Gruppierung 1:1 auf die neue 5-Punkte-Struktur übertragen; „Planen"/„Verwalten" klappen als Akkordeon mit ihren Kind-Einträgen auf, exakt wie im Mockup `alle-menues-mockup.html` gezeigt. Kein neues Verhalten, nur neue Gruppierung bestehender Einträge.

## §10 Tests

- Betrifft laut `replit.md`-Klassifizierung (`validation-scope.ts`) die Kategorie **frontend** → nur `test:e2e:smoke` läuft automatisch in der gestaffelten Kette, volle E2E-Suite NICHT „just in case" fahren (Kostenregel aus `replit.md` beachten).
- E2E-Selektoren/Klickpfade aktualisieren, die bisher über die alte Top-Nav-Struktur navigieren (z. B. direkter Klick auf „Abwesenheiten" in der Hauptleiste → jetzt „Planen" → Tab „Abwesenheiten").
- Neuer Test: Direktaufruf von `/abwesenheiten`, `/team-verwaltung` etc. markiert die korrekte Tab-Gruppe als aktiv (§7).
- Rollen-Matrix-Regressionstest (Assistenznehmer/Assistenzkraft/Teamleiter/Dienstleister-Admin): richtige Tabs sichtbar/unsichtbar je Rolle, insbesondere Team-Verwaltung (§5-Korrektur) und die Entscheidung aus §3.

## §11 Vorgehen (Kostenregeln aus `replit.md`)

1. Vor dem Bauen: Plan/Discuss-Modus, diese Arbeitsanweisung kurz bestätigen lassen (insbesondere §3 klären).
2. Kleine, abgegrenzte Schritte: zuerst Datenmodell (§2), dann Rendering Desktop (§4/§5), dann Mobile (§9), dann Tests (§10) — nicht alles gleichzeitig.
3. Bei fehlschlagenden Checks: Ursache in 1–2 Sätzen erklären, max. 2 automatische Korrekturversuche, danach stoppen und melden.
4. Session-Ende: kurze Zusammenfassung (was gemacht, Anläufe, Probleme).

## §12 Akzeptanzkriterien

- [ ] Top-Navigation zeigt max. 5 Hauptpunkte (rollenabhängig weniger), keine Funktion entfernt.
- [ ] „Planen" und „Verwalten" zeigen ihre Kind-Tabs, URLs bleiben bestehen (`/dienstplan`, `/abwesenheiten`, `/assistenten`, `/team-verwaltung`, `/einstellungen`).
- [ ] Team-Verwaltung sichtbar für Admin ODER Teamleiter, unabhängig von `accountType` (§5).
- [ ] „Abwesenheiten"-Tab für alle Rollen sichtbar (§3); Assistenzkraft sieht/verwaltet nur eigene Einträge, fremde Einträge bleiben Admin/Teamleiter vorbehalten.
- [ ] Direktaufruf jeder Kind-Route markiert die richtige Tab-Gruppe aktiv.
- [ ] Mobile-Vollbildmenü zeigt dieselbe Gruppierung als Akkordeon.
- [ ] Sticky-Header funktioniert unverändert auf der neuen Tab-Ebene.
- [ ] Kalender-/Pillen-/Icon-Design unverändert (Pixel-Diff/Screenshot-Vergleich vor/nach).
- [ ] `pnpm run typecheck` + `test:e2e:smoke` grün.
- [ ] Rollen-Matrix-Regressionstest manuell durchgespielt (§10).
- [ ] Handbuch-Screenshot-Fingerprint-Check läuft mit und ist grün (`screenshots:handbuch:check` / `pnpm run screenshots:handbuch` neu erzeugen, da sich die Nav-Optik ändert) — reine Bild-Regeneration, NICHT die größere Skill-Funktion „Handbuch aktualisieren" (siehe §8).

## §13 Aufwand

Referenz: `Aufwandsschaetzung-Menue-Neustrukturierung.md` — grober Richtwert ca. 4–5,5 Personentage für die reine Struktur-Umsetzung. **Zusatz durch §3-Entscheidung B:** Rechte-/Scoping-Logik in `abwesenheiten.tsx` (+ ggf. API-Server-Check) ist zusätzlicher Aufwand, grob geschätzt +0,5–1 Personentag — vom Replit-Agenten beim Start gegenschätzen lassen.

---

**Reihenfolge der Gesamt-Umsetzung (Erinnerung):** 1) diese Arbeitsanweisung (Menü), 2) Kalender/Tabellen/Pillen/Icons-Redesign (bereits eigene Arbeitsanweisung), 3) Abwesenheitskalender-Funktionsumfang (`HANDOFF-abwesenheiten-menue.md`).
