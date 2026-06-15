import { describe, expect, it } from "vitest";
import { CreateUploadSessionRequest } from "./uploadSessions.js";

const sha = (char: string) => char.repeat(64);
const baseRevisionId = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";

function baseRequest(overrides: Record<string, unknown> = {}) {
  return {
    title: "doc",
    entrypoint: "index.html",
    files: [{ path: "index.html", size_bytes: 12, sha256: sha("a") }],
    ...overrides,
  };
}

describe("CreateUploadSessionRequest partial-manifest + patch", () => {
  it("accepts a base_revision_id with deleted_paths and a whole-file change", () => {
    const parsed = CreateUploadSessionRequest.parse(
      baseRequest({
        base_revision_id: baseRevisionId,
        deleted_paths: ["old/page.html"],
        files: [{ path: "index.html", size_bytes: 20, sha256: sha("b") }],
      }),
    );
    expect(parsed.base_revision_id).toBe(baseRevisionId);
    expect(parsed.deleted_paths).toEqual(["old/page.html"]);
  });

  it("accepts a per-file unified patch against a base revision", () => {
    const parsed = CreateUploadSessionRequest.parse(
      baseRequest({
        base_revision_id: baseRevisionId,
        files: [
          {
            path: "big.txt",
            size_bytes: 30,
            patch: { base_sha256: sha("d"), format: "unified", result_sha256: sha("e") },
          },
        ],
      }),
    );
    expect(parsed.files[0]?.patch).toEqual({
      base_sha256: sha("d"),
      format: "unified",
      result_sha256: sha("e"),
    });
  });

  it("rejects a patch with no base_revision_id", () => {
    const result = CreateUploadSessionRequest.safeParse(
      baseRequest({
        files: [
          {
            path: "big.txt",
            size_bytes: 30,
            patch: { base_sha256: sha("d"), format: "unified", result_sha256: sha("e") },
          },
        ],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a file declaring both a whole-file sha256 and a patch", () => {
    const result = CreateUploadSessionRequest.safeParse(
      baseRequest({
        base_revision_id: baseRevisionId,
        files: [
          {
            path: "big.txt",
            size_bytes: 30,
            sha256: sha("c"),
            patch: { base_sha256: sha("d"), format: "unified", result_sha256: sha("e") },
          },
        ],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("accepts a delete-only delta (empty files) against a base revision", () => {
    const parsed = CreateUploadSessionRequest.parse(
      baseRequest({
        base_revision_id: baseRevisionId,
        deleted_paths: ["old/page.html"],
        files: [],
      }),
    );
    expect(parsed.files).toEqual([]);
    expect(parsed.deleted_paths).toEqual(["old/page.html"]);
  });

  it("rejects a base delta with no changed files and no deletions", () => {
    const result = CreateUploadSessionRequest.safeParse(baseRequest({ base_revision_id: baseRevisionId, files: [] }));
    expect(result.success).toBe(false);
  });

  it("rejects an empty files manifest without base_revision_id", () => {
    const result = CreateUploadSessionRequest.safeParse(baseRequest({ files: [] }));
    expect(result.success).toBe(false);
  });

  it("rejects deleted_paths with no base_revision_id", () => {
    const result = CreateUploadSessionRequest.safeParse(baseRequest({ deleted_paths: ["gone.html"] }));
    expect(result.success).toBe(false);
  });

  it("rejects a non-unified patch format", () => {
    // No whole-file sha256 here: a patched entry must omit it, so this isolates the
    // format:"binary" rejection rather than tripping the sha256+patch mutual-exclusion.
    const result = CreateUploadSessionRequest.safeParse(
      baseRequest({
        base_revision_id: baseRevisionId,
        files: [
          {
            path: "big.bin",
            size_bytes: 30,
            patch: { base_sha256: sha("d"), format: "binary", result_sha256: sha("e") },
          },
        ],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a path that is both uploaded and deleted", () => {
    const result = CreateUploadSessionRequest.safeParse(
      baseRequest({
        base_revision_id: baseRevisionId,
        deleted_paths: ["index.html"],
        files: [{ path: "index.html", size_bytes: 12, sha256: sha("a") }],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects duplicate deleted_paths", () => {
    const result = CreateUploadSessionRequest.safeParse(
      baseRequest({
        base_revision_id: baseRevisionId,
        deleted_paths: ["dup.html", "dup.html"],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("still accepts a legacy whole-tree manifest with no base_revision_id", () => {
    const parsed = CreateUploadSessionRequest.parse(baseRequest());
    expect(parsed.base_revision_id).toBeUndefined();
    expect(parsed.deleted_paths).toBeUndefined();
    expect(parsed.files[0]).not.toHaveProperty("patch");
  });
});
