---
name: Auth & Route Handler Patterns
description: How to write Express middleware and route handlers without TS7030 errors in this project
---

## The Problem

Adding a middleware (e.g. `requireAdmin`) as the first argument to `router.get(path, middleware, handler)` causes TypeScript to use a stricter overload that enforces all code paths return a value in the handler (TS7030).

## The Fix

All async route handlers must use explicit `Promise<void>` return type and use `res.json(); return;` pattern (never `return res.json()`):

```ts
router.get("/route", requireAdmin, async (req, res): Promise<void> => {
  if (!valid) {
    res.status(400).json({ error: "..." });
    return;
  }
  res.json(data); // no return needed at the end
});
```

## Middleware Pattern

Middleware must explicitly return `void` and use early-exit `return` after sending the response:

```ts
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.userId) {
    res.status(401).json({ error: "Nicht angemeldet" });
    return;
  }
  next();
}
```

**Why:** `return res.json()` makes TypeScript infer the function returns `Response | undefined`, which conflicts with Express's stricter multi-handler overloads.

**How to apply:** Any time you add middleware to an existing route, update the handler to use `Promise<void>` return type and split `return res.json()` into `res.json(); return;`.

## Session Type Augmentation

Session augmentation must be in `src/middleware/auth.ts`:

```ts
declare module "express-session" {
  interface SessionData {
    userId: number;
    role: "admin" | "assistant";
  }
}
```

## req.params Access

Use `req.params["id"]` (bracket notation) instead of `req.params.id` to avoid `string | string[]` type errors in multi-middleware route handlers.
