/** Reject open-redirect targets: only same-origin absolute paths are allowed. */
export function parseReturnPathname(raw: string | null | undefined): string | undefined {
  if (!raw?.startsWith("/") || raw.startsWith("//")) return undefined;
  return raw;
}
