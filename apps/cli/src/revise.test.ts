import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ApiClient } from "@agent-paste/api-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ManifestCache } from "./manifest-cache.js";
import { buildRevisePlan, isBaseUnusableError, type LocalFileWithDigest } from "./revise.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "revise-test-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function writeFile(rel: string, content: string): Promise<LocalFileWithDigest> {
  const abs = path.join(tmp, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content);
  const { createHash } = await import("node:crypto");
  const bytes = new TextEncoder().encode(content);
  return {
    absolutePath: abs,
    path: rel,
    sizeBytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function clientReturning(body: string, sha: string): ApiClient {
  return {
    artifacts: {
      readFile: async () => ({
        path: "x",
        sha256: sha,
        size_bytes: body.length,
        content_type: "text/plain",
        is_binary: false,
        body,
      }),
    },
  } as unknown as ApiClient;
}

const ARTIFACT_ID = "art_1";

describe("buildRevisePlan", () => {
  it("omits unchanged files (inherit) and uploads added files whole", async () => {
    const unchanged = await writeFile("keep.txt", "same\n");
    const added = await writeFile("new.txt", "brand new\n");
    const cache: ManifestCache = {
      revision_id: "rev_1",
      files: [{ path: "keep.txt", sha256: unchanged.sha256, size_bytes: unchanged.sizeBytes }],
    };

    const plan = await buildRevisePlan({
      client: clientReturning("", ""),
      artifactId: ARTIFACT_ID,
      cache,
      files: [unchanged, added],
      entrypoint: "keep.txt",
    });

    expect(plan.publishFiles.map((f) => f.path)).toEqual(["new.txt"]);
    expect(plan.baseRevisionId).toBe("rev_1");
    expect(plan.effectiveTree.map((f) => f.path).sort()).toEqual(["keep.txt", "new.txt"]);
  });

  it("sends a changed text file as a patch against the cached base", async () => {
    // Large enough that a one-line diff is smaller than the whole file, so the
    // patch path wins over whole-blob.
    const lines = Array.from({ length: 200 }, (_, i) => `line number ${i} padded out a bit`);
    const base = `${lines.join("\n")}\n`;
    const nextLines = [...lines];
    nextLines[100] = "line number 100 EDITED";
    const next = `${nextLines.join("\n")}\n`;
    const changed = await writeFile("doc.txt", next);
    const { createHash } = await import("node:crypto");
    const baseSha = createHash("sha256").update(new TextEncoder().encode(base)).digest("hex");
    const cache: ManifestCache = {
      revision_id: "rev_1",
      files: [{ path: "doc.txt", sha256: baseSha, size_bytes: base.length }],
    };

    const plan = await buildRevisePlan({
      client: clientReturning(base, baseSha),
      artifactId: ARTIFACT_ID,
      cache,
      files: [changed],
      entrypoint: "doc.txt",
    });

    const entry = plan.publishFiles[0];
    expect(entry?.path).toBe("doc.txt");
    expect(entry?.patch?.baseSha256).toBe(baseSha);
    expect(entry?.patch?.resultSha256).toBe(changed.sha256);
  });

  it("records deleted_paths for cached files absent locally, never the entrypoint", async () => {
    const keep = await writeFile("index.html", "<h1>hi</h1>\n");
    const cache: ManifestCache = {
      revision_id: "rev_1",
      files: [
        { path: "index.html", sha256: keep.sha256, size_bytes: keep.sizeBytes },
        { path: "old.css", sha256: "a".repeat(64), size_bytes: 10 },
        { path: "stale.js", sha256: "b".repeat(64), size_bytes: 10 },
      ],
    };

    const plan = await buildRevisePlan({
      client: clientReturning("", ""),
      artifactId: ARTIFACT_ID,
      cache,
      files: [keep],
      entrypoint: "index.html",
    });

    expect(plan.deletedPaths.sort()).toEqual(["old.css", "stale.js"]);
  });

  it("falls back to a whole-blob upload when the read route reports binary base", async () => {
    const changed = await writeFile("doc.txt", "new text\n");
    const cache: ManifestCache = {
      revision_id: "rev_1",
      files: [{ path: "doc.txt", sha256: "c".repeat(64), size_bytes: 5 }],
    };
    const binaryClient = {
      artifacts: {
        readFile: async () => ({
          path: "doc.txt",
          sha256: "c".repeat(64),
          size_bytes: 5,
          content_type: "text/plain",
          is_binary: true,
        }),
      },
    } as unknown as ApiClient;

    const plan = await buildRevisePlan({
      client: binaryClient,
      artifactId: ARTIFACT_ID,
      cache,
      files: [changed],
      entrypoint: "doc.txt",
    });

    expect(plan.publishFiles[0]?.patch).toBeUndefined();
  });
});

describe("isBaseUnusableError", () => {
  it("matches base-unusable error codes", () => {
    expect(isBaseUnusableError({ code: "patch_conflict" })).toBe(true);
    expect(isBaseUnusableError({ code: "base_revision_not_found" })).toBe(true);
    expect(isBaseUnusableError({ code: "inherited_path_not_blob_backed" })).toBe(true);
    expect(isBaseUnusableError({ message: "patch_conflict: index.html: apply_failed" })).toBe(true);
  });
  it("does not match unrelated errors", () => {
    expect(isBaseUnusableError({ code: "not_authenticated" })).toBe(false);
    expect(isBaseUnusableError(new Error("network down"))).toBe(false);
    expect(isBaseUnusableError(null)).toBe(false);
  });
});
