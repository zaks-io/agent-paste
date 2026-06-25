/**
 * Strong validator over immutable revision identity plus any request-scoped
 * representation that rewrites the served body or per-path headers (viewer-frame
 * HTML transforms, script policy, noindex injection). Revisions are append-only
 * (ADR 0020), so `(revision_id, path)` identifies the stored ciphertext; the
 * optional `representation` suffix distinguishes transformed variants so a 304
 * cannot reuse a cached body from a different framing or script policy. We hash
 * so the header is opaque and fixed-length rather than leaking raw ids, and
 * never read R2: the value is a pure function of the token payload and
 * representation key, which lets the handler answer conditional requests before
 * fetching or decrypting ciphertext.
 */
export async function contentEtag(revisionId: string, path: string, representation?: string): Promise<string> {
  const material = representation ? `${revisionId}\n${path}\n${representation}` : `${revisionId}\n${path}`;
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
