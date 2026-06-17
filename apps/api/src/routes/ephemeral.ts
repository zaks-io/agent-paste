import { buildErrorBody, getRequestId, REQUEST_ID_HEADER } from "@agent-paste/auth";
import { ClaimCode } from "@agent-paste/contracts";
import type { Repository } from "@agent-paste/db";
import { DEFAULT_POW_CHALLENGE_TTL_SECONDS, issuePowChallenge, verifyPowSolution } from "@agent-paste/tokens/pow";
import { getBoundResponders, writeFunnelEvent } from "@agent-paste/worker-runtime";
import type { AppContext } from "../env.js";
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
  const claimCode = validClaimCode(body.claim_code);
  if (!body.challenge || !body.solution) {
    writeFunnelEvent(env.FUNNEL_EVENTS, {
      kind: "ephemeral_provision_started",
      surface: "api",
      claimCode,
    });
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

  const gateDecision = await consumeEphemeralProvisionGate(
    env.EPHEMERAL_PROVISION_GATE,
    challenge.nonce,
    DEFAULT_POW_CHALLENGE_TTL_SECONDS,
  );
  if (!gateDecision) {
    return provisionUnavailableResponse(context, claimCode);
  }
  if (!gateDecision.allowed && gateDecision.reason === "duplicate_nonce") {
    return getBoundResponders(context).respondError("pow_invalid");
  }
  if (!gateDecision.allowed) {
    writeFunnelEvent(env.FUNNEL_EVENTS, {
      kind: "ephemeral_provision_rate_limited",
      surface: "api",
      claimCode,
      status: gateDecision.reason,
    });
    return getBoundResponders(context).respondError("ephemeral_provision_rate_limited", {
      headers: { "Retry-After": retryAfterSeconds(gateDecision.retry_after_seconds) },
    });
  }

  const result = await db.createEphemeralWorkspace({
    idempotencyKey: `ephemeral-provision:${challenge.nonce}`,
  });
  writeFunnelEvent(env.FUNNEL_EVENTS, {
    kind: "ephemeral_workspace_created",
    surface: "api",
    claimCode,
    workspaceId: result.workspace.id,
    claimTokenId: result.claim_token.id,
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
    async () => {
      const { result, isReplay } = await db.claimEphemeralWorkspaceWithReplayState({
        actor,
        claimTokenSecret: guard.body.claim_token,
        idempotencyKey: guard.idempotencyKey,
      });
      if (!isReplay) {
        writeFunnelEvent(context.env.FUNNEL_EVENTS, {
          kind: "link_claimed",
          surface: "api",
          claimCode: validClaimCode(guard.body.claim_code),
          workspaceId: result.source_workspace_id,
          claimTokenId: result.claim_token_id,
          artifactCount: result.artifact_ids.length,
        });
      }
      return result;
    },
    { successStatus: 200 },
  );
}

function provisionUnavailableResponse(context: AppContext, claimCode?: string): Response {
  writeFunnelEvent(context.env.FUNNEL_EVENTS, {
    kind: "ephemeral_provision_unavailable",
    surface: "api",
    claimCode,
    status: "gate_unavailable",
  });
  return getBoundResponders(context).respondError("ephemeral_provision_unavailable", {
    headers: { "Retry-After": "60" },
  });
}

function retryAfterSeconds(value: number): string {
  return String(Math.max(1, Math.ceil(value)));
}

function validClaimCode(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = ClaimCode.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

// Verification trusts the difficulty signed into the challenge, so this knob only
// affects issuance. Hosted envs leave it unset (default 20); the local harness and
// CI smokes lower it so a 2-vCPU runner is not grinding ~1M hashes per provision.
function resolvePowDifficultyBits(env: AppContext["env"]): number | undefined {
  const raw = env.EPHEMERAL_POW_DIFFICULTY_BITS;
  if (raw === undefined || raw === "") {
    return undefined;
  }
  const value = /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isInteger(value) || value < 1 || value > 32) {
    throw new Error(`EPHEMERAL_POW_DIFFICULTY_BITS must be an integer between 1 and 32, got ${JSON.stringify(raw)}`);
  }
  return value;
}

async function powRequiredResponse(context: AppContext, powSecret: string): Promise<Response> {
  const difficulty = resolvePowDifficultyBits(context.env);
  const challenge = await issuePowChallenge(
    difficulty === undefined ? { secret: powSecret } : { secret: powSecret, difficulty },
  );
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
