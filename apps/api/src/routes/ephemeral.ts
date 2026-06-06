import { buildErrorBody, getRequestId, REQUEST_ID_HEADER } from "@agent-paste/auth";
import type { Repository } from "@agent-paste/db";
import { DEFAULT_POW_CHALLENGE_TTL_SECONDS, issuePowChallenge, verifyPowSolution } from "@agent-paste/tokens/pow";
import { getBoundResponders } from "@agent-paste/worker-runtime";
import type { AppContext } from "../env.js";
import { resolveEphemeralProvisionLimitPerMinute } from "../ephemeral-provision-config.js";
import { consumeEphemeralProvisionGate } from "../ephemeral-provision-gate.js";
import { webMemberActor } from "../principals.js";
import { runIdempotent } from "../responses.js";
import type { GuardFor } from "../route-contracts.js";

export async function ephemeralProvisionRoute(
  context: AppContext,
  db: Repository,
  guard: GuardFor<"ephemeral.provision">,
): Promise<Response> {
  const env = context.env;
  const powSecret = env.EPHEMERAL_POW_SECRET;
  if (!powSecret) {
    return getBoundResponders(context).respondError("database_unavailable");
  }

  const body = guard.body;
  if (!body.challenge || !body.solution) {
    return powRequiredResponse(context, powSecret);
  }

  const challenge = body.challenge;
  const solution = body.solution;
  if (solution.nonce !== challenge.nonce) {
    return getBoundResponders(context).respondError("pow_invalid");
  }

  const valid = await verifyPowSolution({
    secret: powSecret,
    challenge,
    solution,
  });
  if (!valid) {
    return getBoundResponders(context).respondError("pow_invalid");
  }

  const limitConfig = await resolveEphemeralProvisionLimitPerMinute(env);
  if (!limitConfig.ok) {
    return provisionUnavailableResponse(context);
  }

  const gateDecision = await consumeEphemeralProvisionGate(
    env.EPHEMERAL_PROVISION_GATE,
    challenge.nonce,
    DEFAULT_POW_CHALLENGE_TTL_SECONDS,
    limitConfig.limitPerMinute,
  );
  if (!gateDecision) {
    return provisionUnavailableResponse(context);
  }
  if (!gateDecision.allowed && gateDecision.reason === "duplicate_nonce") {
    return getBoundResponders(context).respondError("pow_invalid");
  }
  if (!gateDecision.allowed) {
    return getBoundResponders(context).respondError("ephemeral_provision_rate_limited", {
      headers: { "Retry-After": retryAfterSeconds(gateDecision.retry_after_seconds) },
    });
  }

  const result = await db.createEphemeralWorkspace({
    idempotencyKey: `ephemeral-provision:${challenge.nonce}`,
  });

  return getBoundResponders(context).respondJson(
    {
      api_key_secret: result.api_key_secret,
      claim_token: result.claim_token_secret,
      workspace_id: result.workspace.id,
      api_key_id: result.api_key.id,
      claim_token_id: result.claim_token.id,
    },
    201,
  );
}

export async function ephemeralClaimRoute(
  context: AppContext,
  principal: import("@agent-paste/worker-runtime").Principal,
  db: Repository,
  guard: GuardFor<"ephemeral.claim">,
): Promise<Response> {
  const actor = webMemberActor(principal);
  if (!actor) {
    return getBoundResponders(context).respondError("forbidden");
  }

  return runIdempotent(
    context,
    () =>
      db.claimEphemeralWorkspace({
        actor,
        claimTokenSecret: guard.body.claim_token,
        idempotencyKey: guard.idempotencyKey,
      }),
    { successStatus: 200 },
  );
}

function provisionUnavailableResponse(context: AppContext): Response {
  return getBoundResponders(context).respondError("ephemeral_provision_unavailable", {
    headers: { "Retry-After": "60" },
  });
}

function retryAfterSeconds(value: number): string {
  return String(Math.max(1, Math.ceil(value)));
}

async function powRequiredResponse(context: AppContext, powSecret: string): Promise<Response> {
  const challenge = await issuePowChallenge({ secret: powSecret });
  const requestId = getRequestId(context);
  const body = {
    ...buildErrorBody({
      code: "pow_required",
      message: "pow_required",
      requestId,
      docsBaseUrl: context.env.DOCS_BASE_URL,
    }),
    challenge,
  };
  return new Response(JSON.stringify(body), {
    status: 401,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      [REQUEST_ID_HEADER]: requestId,
    },
  });
}
