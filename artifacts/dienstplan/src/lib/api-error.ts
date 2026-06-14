import { ApiError } from "@workspace/api-client-react";

function pickString(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  if (typeof candidate !== "string") return undefined;
  const trimmed = candidate.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Liefert eine lesbare Fehlermeldung aus einer API-Antwort.
 *
 * Bevorzugt das vom Server gelieferte Detail (`error` / `message` / `detail` /
 * `title`); fällt nur auf den übergebenen generischen Text zurück, wenn keine
 * verwertbare Serverantwort vorliegt (z. B. Netzwerkfehler).
 */
export function readableApiError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const data = err.data;

    if (typeof data === "string" && data.trim() !== "") {
      return data.trim();
    }

    const detail =
      pickString(data, "error") ??
      pickString(data, "message") ??
      pickString(data, "detail") ??
      pickString(data, "title");

    if (detail) return detail;
  }

  return fallback;
}
