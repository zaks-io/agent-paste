import { McpReadFileOutput } from "@agent-paste/contracts";
import type { Repository } from "@agent-paste/db";
import {
  seedEncryptedWorkspaceBlob,
  testArtifactBytesEncryptionEnv,
} from "@agent-paste/storage/test-helpers/encrypted-artifact-fixture";
import { describe, expect, it } from "vitest";
import { apiPrincipal, contextFor, nonePrincipal, responseJson, workspaceId } from "../../test/route-test-helpers.js";
import type { Env, R2GetObjectBody } from "../env.js";
import { readArtifactFileContent } from "./artifact-file-content.js";

// Real sha256 of the seeded plaintext so the route's row matches the blob key.
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fakeR2(seed?: { key: string; body: Uint8Array; customMetadata?: Record<string, string> }): Env["ARTIFACTS"] {
  const store = new Map<string, { body: Uint8Array; customMetadata?: Record<string, string> }>();
  if (seed) {
    store.set(seed.key, { body: seed.body, customMetadata: seed.customMetadata });
  }
  return {
    async get(key: string): Promise<R2GetObjectBody | null> {
      return store.get(key) ?? null;
    },
    async list() {
      return { objects: [], truncated: false };
    },
    async delete() {},
  };
}

function dbWithFile(file: Record<string, unknown> | null): Repository {
  return {
    async getAgentView() {
      return file ? { workspace_id: workspaceId, files: [file] } : null;
    },
  } as unknown as Repository;
}

const ARTIFACT_ID = "art_00000000000000000000000001";

describe("artifacts.fileContent route", () => {
  it("returns the decoded text body + sha256 for a text file", async () => {
    const plaintext = "# Title\nhello\n";
    const sha = await sha256Hex(plaintext);
    const seeded = await seedEncryptedWorkspaceBlob({ workspaceId, sha256: sha, plaintext });
    const env: Env = {
      ...testArtifactBytesEncryptionEnv,
      ARTIFACTS: fakeR2({ key: seeded.objectKey, body: seeded.body, customMetadata: seeded.customMetadata }),
    };
    const file = { path: "index.md", sha256: sha, size_bytes: plaintext.length, content_type: "text/markdown" };

    const response = await readArtifactFileContent(contextFor({ env }), apiPrincipal(), dbWithFile(file), {
      artifactId: ARTIFACT_ID,
      path: "index.md",
    });

    expect(response.status).toBe(200);
    const json = await responseJson(response);
    expect(json).toMatchObject({ path: "index.md", sha256: sha, is_binary: false, body: plaintext });
    // The strict MCP output contract must accept the real handler output unchanged
    // (guards the strict-parse-500 class: no extra fields like object_key leak).
    expect(McpReadFileOutput.safeParse(json).success).toBe(true);
  });

  it("flags binary content with is_binary and no body", async () => {
    const plaintext = new Uint8Array([0xff, 0xfe, 0x00, 0x01]);
    const sha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", plaintext)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const seeded = await seedEncryptedWorkspaceBlob({ workspaceId, sha256: sha, plaintext });
    const env: Env = {
      ...testArtifactBytesEncryptionEnv,
      ARTIFACTS: fakeR2({ key: seeded.objectKey, body: seeded.body, customMetadata: seeded.customMetadata }),
    };
    const file = {
      path: "logo.bin",
      sha256: sha,
      size_bytes: plaintext.length,
      content_type: "application/octet-stream",
    };

    const response = await readArtifactFileContent(contextFor({ env }), apiPrincipal(), dbWithFile(file), {
      artifactId: ARTIFACT_ID,
      path: "logo.bin",
    });

    const json = await responseJson<{ is_binary: boolean; body?: string }>(response);
    expect(json.is_binary).toBe(true);
    expect(json.body).toBeUndefined();
    expect(McpReadFileOutput.safeParse(json).success).toBe(true);
  });

  it("returns oversize text as metadata without reading R2", async () => {
    let getCalled = false;
    const env: Env = {
      ...testArtifactBytesEncryptionEnv,
      ARTIFACTS: {
        async get() {
          getCalled = true;
          return null;
        },
        async list() {
          return { objects: [], truncated: false };
        },
        async delete() {},
      },
    };
    const sha = await sha256Hex("placeholder");
    const file = { path: "huge.txt", sha256: sha, size_bytes: 11 * 1024 * 1024, content_type: "text/plain" };

    const response = await readArtifactFileContent(contextFor({ env }), apiPrincipal(), dbWithFile(file), {
      artifactId: ARTIFACT_ID,
      path: "huge.txt",
    });

    const json = await responseJson<{ is_binary: boolean; body?: string }>(response);
    expect(getCalled).toBe(false);
    expect(json.is_binary).toBe(false);
    expect(json.body).toBeUndefined();
  });

  it("flags oversize binary as is_binary from content type without reading R2", async () => {
    let getCalled = false;
    const env: Env = {
      ...testArtifactBytesEncryptionEnv,
      ARTIFACTS: {
        async get() {
          getCalled = true;
          return null;
        },
        async list() {
          return { objects: [], truncated: false };
        },
        async delete() {},
      },
    };
    const sha = await sha256Hex("placeholder");
    const file = {
      path: "huge.bin",
      sha256: sha,
      size_bytes: 11 * 1024 * 1024,
      content_type: "application/octet-stream",
    };

    const response = await readArtifactFileContent(contextFor({ env }), apiPrincipal(), dbWithFile(file), {
      artifactId: ARTIFACT_ID,
      path: "huge.bin",
    });

    const json = await responseJson<{ is_binary: boolean; body?: string }>(response);
    expect(getCalled).toBe(false);
    expect(json.is_binary).toBe(true);
    expect(json.body).toBeUndefined();
  });

  it("404s when the path is not in the artifact or the row has no sha256", async () => {
    const env: Env = { ...testArtifactBytesEncryptionEnv, ARTIFACTS: fakeR2() };
    const missing = await readArtifactFileContent(contextFor({ env }), apiPrincipal(), dbWithFile(null), {
      artifactId: ARTIFACT_ID,
      path: "index.md",
    });
    expect(missing.status).toBe(404);

    const nullSha = await readArtifactFileContent(
      contextFor({ env }),
      apiPrincipal(),
      dbWithFile({ path: "index.md", size_bytes: 1, content_type: "text/plain" }),
      { artifactId: ARTIFACT_ID, path: "index.md" },
    );
    expect(nullSha.status).toBe(404);
  });

  it("401s without a workspace actor", async () => {
    const response = await readArtifactFileContent(
      contextFor({ env: testArtifactBytesEncryptionEnv }),
      nonePrincipal(),
      dbWithFile(null),
      { artifactId: ARTIFACT_ID, path: "index.md" },
    );
    expect(response.status).toBe(401);
  });

  it("returns storage_unavailable when the blob is missing", async () => {
    const sha = await sha256Hex("present-in-row-missing-in-r2");
    const env: Env = { ...testArtifactBytesEncryptionEnv, ARTIFACTS: fakeR2() };
    const file = { path: "index.md", sha256: sha, size_bytes: 10, content_type: "text/markdown" };

    const response = await readArtifactFileContent(contextFor({ env }), apiPrincipal(), dbWithFile(file), {
      artifactId: ARTIFACT_ID,
      path: "index.md",
    });
    expect(response.status).toBe(503);
  });

  it("returns storage_unavailable (not 500) when decryption fails on tampered ciphertext", async () => {
    // A corrupt/auth-tag-rejected ciphertext throws a plain Error from the ring, not a
    // WorkspaceBlob* error. It must still degrade to 503 (retryable), never a 500 (ADR 0090).
    const plaintext = "secret\n";
    const sha = await sha256Hex(plaintext);
    const seeded = await seedEncryptedWorkspaceBlob({ workspaceId, sha256: sha, plaintext });
    const tampered = new Uint8Array(seeded.body);
    tampered[tampered.length - 1] ^= 0xff; // flip a ciphertext byte → AES-GCM auth tag fails
    const env: Env = {
      ...testArtifactBytesEncryptionEnv,
      ARTIFACTS: fakeR2({ key: seeded.objectKey, body: tampered, customMetadata: seeded.customMetadata }),
    };
    const file = { path: "index.md", sha256: sha, size_bytes: plaintext.length, content_type: "text/markdown" };

    const response = await readArtifactFileContent(contextFor({ env }), apiPrincipal(), dbWithFile(file), {
      artifactId: ARTIFACT_ID,
      path: "index.md",
    });
    expect(response.status).toBe(503);
  });
});
