---
name: Bodyless POST req.body is undefined
description: Destructuring req.body on a POST that may arrive without a JSON body crashes Express; guard with ?? {}
---

The web auto-login calls `POST /api/auth/dev-login` with no `Content-Type`/body. Express's
json parser leaves `req.body` **undefined** in that case (not `{}`). Any handler that does
`const { x } = req.body` then throws `Cannot destructure property ... of req.body as it is undefined`.

**Rule:** when a POST handler can be reached without a body, destructure defensively: `const { x } = (req.body ?? {}) as {...}`.

**Why:** the dev auto-login path (default test-user login) is bodyless; adding optional body fields to that route silently broke the default login until guarded.

**How to apply:** any route that both auto-fires bodyless AND later gained optional body params (dev-login is the concrete case).
