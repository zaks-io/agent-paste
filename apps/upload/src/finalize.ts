import { IdempotencyInFlightError } from "@agent-paste/commands";
import type { routeContracts } from "@agent-paste/contracts";
import { FinalizeUploadSessionResponse } from "@agent-paste/contracts";
import {
  isRepositoryError,
  observeUploadSessionForFinalize,
  type Repository,
  RepositoryErrorCode,
  repositoryErrorToAppError,
} from "@agent-paste/db";
import { type GuardState, getBoundResponders, type Principal } from "@agent-paste/worker-runtime";
import type { AppContext } from "./env.js";
import { uploadSessionActor } from "./upload-actor.js";

type RouteId = (typeof routeContracts)[number]["id"];
type GuardFor<Id extends RouteId> = GuardState<Extract<(typeof routeContracts)[number], { id: Id }>>;

// A cached partial-manifest base can become unusable between publish and finalize
// (a concurrent revise, a retained/GC'd base Revision, a non-blob inherited file).
// These all collapse to the wire code `invalid_request`, so we surface the precise
// repository kind as the error detail; the CLI keys on it to drop its manifest cache
// and re-publish the whole tree (ADR 0089). Without this, the agent's self-heal is
// indistinguishable from a genuinely malformed request and never fires.
const BASE_UNUSABLE_KINDS = new Set<RepositoryErrorCode>([
  RepositoryErrorCode.base_revision_not_found,
  RepositoryErrorCode.base_revision_not_publishable,
  RepositoryErrorCode.base_revision_artifact_mismatch,
  RepositoryErrorCode.deleted_path_not_in_base,
  RepositoryErrorCode.inherited_path_not_blob_backed,
]);

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
      return getBoundResponders(context).respondError(repositoryCode, finalizeErrorDetail(repositoryCode, error));
    }
    throw error;
  }

  return getBoundResponders(context).respondJson(FinalizeUploadSessionResponse.parse(result));
}

// The error detail attached to a finalize failure so the agent can act on it.
// A patch conflict carries the path + failure reason on the error cause so the agent
// learns which file to regenerate (its message is already `patch_conflict: <path>: <reason>`).
// A base-unusable kind is surfaced by name so the CLI can self-heal (see BASE_UNUSABLE_KINDS).
// Anything else falls through to the wire code's default message.
function finalizeErrorDetail(repositoryCode: string, error: unknown): string | undefined {
  if (!isRepositoryError(error)) {
    return undefined;
  }
  if (repositoryCode === "patch_conflict" && error.cause instanceof Error) {
    return error.cause.message;
  }
  if (BASE_UNUSABLE_KINDS.has(error.kind)) {
    return error.kind;
  }
  return undefined;
}
