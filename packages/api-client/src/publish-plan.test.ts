import type { ArtifactFileListItem, ArtifactFileListResponse } from "@agent-paste/contracts/artifact-files";
import { treeSnapshotDigest } from "@agent-paste/contracts/file-transfer";
import { Cursor } from "@agent-paste/contracts/primitives";
import { describe, expect, it, vi } from "vitest";
import { listRevisionFiles, type PublishPlanInput, planPublish } from "./publish-plan.js";
import type { LocalSource, PublishTransport } from "./publish-types.js";

const aid = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9" as never;
const rid = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9" as never;
const source = (path: string): LocalSource => ({
  path,
  sha256: "a".repeat(64) as never,
  sizeBytes: 1,
  contentType: "text/plain",
  readRange: async () => new Uint8Array([1]),
});
const file = (path: string): ArtifactFileListItem => ({
  path: path as never,
  sha256: "a".repeat(64) as never,
  size_bytes: 1,
  content_type: "text/plain",
  format: "single",
});
const page = (
  items: ArtifactFileListItem[],
  extra: Partial<ArtifactFileListResponse> = {},
): ArtifactFileListResponse => ({
  artifact_id: aid,
  revision_id: rid,
  file_count: items.length,
  size_bytes: items.length,
  title: "Title",
  entrypoint: "index.txt" as never,
  items,
  page_info: { has_more: false, next_cursor: null },
  ...extra,
});
const input = (extra: Partial<PublishPlanInput> = {}): PublishPlanInput => ({
  sources: [],
  artifactId: aid,
  title: "Title" as never,
  entrypoint: "index.txt",
  mode: { kind: "paths" },
  idempotencyKey: "planning" as never,
  ...extra,
});
function transport(files: ArtifactFileListItem[], extra: Partial<PublishTransport> = {}): PublishTransport {
  const unexpected = async (): Promise<never> => {
    throw new Error("Planning must not mutate remote state");
  };
  return {
    listFiles: vi.fn(async () => page(files)),
    createUploadSession: unexpected,
    putFile: unexpected,
    finalize: unexpected,
    publishRevision: unexpected,
    ...extra,
  };
}

describe("revision listing integrity", () => {
  it("pins later pages to the selected revision", async () => {
    const listFiles = vi
      .fn()
      .mockResolvedValueOnce(
        page([file("a")], { file_count: 2, page_info: { has_more: true, next_cursor: Cursor.parse("next") } }),
      )
      .mockResolvedValueOnce(page([file("b")], { file_count: 2 }));
    expect((await listRevisionFiles({ listFiles }, aid)).files.map((f) => f.path)).toEqual(["a", "b"]);
    expect(listFiles.mock.calls[1]?.[1]).toEqual({ revision_id: rid, cursor: "next", limit: 1000 });
  });
  it.each([null, Cursor.parse("repeat")])("rejects a missing or repeating continuation cursor (%s)", async (cursor) => {
    const listFiles = vi.fn(async () => page([file("a")], { page_info: { has_more: true, next_cursor: cursor } }));
    await expect(listRevisionFiles({ listFiles }, aid)).rejects.toThrow("invalid_listing_cursor");
    expect(listFiles.mock.calls.length).toBe(cursor ? 2 : 1);
  });
  it.each([
    { revision_id: "rev_other" },
    { artifact_id: "art_other" },
  ])("rejects a changed listing identity", async (changed) => {
    const listFiles = vi
      .fn()
      .mockResolvedValueOnce(
        page([file("a")], { file_count: 2, page_info: { has_more: true, next_cursor: Cursor.parse("next") } }),
      )
      .mockResolvedValueOnce({ ...page([file("b")]), ...changed });
    await expect(listRevisionFiles({ listFiles }, aid)).rejects.toThrow("revision_changed_during_listing");
  });
  it.each([
    page([file("a"), file("a")]),
    page([file("a")], { file_count: 2 }),
  ])("rejects duplicate paths or missing entries before a mirror can be planned", async (response) => {
    await expect(listRevisionFiles({ listFiles: async () => response }, aid)).rejects.toThrow(
      "incomplete_file_listing",
    );
  });
  it("rejects unsafe paths and a missing listing adapter", async () => {
    await expect(listRevisionFiles({ listFiles: async () => page([file("../escape")]) }, aid)).rejects.toThrow();
    await expect(listRevisionFiles({}, aid)).rejects.toThrow("File listing transport is required");
  });
});

describe("selected-path planning boundaries", () => {
  it("collapses nested prefix deletions, guards exact files, and ignores absent paths", async () => {
    const files = ["docs/a", "docs/sub/b", "other", "keep"].map(file);
    const plan = await planPublish(
      transport(files),
      input({ deletePaths: ["docs", "docs/sub", "docs/a", "other", "other", "absent"] }),
    );
    expect(plan.deletions).toEqual([{ path: "other", expect: { sha256: "a".repeat(64), size_bytes: 1 } }]);
    expect(plan.prefixDeletions).toEqual([
      { prefix: "docs", snapshot_sha256: await treeSnapshotDigest(files, "docs") },
    ]);
    expect(plan.changes.removed).toBe(3);
  });
  it("rejects uploading a path that the same plan deletes directly or through its prefix", async () => {
    const t = transport([file("docs/a")]);
    for (const deletion of ["docs", "docs/a"])
      await expect(planPublish(t, input({ sources: [source("docs/a")], deletePaths: [deletion] }))).rejects.toThrow(
        deletion === "docs" ? "upsert_under_deleted_prefix" : "path_both_uploaded_and_deleted",
      );
  });
  it("requires an explicit tree mirror to replace or delete a legacy file without a digest", async () => {
    const t = transport([{ ...file("legacy"), sha256: null }]);
    await expect(planPublish(t, input({ sources: [source("legacy")] }))).rejects.toThrow("Legacy file has no digest");
    await expect(planPublish(t, input({ deletePaths: ["legacy"] }))).rejects.toThrow("Legacy file has no digest");
    expect((await planPublish(t, input({ mode: { kind: "tree" } }))).deletions).toEqual([{ path: "legacy" }]);
  });
  it("rejects duplicate local paths, new partial artifacts and sources outside a mirror prefix", async () => {
    const t = transport([]);
    await expect(planPublish(t, input({ sources: [source("a"), source("a")] }))).rejects.toThrow(
      "duplicate_local_path",
    );
    const fresh = input();
    delete fresh.artifactId;
    await expect(planPublish(t, fresh)).rejects.toThrow("Partial uploads require an existing Artifact");
    await expect(
      planPublish(t, input({ mode: { kind: "mirror_prefix", prefix: "docs" }, sources: [source("docs-other/a")] })),
    ).rejects.toThrow("source_outside_mirror_prefix");
  });
  it("only fetches retention when pin intent can change an otherwise unchanged publish", async () => {
    const getAgentView = vi.fn(async () => ({ retention: "temporary" }) as never);
    const t = transport([file("index.txt")], { getAgentView });
    expect((await planPublish(t, input({ sources: [source("index.txt")] }))).noChange).toBe(true);
    expect(getAgentView).not.toHaveBeenCalled();
    expect((await planPublish(t, input({ sources: [source("index.txt")], pin: false }))).noChange).toBe(true);
    expect((await planPublish(t, input({ sources: [source("index.txt")], pin: true }))).noChange).toBe(false);
    expect(
      (await planPublish(transport([file("index.txt")]), input({ sources: [source("index.txt")], pin: true })))
        .noChange,
    ).toBe(false);
  });
});
