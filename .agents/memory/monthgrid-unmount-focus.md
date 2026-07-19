---
name: MonthGrid unmount on month change
description: Why cross-month keyboard focus state must live in the parent page, not MonthGrid.
---
Rule: any state that must survive a month switch in /dienstplan (e.g. "focus this day after navigation") must live in the page component, not in MonthGrid.
**Why:** on month change the shifts query reloads and the page renders the skeleton branch, unmounting MonthGrid — refs/state inside it are lost (an E2E test caught focus dropping to <body>).
**How to apply:** pass such state down as props; also note mobile AND desktop MonthGrid are mounted simultaneously, so focus effects must check `el.offsetParent !== null` and only the visible instance clears the pending state.
