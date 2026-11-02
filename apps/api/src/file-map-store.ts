import type { RepositoryOptions } from "@agent-paste/db";
import { artifactBytesEncryptionRingFromEnv } from "@agent-paste/rotation";
import { serializeRevisionFileMap, writeWorkspaceBlob } from "@agent-paste/storage";
import type { Env } from "./env.js";
import { RepositoryRouteError } from "./responses.js";

export function fileMapStore(env: Env): NonNullable<RepositoryOptions["fileMapStore"]> {
  return {
    async write(map) {
      const bucket = env.ARTIFACTS;
      const ring = artifactBytesEncryptionRingFromEnv(env);
      if (!bucket?.put || !bucket.head || !ring) throw new RepositoryRouteError("storage_unavailable");
      const plaintext = serializeRevisionFileMap(map);
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", plaintext as BufferSource));
      const sha256 = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
      try {
        const result = await writeWorkspaceBlob({
          r2: { head: bucket.head.bind(bucket), put: bucket.put.bind(bucket) },
          ring,
          workspaceId: map.workspace_id,
          sha256,
          plaintext,
        });
        return { sha256, size_bytes: plaintext.length, r2_key: result.key };
      } catch (error) {
        throw new RepositoryRouteError("storage_unavailable", undefined, { cause: error });
      }
    },
  };
}
