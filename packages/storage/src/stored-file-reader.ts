import { CHUNK_BYTES, LEGACY_SINGLE_PUT_MAX_BYTES, MAX_FILE_BYTES } from "@agent-paste/config";
import type { ArtifactBytesKeyRing } from "./artifact-bytes-encryption.js";
import { parseWorkspaceBlobObjectKey } from "./artifact-bytes-encryption.js";
import { readRevisionFileObjectBytes, readWorkspaceBlobBytes, type WorkspaceBlobR2 } from "./workspace-blob-bytes.js";

export type StoredFileRef =
  | { format: "single"; objectKey: string; sizeBytes: number }
  | { format: "chunked-v1"; sizeBytes: number; chunks: Array<{ sha256: string; sizeBytes: number }> };

type ReadInput = {
  r2: Pick<WorkspaceBlobR2, "get">;
  ring: ArtifactBytesKeyRing;
  workspaceId: string;
  file: StoredFileRef;
  range?: { start: number; endInclusive: number };
  onBytes?: (n: number) => void;
};

function validate(input: ReadInput): void {
  const { file, range } = input;
  if (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0 || file.sizeBytes > MAX_FILE_BYTES) {
    throw new Error("invalid_stored_file_size");
  }
  if (
    range &&
    (!Number.isSafeInteger(range.start) ||
      !Number.isSafeInteger(range.endInclusive) ||
      range.start < 0 ||
      range.endInclusive < range.start ||
      range.endInclusive >= file.sizeBytes)
  ) {
    throw new Error("invalid_stored_file_range");
  }
  if (file.format === "single") {
    if (file.sizeBytes > LEGACY_SINGLE_PUT_MAX_BYTES) throw new Error("stored_single_file_too_large");
    return;
  }
  if (
    !file.sizeBytes ||
    file.chunks.length !== Math.ceil(file.sizeBytes / CHUNK_BYTES) ||
    file.chunks.some(
      (chunk, index) =>
        !/^[a-f0-9]{64}$/u.test(chunk.sha256) ||
        chunk.sizeBytes !== Math.min(CHUNK_BYTES, file.sizeBytes - index * CHUNK_BYTES),
    )
  ) {
    throw new Error("invalid_stored_file_chunks");
  }
}

export function streamStoredFile(input: ReadInput): ReadableStream<Uint8Array> {
  validate(input);
  const { file } = input;
  const start = input.range?.start ?? 0;
  const end = input.range?.endInclusive ?? file.sizeBytes - 1;
  let index = file.format === "single" ? 0 : Math.floor(start / CHUNK_BYTES);
  let cancelled = false;
  // No eager pull or prefetch. Backpressure retains only the chunk requested by
  // the consumer, and cancellation never starts a later R2 read.
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          if (end < start && file.format !== "single") {
            controller.close();
            return;
          }
          const offset = file.format === "single" ? 0 : index * CHUNK_BYTES;
          let bytes: Uint8Array;
          if (file.format === "single") {
            const blob = parseWorkspaceBlobObjectKey(file.objectKey);
            if (blob && blob.workspaceId !== input.workspaceId) throw new Error("stored_file_workspace_mismatch");
            const limits = { expectedPlaintextBytes: file.sizeBytes, maxPlaintextBytes: LEGACY_SINGLE_PUT_MAX_BYTES };
            bytes = blob
              ? await readWorkspaceBlobBytes({ ...input, ...limits, sha256: blob.sha256 })
              : await readRevisionFileObjectBytes({ ...input, ...limits, objectKey: file.objectKey });
          } else {
            const chunk = file.chunks[index];
            if (!chunk) throw new Error("stored_file_chunk_missing");
            bytes = await readWorkspaceBlobBytes({
              ...input,
              sha256: chunk.sha256,
              expectedPlaintextBytes: chunk.sizeBytes,
              maxPlaintextBytes: CHUNK_BYTES,
            });
          }
          if (cancelled) return;
          const selected = bytes.subarray(Math.max(0, start - offset), Math.min(bytes.length, end - offset + 1));
          controller.enqueue(selected);
          input.onBytes?.(selected.byteLength);
          index++;
          if (file.format === "single" || index * CHUNK_BYTES > end) controller.close();
        } catch (error) {
          if (!cancelled) controller.error(error);
        }
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
}

export async function readStoredFilePrefix(input: Omit<ReadInput, "range">, maxBytes: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error("invalid_stored_file_prefix_size");
  const size = Math.min(maxBytes, input.file.sizeBytes);
  if (size === 0 && input.file.sizeBytes !== 0) return new Uint8Array();
  const reader = streamStoredFile({
    ...input,
    ...(size ? { range: { start: 0, endInclusive: size - 1 } } : {}),
  }).getReader();
  const out = new Uint8Array(size);
  let offset = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      out.set(value, offset);
      offset += value.length;
    }
    return out;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
