import type { RequestIdVariables } from "@agent-paste/auth";
import { requestIdMiddleware } from "@agent-paste/auth";
import { IdempotencyInFlightError } from "@agent-paste/commands";
import type { Repository } from "@agent-paste/db";
import { RepositoryError } from "@agent-paste/db";
import { ciphertextByteLengthForPlaintext } from "@agent-paste/storage";
import {
  BOUND_RESPONDERS_KEY,
  type BoundRespondersVariables,
  createBoundResponders,
  type Principal,
} from "@agent-paste/worker-runtime";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AppContext, Env, UploadSessionRecord } from "./env.js";
import { finalizeUploadSession } from "./finalize.js";

const SESSION_ID = "upl_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const ARTIFACT_ID = "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const REVISION_ID = "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9";
const WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
const FILE_SIZE_BYTES = 12;

const apiKeyPrincipal: Principal = {
  kind: "api_key",
  actor: { type: "api_key", id: "key_1", workspace_id: WORKSPACE_ID, scopes: ["publish"] },
} as Principal;

const guard = { idempotencyKey: "idem-finalize" };

function sessionRecord(): UploadSessionRecord {
  return {
    session_id: SESSION_ID,
    workspace_id: WORKSPACE_ID,
    artifact_id: ARTIFACT_ID,
    revision_id: REVISION_ID,
    expires_at: "2030-01-01T00:00:00.000Z",
    files: [{ path: "index.html", size_bytes: FILE_SIZE_BYTES }],
  };
}

function completeArtifacts(): NonNullable<Env["ARTIFACTS"]> {
  const storedSize = ciphertextByteLengthForPlaintext(FILE_SIZE_BYTES);
  return {
    async head(key) {
      return key.endsWith("index.html") ? { size: storedSize } : null;
    },
    async put() {
      return {};
    },
  };
}

async function contextFor(sessionId: string, env: Partial<Env>): Promise<AppContext> {
  const app = new Hono<{ Bindings: Env; Variables: RequestIdVariables & BoundRespondersVariables }>();
  let captured: AppContext | undefined;
  app.use("*", requestIdMiddleware());
  app.use("*", async (context, next) => {
    context.set(BOUND_RESPONDERS_KEY, createBoundResponders(context));
    await next();
  });
  app.post("/v1/upload-sessions/:upload_session_id/finalize", async (context, next) => {
    captured = context as AppContext;
    await next();
    return context.body(null);
  });
  await app.fetch(
    new Request(`https://upload.test/v1/upload-sessions/${sessionId}/finalize`, { method: "POST" }),
    env as Env,
  );
  if (!captured) {
    throw new Error("failed to capture context");
  }
  return captured;
}

async function expectError(response: Response, status: number, code: string): Promise<void> {
  expect(response.status).toBe(status);
  const body = (await response.json()) as { error: { code: string } };
  expect(body.error.code).toBe(code);
}

describe("finalizeUploadSession", () => {
  it("returns draft artifact metadata on a successful finalize", async () => {
    const finalized = {
      upload_session_id: SESSION_ID,
      artifact_id: ARTIFACT_ID,
      revision_id: REVISION_ID,
      status: "draft" as const,
      title: "Demo",
      entrypoint: "index.html",
      file_count: 1,
      size_bytes: FILE_SIZE_BYTES,
    };
    const finalizeCalls: Array<Record<string, unknown>> = [];
    const db: Repository = {
      async getUploadSession({ sessionId }) {
        expect(sessionId).toBe(SESSION_ID);
        return sessionRecord();
      },
      async finalizeUploadSession(input) {
        finalizeCalls.push(input);
        return finalized;
      },
    } as Repository;

    const response = await finalizeUploadSession(
      await contextFor(SESSION_ID, { ARTIFACTS: completeArtifacts() }),
      apiKeyPrincipal,
      db,
      guard,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(finalized);
    expect(finalizeCalls).toHaveLength(1);
    expect(finalizeCalls[0]).toMatchObject({
      sessionId: SESSION_ID,
      idempotencyKey: guard.idempotencyKey,
      observedFiles: [
        {
          path: "index.html",
          objectKey: `artifacts/${ARTIFACT_ID}/revisions/${REVISION_ID}/files/index.html`,
          sizeBytes: FILE_SIZE_BYTES,
        },
      ],
    });
    expect(typeof finalizeCalls[0]?.now).toBe("string");
  });

  it("returns not_authenticated when the principal cannot map to an upload actor", async () => {
    const db: Repository = {
      async getUploadSession() {
        throw new Error("getUploadSession should not run without actor");
      },
      async finalizeUploadSession() {
        throw new Error("finalizeUploadSession should not run without actor");
      },
    } as Repository;

    const response = await finalizeUploadSession(
      await contextFor(SESSION_ID, { ARTIFACTS: completeArtifacts() }),
      {
        kind: "api_key",
        actor: { type: "api_key", id: "key_1", scopes: ["publish"] },
      } as Principal,
      db,
      guard,
    );

    await expectError(response, 401, "not_authenticated");
  });

  it("returns storage_unavailable when the artifacts binding is missing", async () => {
    const db: Repository = {
      async getUploadSession() {
        throw new Error("getUploadSession should not run without storage");
      },
      async finalizeUploadSession() {
        throw new Error("finalizeUploadSession should not run without storage");
      },
    } as Repository;

    const response = await finalizeUploadSession(await contextFor(SESSION_ID, {}), apiKeyPrincipal, db, guard);

    await expectError(response, 503, "storage_unavailable");
  });

  it("returns not_found when the upload session does not exist", async () => {
    const db: Repository = {
      async getUploadSession() {
        return null;
      },
      async finalizeUploadSession() {
        throw new Error("finalizeUploadSession should not run for missing session");
      },
    } as Repository;

    const response = await finalizeUploadSession(
      await contextFor(SESSION_ID, { ARTIFACTS: completeArtifacts() }),
      apiKeyPrincipal,
      db,
      guard,
    );

    await expectError(response, 404, "not_found");
  });

  it("returns upload_incomplete when uploaded bytes are missing in storage", async () => {
    const db: Repository = {
      async getUploadSession() {
        return sessionRecord();
      },
      async finalizeUploadSession() {
        throw new Error("finalizeUploadSession should not run for incomplete upload");
      },
    } as Repository;

    const response = await finalizeUploadSession(
      await contextFor(SESSION_ID, {
        ARTIFACTS: {
          async head() {
            return null;
          },
          async put() {
            return {};
          },
        },
      }),
      apiKeyPrincipal,
      db,
      guard,
    );

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("upload_incomplete");
    expect(body.error.message).toBe("index.html");
  });

  it("returns idempotency_in_flight when finalize is already running", async () => {
    const db: Repository = {
      async getUploadSession() {
        return sessionRecord();
      },
      async finalizeUploadSession() {
        throw new IdempotencyInFlightError("upload.session.finalize", guard.idempotencyKey);
      },
    } as Repository;

    const response = await finalizeUploadSession(
      await contextFor(SESSION_ID, { ARTIFACTS: completeArtifacts() }),
      apiKeyPrincipal,
      db,
      guard,
    );

    await expectError(response, 409, "idempotency_in_flight");
  });

  it.each([
    ["draft_revision_conflict", "draft_revision_conflict", 409],
    ["upload_session_not_found", "upload_session_not_found", 404],
  ] as const)("maps repository %s to %s", async (repositoryKind, appCode, status) => {
    const db: Repository = {
      async getUploadSession() {
        return sessionRecord();
      },
      async finalizeUploadSession() {
        throw new RepositoryError(repositoryKind);
      },
    } as Repository;

    const response = await finalizeUploadSession(
      await contextFor(SESSION_ID, { ARTIFACTS: completeArtifacts() }),
      apiKeyPrincipal,
      db,
      guard,
    );

    await expectError(response, status, appCode);
  });

  it("rethrows unmapped repository failures", async () => {
    const db: Repository = {
      async getUploadSession() {
        return sessionRecord();
      },
      async finalizeUploadSession() {
        throw new RepositoryError("workspace_not_found");
      },
    } as Repository;

    await expect(
      finalizeUploadSession(
        await contextFor(SESSION_ID, { ARTIFACTS: completeArtifacts() }),
        apiKeyPrincipal,
        db,
        guard,
      ),
    ).rejects.toThrow("workspace_not_found");
  });
});
