import { IdempotencyInFlightError } from "@agent-paste/commands";
import type { ApiActor, Repository } from "@agent-paste/db";
import { writeArtifactEvent } from "@agent-paste/worker-runtime";
import { entrypointPathFromViewUrl, signPublishResult } from "./agent-view.js";
import type { Env } from "./env.js";
import { buildRevisionNoticeFromPublishResult, notifyLiveUpdatePublish } from "./live-updates.js";
import { enqueuePostPublishJobs } from "./post-publish.js";
import { RepositoryRouteError } from "./responses.js";
import { enforceNewArtifactWriteAllowance, releaseNewArtifactWriteAllowance } from "./write-allowance.js";

type PublishResult = Awaited<ReturnType<Repository["publishRevision"]>>;

export type PublishCoordinatorInput = {
  actor: ApiActor;
  idempotencyKey: string;
  artifactId: string;
  revisionId: string;
};

export type PublishCoordinator = {
  publishRevision(input: PublishCoordinatorInput): Promise<unknown>;
};

type PublishCoordinatorDeps = {
  db: Repository;
  env: Env;
};

export function createPublishCoordinator(deps: PublishCoordinatorDeps): PublishCoordinator {
  return {
    async publishRevision(input) {
      const isReplay = await assertPublishNotInFlight(deps.db, input);
      const now = new Date().toISOString();
      const consumedAllowance = await reservePublishAllowance(deps, input, isReplay);
      const result = await commitPublish(deps, input, now, consumedAllowance);
      return runPostPublishFanout(deps.env, input, result, now, isReplay);
    },
  };
}

async function assertPublishNotInFlight(db: Repository, input: PublishCoordinatorInput): Promise<boolean> {
  const replay = await db.peekWorkspaceCommandReplay?.({
    actor: input.actor,
    operation: "artifact.revision.publish",
    idempotencyKey: input.idempotencyKey,
  });
  if (replay && "inFlight" in replay && replay.inFlight) {
    throw new IdempotencyInFlightError();
  }
  return replay !== null && replay !== undefined && "result" in replay;
}

async function reservePublishAllowance(
  deps: PublishCoordinatorDeps,
  input: PublishCoordinatorInput,
  isReplay: boolean,
): Promise<boolean> {
  if (isReplay || !deps.db.peekPublishWriteGate) {
    return false;
  }

  const gate = await deps.db.peekPublishWriteGate({
    actor: input.actor,
    artifactId: input.artifactId,
    revisionId: input.revisionId,
  });
  const allowance = publishAllowanceLimit(gate);
  if (allowance === undefined) {
    return false;
  }

  const writeAllowance = await enforceNewArtifactWriteAllowance(
    deps.env.WRITE_ALLOWANCE,
    input.actor.workspace_id,
    allowance,
    input.idempotencyKey,
  );
  if (writeAllowance.ok) {
    return true;
  }
  if (writeAllowance.reason === "unavailable") {
    throw new RepositoryRouteError("storage_unavailable");
  }
  throw new RepositoryRouteError("write_allowance_exceeded", undefined, {
    headers: { "Retry-After": writeAllowance.retryAfter },
  });
}

function publishAllowanceLimit(
  gate: Awaited<ReturnType<Repository["peekPublishWriteGate"]>> | null | undefined,
): number | undefined {
  if (!gate || gate.is_already_published || !gate.is_new_artifact) {
    return undefined;
  }
  return typeof gate.daily_new_artifact_allowance === "number" ? gate.daily_new_artifact_allowance : undefined;
}

async function commitPublish(
  deps: PublishCoordinatorDeps,
  input: PublishCoordinatorInput,
  now: string,
  consumedAllowance: boolean,
): Promise<PublishResult> {
  try {
    return await deps.db.publishRevision({
      actor: input.actor,
      idempotencyKey: input.idempotencyKey,
      artifactId: input.artifactId,
      revisionId: input.revisionId,
      now,
    });
  } catch (error) {
    if (consumedAllowance) {
      await releaseNewArtifactWriteAllowance(deps.env.WRITE_ALLOWANCE, input.actor.workspace_id, input.idempotencyKey);
    }
    throw error;
  }
}

async function runPostPublishFanout(
  env: Env,
  input: PublishCoordinatorInput,
  result: PublishResult,
  now: string,
  isReplay: boolean,
): Promise<unknown> {
  const ephemeralTier = isEphemeralPublish(result);
  recordFreshPublishEvent(env, input, ephemeralTier, isReplay);
  await enqueuePublishJobs(env, input, result, now, ephemeralTier);
  const signed = await signPublishResult(result, env, { workspaceId: input.actor.workspace_id, ephemeralTier });
  await notifyPublishedRevision(env, result, signed);
  return signed;
}

function isEphemeralPublish(result: PublishResult): boolean {
  return result !== null && typeof result === "object" && "ephemeral_tier" in result && result.ephemeral_tier === true;
}

function recordFreshPublishEvent(
  env: Env,
  input: PublishCoordinatorInput,
  ephemeralTier: boolean,
  isReplay: boolean,
): void {
  if (isReplay) {
    return;
  }
  writeArtifactEvent(env.ARTIFACT_EVENTS, {
    kind: "publish",
    workspaceId: input.actor.workspace_id,
    artifactId: input.artifactId,
    revisionId: input.revisionId,
    detail: ephemeralTier ? "ephemeral" : "standard",
  });
}

async function enqueuePublishJobs(
  env: Env,
  input: PublishCoordinatorInput,
  result: PublishResult,
  now: string,
  ephemeralTier: boolean,
): Promise<void> {
  const bundleStatus = bundleStatusFromPublishResult(result);
  try {
    await enqueuePostPublishJobs(env, {
      workspaceId: input.actor.workspace_id,
      artifactId: input.artifactId,
      revisionId: input.revisionId,
      bundleStatus: bundleStatus === "pending" ? "pending" : "disabled",
      requestedAt: now,
      ephemeralTier,
    });
  } catch (error) {
    console.warn("Post-publish job enqueue failed after publish; revision remains published.", {
      artifactId: input.artifactId,
      revisionId: input.revisionId,
      bundleStatus,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function bundleStatusFromPublishResult(result: unknown): string {
  if (!result || typeof result !== "object" || !("bundle" in result)) {
    return "disabled";
  }
  const bundle = (result as { bundle?: unknown }).bundle;
  if (!bundle || typeof bundle !== "object") {
    return "disabled";
  }
  const status = (bundle as { status?: unknown }).status;
  return typeof status === "string" ? status : "disabled";
}

async function notifyPublishedRevision(env: Env, result: PublishResult, signed: unknown): Promise<void> {
  const publish = publishMetadata(result);
  if (!publish) {
    return;
  }
  const entrypoint =
    typeof (signed as { view_url?: string }).view_url === "string"
      ? entrypointPathFromViewUrl((signed as { view_url: string }).view_url)
      : "index.html";
  const revision = await buildRevisionNoticeFromPublishResult(signed, entrypoint, publish.title);
  if (!revision) {
    return;
  }

  try {
    await notifyLiveUpdatePublish(env, { artifactId: publish.artifactId, revision });
  } catch (error) {
    console.warn("Live update publish notify failed after commit.", {
      artifactId: publish.artifactId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function publishMetadata(result: PublishResult): { artifactId: string; title: string } | null {
  if (!result || typeof result !== "object" || !("artifact_id" in result)) {
    return null;
  }
  const publish = result as { artifact_id: string; title?: string };
  return {
    artifactId: publish.artifact_id,
    title: typeof publish.title === "string" ? publish.title : "Untitled",
  };
}
