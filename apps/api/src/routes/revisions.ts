import type { ApiActor, Repository } from "@agent-paste/db";
import type { AgentViewTokenPayload } from "@agent-paste/tokens/agent-view";
import type { Principal } from "@agent-paste/worker-runtime";
import { entrypointPathFromViewUrl, signAgentViewContentUrls, signPublishResult } from "../agent-view.js";
import { htmlAgentViewResponse, wantsHtml } from "../agent-view-html.js";
import type { AppContext } from "../env.js";
import { buildRevisionNoticeFromPublishResult, notifyLiveUpdatePublish } from "../live-updates.js";
import { enqueuePostPublishJobs } from "../post-publish.js";
import { workspaceApiActor } from "../principals.js";
import { errorResponse, jsonResponse, mapRepositoryError, RepositoryRouteError, runIdempotent } from "../responses.js";
import type { GuardFor, RouteParams } from "../route-contracts.js";
import { contentBaseUrl } from "../runtime.js";

export async function authenticatedAgentView(
  context: AppContext,
  principal: Principal,
  db: Repository,
  params: RouteParams,
): Promise<Response> {
  const env = context.env;
  const actor = workspaceApiActor(principal);
  if (!actor) {
    return errorResponse(context, "not_authenticated");
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
        return errorResponse(context, "revision_retained");
      }
    }
    return errorResponse(context, "not_found");
  }

  return jsonResponse(context, await signAgentViewContentUrls(view, env, { workspaceId: actor.workspace_id }));
}

export async function listRevisions(
  context: AppContext,
  principal: Principal,
  db: Repository,
  params: RouteParams,
): Promise<Response> {
  const actor = workspaceApiActor(principal);
  if (!actor) {
    return errorResponse(context, "not_authenticated");
  }
  const result = await db.listRevisions({ actor, artifactId: params.artifactId ?? "" });
  return result ? jsonResponse(context, result) : errorResponse(context, "artifact_not_found");
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
    return errorResponse(context, "not_authenticated");
  }
  const idempotencyKey = guard.idempotencyKey;
  return runIdempotent(context, async () => {
    try {
      const now = new Date().toISOString();
      const result = await db.publishRevision({
        actor,
        idempotencyKey,
        artifactId: params.artifactId ?? "",
        revisionId: params.revisionId ?? "",
        now,
      });
      const bundleStatus =
        result && typeof result === "object" && "bundle" in result
          ? (result as { bundle: { status: string } }).bundle.status
          : "disabled";
      try {
        await enqueuePostPublishJobs(context.env, {
          workspaceId: actor.workspace_id,
          artifactId: params.artifactId ?? "",
          revisionId: params.revisionId ?? "",
          bundleStatus: bundleStatus === "pending" ? "pending" : "disabled",
          requestedAt: now,
        });
      } catch (error) {
        console.warn("Post-publish job enqueue failed after publish; revision remains published.", {
          artifactId: params.artifactId ?? "",
          revisionId: params.revisionId ?? "",
          bundleStatus,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      const signed = await signPublishResult(result, context.env, { workspaceId: actor.workspace_id });
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
    } catch (error) {
      const mapped = mapRepositoryError(error);
      if (mapped) {
        throw new RepositoryRouteError(mapped.code, mapped.message);
      }
      throw error;
    }
  });
}

export async function publicAgentView(context: AppContext, principal: Principal, db: Repository): Promise<Response> {
  const env = context.env;
  if (principal.kind !== "signed_agent_view_token") {
    return errorResponse(context, "not_found");
  }
  const payload = principal.payload as AgentViewTokenPayload;
  const publicToken = `${payload.artifact_id}.${payload.revision_id}`;

  const view = await db.getPublicAgentView({
    token: publicToken,
    contentBaseUrl: contentBaseUrl(env),
  });

  if (!view) {
    return errorResponse(context, "not_found");
  }

  const signedView = await signAgentViewContentUrls(view, env);
  return wantsHtml(context.req.raw) ? htmlAgentViewResponse(context, signedView) : jsonResponse(context, signedView);
}
