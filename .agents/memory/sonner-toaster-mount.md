---
name: Sonner toasts need mounted Toaster
description: toast() from "sonner" silently no-ops unless the sonner <Toaster> component is mounted; the shadcn toaster does not render sonner toasts.
---

Two toast systems coexist in the web app: shadcn/Radix (`useToast` + `<Toaster>` from `components/ui/toaster`) and sonner (`toast` from "sonner" + `<Toaster>` from `components/ui/sonner`). Several pages call the sonner `toast`, and those calls render NOTHING unless the sonner Toaster is mounted at the app root (it now is, `position="top-center"`).

**Why:** The sonner wrapper existed but was never mounted, so plan-limit hints and other sonner toasts were silently swallowed — discovered only via an E2E assertion on toast text.

**How to apply:** When adding a page that shows toasts, either use the existing shadcn `useToast` or the sonner `toast` — both work — but never remove the sonner `<Toaster>` mount from the app root. When asserting toast text in E2E, beware duplicate matches (visible toast + aria-live announcer); scope the locator.
