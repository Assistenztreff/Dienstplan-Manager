---
name: Offline Bootstrap bewahrt Auth
description: auth.tsx bootstrap unterscheidet TypeError (Netzwerkfehler) von echten API-Fehlern und löscht den Auth-Zustand nur bei letzteren.
---

## Regel
In `auth.tsx` `bootstrap()` catch-Block: `instanceof TypeError` → **kein** `setCurrentUser(null)`.
Nur bei nicht-TypeError Exceptions (echte 4xx/5xx Antworten, die beim Parsen werfen) wird der Zustand geleert.

**Why:** Wenn der Nutzer offline ist und die App neu lädt, würde ein `TypeError` (fetch schlägt fehl) sonst den angemeldeten Nutzer aus dem State löschen → Redirect auf /login. Das OfflineBanner zeigt stattdessen den Hinweis.

**How to apply:**
```ts
} catch (error) {
  const isNetworkError = error instanceof TypeError;
  if (!isNetworkError && !cancelled) {
    setCurrentUser(null);
    storeSession(null);
  }
  return false;
}
```

## MutationCache + QueryCache
`App.tsx` hat jetzt:
- `MutationCache.onError`: Wenn `!navigator.onLine` → kein Toast (Banner zeigt bereits).
- `QueryCache.onError`: `TypeError && navigator.onLine` → einmaliger "Verbindung unterbrochen"-Toast (10s Cooldown).
- Hilfsfunktion `isNetworkError(error)`: `error instanceof TypeError`.
