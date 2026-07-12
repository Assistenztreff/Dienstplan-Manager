---
name: Embed-mode sticky specs need shorter viewports
description: In ?embed=1 the platform header/footer are gone, so scroll-based e2e assertions can silently lose their scroll room.
---

Sticky/scroll e2e specs that assert "container actually scrolled >100px" depend on the content overflowing the viewport. In embed mode (`?embed=1`) the platform header AND footer placeholders are removed, so the same page is much shorter than in normal mode: at 400x700 the mobile month grid fits entirely (scrollTop stays 0), and at 400x560 only ~87px of scroll room remains.

**Why:** the scroll-precondition poll (`scrollTop > 100`) fails not because sticky broke but because there is nothing to scroll.

**How to apply:** embed-mode variants of scroll specs must use a shorter viewport than their normal-mode siblings (400x460 works for the mobile month grid) — or seed enough content. Don't copy the normal-mode viewport blindly.
