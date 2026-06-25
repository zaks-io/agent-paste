import { describe, expect, it } from "vitest";
import { workspaceBlobObjectKeyFor } from "./artifact-bytes-encryption.js";
import { seedEncryptedWorkspaceBlob, testArtifactBytesKeyRing } from "./test-helpers/encrypted-artifact-fixture.js";
import {
  type R2GetObjectBody,
  readWorkspaceBlobBytes,
  WorkspaceBlobMissingError,
  writeWorkspaceBlob,
} from "./workspace-blob-bytes.js";

const WORKSPACE = "ws_blob_bytes";
const SHA = "a".repeat(64);

function fakeR2() {
  const store = new Map<string, { body: Uint8Array; customMetadata?: Record<string, string> }>();
  const puts: string[] = [];
  const putOptions: Array<{ httpMetadata?: Record<string, string>; customMetadata?: Record<string, string> }> = [];
  return {
    store,
    puts,
    putOptions,
    async get(key: string): Promise<R2GetObjectBody | null> {
      return store.get(key) ?? null;
    },
    async put(
      key: string,
      value: Uint8Array,
      options?: { httpMetadata?: Record<string, string>; customMetadata?: Record<string, string> },
    ) {
      puts.push(key);
      putOptions.push(options ?? {});
      store.set(key, { body: value, customMetadata: options?.customMetadata });
    },
    async head(key: string) {
      return store.has(key) ? {} : null;
    },
  };
}

describe("readWorkspaceBlobBytes", () => {
  it("round-trips a blob seeded through the real encrypt path", async () => {
    const ring = testArtifactBytesKeyRing();
    const seeded = await seedEncryptedWorkspaceBlob({ workspaceId: WORKSPACE, sha256: SHA, plaintext: "hello blob" });
    const r2 = fakeR2();
    r2.store.set(seeded.objectKey, { body: seeded.body, customMetadata: seeded.customMetadata });

    const bytes = await readWorkspaceBlobBytes({ r2, workspaceId: WORKSPACE, sha256: SHA, ring });
    expect(new TextDecoder().decode(bytes)).toBe("hello blob");
  });

  it("derives the key from (workspaceId, sha256), never accepting a raw key", async () => {
    const ring = testArtifactBytesKeyRing();
    const seeded = await seedEncryptedWorkspaceBlob({ workspaceId: WORKSPACE, sha256: SHA, plaintext: "x" });
    const r2 = fakeR2();
    r2.store.set(seeded.objectKey, { body: seeded.body, customMetadata: seeded.customMetadata });

    await readWorkspaceBlobBytes({ r2, workspaceId: WORKSPACE, sha256: SHA, ring });
    // The only key read is the canonical derived key.
    expect(seeded.objectKey).toBe(workspaceBlobObjectKeyFor({ workspaceId: WORKSPACE, sha256: SHA }));
  });

  it("throws WorkspaceBlobMissingError when the object is absent", async () => {
    const ring = testArtifactBytesKeyRing();
    await expect(
      readWorkspaceBlobBytes({ r2: fakeR2(), workspaceId: WORKSPACE, sha256: SHA, ring }),
    ).rejects.toBeInstanceOf(WorkspaceBlobMissingError);
    await expect(
      readWorkspaceBlobBytes({ r2: fakeR2(), workspaceId: WORKSPACE, sha256: SHA, ring }),
    ).rejects.toMatchObject({
      name: "WorkspaceBlobMissingError",
      message: "workspace_blob_missing",
      sha256: SHA,
    });
  });

  it("throws WorkspaceBlobMetadataError when encryption metadata is missing", async () => {
    const ring = testArtifactBytesKeyRing();
    const r2 = fakeR2();
    r2.store.set(workspaceBlobObjectKeyFor({ workspaceId: WORKSPACE, sha256: SHA }), {
      body: new Uint8Array([1, 2, 3]),
    });
    await expect(readWorkspaceBlobBytes({ r2, workspaceId: WORKSPACE, sha256: SHA, ring })).rejects.toMatchObject({
      name: "WorkspaceBlobMetadataError",
      message: "workspace_blob_metadata_missing",
    });
  });
});

describe("writeWorkspaceBlob", () => {
  it("encrypts under blob AAD and PUTs at the content-addressed key, then reads back", async () => {
    const ring = testArtifactBytesKeyRing();
    const r2 = fakeR2();
    const plaintext = new TextEncoder().encode("reconstructed result");

    const result = await writeWorkspaceBlob({ r2, workspaceId: WORKSPACE, sha256: SHA, plaintext, ring });
    expect(result.written).toBe(true);
    expect(result.key).toBe(workspaceBlobObjectKeyFor({ workspaceId: WORKSPACE, sha256: SHA }));
    expect(r2.putOptions).toEqual([
      expect.objectContaining({
        httpMetadata: { contentType: "application/octet-stream" },
        customMetadata: expect.any(Object),
      }),
    ]);

    const back = await readWorkspaceBlobBytes({ r2, workspaceId: WORKSPACE, sha256: SHA, ring });
    expect(new TextDecoder().decode(back)).toBe("reconstructed result");
  });

  it("is idempotent: skips the PUT when the blob already exists", async () => {
    const ring = testArtifactBytesKeyRing();
    const r2 = fakeR2();
    const plaintext = new TextEncoder().encode("once");

    const first = await writeWorkspaceBlob({ r2, workspaceId: WORKSPACE, sha256: SHA, plaintext, ring });
    const second = await writeWorkspaceBlob({ r2, workspaceId: WORKSPACE, sha256: SHA, plaintext, ring });

    expect(first.written).toBe(true);
    expect(second.written).toBe(false);
    expect(r2.puts).toHaveLength(1);
  });
});
