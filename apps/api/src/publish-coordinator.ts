import { IdempotencyInFlightError } from "@agent-paste/commands";
import type { ApiActor, Repository } from "@agent-paste/db";
import { writeArtifactEvent, writeFunnelEvent } from "@agent-paste/worker-runtime";
import { signPublishResult } from "./agent-view.js";
import type { Env } from "./env.js";
import { enqueuePostPublishJobs } from "./post-publish.js";
import { RepositoryRouteError } from "./responses.js";
import { enforceNewArtifactWriteAllowance, releaseNewArtifactWriteAllowance } from "./write-allowance.js";

type PublishResult = Awaited<ReturnType<Repository["publishRevision"]>>;

// Every publish returns the Artifact's durable capability URL. Authenticated and
// ephemeral callers use the same top-level page contract; the capability itself
// is the unguessable, revocable access grant (ADR 0094).
export type PublishCoordinatorInput = {
  actor: ApiActor;
  idempotencyKey: string;
  artifactId: string;
  revisionId: string;
  claimCode?: string | undefined;
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
      return runPostPublishFanout(deps, input, result, now, isReplay);
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
    // An in-flight duplicate proves a concurrent winner is publishing under the same
    // idempotency key; the reservation is keyed by that same key, so releasing it here
    // would refund the allowance the winner's publish legitimately spends.
    if (consumedAllowance && !(error instanceof IdempotencyInFlightError)) {
      await releaseNewArtifactWriteAllowance(deps.env.WRITE_ALLOWANCE, input.actor.workspace_id, input.idempotencyKey);
    }
    throw error;
  }
}

async function runPostPublishFanout(
  deps: PublishCoordinatorDeps,
  input: PublishCoordinatorInput,
  result: PublishResult,
  now: string,
  isReplay: boolean,
): Promise<unknown> {
  const ephemeralTier = isEphemeralPublish(result);
  recordFreshPublishEvent(deps.env, input, ephemeralTier, isReplay);
  recordFreshEphemeralFunnelEvent(deps.env, input, ephemeralTier, isReplay);
  await enqueuePublishJobs(deps.env, input, result, now, ephemeralTier);
  return signPublishResult(result, deps.env, { workspaceId: input.actor.workspace_id, ephemeralTier });
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

function recordFreshEphemeralFunnelEvent(
  env: Env,
  input: PublishCoordinatorInput,
  ephemeralTier: boolean,
  isReplay: boolean,
): void {
  if (isReplay || !ephemeralTier) {
    return;
  }
  writeFunnelEvent(env.FUNNEL_EVENTS, {
    kind: "ephemeral_publish_created",
    surface: "api",
    claimCode: input.claimCode,
    workspaceId: input.actor.workspace_id,
    artifactId: input.artifactId,
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
