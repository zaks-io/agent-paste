import type { AdminActor, Repository } from "@agent-paste/db";
import { getBoundResponders } from "@agent-paste/worker-runtime";
import { authenticateSmokeHarness, isNonProductionEnv } from "../auth.js";
import {
  peekAdminArtifactDeleteReplay,
  resolveDeletionInvalidationExecutor,
  runPostCommitArtifactDeletionInvalidation,
} from "../deletion-invalidation.js";
import type { AppContext, Env } from "../env.js";
import { notifyLiveUpdateDisconnect } from "../live-updates.js";
import { readJsonObject } from "../responses.js";
import { apiDatabase } from "../runtime.js";

const smokeHarnessActor: AdminActor = { type: "system", id: "smoke-harness" };

type SmokeResponders = ReturnType<typeof getBoundResponders>;

type SmokeHarnessContext = {
  env: Env;
  request: Request;
  respondError: SmokeResponders["respondError"];
  respondJson: SmokeResponders["respondJson"];
};

function resolveSmokeHarness(
  context: AppContext,
): { ok: true; ctx: SmokeHarnessContext } | { ok: false; response: Response } {
  const env = context.env;
  const request = context.req.raw;
  const { respondError, respondJson } = getBoundResponders(context);
  if (!isNonProductionEnv(env) || !authenticateSmokeHarness(request, env)) {
    return { ok: false, response: respondError("not_found") };
  }
  return { ok: true, ctx: { env, request, respondError, respondJson } };
}

function resolveSmokeDatabase(
  ctx: SmokeHarnessContext,
): { ok: true; db: Repository } | { ok: false; response: Response } {
  const db = apiDatabase(ctx.env);
  if (!db) {
    return { ok: false, response: ctx.respondError("database_unavailable") };
  }
  return { ok: true, db };
}

function resolveSmokeDatabaseRoute(
  context: AppContext,
): { ok: true; ctx: SmokeHarnessContext; db: Repository } | { ok: false; response: Response } {
  const smoke = resolveSmokeHarness(context);
  if (!smoke.ok) {
    return smoke;
  }
  const database = resolveSmokeDatabase(smoke.ctx);
  if (!database.ok) {
    return database;
  }
  return { ok: true, ctx: smoke.ctx, db: database.db };
}

export async function provisionSmoke(context: AppContext): Promise<Response> {
  const smoke = resolveSmokeDatabaseRoute(context);
  if (!smoke.ok) {
    return smoke.response;
  }
  const { request, respondError, respondJson } = smoke.ctx;
  const { db } = smoke;
  const body = await readJsonObject(request);
  const email = typeof body.email === "string" ? body.email : "";
  if (!email) {
    return respondError("invalid_request", "email is required");
  }
  const name = typeof body.name === "string" ? body.name : undefined;
  const idempotencyKey = `smoke-provision:${email}`;
  const workspaceInput: { actor: AdminActor; idempotencyKey: string; email: string; name?: string } = {
    actor: smokeHarnessActor,
    idempotencyKey,
    email,
  };
  if (name) {
    workspaceInput.name = name;
  }
  const workspace = await db.createWorkspace(workspaceInput);
  const apiKey = await db.createApiKey({
    actor: smokeHarnessActor,
    idempotencyKey: `${idempotencyKey}:key`,
    workspaceId: workspace.id,
    name: "smoke",
  });
  return respondJson({ workspace, api_key: apiKey }, 201);
}

export async function deleteSmokeArtifact(context: AppContext): Promise<Response> {
  const smoke = resolveSmokeDatabaseRoute(context);
  if (!smoke.ok) {
    return smoke.response;
  }
  const { env, request, respondError, respondJson } = smoke.ctx;
  const { db } = smoke;
  const body = await readJsonObject(request);
  const artifactId = typeof body.artifact_id === "string" ? body.artifact_id : "";
  if (!artifactId) {
    return respondError("invalid_request", "artifact_id is required");
  }
  const idempotencyKey = `smoke-delete:${artifactId}`;
  const executor = resolveDeletionInvalidationExecutor(env);
  let isReplay = false;
  const detail = await db.getArtifactDetail(artifactId);
  if (executor && detail) {
    isReplay = await peekAdminArtifactDeleteReplay(executor, {
      actor: smokeHarnessActor,
      workspaceId: detail.workspace_id,
      idempotencyKey,
    });
  }
  const result = await db.deleteArtifact({
    actor: smokeHarnessActor,
    idempotencyKey,
    artifactId,
  });
  const invalidation = await runPostCommitArtifactDeletionInvalidation(
    env,
    {
      actor: smokeHarnessActor,
      idempotencyKey,
      workspaceId: result.workspace_id,
      artifactId: result.artifact_id,
      revisionId: result.revision_id,
    },
    { isReplay },
  );
  if (!invalidation.replaySkipped) {
    try {
      await notifyLiveUpdateDisconnect(env, {
        artifactId: result.artifact_id,
        audiences: ["share", "dashboard"],
        reason: "deletion",
      });
    } catch (error) {
      console.warn(`Live update disconnect failed for deleted artifact ${result.artifact_id}.`, error);
    }
  }
  return respondJson({
    artifact_id: result.artifact_id,
    deleted_at: result.deleted_at,
    deleted_r2_objects: invalidation.deleted_r2_objects,
  });
}

export async function forceExpire(context: AppContext): Promise<Response> {
  const smoke = resolveSmokeHarness(context);
  if (!smoke.ok) {
    return smoke.response;
  }
  const { env, request, respondError, respondJson } = smoke.ctx;
  const db = apiDatabase(env);
  if (!db?.forceExpireArtifact) {
    return respondError("not_supported");
  }
  const body = await readJsonObject(request);
  const artifactId = typeof body.artifact_id === "string" ? body.artifact_id : "";
  if (!artifactId) {
    return respondError("invalid_request", "artifact_id is required");
  }
  const expiresAt = new Date(Date.now() - 1000).toISOString();
  const result = await db.forceExpireArtifact({ artifactId, expiresAt });
  return result ? respondJson(result) : respondError("not_found");
}

export async function listR2Prefix(context: AppContext): Promise<Response> {
  const smoke = resolveSmokeHarness(context);
  if (!smoke.ok) {
    return smoke.response;
  }
  const { env, request, respondJson } = smoke.ctx;
  if (!env.ARTIFACTS) {
    return respondJson({ keys: [], r2_bound: false });
  }
  const prefix = new URL(request.url).searchParams.get("prefix") ?? "";
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const listOptions: { prefix: string; cursor?: string } = { prefix };
    if (cursor) {
      listOptions.cursor = cursor;
    }
    const page = await env.ARTIFACTS.list(listOptions);
    for (const object of page.objects) {
      keys.push(object.key);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return respondJson({ keys, r2_bound: true });
}

export async function getDenylistKey(context: AppContext): Promise<Response> {
  const smoke = resolveSmokeHarness(context);
  if (!smoke.ok) {
    return smoke.response;
  }
  const { env, request, respondError, respondJson } = smoke.ctx;
  if (!env.DENYLIST?.get) {
    return respondJson({ key: null, value: null, kv_bound: false });
  }
  const key = new URL(request.url).searchParams.get("key") ?? "";
  if (!key) {
    return respondError("invalid_request", "key is required");
  }
  const value = await env.DENYLIST.get(key);
  return respondJson({ key, value, kv_bound: true });
}
