import { chunkSize, requiresChunking } from "@agent-paste/contracts/file-transfer";
import type { FilePath, UploadSessionId } from "@agent-paste/contracts/primitives";
import type { SignedUploadTarget } from "@agent-paste/contracts/upload-sessions";
import type { LocalSource, PublishTransport, UploadStats } from "./publish-types.js";
import { digestBytes, errorFields, operationKey, runConcurrent, transferRetry } from "./transfer-retry.js";

const CHUNK_BYTES = 4 * 1024 * 1024;
export async function uploadTargets(
  t: PublishTransport,
  id: UploadSessionId,
  sources: LocalSource[],
  targets: SignedUploadTarget[],
  stats: UploadStats,
  baseKey: string,
  progress?: (p: { uploadedFiles: number; totalToUpload: number; uploadedBytes: number }) => void,
): Promise<void> {
  const byPath = new Map(sources.map((f) => [f.path, f]));
  const verify = new Set<string>();
  const uploadedPaths = new Set<string>();
  await runConcurrent(targets, async (target) => {
    const source = byPath.get(target.path);
    if (!source) throw new Error(`unknown_upload_target: ${target.path}`);
    if (target.status === "reused") return;
    if (target.status === "verify_required") {
      verify.add(target.path);
      return;
    }
    const chunked = target.status === "chunk_upload_required";
    const index = chunked ? target.chunk_index : 0;
    if (chunked !== requiresChunking(source.sizeBytes)) throw new Error("unexpected_upload_target_format");
    const length = chunked ? chunkSize(source.sizeBytes, index) : source.sizeBytes;
    const start = chunked ? index * CHUNK_BYTES : 0;
    const bytes = await source.readRange(start, length);
    const expected = chunked ? source.chunkSha256?.[index] : source.sha256;
    // Patch sha256 describes the resulting file; the server verifies reconstruction.
    if (bytes.length !== length || (!source.patch && (!expected || (await digestBytes(bytes)) !== expected))) {
      throw Object.assign(new Error(`local_file_changed: ${source.path}`), { code: "local_file_changed" });
    }
    await transferRetry(() =>
      t.putFile(target.put_url, bytes, { "content-type": source.contentType, ...target.required_headers }),
    );
    stats.uploadedBytes += bytes.length;
    if (!uploadedPaths.has(target.path)) {
      uploadedPaths.add(target.path);
      stats.uploadedFiles++;
    }
    progress?.({
      uploadedFiles: stats.uploadedFiles,
      totalToUpload: targets.length,
      uploadedBytes: stats.uploadedBytes,
    });
  });
  if (verify.size) {
    const completeFiles = t.completeFiles;
    if (!completeFiles) throw new Error("File completion transport is required");
    let paths: string[] = [];
    let size = 0;
    const complete = async () => {
      if (!paths.length) return;
      const body = { paths: paths as FilePath[] };
      const key = await operationKey(baseKey, `c${paths.join("\n")}`);
      const response = await transferRetry(() => completeFiles(id, body, key));
      for (const file of response.files) {
        const source = byPath.get(file.path);
        if (!source || source.sha256 !== file.sha256 || source.sizeBytes !== file.size_bytes)
          throw new Error("file_digest_mismatch");
      }
      paths = [];
      size = 0;
    };
    for (const path of [...verify].sort()) {
      const source = byPath.get(path)!;
      if (paths.length === 64 || size + source.sizeBytes > 262_144_000) await complete();
      paths.push(path);
      size += source.sizeBytes;
    }
    await complete();
  }
}
export function isExpiredTarget(error: unknown): boolean {
  const { status } = errorFields(error);
  return status === 401 || status === 403;
}
