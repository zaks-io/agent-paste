import { CHUNK_BYTES, MAX_FILE_MAP_BYTES } from "@agent-paste/config";
import { describe, expect, it } from "vitest";
import { isValidContentTokenPayload, mintContentToken, verifyContentToken } from "./content.js";
import { isValidUploadPayload, mintUploadToken, verifyUploadToken } from "./upload-url.js";

const sha = "a".repeat(64);
const content = { workspace_id: "workspace", artifact_id: "art_test", revision_id: "rev_test", exp: 4_000_000_000 };
const upload = {
  sid: "upl_test",
  wid: "workspace",
  path: "video.mp4",
  key: `workspaces/workspace/blobs/sha256/aa/${sha}`,
  size: CHUNK_BYTES,
  sha256: sha,
  ci: 62,
  exp: 4_000_000_000,
};

describe("persistent hosting token authority", () => {
  it("signs and verifies exact-map tokens with bounded map size", async () => {
    const payload = { ...content, file_map: { sha256: sha, size_bytes: MAX_FILE_MAP_BYTES } };
    expect(await verifyContentToken(await mintContentToken(payload, "test-secret"), "test-secret")).toEqual(payload);
    expect(isValidContentTokenPayload({ ...content, object_keys: { "index.html": "legacy/key" } })).toBe(true);
    for (const size of [0, -1, 0.5, MAX_FILE_MAP_BYTES + 1])
      expect(isValidContentTokenPayload({ ...payload, file_map: { sha256: sha, size_bytes: size } })).toBe(false);
    for (const field of ["paths", "object_key", "object_keys", "key_prefix"])
      expect(isValidContentTokenPayload({ ...payload, [field]: field === "paths" ? [] : "key" })).toBe(false);
    expect(isValidContentTokenPayload({ ...payload, workspace_id: undefined })).toBe(false);
    for (const value of [null, [], "wrong", { sha256: sha.toUpperCase(), size_bytes: 1 }])
      expect(isValidContentTokenPayload({ ...content, file_map: value })).toBe(false);
  });
  it("binds chunk identity to its workspace, digest, key and bounded size", async () => {
    expect(await verifyUploadToken(await mintUploadToken(upload, "test-secret"), "test-secret")).toEqual(upload);
    for (const changed of [
      { ci: -1 },
      { ci: 63 },
      { ci: 0.5 },
      { sha256: undefined },
      { size: CHUNK_BYTES + 1 },
      { size: 0 },
      { key: `workspaces/other/blobs/sha256/aa/${sha}` },
      { key: "revision/key" },
    ])
      expect(isValidUploadPayload({ ...upload, ...changed })).toBe(false);
    expect(isValidUploadPayload({ ...upload, ci: undefined, size: 25 * 1024 * 1024 })).toBe(true);
    const token = await mintUploadToken({ ...upload, ci: 63 }, "test-secret");
    expect(await verifyUploadToken(token, "test-secret")).toBeNull();
  });
});
