import type { ApiActor, Repository } from "@agent-paste/db";
import type { AgentViewTokenPayload } from "@agent-paste/tokens/agent-view";
import type { Principal } from "@agent-paste/worker-runtime";
import { getBoundResponders } from "@agent-paste/worker-runtime";
import { entrypointPathFromViewUrl, signAgentViewContentUrls, signPublishResult } from "../agent-view.js";
import { htmlAgentViewResponse, wantsHtml } from "../agent-view-html.js";
import type { AppContext } from "../env.js";
import { buildRevisionNoticeFromPublishResult, notifyLiveUpdatePublish } from "../live-updates.js";
import { enqueuePostPublishJobs } from "../post-publish.js";
import { workspaceApiActor } from "../principals.js";
import { type ContractRespondError, RepositoryRouteError, runIdempotent } from "../responses.js";
import type { GuardFor, RouteParams } from "../route-contracts.js";
import { contentBaseUrl } from "../runtime.js";
import { enforceNewArtifactWriteAllowance, releaseNewArtifactWriteAllowance } from "../write-allowance.js";

export async function authenticatedAgentView(
  context: AppContext,
  principal: Principal,
  db: Repository,
  params: RouteParams,
): Promise<Response> {
  const env = context.env;
  const actor = workspaceApiActor(principal);
  if (!actor) {
    return getBoundResponders(context).respondError("not_authenticated");
  }

  const input: { actor: ApiActor; artifactId: string; revisionId?: string; contentBaseUrl: string } = {
    actor,
    artifactId: params.artifactId ?? "",
    contentBaseUrl: contentBaseUrl(env),
  };
  if (params.revisionId) {
    input.revisionId = params.revisionId;
  }

  const view = await db.getAgentView(input);

  if (!view) {
    if (params.revisionId) {
      const revisions = await db.listRevisions({ actor, artifactId: params.artifactId ?? "" });
      const revision = revisions?.items.find((row) => row.revision_id === params.revisionId);
      if (revision?.status === "retained") {
        return getBoundResponders(context).respondError("revision_retained");
      }
    }
    return getBoundResponders(context).respondError("not_found");
  }

  return getBoundResponders(context).respondJson(
    await signAgentViewContentUrls(view, env, { workspaceId: actor.workspace_id }),
  );
}

export async function listRevisions(
  context: AppContext,
  principal: Principal,
  db: Repository,
  params: RouteParams,
): Promise<Response> {
  const actor = workspaceApiActor(principal);
  if (!actor) {
    return getBoundResponders(context).respondError("not_authenticated");
  }
  const result = await db.listRevisions({ actor, artifactId: params.artifactId ?? "" });
  return result
    ? getBoundResponders(context).respondJson(result)
    : getBoundResponders(context).respondError("artifact_not_found");
}

export async function publishRevision(
  context: AppContext,
  principal: Principal,
  db: Repository,
  guard: GuardFor<"revisions.publish">,
  params: RouteParams,
): Promise<Response> {
  const actor = workspaceApiActor(principal);
  if (!actor) {
    return getBoundResponders(context).respondError("not_authenticated");
  }
  const idempotencyKey = guard.idempotencyKey;
  const replay = await db.peekWorkspaceCommandReplay?.({
    actor,
    operation: "artifact.revision.publish",
    idempotencyKey,
  });
  if (replay && "inFlight" in replay && replay.inFlight) {
    return getBoundResponders(context).respondError("idempotency_in_flight");
  }
  const isReplay = replay !== null && replay !== undefined && "result" in replay;

  return runIdempotent(
    context,
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: known offender (62), pending ratchet toward 15 — see docs/ops/complexity-todo.md
    async () => {
      let consumedAllowance = false;
      if (!isReplay && db.peekPublishWriteGate) {
        const gate = await db.peekPublishWriteGate({
          actor,
          artifactId: params.artifactId ?? "",
          revisionId: params.revisionId ?? "",
        });
        if (gate && !gate.is_already_published && gate.is_new_artifact) {
          const allowance = gate.daily_new_artifact_allowance;
          if (typeof allowance === "number") {
            const writeAllowance = await enforceNewArtifactWriteAllowance(
              context.env.WRITE_ALLOWANCE,
              actor.workspace_id,
              allowance,
              idempotencyKey,
            );
            if (!writeAllowance.ok) {
              if (writeAllowance.reason === "unavailable") {
                throw new RepositoryRouteError("storage_unavailable");
              }
              throw new RepositoryRouteError("write_allowance_exceeded", undefined, {
                headers: { "Retry-After": writeAllowance.retryAfter },
              });
            }
            consumedAllowance = true;
          }
        }
      }

      let result: Awaited<ReturnType<Repository["publishRevision"]>>;
      const now = new Date().toISOString();
      try {
        result = await db.publishRevision({
          actor,
          idempotencyKey,
          artifactId: params.artifactId ?? "",
          revisionId: params.revisionId ?? "",
          now,
        });
      } catch (error) {
        if (consumedAllowance) {
          await releaseNewArtifactWriteAllowance(context.env.WRITE_ALLOWANCE, actor.workspace_id, idempotencyKey);
        }
        throw error;
      }

      const bundleStatus = bundleStatusFromPublishResult(result);
      try {
        await enqueuePostPublishJobs(context.env, {
          workspaceId: actor.workspace_id,
          artifactId: params.artifactId ?? "",
          revisionId: params.revisionId ?? "",
          bundleStatus: bundleStatus === "pending" ? "pending" : "disabled",
          requestedAt: now,
          ephemeralTier:
            result !== null &&
            typeof result === "object" &&
            "ephemeral_tier" in result &&
            result.ephemeral_tier === true,
        });
      } catch (error) {
        console.warn("Post-publish job enqueue failed after publish; revision remains published.", {
          artifactId: params.artifactId ?? "",
          revisionId: params.revisionId ?? "",
          bundleStatus,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      const signed = await signPublishResult(result, context.env, {
        workspaceId: actor.workspace_id,
        ephemeralTier:
          result !== null && typeof result === "object" && "ephemeral_tier" in result && result.ephemeral_tier === true,
      });
      if (result && typeof result === "object" && "artifact_id" in result) {
        const publish = result as { artifact_id: string; title?: string };
        const entrypoint =
          typeof (signed as { view_url?: string }).view_url === "string"
            ? entrypointPathFromViewUrl((signed as { view_url: string }).view_url)
            : "index.html";
        const title = typeof publish.title === "string" ? publish.title : "Untitled";
        const revision = await buildRevisionNoticeFromPublishResult(signed, entrypoint, title);
        if (revision) {
          try {
            await notifyLiveUpdatePublish(context.env, {
              artifactId: publish.artifact_id,
              revision,
            });
          } catch (error) {
            console.warn("Live update publish notify failed after commit.", {
              artifactId: publish.artifact_id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
      return signed;
    },
    { respondError: guard.respondError as ContractRespondError },
  );
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

export async function publicAgentView(context: AppContext, principal: Principal, db: Repository): Promise<Response> {
  const env = context.env;
  if (principal.kind !== "signed_agent_view_token") {
    return getBoundResponders(context).respondError("not_found");
  }
  const payload = principal.payload as AgentViewTokenPayload;
  const publicToken = `${payload.artifact_id}.${payload.revision_id}`;

  const view = await db.getPublicAgentView({
    token: publicToken,
    contentBaseUrl: contentBaseUrl(env),
  });

  if (!view) {
    return getBoundResponders(context).respondError("not_found");
  }

  const signedView = await signAgentViewContentUrls(view, env);
  return wantsHtml(context.req.raw)
    ? htmlAgentViewResponse(context, signedView)
    : getBoundResponders(context).respondJson(signedView);
}
