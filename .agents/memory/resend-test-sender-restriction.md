---
name: Resend test-sender restriction & domain verification
description: onboarding@resend.dev only delivers to the account owner's email; custom sender needs a verified domain, verification can lag DNS by hours
---

Rule: With the default sender `onboarding@resend.dev`, Resend rejects any recipient other than the account owner's own email with 403 `validation_error`. A custom sender (`ERROR_ALERT_FROM`) works only once its domain is `verified` at Resend.

**Why:** Discovered when activating operator alert mails — the recipient resolved to a dev-only address and Resend refused delivery. Later, the subdomain `mail.assistenztreff.de` was registered via the Resend API (`POST /domains`, region eu-west-1): even with DKIM/SPF DNS records correctly published and resolvable via 8.8.8.8/1.1.1.1 within minutes, Resend's DKIM check stayed `pending` for a long time (SPF verified quickly; Resend allows up to 72 h). Blocking a task on that flip is not viable.

**How to apply:**
- The alert mailer has a sender fallback: if the configured `ERROR_ALERT_FROM` is rejected with 403/422, it retries ONCE with the test sender — so `ERROR_ALERT_FROM` can be set before verification completes without silently losing alerts, and the custom sender takes over automatically once verified (env is read per send, no restart needed).
- With the test-sender fallback active, the recipient must remain the Resend account owner's email (`kontakt@assistenztreff.de`); free recipients only work reliably after verification.
- Resend domain management fully scriptable via API with `RESEND_API_KEY`: `GET/POST /domains`, `POST /domains/:id/verify` — only the DNS entries themselves need the user.
- The alert throttle is in-memory; restarting the API server resets it — useful for repeat send tests via `GET /api/dev/boom`.
