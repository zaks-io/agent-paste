import { createHash } from "node:crypto";
import type { Repository } from "@agent-paste/db";
import { type RevisionFileMapV1, serializeRevisionFileMap } from "@agent-paste/storage";
import {
  seedEncryptedWorkspaceBlob,
  testArtifactBytesEncryptionEnv,
} from "@agent-paste/storage/test-helpers/encrypted-artifact-fixture";
import { describe, expect, it, vi } from "vitest";
import { apiPrincipal, contextFor, workspaceId } from "../test/route-test-helpers.js";
import type { Env } from "./env.js";
import { readArtifactFileContent } from "./routes/artifact-file-content.js";

const artifactId = "art_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const revisionId = "rev_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const CHUNK = 4 * 1024 * 1024;
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

describe("chunked file-content inspection", () => {
  it.each([
    "text",
    "binary",
    "boundary",
  ])("inspects only chunk zero for %s and never returns a large body", async (kind) => {
    const bytes = new Uint8Array(CHUNK).fill(97);
    if (kind === "binary") bytes[15] = 255;
    if (kind === "boundary") bytes[CHUNK - 1] = 0xe2;
    const sha256 = digest(bytes);
    const chunk = await seedEncryptedWorkspaceBlob({ workspaceId, sha256, plaintext: bytes });
    const map: RevisionFileMapV1 = {
      version: 1,
      workspace_id: workspaceId,
      artifact_id: artifactId,
      revision_id: revisionId,
      entrypoint: "huge.txt",
      files: [
        {
          path: "huge.txt",
          content_type: "text/plain",
          format: "chunked-v1",
          size_bytes: 250 * 1024 * 1024,
          sha256: "c".repeat(64),
          chunk_bytes: CHUNK,
          chunks: Array.from({ length: 63 }, () => sha256),
        },
      ],
    };
    const mapBytes = serializeRevisionFileMap(map);
    const mapSha = digest(mapBytes);
    const storedMap = await seedEncryptedWorkspaceBlob({ workspaceId, sha256: mapSha, plaintext: mapBytes });
    const get = vi.fn(async (key: string) => {
      const object = key === storedMap.objectKey ? storedMap : key === chunk.objectKey ? chunk : null;
      return object ? { ...object, size: object.body.length } : null;
    });
    const db = {
      ensureRevisionFileMap: vi.fn(async () => "present" as const),
      async getRevisionReadTarget() {
        return {
          artifactId,
          revisionId,
          workspaceId,
          fileMap: { sha256: mapSha, size_bytes: mapBytes.length },
          objectKeys: null,
          ephemeralTier: false,
          sizeBytes: map.files[0].size_bytes,
          fileCount: 1,
        };
      },
      getAgentView: vi.fn(() => {
        throw new Error("must_not_use_truncated_view");
      }),
    } as unknown as Repository;
    const env: Env = {
      ...testArtifactBytesEncryptionEnv,
      ARTIFACTS: {
        get,
        async list() {
          return { objects: [], truncated: false };
        },
        async delete() {},
      },
    };
    const response = await readArtifactFileContent(contextFor({ env }), apiPrincipal(), db, {
      artifactId,
      path: "huge.txt",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      path: "huge.txt",
      sha256: "c".repeat(64),
      size_bytes: 250 * 1024 * 1024,
      content_type: "text/plain",
      is_binary: kind === "binary",
    });
    expect(db.ensureRevisionFileMap).toHaveBeenCalledExactlyOnceWith({ workspaceId, revisionId });
    expect(get).toHaveBeenCalledTimes(2);
    expect(db.getAgentView).not.toHaveBeenCalled();
  });
});
