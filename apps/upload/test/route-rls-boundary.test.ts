import {
  createRouteBoundaryFixture,
  type RouteBoundaryFixture,
  type WorkspaceActorSeed,
} from "@agent-paste/db/test-helpers/route-boundary-fixture";
import { ciphertextByteLengthForPlaintext } from "@agent-paste/storage";
import { beforeAll, describe, expect, it } from "vitest";
import { finalizeUploadSession } from "../src/finalize.js";
import { type Env, handleRequest } from "../src/index.js";
import { contextFor, guardFor, responseJson } from "./route-test-helpers.js";

function uploadRequestBody() {
  return {
    title: "RLS matrix",
    entrypoint: "index.html",
    files: [{ path: "index.html", size_bytes: 12 }],
  };
}

function allowRateLimitBinding(): NonNullable<Env["ACTOR_RATE_LIMIT"]> {
  return {
    async limit() {
      return { success: true };
    },
  };
}

function uploadEnv(fixture: RouteBoundaryFixture, seed: WorkspaceActorSeed): Env {
  const secrets = new Map<string, WorkspaceActorSeed>([[seed.apiKeySecret, seed]]);
  return {
    UPLOAD_SIGNING_SECRET: "upload-signing-secret",
    AUTH: {
      async verifyApiKey(token) {
        const match = secrets.get(token);
        return match?.apiActor ?? null;
      },
    },
    DB: fixture.repo,
    ACTOR_RATE_LIMIT: allowRateLimitBinding(),
    WORKSPACE_BURST_CAP: allowRateLimitBinding(),
    ARTIFACTS: {
      async head(key) {
        return key.includes("index.html") ? { size: ciphertextByteLengthForPlaintext(12) } : null;
      },
      async put() {
        return {};
      },
    },
  };
}

describe("AP-219 upload PGlite route-boundary matrix", () => {
  let fixture: RouteBoundaryFixture;

  beforeAll(async () => {
    fixture = await createRouteBoundaryFixture();
  }, 180_000);

  it("creates upload sessions for the authenticated workspace", async () => {
    const { workspaceA } = fixture;
    const env = uploadEnv(fixture, workspaceA);

    const response = await handleRequest(
      new Request("https://upload.test/v1/upload-sessions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${workspaceA.apiKeySecret}`,
          "idempotency-key": "idem-upload-create-allow",
          "content-type": "application/json",
        },
        body: JSON.stringify(uploadRequestBody()),
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      artifact_id: expect.any(String),
      revision_id: expect.any(String),
      upload_session_id: expect.any(String),
    });
  });

  it("denies finalize for another workspace's upload session with not_found", async () => {
    const { workspaceA, workspaceB, repo } = fixture;
    const env = uploadEnv(fixture, workspaceB);

    const response = await finalizeUploadSession(
      contextFor({
        env,
        method: "POST",
        url: `https://upload.test/v1/upload-sessions/${workspaceA.pendingUploadSessionId}/finalize`,
        params: { upload_session_id: workspaceA.pendingUploadSessionId },
      }),
      { kind: "api_key", actor: workspaceB.apiActor },
      repo,
      guardFor({}, "idem-upload-finalize-deny"),
    );

    expect(response.status).toBe(404);
    await expect(responseJson(response)).resolves.toMatchObject({ error: { code: "not_found" } });
  });

  it("finalizes an upload session owned by the same workspace", async () => {
    const { workspaceA, repo } = fixture;
    const env = uploadEnv(fixture, workspaceA);

    const response = await finalizeUploadSession(
      contextFor({
        env,
        method: "POST",
        url: `https://upload.test/v1/upload-sessions/${workspaceA.pendingUploadSessionId}/finalize`,
        params: { upload_session_id: workspaceA.pendingUploadSessionId },
      }),
      { kind: "api_key", actor: workspaceA.apiActor },
      repo,
      guardFor({}, "idem-upload-finalize-allow"),
    );

    expect(response.status).toBe(200);
    await expect(responseJson(response)).resolves.toMatchObject({
      artifact_id: expect.any(String),
      revision_id: expect.any(String),
    });
  });
});
