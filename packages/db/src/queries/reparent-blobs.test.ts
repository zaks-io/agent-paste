import { describe, expect, it } from "vitest";
import { remapWorkspaceBlobR2Key, workspaceBlobR2KeyPrefix } from "./reparent-blobs.js";

describe("remapWorkspaceBlobR2Key", () => {
  const fromWorkspaceId = "11111111-1111-1111-1111-111111111111";
  const toWorkspaceId = "22222222-2222-2222-2222-222222222222";
  const sha256 = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

  it("remaps keys that start with the source workspace prefix", () => {
    const sourceKey = `${workspaceBlobR2KeyPrefix(fromWorkspaceId)}${sha256}`;
    expect(remapWorkspaceBlobR2Key(sourceKey, fromWorkspaceId, toWorkspaceId)).toBe(
      `${workspaceBlobR2KeyPrefix(toWorkspaceId)}${sha256}`,
    );
  });

  it("throws when the key does not start with the source workspace prefix", () => {
    const foreignKey = `${workspaceBlobR2KeyPrefix(toWorkspaceId)}${sha256}`;
    expect(() => remapWorkspaceBlobR2Key(foreignKey, fromWorkspaceId, toWorkspaceId)).toThrow(
      "reparent_blob_r2_key_prefix_mismatch",
    );
  });
});
