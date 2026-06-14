export const ACCEPTED_LOGO_TYPES = ["image/png", "image/jpeg"];
export const MAX_LOGO_BYTES = 5 * 1024 * 1024;

export function logoSrcFromPath(logoPath: string | null | undefined): string | null {
  if (!logoPath) return null;
  return `/api/storage${logoPath}`;
}
