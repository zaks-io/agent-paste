import { redactAuditDetails } from "../../audit/change-summary.js";
import { resolveLockdownAuditWorkspaceId } from "../../audit/lockdown-audit.js";
import { createId } from "../../id.js";
import type { PlatformActor, PlatformLockdown } from "../../types.js";
import type { RepositoryCoreContext } from "../core-context.js";
import type { OperatorEventFilters } from "../operator-event-filters.js";
import { platformCommandActor, nowIso, PLATFORM_SCOPE, toLockdownDetail } from "../core-helpers.js";
import { resolveOperatorEventActions } from "../operator-event-filters.js";
import {
  decodeLockdownCursor,
  decodeWebAuditCursor,
  encodeLockdownCursor,
  encodeWebAuditCursor,
  normalizeLockdownLimit,
  normalizeWebAuditLimit,
  toWebOperatorEventRow,
} from "../web-transforms.js";

export async function listLockdowns(
  ctx: RepositoryCoreContext,
  _actor: PlatformActor,
  pagination: { cursor?: string; limit?: number } = {},
) {
  const limit = normalizeLockdownLimit(pagination.limit);
  return ctx.uow.read(PLATFORM_SCOPE, async (entities) => {
    const rows = await entities.platformLockdowns.listEffectivePage({
      limit: limit + 1,
      ...(pagination.cursor ? { cursor: decodeLockdownCursor(pagination.cursor) } : {}),
    });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(toLockdownDetail),
      page_info: {
        next_cursor: rows.length > limit && last ? encodeLockdownCursor(last) : null,
        has_more: rows.length > limit,
      },
    };
  });
}

export async function listOperatorEvents(
  ctx: RepositoryCoreContext,
  _actor: PlatformActor,
  input: OperatorEventFilters & { cursor?: string; limit?: number } = {},
) {
  const limit = normalizeWebAuditLimit(input.limit);
  const actions = resolveOperatorEventActions(input);
  return ctx.uow.read(PLATFORM_SCOPE, async (entities) => {
    const rows = await entities.operationEvents.listOperatorPage({
      limit: limit + 1,
      ...(input.cursor ? { cursor: decodeWebAuditCursor(input.cursor) } : {}),
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(input.actorType ? { actorType: input.actorType } : {}),
      ...(input.targetType ? { targetType: input.targetType } : {}),
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(actions ? { actions } : {}),
    });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(toWebOperatorEventRow),
      page_info: {
        next_cursor: rows.length > limit && last ? encodeWebAuditCursor(last) : null,
        has_more: rows.length > limit,
      },
    };
  });
}

export async function setLockdown(
  ctx: RepositoryCoreContext,
  input: {
    actor: PlatformActor;
    idempotencyKey: string;
    scope: "workspace" | "artifact";
    targetId: string;
    reasonCode: string;
    requestId?: string;
    now?: Date;
  },
) {
  const now = nowIso(input.now);
  return ctx.uow.command(
    {
      actor: platformCommandActor(input.actor),
      operation: "platform.lockdown.set",
      idempotencyKey: input.idempotencyKey,
      scope: PLATFORM_SCOPE,
      now,
    },
    async (entities) => {
      const existing = await entities.platformLockdowns.findEffective(input.scope, input.targetId);
      if (existing) {
        return toLockdownDetail(existing);
      }
      const lockdown: PlatformLockdown = {
        id: createId("lkd"),
        scope: input.scope,
        target_id: input.targetId,
        reason_code: input.reasonCode,
        set_at: now,
        set_by: input.actor.id,
        lifted_at: null,
        lifted_by: null,
      };
      const inserted = await entities.platformLockdowns.insert(lockdown);
      if (!inserted) {
        const winner = await entities.platformLockdowns.findEffective(input.scope, input.targetId);
        if (winner) {
          return toLockdownDetail(winner);
        }
        throw new Error("lockdown_insert_conflict");
      }
      const auditWorkspaceId = await resolveLockdownAuditWorkspaceId(entities, input.scope, input.targetId);
      await entities.operationEvents.insert({
        actorType: "platform",
        actorId: input.actor.id,
        action: "platform.lockdown.set",
        targetType: input.scope,
        targetId: input.targetId,
        workspaceId: auditWorkspaceId,
        details: redactAuditDetails({ scope: input.scope, reason_code: input.reasonCode }),
        occurredAt: now,
        requestId: input.requestId ?? null,
      });
      return toLockdownDetail(lockdown);
    },
  );
}

export async function liftLockdown(
  ctx: RepositoryCoreContext,
  input: {
    actor: PlatformActor;
    idempotencyKey: string;
    scope: "workspace" | "artifact";
    targetId: string;
    requestId?: string;
    now?: Date;
  },
) {
  const now = nowIso(input.now);
  return ctx.uow.command(
    {
      actor: platformCommandActor(input.actor),
      operation: "platform.lockdown.lift",
      idempotencyKey: input.idempotencyKey,
      scope: PLATFORM_SCOPE,
      now,
    },
    async (entities) => {
      const existing = await entities.platformLockdowns.findEffective(input.scope, input.targetId);
      if (!existing) {
        throw new Error("not_found");
      }
      const lifted = await entities.platformLockdowns.markLifted(existing.id, {
        liftedAt: now,
        liftedBy: input.actor.id,
      });
      if (!lifted) {
        throw new Error("not_found");
      }
      const auditWorkspaceId = await resolveLockdownAuditWorkspaceId(entities, input.scope, input.targetId);
      await entities.operationEvents.insert({
        actorType: "platform",
        actorId: input.actor.id,
        action: "platform.lockdown.lifted",
        targetType: input.scope,
        targetId: input.targetId,
        workspaceId: auditWorkspaceId,
        details: redactAuditDetails({ scope: input.scope, reason_code: existing.reason_code }),
        occurredAt: now,
        requestId: input.requestId ?? null,
      });
      return toLockdownDetail({ ...existing, lifted_at: now, lifted_by: input.actor.id });
    },
  );
}
