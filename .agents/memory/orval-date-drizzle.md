---
name: Orval Date Coercion vs Drizzle Text Columns
description: How to handle the Date/string mismatch between Orval-generated body schemas and Drizzle text date columns
---

## The Problem

The Orval config has `body: ['bigint', 'date']` in the coerce settings. This makes Orval generate `z.coerce.date()` for any field with `format: date` in the OpenAPI spec. The parsed Zod value is a JavaScript `Date` object.

But Drizzle ORM's `text()` column type expects a `string`, not a `Date`. Passing `Date` to a `text()` column insert causes TS2769.

## The Fix

Use a helper function to convert Date objects to ISO date strings before Drizzle inserts:

```ts
function toDateString(val: unknown): string {
  if (val instanceof Date) return val.toISOString().split("T")[0]!;
  return String(val);
}

// In the POST handler:
await db.insert(contractsTable).values({
  ...body.data,
  startDate: toDateString(body.data.startDate),
  endDate: body.data.endDate ? toDateString(body.data.endDate) : undefined,
}).returning();
```

For timestamp columns (which Drizzle types as `Date`), use `new Date(value as unknown as string)` when Orval also coerces them to `Date` but the type annotation differs.

**Why:** Orval's coerce config converts body date strings to JS Date objects for Zod validation. Drizzle text() columns expect ISO date strings, not Date objects. TypeScript catches this mismatch.

**How to apply:** Whenever you insert body data containing Orval-coerced date fields into Drizzle `text()` date columns, always convert through `toDateString()`. Check if UpdateBody schema has the field before applying the conversion (patch bodies may omit startDate).
