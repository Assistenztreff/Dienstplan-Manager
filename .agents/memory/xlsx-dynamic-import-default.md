---
name: xlsx dynamic import default interop
description: Warum (await import("xlsx")).default im Vite-Dev-Modus undefined ist und Excel-Downloads still scheitern lässt
---
Regel: CJS-Pakete wie `xlsx` nie über `.default` aus einem dynamischen Import lesen; immer `await import("xlsx").then((m) => m.default ?? m)`.
**Why:** Im Vite-Dev-Modus liefert das ESM-Interop für xlsx KEINEN default-Export → `.default` ist undefined → TypeError, den der Export-catch schluckt (kein Download, teils kein Toast). Im Prod-Build existiert default wieder — der Bug fällt nur im Dev/Preview auf.
**How to apply:** Bei "Download tut nichts, keine Fehlermeldung" zuerst den dynamischen Import im Seitenkontext direkt ausführen (page.evaluate) statt UI-Debugging.
