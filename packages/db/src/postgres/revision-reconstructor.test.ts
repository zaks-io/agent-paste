import { workspaceBlobObjectKeyFor } from "@agent-paste/storage";
import {
  seedEncryptedRevisionFile,
  seedEncryptedWorkspaceBlob,
  testArtifactBytesEncryptionEnv,
} from "@agent-paste/storage/test-helpers/encrypted-artifact-fixture";
import { describe, expect, it } from "vitest";
import { RevisionReconstructionConflict } from "../types.js";
import { revisionReconstructorFromEnv } from "./revision-reconstructor.js";

const WS = "ws_recon";
const ART = "art_recon";
const REV = "rev_recon";
const enc = new TextEncoder();

async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fakeR2() {
  const store = new Map<string, { body: Uint8Array; customMetadata?: Record<string, string> }>();
  return {
    store,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: Uint8Array, options?: { customMetadata?: Record<string, string> }) {
      store.set(key, { body: value, customMetadata: options?.customMetadata });
    },
    async head(key: string) {
      return store.has(key) ? {} : null;
    },
  };
}

// Seed an encrypted base blob and an encrypted diff object, returning the wired R2 and
// the descriptor the db layer would hand the reconstructor.
async function seedPatch(input: { base: string; diff: string; path: string }) {
  const r2 = fakeR2();
  const baseSha = await sha256Hex(input.base);
  const seededBase = await seedEncryptedWorkspaceBlob({ workspaceId: WS, sha256: baseSha, plaintext: input.base });
  r2.store.set(seededBase.objectKey, { body: seededBase.body, customMetadata: seededBase.customMetadata });
  const seededDiff = await seedEncryptedRevisionFile({
    workspaceId: WS,
    artifactId: ART,
    revisionId: REV,
    path: input.path,
    plaintext: input.diff,
  });
  r2.store.set(seededDiff.objectKey, { body: seededDiff.body, customMetadata: seededDiff.customMetadata });
  return { r2, baseSha, diffObjectKey: seededDiff.objectKey };
}

describe("revisionReconstructorFromEnv", () => {
  it("returns undefined without the encryption ring or R2 binding", () => {
    expect(revisionReconstructorFromEnv({})).toBeUndefined();
    expect(revisionReconstructorFromEnv({ ...testArtifactBytesEncryptionEnv })).toBeUndefined();
  });

  it("applies a clean patch and writes a content-addressed result blob", async () => {
    const base = "line1\nline2\nline3\n";
    const expected = "line1\nline2 changed\nline3\n";
    const diff = "@@ -1,3 +1,3 @@\n line1\n-line2\n+line2 changed\n line3\n";
    const resultSha = await sha256Hex(expected);
    const { r2, baseSha, diffObjectKey } = await seedPatch({ base, diff, path: "app.txt" });

    const reconstructor = revisionReconstructorFromEnv({ ...testArtifactBytesEncryptionEnv, ARTIFACTS: r2 });
    const out = await reconstructor?.reconstruct({
      workspaceId: WS,
      files: [{ path: "app.txt", diffObjectKey, baseSha256: baseSha, resultSha256: resultSha }],
    });

    expect(out?.files).toHaveLength(1);
    const file = out?.files[0];
    expect(file?.sha256).toBe(resultSha);
    expect(file?.r2Key).toBe(workspaceBlobObjectKeyFor({ workspaceId: WS, sha256: resultSha }));
    expect(file?.sizeBytes).toBe(enc.encode(expected).byteLength);
    // The result blob is now present at the content-addressed key.
    expect(r2.store.has(file?.r2Key ?? "")).toBe(true);
  });

  it("throws an agent-visible conflict when the result hash does not match", async () => {
    const base = "a\nb\n";
    const diff = "@@ -1,2 +1,2 @@\n a\n-b\n+B\n";
    const { r2, baseSha, diffObjectKey } = await seedPatch({ base, diff, path: "f.txt" });

    const reconstructor = revisionReconstructorFromEnv({ ...testArtifactBytesEncryptionEnv, ARTIFACTS: r2 });
    await expect(
      reconstructor?.reconstruct({
        workspaceId: WS,
        files: [{ path: "f.txt", diffObjectKey, baseSha256: baseSha, resultSha256: "9".repeat(64) }],
      }),
    ).rejects.toMatchObject({ name: "RevisionReconstructionConflict", path: "f.txt", reason: "result_hash_mismatch" });
  });

  it("writes zero result blobs when one file in a batch conflicts (apply-all-before-put)", async () => {
    const cleanBase = "x\n";
    const cleanDiff = "@@ -1 +1 @@\n-x\n+X\n";
    const cleanResult = "X\n";
    const cleanResultSha = await sha256Hex(cleanResult);
    const {
      r2,
      baseSha: cleanBaseSha,
      diffObjectKey: cleanDiffKey,
    } = await seedPatch({
      base: cleanBase,
      diff: cleanDiff,
      path: "clean.txt",
    });
    // Seed a second base + a diff that will not match its declared result.
    const badBase = "p\n";
    const badDiff = "@@ -1 +1 @@\n-p\n+P\n";
    const badSha = await sha256Hex(badBase);
    const seededBadBase = await seedEncryptedWorkspaceBlob({ workspaceId: WS, sha256: badSha, plaintext: badBase });
    r2.store.set(seededBadBase.objectKey, { body: seededBadBase.body, customMetadata: seededBadBase.customMetadata });
    const seededBadDiff = await seedEncryptedRevisionFile({
      workspaceId: WS,
      artifactId: ART,
      revisionId: REV,
      path: "bad.txt",
      plaintext: badDiff,
    });
    r2.store.set(seededBadDiff.objectKey, { body: seededBadDiff.body, customMetadata: seededBadDiff.customMetadata });

    const reconstructor = revisionReconstructorFromEnv({ ...testArtifactBytesEncryptionEnv, ARTIFACTS: r2 });
    const sizeBefore = r2.store.size;
    await expect(
      reconstructor?.reconstruct({
        workspaceId: WS,
        files: [
          { path: "clean.txt", diffObjectKey: cleanDiffKey, baseSha256: cleanBaseSha, resultSha256: cleanResultSha },
          { path: "bad.txt", diffObjectKey: seededBadDiff.objectKey, baseSha256: badSha, resultSha256: "0".repeat(64) },
        ],
      }),
    ).rejects.toBeInstanceOf(RevisionReconstructionConflict);
    // No new blob written: the clean file's result was held in memory until all verified.
    expect(r2.store.size).toBe(sizeBefore);
    expect(r2.store.has(workspaceBlobObjectKeyFor({ workspaceId: WS, sha256: cleanResultSha }))).toBe(false);
  });
});
