---
name: Resend test-sender restriction
description: Resend's onboarding@resend.dev sender only delivers to the Resend account owner's email
---

Rule: With the default sender `onboarding@resend.dev`, Resend rejects any recipient other than the account owner's own email with 403 `validation_error` ("You can only send testing emails to your own email address").

**Why:** Discovered when activating operator alert mails — the recipient resolved to the DB superadmin (`betreiber@dienstplan.local`, a dev-only address) and Resend refused delivery. Fix was setting `ERROR_ALERT_EMAIL` to the Resend account address.

**How to apply:** Until a domain is verified at resend.com/domains (and `ERROR_ALERT_FROM` points to it), the alert recipient MUST be the Resend account owner's email. Don't rely on the DB-superadmin fallback with the test sender. The alert throttle is in-memory, so restarting the API server resets it — useful for repeat send tests.
