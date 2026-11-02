import { CHUNK_BYTES, SINGLE_PUT_MAX_BYTES } from "@agent-paste/config";
import { chunkSize } from "@agent-paste/contracts/file-transfer";
import type { ApiActor, Repository } from "@agent-paste/db";
import { artifactBytesEncryptionRingFromEnv } from "@agent-paste/rotation";
import {
  decodeUtf8Strict,
  lookupFileMapEntry,
  parseRevisionFileMap,
  readStoredFilePrefix,
  readWorkspaceBlobBytes,
} from "@agent-paste/storage";
import type { Env } from "./env.js";
import { RepositoryRouteError } from "./responses.js";

export async function inspectMappedFile(input: {
  env: Env;
  db: Repository;
  actor: ApiActor;
  artifactId: string;
  revisionId?: string;
  path: string;
}): Promise<Record<string, unknown> | null | undefined> {
  const { db, env, actor } = input;
  // Older Revisions have no file map and use their existing agent-view read.
  const target = await db.getRevisionReadTarget?.({
    actor,
    artifactId: input.artifactId,
    ...(input.revisionId ? { revisionId: input.revisionId } : {}),
  });
  if (!target?.fileMap) return undefined;
  if (target.workspaceId !== actor.workspace_id) return null;
  const ring = artifactBytesEncryptionRingFromEnv(env);
  if (!ring || !env.ARTIFACTS) throw new RepositoryRouteError("storage_unavailable");
  try {
    const ref = target.fileMap;
    const bytes = await readWorkspaceBlobBytes({
      r2: env.ARTIFACTS,
      workspaceId: actor.workspace_id,
      ring,
      sha256: ref.sha256,
      expectedPlaintextBytes: ref.size_bytes,
      maxPlaintextBytes: ref.size_bytes,
    });
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
    if (Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("") !== ref.sha256)
      throw new Error("file_map_digest_mismatch");
    const map = parseRevisionFileMap(bytes, {
      workspaceId: actor.workspace_id,
      artifactId: target.artifactId,
      revisionId: target.revisionId,
    });
    const entry = lookupFileMapEntry(map, input.path);
    if (!entry) return null;
    if (entry.format === "single") {
      if (!entry.sha256) return null;
      const meta = {
        path: entry.path,
        sha256: entry.sha256,
        size_bytes: entry.size_bytes,
        content_type: entry.content_type,
      };
      if (entry.size_bytes > SINGLE_PUT_MAX_BYTES)
        return { ...meta, is_binary: !entry.content_type.startsWith("text/") };
      const plaintext = await readStoredFilePrefix(
        {
          r2: env.ARTIFACTS,
          workspaceId: actor.workspace_id,
          ring,
          file: { format: "single", objectKey: entry.object_key, sizeBytes: entry.size_bytes },
        },
        entry.size_bytes,
      );
      const text = decodeUtf8Strict(plaintext);
      return { ...meta, is_binary: text === null, ...(text === null ? {} : { body: text }) };
    }
    const prefix = await readStoredFilePrefix(
      {
        r2: env.ARTIFACTS,
        workspaceId: actor.workspace_id,
        ring,
        file: {
          format: "chunked-v1",
          sizeBytes: entry.size_bytes,
          chunks: entry.chunks.map((sha256, index) => ({ sha256, sizeBytes: chunkSize(entry.size_bytes, index) })),
        },
      },
      CHUNK_BYTES,
    );
    let isBinary = false;
    try {
      // Keep an incomplete codepoint at the prefix boundary pending rather than
      // marking valid UTF-8 as binary. The large file is never decoded in full.
      new TextDecoder("utf-8", { fatal: true }).decode(prefix, { stream: prefix.length < entry.size_bytes });
    } catch {
      isBinary = true;
    }
    return {
      path: entry.path,
      sha256: entry.sha256,
      size_bytes: entry.size_bytes,
      content_type: entry.content_type,
      is_binary: isBinary,
    };
  } catch (error) {
    throw new RepositoryRouteError("storage_unavailable", undefined, { cause: error });
  }
}
