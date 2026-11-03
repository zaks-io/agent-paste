import { artifactBytesEncryptionRingFromEnv } from "@agent-paste/rotation";
import { parseRevisionFileMap, type RevisionFileMapV1, readWorkspaceBlobBytes } from "@agent-paste/storage";
import type { ContentTokenPayload } from "@agent-paste/tokens/content";
import type { Env } from "./env.js";

const CACHE_BUDGET_BYTES = 16 * 1024 * 1024;
const cache = new Map<string, { map: RevisionFileMapV1; size: number }>();
let cacheBytes = 0;

export async function resolveFileMap(env: Env, payload: ContentTokenPayload): Promise<RevisionFileMapV1 | null> {
  const ref = payload.file_map;
  const workspaceId = payload.workspace_id;
  if (!ref || !workspaceId) return null;
  const cached = cache.get(ref.sha256);
  if (cached && cached.size === ref.size_bytes) {
    if (
      cached.map.workspace_id !== workspaceId ||
      cached.map.artifact_id !== payload.artifact_id ||
      cached.map.revision_id !== payload.revision_id
    )
      return null;
    cache.delete(ref.sha256);
    cache.set(ref.sha256, cached);
    return cached.map;
  }
  const ring = artifactBytesEncryptionRingFromEnv(env);
  if (!ring) return null;
  try {
    const bytes = await readWorkspaceBlobBytes({
      r2: env.ARTIFACTS,
      ring,
      workspaceId,
      sha256: ref.sha256,
      expectedPlaintextBytes: ref.size_bytes,
      maxPlaintextBytes: ref.size_bytes,
    });
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
    const sha = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
    if (sha !== ref.sha256) return null;
    const map = parseRevisionFileMap(bytes, {
      workspaceId,
      artifactId: payload.artifact_id,
      revisionId: payload.revision_id,
    });
    while (cacheBytes + bytes.length > CACHE_BUDGET_BYTES) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      const evicted = cache.get(oldest);
      if (evicted) cacheBytes -= evicted.size;
      cache.delete(oldest);
    }
    // Concurrent loads may have populated this digest while R2 was in flight.
    const existing = cache.get(sha);
    if (existing) cacheBytes -= existing.size;
    cache.set(sha, { map, size: bytes.length });
    cacheBytes += bytes.length;
    return map;
  } catch {
    return null;
  }
}
