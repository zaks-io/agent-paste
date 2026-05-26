/** Parses Worker `kid` vars such as `v1` / `v2` or plain integers into a numeric kid. */
export function parseKidLabel(label: string | undefined, fallback: number): number {
  if (!label) {
    return fallback;
  }
  const trimmed = label.trim().toLowerCase();
  const versionMatch = trimmed.match(/^v([1-9]\d*)$/);
  if (versionMatch?.[1]) {
    const parsed = Number.parseInt(versionMatch[1], 10);
    return parsed > 0 ? parsed : fallback;
  }
  const numericMatch = trimmed.match(/^\d+$/);
  if (numericMatch) {
    const parsed = Number.parseInt(numericMatch[0], 10);
    return parsed > 0 ? parsed : fallback;
  }
  return fallback;
}
