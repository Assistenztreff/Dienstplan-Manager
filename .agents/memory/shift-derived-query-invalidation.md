---
name: Shift-abgeleitete Query-Invalidierung
description: Nach Schicht-/Abwesenheits-Writes alle abgeleiteten React-Query-Caches invalidieren (zentraler Helfer), nicht nur /api/shifts
---

# Shift-abgeleitete Query-Invalidierung (Web-Client)

**Regel:** Nach Anlegen/Ändern/Löschen von Schichten oder Abwesenheiten reicht
es NICHT, nur die `/api/shifts`-Listen zu invalidieren. Abgeleitet sind auch:
`/api/contracts` (Urlaubszähler inkl. `/api/contracts/{id}/vacation-balance`),
`/api/time-tracking` (Abwesenheiten buchen automatisch Ist-Zeiten) und
`/api/dashboard/*` (Stunden-/Budget-Salden, Zusammenfassung). Dafür gibt es den
zentralen Helfer `invalidateShiftDerivedQueries` (Präfix-Predicate) in der
Web-App-Lib `shift-cache.ts` — neue abgeleitete Endpunkte dort in die
Präfix-Liste aufnehmen, keine lokalen Invalidierungs-Predicates streuen.

**Why:** Die Lösch-UX patcht Listen sofort nach Server-Erfolg und gleicht nur
im Hintergrund ab — jeder vergessene abgeleitete Key zeigt dann dauerhaft
veraltete Salden (Review-Finding bei der Bulk-Delete-Einführung: Urlaubs- und
Zeiterfassungs-Caches blieben stale).

**How to apply:**
- Sofort-Reaktion: `removeShiftsFromCache` patcht NUR nach bestätigtem
  Server-Erfolg (kein optimistisches Löschen, kein Rollback nötig).
- Danach `void invalidateShiftDerivedQueries(queryClient)` — Hintergrund,
  UI nie auf das `await` warten lassen (das war die 2–3-s-Bremse).
- Bei Fehlern in Chunk-Ketten (Blöcke à 200): bereits bestätigte Blöcke
  trotzdem patchen + invalidieren, damit die Anzeige zur DB passt.
