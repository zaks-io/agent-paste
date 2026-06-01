import { createId } from "../../id.js";
import type { OperationEvent } from "../../types.js";
import type { LocalState } from "../local-state.js";
import type { Entities } from "../ports.js";

function compareOperationEventsForWeb(left: OperationEvent, right: OperationEvent) {
  const occurred = right.occurred_at.localeCompare(left.occurred_at);
  return occurred === 0 ? right.id.localeCompare(left.id) : occurred;
}

export function localOperationEvents(state: LocalState): Entities["operationEvents"] {
  return {
    async insert(input) {
      const event: OperationEvent = {
        id: createId("evt"),
        workspace_id: input.workspaceId,
        actor_type: input.actorType,
        actor_id: input.actorId,
        action: input.action,
        target_type: input.targetType,
        target_id: input.targetId,
        details: input.details,
        request_id: input.requestId ?? null,
        occurred_at: input.occurredAt,
      };
      state.operationEvents.set(event.id, event);
    },
    async listAll() {
      return [...state.operationEvents.values()].sort((left, right) =>
        right.occurred_at.localeCompare(left.occurred_at),
      );
    },
    async listForWorkspace(workspaceId) {
      return [...state.operationEvents.values()]
        .filter((event) => event.workspace_id === workspaceId)
        .sort((left, right) => right.occurred_at.localeCompare(left.occurred_at));
    },
    async listWebPage(input) {
      const cursorOccurredAt = input.cursor ? input.cursor.occurredAt.toISOString() : null;
      const cursorId = input.cursor?.id ?? null;
      return [...state.operationEvents.values()]
        .filter((event) => event.workspace_id === input.workspaceId)
        .filter(
          (event) =>
            cursorOccurredAt === null ||
            cursorId === null ||
            event.occurred_at < cursorOccurredAt ||
            (event.occurred_at === cursorOccurredAt && event.id < cursorId),
        )
        .sort(compareOperationEventsForWeb)
        .slice(0, input.limit);
    },
    async listOperatorPage(input) {
      const cursorOccurredAt = input.cursor ? input.cursor.occurredAt.toISOString() : null;
      const cursorId = input.cursor?.id ?? null;
      if (input.actions !== undefined && input.actions.length === 0) {
        return [];
      }
      const actionSet = input.actions ? new Set(input.actions) : null;
      return [...state.operationEvents.values()]
        .filter((event) => (input.workspaceId ? event.workspace_id === input.workspaceId : true))
        .filter((event) => (input.actorType ? event.actor_type === input.actorType : true))
        .filter((event) => (input.targetType ? event.target_type === input.targetType : true))
        .filter((event) => (input.requestId ? event.request_id === input.requestId : true))
        .filter((event) => (actionSet ? actionSet.has(event.action) : true))
        .filter(
          (event) =>
            cursorOccurredAt === null ||
            cursorId === null ||
            event.occurred_at < cursorOccurredAt ||
            (event.occurred_at === cursorOccurredAt && event.id < cursorId),
        )
        .sort(compareOperationEventsForWeb)
        .slice(0, input.limit);
    },
    async listIdsForTarget(targetId) {
      return [...state.operationEvents.values()]
        .filter((event) => event.target_id === targetId)
        .map((event) => event.id);
    },
  };
}
