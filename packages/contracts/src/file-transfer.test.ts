import { CHUNK_BYTES, MAX_FILE_BYTES, SINGLE_PUT_MAX_BYTES } from "@agent-paste/config";
import { describe, expect, it } from "vitest";
import {
  chunkCount,
  chunkSize,
  EMPTY_TREE_SNAPSHOT_SHA256,
  isUnderPrefix,
  requiresChunking,
  treeSnapshotDigest,
} from "./file-transfer.js";

describe("file transfer geometry and snapshots", () => {
  it("covers boundaries and the final partial chunk", () => {
    expect(requiresChunking(SINGLE_PUT_MAX_BYTES)).toBe(false);
    expect(requiresChunking(SINGLE_PUT_MAX_BYTES + 1)).toBe(true);
    expect(chunkCount(0)).toBe(0);
    expect(chunkCount(MAX_FILE_BYTES)).toBe(63);
    expect(chunkSize(MAX_FILE_BYTES, 62)).toBe(2 * 1024 * 1024);
    expect(chunkSize(CHUNK_BYTES, 0)).toBe(CHUNK_BYTES);
    for (const size of [-1, NaN, Infinity, 0.5, MAX_FILE_BYTES + 1]) expect(() => chunkCount(size)).toThrow();
    for (const index of [-1, 1, 0.5]) expect(() => chunkSize(CHUNK_BYTES, index)).toThrow();
  });
  it("matches directory descendants only", () => {
    expect(isUnderPrefix("docs/a", "docs")).toBe(true);
    expect(isUnderPrefix("docs", "docs")).toBe(false);
    expect(isUnderPrefix("docs2/a", "docs")).toBe(false);
    expect(isUnderPrefix("anything", null)).toBe(true);
  });
  it("hashes the specified UTF-8 wire lines in UTF-16 order without mutating input", async () => {
    const entries = [
      { path: "docs/\uE000", sha256: "a".repeat(64), size_bytes: 3 },
      { path: "docs/\u{10000}", sha256: null, size_bytes: 2 },
      { path: "other/a", sha256: null, size_bytes: 1 },
    ];
    const expected = "600310d461e55b6321184a86a21364c1e4db573d7f07d9bc818872c3e322bd90";
    expect(await treeSnapshotDigest(entries, "docs")).toBe(expected);
    expect(entries[0]?.path).toBe("docs/\uE000");
    expect(await treeSnapshotDigest([], null)).toBe(EMPTY_TREE_SNAPSHOT_SHA256);
  });
});
