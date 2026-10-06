import type { RouteContract } from "@agent-paste/contracts";
import type { Repository } from "@agent-paste/db";
import { getBoundResponders, type HeaderGuardState, type Principal } from "@agent-paste/worker-runtime";
import type { Context } from "hono";
import type { AppContext } from "../env.js";
import { workspaceApiActor } from "../principals.js";
import { runIdempotent } from "../responses.js";
import type { GuardFor } from "../route-contracts.js";

export async function submitFeedbackRoute(
  context: AppContext,
  principal: Principal,
  db: Repository,
  guard: GuardFor<"feedback.create">,
): Promise<Response> {
  const actor = workspaceApiActor(principal);
  if (!actor) return getBoundResponders(context).respondError("not_authenticated");
  return runIdempotent(
    context,
    () =>
      db.submitFeedback({
        actor,
        idempotencyKey: guard.idempotencyKey,
        request: guard.body,
      }),
    { successStatus: 201 },
  );
}

// ADR 0039 requires completed retries to bypass actor and Workspace rate counters.
export const replayFeedbackRequest = async ({
  context,
  contract,
  principal,
  db,
  guard,
}: {
  context: Context;
  contract: RouteContract;
  principal: Principal;
  db: Repository;
  guard: HeaderGuardState;
}): Promise<Response | null> => {
  if (contract.id !== "feedback.create" || !guard.idempotencyKey) return null;
  const actor = workspaceApiActor(principal);
  if (!actor) return null;
  const replay = await db.peekWorkspaceCommandReplay({
    actor,
    operation: contract.id,
    idempotencyKey: guard.idempotencyKey,
  });
  if (!replay) return null;
  const responders = getBoundResponders(context);
  return "inFlight" in replay
    ? responders.respondError("idempotency_in_flight")
    : responders.respondJson(replay.result, 201);
};
