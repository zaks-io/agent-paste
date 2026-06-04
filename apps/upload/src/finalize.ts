import { IdempotencyInFlightError } from "@agent-paste/commands";
import type { routeContracts } from "@agent-paste/contracts";
import { FinalizeUploadSessionResponse } from "@agent-paste/contracts";
import { observeUploadSessionForFinalize, type Repository, repositoryErrorToAppError } from "@agent-paste/db";
import { type GuardState, getBoundResponders, type Principal } from "@agent-paste/worker-runtime";
import type { AppContext } from "./env.js";
import { uploadSessionActor } from "./upload-actor.js";

type RouteId = (typeof routeContracts)[number]["id"];
type GuardFor<Id extends RouteId> = GuardState<Extract<(typeof routeContracts)[number], { id: Id }>>;

export async function finalizeUploadSession(
  context: AppContext,
  principal: Principal,
  db: Repository,
  guard: GuardFor<"uploadSessions.finalize">,
): Promise<Response> {
  const env = context.env;
  const actor = uploadSessionActor(principal);
  if (!actor) {
    return getBoundResponders(context).respondError("not_authenticated");
  }
  const idempotencyKey = guard.idempotencyKey;
  const sessionId = context.req.param("upload_session_id") ?? "";

  if (!env.ARTIFACTS) {
    return getBoundResponders(context).respondError("storage_unavailable");
  }

  const session = await db.getUploadSession({ actor, sessionId });
  if (!session) {
    return getBoundResponders(context).respondError("not_found");
  }

  const observation = await observeUploadSessionForFinalize(session, env.ARTIFACTS);
  if ("incompletePath" in observation) {
    return getBoundResponders(context).respondError("upload_incomplete", observation.incompletePath);
  }
  const { observedFiles } = observation;

  let result: unknown;
  try {
    result = await db.finalizeUploadSession({
      actor,
      idempotencyKey,
      sessionId,
      observedFiles,
      now: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof IdempotencyInFlightError) {
      return getBoundResponders(context).respondError("idempotency_in_flight");
    }
    const repositoryCode = repositoryErrorToAppError(error);
    if (repositoryCode) {
      return getBoundResponders(context).respondError(repositoryCode);
    }
    throw error;
  }

  return getBoundResponders(context).respondJson(FinalizeUploadSessionResponse.parse(result));
}
