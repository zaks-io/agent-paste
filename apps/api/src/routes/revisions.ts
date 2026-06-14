import type { ApiActor, Repository } from "@agent-paste/db";
import type { AgentViewTokenPayload } from "@agent-paste/tokens/agent-view";
import type { Principal } from "@agent-paste/worker-runtime";
import { getBoundResponders } from "@agent-paste/worker-runtime";
import { signAgentViewContentUrls } from "../agent-view.js";
import { htmlAgentViewResponse, wantsHtml } from "../agent-view-html.js";
import type { AppContext } from "../env.js";
import { workspaceApiActor } from "../principals.js";
import { createPublishCoordinator } from "../publish-coordinator.js";
import { type ContractRespondError, runIdempotent } from "../responses.js";
import type { GuardFor, RouteParams } from "../route-contracts.js";
import { contentBaseUrl } from "../runtime.js";
import { enforceArtifactRateLimit } from "./artifact-rate-limit.js";

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
  const coordinator = createPublishCoordinator({ db, env: context.env });

  return runIdempotent(
    context,
    () =>
      coordinator.publishRevision({
        actor,
        idempotencyKey: guard.idempotencyKey,
        artifactId: params.artifactId ?? "",
        revisionId: params.revisionId ?? "",
      }),
    { respondError: guard.respondError as ContractRespondError },
  );
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

  const rateLimited = await enforceArtifactRateLimit(context, view.artifact_id);
  if (rateLimited) {
    return rateLimited;
  }

  const signedView = await signAgentViewContentUrls(view, env);
  return wantsHtml(context.req.raw)
    ? htmlAgentViewResponse(context, signedView)
    : getBoundResponders(context).respondJson(signedView);
}
