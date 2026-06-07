import { getRequestId } from "@agent-paste/auth";
import { loadLocalBillingRow, setWorkspacePlanOverride } from "@agent-paste/billing";
import {
  ActorType,
  LockdownScope,
  OperationEventAction,
  OperationEventTargetType,
  type SetLockdownRequest,
  type SetWorkspacePlanRequest,
  WebOperatorEventFocus,
  WorkspaceId,
} from "@agent-paste/contracts";
import { type Repository, rlsExecutor, type SqlExecutor } from "@agent-paste/db";
import type { Principal } from "@agent-paste/worker-runtime";
import { getBoundResponders } from "@agent-paste/worker-runtime";
import { clearPlatformLockdownDenylist, invalidatePlatformLockdown } from "../access-link-invalidation.js";
import { type AppContext, billingEnabled } from "../env.js";
import { notifyLiveUpdateDisconnect, notifyLiveUpdateDisconnectWorkspace } from "../live-updates.js";
import { parsePagination } from "../pagination.js";
import { platformActor } from "../principals.js";
import { executeRepositoryRoute, RepositoryRouteError, runIdempotent } from "../responses.js";
import type { GuardFor } from "../route-contracts.js";
import { billingStatusFromRow, resolveBillingExecutor } from "./billing.js";

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
    return getBoundResponders(context).respondError("not_found");
  }
  if (!db.listLockdowns) {
    return getBoundResponders(context).respondError("database_unavailable");
  }
  const pagination = parsePagination(context.req.raw);
  if (!pagination.ok) {
    return getBoundResponders(context).respondError(pagination.code);
  }
  const listLockdowns = db.listLockdowns.bind(db);
  return executeRepositoryRoute(context, () => listLockdowns(actor, pagination.value));
}

export async function webAdminListEvents(context: AppContext, principal: Principal, db: Repository): Promise<Response> {
  const actor = platformActor(principal);
  if (!actor) {
    return getBoundResponders(context).respondError("not_found");
  }
  if (!db.listOperatorEvents) {
    return getBoundResponders(context).respondError("database_unavailable");
  }
  const pagination = parsePagination(context.req.raw);
  if (!pagination.ok) {
    return getBoundResponders(context).respondError(pagination.code);
  }
  const filters = parseOperatorEventFilters(context.req.raw);
  if (!filters.ok) {
    return getBoundResponders(context).respondError(filters.code);
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
    return getBoundResponders(context).respondError("not_found");
  }
  if (!db.setLockdown) {
    return getBoundResponders(context).respondError("database_unavailable");
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
      await invalidatePlatformLockdown(env, body.scope, body.target_id);
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

export async function webAdminSetWorkspacePlan(
  context: AppContext,
  principal: Principal,
  guard: GuardFor<"billing.admin.setPlan">,
  params: { workspaceId: string },
  executor: SqlExecutor | undefined = resolveBillingExecutor(context.env),
): Promise<Response> {
  const { respondError } = getBoundResponders(context);
  const actor = platformActor(principal);
  if (!actor) {
    return respondError("not_found");
  }
  const env = context.env;
  if (!billingEnabled(env)) {
    return respondError("not_found");
  }
  const workspaceId = WorkspaceId.safeParse(params.workspaceId);
  if (!workspaceId.success) {
    return respondError("not_found");
  }
  if (!executor) {
    return respondError("database_unavailable");
  }
  const scoped = rlsExecutor(executor, { kind: "workspace", workspaceId: workspaceId.data });
  const body: SetWorkspacePlanRequest = guard.body;
  return runIdempotent(context, async () => {
    try {
      await setWorkspacePlanOverride({
        executor: scoped,
        actorId: actor.id,
        workspaceId: workspaceId.data,
        plan: body.plan,
        idempotencyKey: guard.idempotencyKey,
        now: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof Error && error.message === "workspace_not_found") {
        throw new RepositoryRouteError("not_found", "workspace not found", { cause: error });
      }
      throw error;
    }
    const row = await loadLocalBillingRow(scoped, workspaceId.data);
    return billingStatusFromRow(row);
  });
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
    return getBoundResponders(context).respondError("not_found");
  }
  if (!db.liftLockdown) {
    return getBoundResponders(context).respondError("database_unavailable");
  }
  const liftLockdown = db.liftLockdown.bind(db);
  const scopeResult = LockdownScope.safeParse(params.scope);
  if (!scopeResult.success) {
    return getBoundResponders(context).respondError("not_found");
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
    await clearPlatformLockdownDenylist(env, db, scope, params.targetId);
    return detail;
  });
}

type OperatorEventFilterField = Exclude<keyof OperatorEventFilterInput, "focus">;

const OPERATOR_EVENT_FILTERS: ReadonlyArray<{
  param: string;
  key: OperatorEventFilterField;
  valid: (raw: string) => boolean;
}> = [
  { param: "workspace_id", key: "workspaceId", valid: (raw) => WorkspaceId.safeParse(raw).success },
  { param: "actor_type", key: "actorType", valid: (raw) => ActorType.safeParse(raw).success },
  { param: "action", key: "action", valid: (raw) => OperationEventAction.safeParse(raw).success },
  { param: "target_type", key: "targetType", valid: (raw) => OperationEventTargetType.safeParse(raw).success },
  { param: "request_id", key: "requestId", valid: (raw) => raw.length >= 1 && raw.length <= 128 },
];

function parseOperatorEventFilters(
  request: Request,
): { ok: true; value: OperatorEventFilterInput } | { ok: false; code: "invalid_request" } {
  const url = new URL(request.url);
  const value: OperatorEventFilterInput = {};
  for (const { param, key, valid } of OPERATOR_EVENT_FILTERS) {
    const raw = url.searchParams.get(param);
    if (raw === null) {
      continue;
    }
    if (!valid(raw)) {
      return { ok: false, code: "invalid_request" };
    }
    if (raw) {
      value[key] = raw;
    }
  }
  const focusParam = url.searchParams.get("focus");
  if (focusParam !== null && !WebOperatorEventFocus.safeParse(focusParam).success) {
    return { ok: false, code: "invalid_request" };
  }
  if (focusParam === "security" || focusParam === "lifecycle") {
    value.focus = focusParam;
  }
  return { ok: true, value };
}
