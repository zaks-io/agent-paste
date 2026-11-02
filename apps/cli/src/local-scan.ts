import { createHash } from "node:crypto";
import path from "node:path";
import type { LocalSource } from "@agent-paste/api-client";
import { requiresChunking } from "@agent-paste/contracts/file-transfer";
import type { Sha256Hex } from "@agent-paste/contracts/primitives";
import { contentTypeForLocalPath, type LocalFile, resolvesToExcluded, walkLocalPath } from "./local.js";

const BLOCK = 4 * 1024 * 1024;
export async function scanLocalPath(inputPath: string, excludes: string[] = []): Promise<LocalSource[]> {
  const files = (await walkLocalPath(inputPath)).filter(
    (file) => !excludes.some((glob) => path.matchesGlob(file.path, glob)),
  );
  const sources: LocalSource[] = [];
  // Hash one file at a time. The retained tree contains metadata, never file bodies.
  for (const file of files) sources.push(await scanFile(file));
  return sources;
}
export async function scanFile(file: LocalFile): Promise<LocalSource> {
  const opened = await file.safeRoot.open(file.rootRelativePath);
  let sha256: Sha256Hex;
  const chunks: Sha256Hex[] = [];
  try {
    checkPath(file, opened.realPath);
    if (opened.stat.size !== file.sizeBytes) throw changed(file);
    const hash = createHash("sha256");
    for (let offset = 0; offset < file.sizeBytes; offset += BLOCK) {
      const bytes = await readExact(opened.handle, offset, Math.min(BLOCK, file.sizeBytes - offset));
      hash.update(bytes);
      chunks.push(createHash("sha256").update(bytes).digest("hex") as Sha256Hex);
    }
    const after = await opened.handle.stat();
    if (
      after.size !== opened.stat.size ||
      after.mtimeMs !== opened.stat.mtimeMs ||
      after.ctimeMs !== opened.stat.ctimeMs
    )
      throw changed(file);
    sha256 = hash.digest("hex") as Sha256Hex;
  } finally {
    await opened.handle.close();
  }
  const chunked = requiresChunking(file.sizeBytes);
  return {
    path: file.path,
    sizeBytes: file.sizeBytes,
    sha256,
    contentType: contentTypeForLocalPath(file.path),
    ...(chunked ? { chunkSha256: chunks } : {}),
    readRange: async (start, length) => {
      if (start < 0 || length < 0 || start + length > file.sizeBytes) throw changed(file);
      const current = await file.safeRoot.open(file.rootRelativePath).catch(() => {
        throw changed(file);
      });
      try {
        checkPath(file, current.realPath);
        if (current.stat.size !== file.sizeBytes) throw changed(file);
        const bytes = await readExact(current.handle, start, length);
        const expected =
          chunked && start % BLOCK === 0 && length === Math.min(BLOCK, file.sizeBytes - start)
            ? chunks[start / BLOCK]
            : !chunked && start === 0 && length === file.sizeBytes
              ? sha256
              : undefined;
        if (!expected || createHash("sha256").update(bytes).digest("hex") !== expected) throw changed(file);
        return bytes;
      } finally {
        await current.handle.close();
      }
    },
  };
}
async function readExact(
  handle: {
    read(buffer: Uint8Array, offset: number, length: number, position: number): Promise<{ bytesRead: number }>;
  },
  start: number,
  length: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = new Uint8Array(length);
  let n = 0;
  while (n < length) {
    const read = await handle.read(bytes, n, length - n, start + n);
    if (!read.bytesRead)
      throw Object.assign(new Error("local_file_changed: unexpected EOF"), { code: "local_file_changed" });
    n += read.bytesRead;
  }
  return bytes;
}
function checkPath(file: LocalFile, real: string): void {
  if (file.enforceExclusions && resolvesToExcluded(real, file.safeRoot.rootReal)) throw changed(file);
}
function changed(file: LocalFile): Error {
  return Object.assign(new Error(`local_file_changed: ${file.path}`), { code: "local_file_changed" });
}
