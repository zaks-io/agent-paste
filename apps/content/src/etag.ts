/** Content hashes keep unchanged files cache-valid across revisions. */
export async function contentEtag(
  revisionId: string,
  path: string,
  representation?: string,
  content?: { sha256: string; sizeBytes: number },
): Promise<string> {
  const material = content
    ? `sha256:${content.sha256}\n${content.sizeBytes}\n${path}\n${representation ?? ""}`
    : representation
      ? `${revisionId}\n${path}\n${representation}`
      : `${revisionId}\n${path}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `"${hex}"`;
}

/**
 * If-None-Match evaluation for GET/HEAD (RFC 9110 §13.1.2). A list member of `*`
 * always matches; otherwise entity-tags are compared with the weak comparison
 * function (the `W/` prefix is ignored on both sides), which is what 304s permit.
 *
 * The list is split on commas, which does not account for a comma inside a
 * quoted entity-tag. That is acceptable here: this server only ever emits
 * comma-free hex tags, so a real match is never split, and the only failure mode
 * is a spurious non-match that yields a full 200 (safe), never a wrong 304.
 */
export function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) {
    return false;
  }
  const target = stripWeak(etag);
  return ifNoneMatch
    .split(",")
    .map((candidate) => candidate.trim())
    .some((candidate) => candidate === "*" || stripWeak(candidate) === target);
}

function stripWeak(etag: string): string {
  return etag.startsWith("W/") ? etag.slice(2) : etag;
}
