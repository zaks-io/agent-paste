/** Reject open-redirect targets: only same-origin absolute paths are allowed. */
export function parseReturnPathname(raw: string | null | undefined): string | undefined {
  if (!raw?.startsWith("/") || raw.includes("\\") || raw[1] === "/" || raw[1] === "\\") return undefined;
  return raw;
}
