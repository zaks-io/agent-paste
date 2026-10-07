import { CreateFeedbackRequest } from "@agent-paste/contracts";
import { resolveFeedbackContact } from "../../feedback-contact.js";
import { createId } from "../../id.js";
import type { ApiActor, Feedback } from "../../types.js";
import type { RepositoryCoreContext } from "../core-context.js";
import { nowIso, workspaceCommandActor, workspaceScope } from "../core-helpers.js";

export type SubmitFeedbackInput = {
  actor: ApiActor;
  idempotencyKey: string;
  request: CreateFeedbackRequest;
  now?: Date;
};

export async function submitFeedback(ctx: RepositoryCoreContext, input: SubmitFeedbackInput) {
  const now = nowIso(input.now);
  const request = CreateFeedbackRequest.parse(input.request);
  const actor = input.actor;
  return ctx.uow.command(
    {
      actor: workspaceCommandActor(actor),
      operation: "feedback.create",
      idempotencyKey: input.idempotencyKey,
      scope: workspaceScope(actor.workspace_id),
      now,
    },
    async (entities) => {
      const workspace = await ctx.mustWorkspace(entities, actor.workspace_id);
      const row: Feedback = {
        id: createId("fb"),
        workspace_id: actor.workspace_id,
        submitter_kind: actor.type === "member" ? "member" : "agent",
        submitter_member_id: actor.type === "member" ? actor.id : null,
        submitter_api_key_id: actor.type === "api_key" ? actor.id : null,
        contact_email: resolveFeedbackContact(actor, workspace.contact_email),
        body: request.body,
        context: request.context ?? null,
        status: "new",
        notification_suppressed: false,
        created_at: now,
        updated_at: now,
      };
      await entities.feedback.insert(row);
      await entities.operationEvents.insert({
        actorType: actor.type,
        actorId: actor.id,
        action: "feedback.created",
        targetType: "feedback",
        targetId: row.id,
        workspaceId: actor.workspace_id,
        details: {},
        occurredAt: now,
      });
      return { feedback_id: row.id };
    },
  );
}
