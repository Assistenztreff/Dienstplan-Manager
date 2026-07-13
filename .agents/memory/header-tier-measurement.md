---
name: Adaptive header tier measurement
description: Rules for the measured labels/icons/stack header escalation (Dienstplan-Kopfzeile) — reset key vs. remeasure key, and why min-w-0 wrappers break overflow detection.
---

# Adaptive header tier measurement

Two rules for the scrollWidth-based tier escalation (labels → icons → stack):

1. **Reset key vs. remeasure key.** Only content changes that genuinely change the
   *unknown* space requirement belong in the `contentKey` (which resets the tier to
   "labels" and clears hysteresis). Toggle states whose active variant is *narrower or
   equal* (e.g. active Mehrfachauswahl = icon-only X button) must go into a separate
   `remeasureKey` that only re-runs the overflow check from the CURRENT tier —
   otherwise every toggle click visibly flashes the header back to labels.

2. **No `min-w-0` wrappers around min-width flex children.** A wrapper with
   `min-w-0 shrink` can shrink below its child's `min-w-[…]`; the child then visually
   overlaps its siblings while the flex line still fits (`scrollWidth <= clientWidth`),
   so the overflow detection never fires. Shrinkable header items need REAL minimum
   floors on the whole chain so that genuine lack of space becomes measurable overflow.

**Why:** clicking Mehrfachauswahl at ~1024px reset the tier to labels and the
re-measurement never escalated back because the team switcher overlapped the assistant
filter instead of overflowing.

**How to apply:** when adding buttons/selects to the Dienstplan header, decide per
state: does it change required width upward-unknown (contentKey) or is it a narrower
toggle variant (remeasureKey)? Transient busy states whose text only changes in the
labels tier (e.g. export "Exportiere...") also belong in the remeasureKey. Never wrap
a min-width select in a `min-w-0` div in a measured row. Regression spec:
`dienstplan-kopfzeile-mehrfachauswahl-icons.spec.ts` (uses a MutationObserver to catch
even few-frame label flashes).
