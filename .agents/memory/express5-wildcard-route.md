---
name: Express 5 Wildcard Route
description: app.get("*", ...) wirft PathError in Express 5 — Regex oder benannte Wildcard verwenden.
---

## Regel

`app.get("*", handler)` ist in Express 5 (path-to-regexp ≥ 8) **ungültig** und wirft beim Start:

```
PathError: Missing parameter name at index ${index}
```

Der Prozess startet, bindet aber nie an den Port — der Healthcheck schlägt mit 500 fehl.

**Why:** Express 5 verwendet path-to-regexp v8, das unbenannte Wildcards verbietet.

**How to apply:**

Ersetze `"*"` durch einen der folgenden Ausdrücke:

```typescript
// Option A — Regex (sicher in allen Express-5-Versionen)
app.get(/.*/, handler);

// Option B — benannte Wildcard (Express 5 Syntax)
app.get("*splat", handler);
```

Gilt für alle Catch-all-Routen (SPA-Fallback, Proxy-Catch-all, etc.).
