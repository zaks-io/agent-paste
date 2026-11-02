import { createHash } from "node:crypto";
import {
  type CompleteUploadFilesRequest,
  CompleteUploadFilesResponse,
  chunkCount,
  chunkSize,
} from "@agent-paste/contracts";
import { type Repository, repositoryError } from "@agent-paste/db";
import { artifactBytesEncryptionRingFromEnv } from "@agent-paste/rotation";
import {
  bytesFromReadableBodyCapped,
  ciphertextByteLengthForPlaintext,
  readWorkspaceBlobBytes,
} from "@agent-paste/storage";
import { getBoundResponders, type Principal } from "@agent-paste/worker-runtime";
import type { AppContext } from "./env.js";
import { uploadSessionActor } from "./upload-actor.js";

export async function completeFiles(
  c: AppContext,
  p: Principal,
  db: Repository,
  guard: { body: CompleteUploadFilesRequest; idempotencyKey: string },
) {
  const actor = uploadSessionActor(p);
  if (!actor) return getBoundResponders(c).respondError("not_authenticated");
  const ring = artifactBytesEncryptionRingFromEnv(c.env);
  const bucket = c.env.ARTIFACTS;
  if (!ring || !bucket) return getBoundResponders(c).respondError("storage_unavailable");
  const sid = c.req.param("upload_session_id") ?? "";
  const selected = [];
  let batchSize = 0;
  for (const path of new Set(guard.body.paths)) {
    const f = await db.getChunkedFileForCompletion({ actor, sessionId: sid, path });
    if (!f) repositoryError("invalid_request");
    batchSize += f.sizeBytes;
    selected.push({ path, ...f });
  }
  // The largest valid file defines the completion CPU/byte budget. This is the
  // protocol limit, independent of the number of paths in the request.
  if (batchSize > 262_144_000) repositoryError("invalid_request");
  for (const f of selected) {
    if (!f.verifiedAt) {
      if (
        f.chunks.length !== chunkCount(f.sizeBytes) ||
        f.chunks.some((v, index) => !v.uploaded || v.sizeBytes !== chunkSize(f.sizeBytes, index))
      )
        repositoryError("upload_incomplete");
      const read = async (index: number) => {
        const chunk = f.chunks[index];
        if (!chunk) throw new Error("missing chunk");
        const plaintext = await readWorkspaceBlobBytes({
          workspaceId: actor.workspace_id,
          sha256: chunk.sha256,
          ring,
          r2: {
            get: async (key) => {
              const object = await bucket.get(key);
              if (!object) return null;
              const max = ciphertextByteLengthForPlaintext(chunk.sizeBytes);
              if (object.size !== max) throw new Error("chunk_ciphertext_length_mismatch");
              // Bound the read even when an object's declared length is incorrect.
              if (object.body instanceof ReadableStream)
                return { ...object, body: await bytesFromReadableBodyCapped(object.body, max) };
              const bytes = object.body;
              if (typeof bytes === "string" || !bytes || bytes.byteLength !== max)
                throw new Error("chunk_ciphertext_length_mismatch");
              return object;
            },
          },
        });
        if (plaintext.byteLength !== chunk.sizeBytes) throw new Error("chunk_plaintext_length_mismatch");
        return plaintext;
      };
      const hash = createHash("sha256");
      let length = 0;
      let pending = read(0);
      for (let n = 0; n < f.chunks.length; n++) {
        const bytes = await pending;
        if (n + 1 < f.chunks.length) {
          pending = read(n + 1);
          void pending.catch(() => {});
        }
        hash.update(bytes);
        length += bytes.byteLength;
      }
      if (length !== f.sizeBytes || hash.digest("hex") !== f.sha256)
        repositoryError("file_digest_mismatch", { details: { path: f.path } });
      await db.recordChunkedFileVerified({ actor, sessionId: sid, path: f.path, now: new Date().toISOString() });
    }
  }
  return getBoundResponders(c).respondJson(
    CompleteUploadFilesResponse.parse(
      await db.completeUploadFiles({
        actor,
        sessionId: sid,
        paths: guard.body.paths,
        idempotencyKey: guard.idempotencyKey,
        now: new Date().toISOString(),
      }),
    ),
  );
}
