/**
 * Reduce a Zod error to safe-to-log metadata: which fields failed and why, never
 * the failing values themselves (an upstream body can carry artifact content/PII).
 */
export function zodIssueMetadata(error: unknown): Array<{ code: unknown; path: string }> | undefined {
  if (typeof error !== "object" || error === null || !("issues" in error)) {
    return undefined;
  }
  const { issues } = error as { issues?: Array<{ code?: unknown; path?: unknown }> };
  if (!Array.isArray(issues)) {
    return undefined;
  }
  return issues.map((issue) => ({
    code: issue?.code,
    path: Array.isArray(issue?.path) ? issue.path.join(".") : "",
  }));
}
