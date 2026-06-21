---
name: Cross-site iframe embedding (Dienstplan in Plattform)
description: What it takes to embed the React/Express Dienstplan SPA as a third-party iframe inside another site (the Assistenztreff/Lulububu Symfony platform) under its "Connect" menu.
---

# Embedding the SPA as a third-party iframe

The Dienstplan runs standalone (React static SPA + Express API + own Postgres) and is embedded via `<iframe>` into a *different* origin (the Assistenztreff platform). That makes the SPA a **third-party / cross-site** context, which breaks two things by default.

## 1. Session cookie must be SameSite=None; Secure
**Rule:** in a cross-site iframe the browser does NOT send a `SameSite=Lax` cookie at all — not even for requests the SPA makes to its own same-origin `/api` — because Lax requires the *top-level* site to be same-site. The session login then silently fails inside the iframe.
**Why:** observed/known browser SameSite semantics; Lax is gated on top-level navigation origin, not the request origin.
**How to apply:** in `artifacts/api-server/src/app.ts` the cookie is `sameSite: "none", secure: true` when `crossSiteCookie` is true (NODE_ENV=production OR `SESSION_COOKIE_CROSS_SITE=1`), else `lax`/insecure for local dev. Secure requires HTTPS, so cross-site mode only works on a deployed HTTPS origin.
**Known caveat:** Chrome's third-party-cookie phase-out can still partition/block SameSite=None cookies in iframes unless they are `Partitioned` (CHIPS) or the user grants Storage Access. express-session 1.19 does not obviously pass through `partitioned`. If iframe login fails specifically in Chrome, add Partitioned (e.g. a middleware that appends `; Partitioned` to Set-Cookie) before reaching for other fixes.

## 1b. SameSite=None forces strict CORS + CSRF guard (do NOT skip)
**Rule:** the moment the session cookie becomes `SameSite=None`, two latent protections vanish and MUST be replaced server-side:
- The pre-existing reflective credentialed CORS (`origin -> reflect any` + `credentials:true`) becomes a cross-origin data-exfil hole (any site can read authenticated responses). Replace with an explicit allowlist; default empty because SPA->/api is same-origin (even inside the iframe). In dev (Lax cookie) permissive reflection is left on for convenience.
- SameSite no longer blocks CSRF. Add an Origin/Referer-hostname check on unsafe methods (POST/PUT/PATCH/DELETE): allow same-host or allowlisted host; allow when NO Origin/Referer (native mobile/curl/server-to-server are not browser CSRF vectors); else 403.
**Why:** flagged by code review as a high-severity regression caused directly by the cookie change. Browsers send Origin on all cross-site POSTs, so the Origin check is a reliable CSRF defense and needs no frontend changes.
**How to apply:** both live in `artifacts/api-server/src/app.ts`, driven by `CORS_ALLOWED_ORIGINS` (comma-separated). A separately-hosted cross-origin client (e.g. Expo *web*) must be added there; native mobile sends no Origin so it just works.

## 2. Embedding host's CSP frame-src
The platform uses nelmio/security with CSP enabled and a `frame-src` whitelist (`config/packages/nelmio_security.yaml`). The Dienstplan deployment domain must be added to `frame-src` under BOTH the `enforce` and `report` blocks, or the iframe is blocked. This edit lives in the platform repo, not the Replit project, and needs the final deploy domain.

## 3. Embed chrome mode
`artifacts/dienstplan/src/lib/embed.ts` `isEmbedded()` keys off `?embed=1` (persisted in sessionStorage), deliberately NOT `window.top` auto-detection (the Replit preview is itself an iframe and would wrongly hide chrome). Layout hides the AssistenzTreff logo when embedded so the platform's own header/footer are the only chrome. The iframe URL must therefore include `?embed=1`.
