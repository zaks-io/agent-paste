import { describe, expect, it } from "vitest";
import {
  type ArtifactBytesKeyRing,
  encryptArtifactBytes,
  workspaceBlobObjectKeyFor,
} from "./artifact-bytes-encryption.js";
import { migrateWorkspaceBlobForReparent, migrateWorkspaceBlobsForReparent } from "./reparent-workspace-blobs.js";

const ROOT_SECRET = "test-artifact-bytes-root-secret-32chars";
const HELLO_SHA256 = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

function memoryBucket() {
  const objects = new Map<string, { bytes: Uint8Array; customMetadata?: Record<string, string> }>();
  return {
    objects,
    async head(key: string) {
      return objects.has(key) ? { customMetadata: objects.get(key)?.customMetadata } : null;
    },
    async get(key: string) {
      const object = objects.get(key);
      if (!object) {
        return null;
      }
      return { body: object.bytes, customMetadata: object.customMetadata };
    },
    async put(key: string, value: Uint8Array, options?: { customMetadata?: Record<string, string> }) {
      objects.set(key, { bytes: value, customMetadata: options?.customMetadata });
    },
  };
}

function testRing(): ArtifactBytesKeyRing {
  return { secretForKid: () => ROOT_SECRET };
}

describe("migrateWorkspaceBlobForReparent", () => {
  it("re-encrypts workspace blobs under the destination prefix", async () => {
    const fromWorkspaceId = "11111111-1111-1111-1111-111111111111";
    const toWorkspaceId = "22222222-2222-2222-2222-222222222222";
    const sourceKey = workspaceBlobObjectKeyFor({ workspaceId: fromWorkspaceId, sha256: HELLO_SHA256 });
    const destKey = workspaceBlobObjectKeyFor({ workspaceId: toWorkspaceId, sha256: HELLO_SHA256 });
    const artifacts = memoryBucket();
    const encrypted = await encryptArtifactBytes({
      plaintext: new TextEncoder().encode("hello"),
      rootSecret: ROOT_SECRET,
      kid: 1,
      context: { kind: "blob", workspaceId: fromWorkspaceId, sha256: HELLO_SHA256 },
    });
    await artifacts.put(sourceKey, encrypted.ciphertext, { customMetadata: encrypted.customMetadata });

    await migrateWorkspaceBlobForReparent({
      artifacts,
      ring: testRing(),
      fromWorkspaceId,
      toWorkspaceId,
      blob: { sha256: HELLO_SHA256, size_bytes: 5, r2_key: sourceKey },
    });

    expect(artifacts.objects.has(destKey)).toBe(true);
    expect(artifacts.objects.has(sourceKey)).toBe(true);
  });

  it("skips migration when the destination object already exists", async () => {
    const fromWorkspaceId = "11111111-1111-1111-1111-111111111111";
    const toWorkspaceId = "22222222-2222-2222-2222-222222222222";
    const sourceKey = workspaceBlobObjectKeyFor({ workspaceId: fromWorkspaceId, sha256: HELLO_SHA256 });
    const destKey = workspaceBlobObjectKeyFor({ workspaceId: toWorkspaceId, sha256: HELLO_SHA256 });
    const artifacts = memoryBucket();
    const sourceEncrypted = await encryptArtifactBytes({
      plaintext: new TextEncoder().encode("hello"),
      rootSecret: ROOT_SECRET,
      kid: 1,
      context: { kind: "blob", workspaceId: fromWorkspaceId, sha256: HELLO_SHA256 },
    });
    const destEncrypted = await encryptArtifactBytes({
      plaintext: new TextEncoder().encode("dest"),
      rootSecret: ROOT_SECRET,
      kid: 1,
      context: { kind: "blob", workspaceId: toWorkspaceId, sha256: HELLO_SHA256 },
    });
    await artifacts.put(sourceKey, sourceEncrypted.ciphertext, { customMetadata: sourceEncrypted.customMetadata });
    await artifacts.put(destKey, destEncrypted.ciphertext, { customMetadata: destEncrypted.customMetadata });

    await migrateWorkspaceBlobForReparent({
      artifacts,
      ring: testRing(),
      fromWorkspaceId,
      toWorkspaceId,
      blob: { sha256: HELLO_SHA256, size_bytes: 5, r2_key: sourceKey },
    });

    expect(artifacts.objects.get(destKey)?.bytes).toEqual(destEncrypted.ciphertext);
  });
});

describe("migrateWorkspaceBlobsForReparent", () => {
  it("dedupes blobs by sha256 and size_bytes before migrating", async () => {
    const fromWorkspaceId = "11111111-1111-1111-1111-111111111111";
    const toWorkspaceId = "22222222-2222-2222-2222-222222222222";
    const sourceKey = workspaceBlobObjectKeyFor({ workspaceId: fromWorkspaceId, sha256: HELLO_SHA256 });
    const destKey = workspaceBlobObjectKeyFor({ workspaceId: toWorkspaceId, sha256: HELLO_SHA256 });
    const bucket = memoryBucket();
    let sourceGetCalls = 0;
    const artifacts = {
      ...bucket,
      async get(key: string) {
        if (key === sourceKey) {
          sourceGetCalls += 1;
        }
        return bucket.get(key);
      },
    };
    const encrypted = await encryptArtifactBytes({
      plaintext: new TextEncoder().encode("hello"),
      rootSecret: ROOT_SECRET,
      kid: 1,
      context: { kind: "blob", workspaceId: fromWorkspaceId, sha256: HELLO_SHA256 },
    });
    await artifacts.put(sourceKey, encrypted.ciphertext, { customMetadata: encrypted.customMetadata });

    await migrateWorkspaceBlobsForReparent({
      artifacts,
      ring: testRing(),
      fromWorkspaceId,
      toWorkspaceId,
      blobs: [
        { sha256: HELLO_SHA256, size_bytes: 5, r2_key: sourceKey },
        { sha256: HELLO_SHA256, size_bytes: 5, r2_key: sourceKey },
      ],
    });

    expect(sourceGetCalls).toBe(1);
    expect(artifacts.objects.has(destKey)).toBe(true);
  });
});
