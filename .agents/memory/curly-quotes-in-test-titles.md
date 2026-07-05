---
name: Curly quotes in test() titles break parsing
description: German typographic quotes inside a Playwright/Babel test title string can round-trip to an ASCII double-quote and prematurely close the JS string.
---

# Curly quotes in test() titles break the Playwright/Babel parser

Writing a `test("…")` title that embeds German typographic quotes — e.g.
`test("„Widerrufen" sperrt …", …)` — can silently save the CLOSING quote as an
ASCII `"` (0x22) even when the OPENING is a real `„` (U+201E). The ASCII `"`
prematurely terminates the JS string, and Playwright's Babel transform dies with
`SyntaxError: Unexpected token, expected ","` pointing at the `test(` line.

**Why:** editors/tools do not always round-trip `“`/`”` faithfully; the closing
glyph can degrade to plain `"`. Comments are unaffected (any char is fine in a
comment), so the same phrase works in a comment but breaks in the title literal.

**How to apply:** keep `test(...)`/`describe(...)` title strings free of embedded
double-quote glyphs (straight or curly). Use plain words, single quotes, or
guillemets («…») if emphasis is needed. Curly quotes remain fine inside comments
and inside assertion messages that are their own separate string args.
