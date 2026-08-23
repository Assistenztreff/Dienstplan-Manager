---
name: Persistierter Query-Cache bei Einstellungen
description: Schutz vor alten React-Query-Werten, die nach Reload aktuelle Server-Einstellungen und abhängige Anzeigen überdecken.
---

Persistierte Einstellungsabfragen dürfen einen alten Cachewert nach einem Reload nicht dauerhaft in ein Formular übernehmen. Ein verpflichtender Server-Refetch muss das Formular aktualisieren dürfen, solange der Nutzer keine ungespeicherten Änderungen vorgenommen hat. Fachlich abhängige Anzeigen müssen ebenfalls invalidiert oder beim Öffnen frisch gelesen werden; während dieses Reads darf kein alter Cachewert als aktueller Stand erscheinen.

**Why:** Eine Änderung wurde korrekt als `false` gespeichert und vom Server so zurückgegeben. Nach sofortigem Reload hydratisierte React Query aber zuerst den alten `true`-Wert. Eine einmalige Formular-Hydrierung blockierte danach die frische Serverantwort; eine abhängige Bilanz konnte zusätzlich ihre Invalidierungsmarkierung durch den Reload verlieren.

**How to apply:** Für selten geänderte Einstellungen mit persistiertem Cache beim Mount frisch lesen. Formular-Refetches nur bei einem echten Dirty-State blockieren. Abhängige Queries nach dem Speichern invalidieren und bei sicherheits- oder fachlich relevanten Anzeigen den alten Cache während des frischen Reads nicht rendern.