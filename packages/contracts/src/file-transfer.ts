import { CHUNK_BYTES, MAX_FILE_BYTES, SINGLE_PUT_MAX_BYTES } from "@agent-paste/config";

export const CHUNKED_FORMAT = "chunked-v1" as const;
export type ContentFormat = "single" | typeof CHUNKED_FORMAT;
export type SnapshotEntry = { path: string; sha256: string | null; size_bytes: number };

function validateSize(sizeBytes: number): void {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0 || sizeBytes > MAX_FILE_BYTES) {
    throw new Error("invalid_file_size");
  }
}

export function requiresChunking(sizeBytes: number): boolean {
  validateSize(sizeBytes);
  return sizeBytes > SINGLE_PUT_MAX_BYTES;
}

export function chunkCount(sizeBytes: number): number {
  validateSize(sizeBytes);
  return Math.ceil(sizeBytes / CHUNK_BYTES);
}

export function chunkSize(sizeBytes: number, index: number): number {
  const count = chunkCount(sizeBytes);
  if (!Number.isInteger(index) || index < 0 || index >= count) throw new Error("invalid_chunk_index");
  return Math.min(CHUNK_BYTES, sizeBytes - index * CHUNK_BYTES);
}

export function isUnderPrefix(path: string, prefix: string | null): boolean {
  return prefix === null || path.startsWith(`${prefix}/`);
}

export async function treeSnapshotDigest(entries: SnapshotEntry[], prefix: string | null): Promise<string> {
  const text = entries
    .filter((entry) => isUnderPrefix(entry.path, prefix))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map(({ path, sha256, size_bytes }) => `${JSON.stringify([path, sha256, size_bytes])}\n`)
    .join("");
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const EMPTY_TREE_SNAPSHOT_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
