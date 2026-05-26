/** Parses Worker `kid` vars such as `v1` / `v2` or plain integers into a numeric kid. */
export function parseKidLabel(label: string | undefined, fallback: number): number {
  if (!label) {
    return fallback;
  }
  const trimmed = label.trim().toLowerCase();
  const versionMatch = trimmed.match(/^v(\d+)$/);
  if (versionMatch?.[1]) {
    return Number.parseInt(versionMatch[1], 10);
  }
  const numeric = Number.parseInt(trimmed, 10);
  if (Number.isInteger(numeric) && numeric > 0) {
    return numeric;
  }
  return fallback;
}
