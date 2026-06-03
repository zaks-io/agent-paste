import { getRequestId } from "@agent-paste/auth";
import {
  ActorType,
  LockdownScope,
  OperationEventAction,
  OperationEventTargetType,
  type SetLockdownRequest,
  WebOperatorEventFocus,
  WorkspaceId,
} from "@agent-paste/contracts";
import type { Repository } from "@agent-paste/db";
import type { Principal } from "@agent-paste/worker-runtime";
import type { AppContext, Env } from "../env.js";
import { notifyLiveUpdateDisconnect, notifyLiveUpdateDisconnectWorkspace } from "../live-updates.js";
import { parsePagination } from "../pagination.js";
import { platformActor } from "../principals.js";
import { errorResponse, executeRepositoryRoute, runIdempotent } from "../responses.js";
import type { GuardFor } from "../route-contracts.js";

type OperatorEventFilterInput = {
  workspaceId?: string;
  actorType?: string;
  action?: string;
  targetType?: string;
  requestId?: string;
  focus?: "all" | "security" | "lifecycle";
};

export async function webAdminListLockdowns(
  context: AppContext,
  principal: Principal,
  db: Repository,
): Promise<Response> {
  const actor = platformActor(principal);
  if (!actor) {
    return errorResponse(context, "not_found");
  }
  if (!db.listLockdowns) {
    return errorResponse(context, "database_unavailable");
  }
  const pagination = parsePagination(context.req.raw);
  if (!pagination.ok) {
    return errorResponse(context, pagination.code);
  }
  const listLockdowns = db.listLockdowns.bind(db);
  return executeRepositoryRoute(context, () => listLockdowns(actor, pagination.value));
}

export async function webAdminListEvents(context: AppContext, principal: Principal, db: Repository): Promise<Response> {
  const actor = platformActor(principal);
  if (!actor) {
    return errorResponse(context, "not_found");
  }
  if (!db.listOperatorEvents) {
    return errorResponse(context, "database_unavailable");
  }
  const pagination = parsePagination(context.req.raw);
  if (!pagination.ok) {
    return errorResponse(context, pagination.code);
  }
  const filters = parseOperatorEventFilters(context.req.raw);
  if (!filters.ok) {
    return errorResponse(context, filters.code);
  }
  const listOperatorEvents = db.listOperatorEvents.bind(db);
  return executeRepositoryRoute(context, () =>
    listOperatorEvents(actor, {
      ...pagination.value,
      ...filters.value,
    }),
  );
}

export async function webAdminSetLockdown(
  context: AppContext,
  principal: Principal,
  db: Repository,
  guard: GuardFor<"web.admin.lockdown.set">,
): Promise<Response> {
  const actor = platformActor(principal);
  if (!actor) {
    return errorResponse(context, "not_found");
  }
  if (!db.setLockdown) {
    return errorResponse(context, "database_unavailable");
  }
  const setLockdown = db.setLockdown.bind(db);
  const body: SetLockdownRequest = guard.body;
  const env = context.env;
  return runIdempotent(
    context,
    async () => {
      const detail = await setLockdown({
        actor,
        idempotencyKey: guard.idempotencyKey,
        scope: body.scope,
        targetId: body.target_id,
        reasonCode: body.reason_code,
        requestId: getRequestId(context),
      });
      await writeDenylistEntry(env, body.scope, body.target_id);
      try {
        if (body.scope === "artifact") {
          await notifyLiveUpdateDisconnect(env, {
            artifactId: body.target_id,
            audiences: ["share", "dashboard"],
            reason: "platform_lockdown",
          });
        } else {
          await notifyLiveUpdateDisconnectWorkspace(env, db, {
            workspaceId: body.target_id,
            audiences: ["share", "dashboard"],
            reason: "platform_lockdown",
          });
        }
      } catch (error) {
        console.warn(
          `Live update disconnect failed for ${body.scope} lockdown ${body.target_id}; lockdown persisted.`,
          error,
        );
      }
      return detail;
    },
    { successStatus: 201 },
  );
}

export async function webAdminLiftLockdown(
  context: AppContext,
  principal: Principal,
  db: Repository,
  guard: GuardFor<"web.admin.lockdown.lift">,
  params: { scope: string; targetId: string },
): Promise<Response> {
  const actor = platformActor(principal);
  if (!actor) {
    return errorResponse(context, "not_found");
  }
  if (!db.liftLockdown) {
    return errorResponse(context, "database_unavailable");
  }
  const liftLockdown = db.liftLockdown.bind(db);
  const scopeResult = LockdownScope.safeParse(params.scope);
  if (!scopeResult.success) {
    return errorResponse(context, "not_found");
  }
  const scope = scopeResult.data;
  const env = context.env;
  return runIdempotent(context, async () => {
    const detail = await liftLockdown({
      actor,
      idempotencyKey: guard.idempotencyKey,
      scope,
      targetId: params.targetId,
      requestId: getRequestId(context),
    });
    await deleteDenylistEntry(env, scope, params.targetId);
    return detail;
  });
}

function parseOperatorEventFilters(
  request: Request,
): { ok: true; value: OperatorEventFilterInput } | { ok: false; code: "invalid_request" } {
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspace_id");
  if (workspaceId !== null && !WorkspaceId.safeParse(workspaceId).success) {
    return { ok: false, code: "invalid_request" };
  }
  const actorType = url.searchParams.get("actor_type");
  if (actorType !== null && !ActorType.safeParse(actorType).success) {
    return { ok: false, code: "invalid_request" };
  }
  const action = url.searchParams.get("action");
  if (action !== null && !OperationEventAction.safeParse(action).success) {
    return { ok: false, code: "invalid_request" };
  }
  const targetType = url.searchParams.get("target_type");
  if (targetType !== null && !OperationEventTargetType.safeParse(targetType).success) {
    return { ok: false, code: "invalid_request" };
  }
  const requestId = url.searchParams.get("request_id");
  if (requestId !== null && (requestId.length < 1 || requestId.length > 128)) {
    return { ok: false, code: "invalid_request" };
  }
  const focusParam = url.searchParams.get("focus");
  if (focusParam !== null && !WebOperatorEventFocus.safeParse(focusParam).success) {
    return { ok: false, code: "invalid_request" };
  }
  const value: OperatorEventFilterInput = {};
  if (workspaceId) {
    value.workspaceId = workspaceId;
  }
  if (actorType) {
    value.actorType = actorType;
  }
  if (action) {
    value.action = action;
  }
  if (targetType) {
    value.targetType = targetType;
  }
  if (requestId) {
    value.requestId = requestId;
  }
  if (focusParam === "security" || focusParam === "lifecycle") {
    value.focus = focusParam;
  }
  return { ok: true, value };
}

function denylistKey(scope: LockdownScope, targetId: string): string {
  return scope === "workspace" ? `wsd:${targetId}` : `ad:${targetId}`;
}

async function writeDenylistEntry(env: Env, scope: LockdownScope, targetId: string): Promise<void> {
  if (!env.DENYLIST) {
    return;
  }
  try {
    await env.DENYLIST.put(
      denylistKey(scope, targetId),
      JSON.stringify({ reason: `platform_lockdown_${scope}`, at: new Date().toISOString() }),
    );
  } catch (error) {
    console.warn(`Denylist write failed for ${scope} lockdown ${targetId}; lockdown persisted.`, error);
  }
}

async function deleteDenylistEntry(env: Env, scope: LockdownScope, targetId: string): Promise<void> {
  if (!env.DENYLIST) {
    return;
  }
  try {
    await env.DENYLIST.delete(denylistKey(scope, targetId));
  } catch (error) {
    console.warn(`Denylist delete failed for ${scope} lockdown ${targetId}; lockdown lifted.`, error);
  }
}
