/** Reject open-redirect targets: only same-origin absolute paths are allowed. */
export function parseReturnPathname(raw: string | null | undefined): string | undefined {
  if (!raw?.startsWith("/") || raw.includes("\\") || raw[1] === "/" || raw[1] === "\\") return undefined;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters (CRLF, NUL, ...) are exactly what this rejects before the value reaches WorkOS.
  if (/[\x00-\x1f\x7f]/.test(raw)) return undefined;
  return raw;
}
