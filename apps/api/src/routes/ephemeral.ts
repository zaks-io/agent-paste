import { ClaimCode } from "@agent-paste/contracts";
import { parseClaimToken, type Repository } from "@agent-paste/db";
import { getBoundResponders, writeFunnelEvent } from "@agent-paste/worker-runtime";
import type { AppContext } from "../env.js";
import {
  consumeEphemeralProvisionGate,
  EPHEMERAL_PROVISION_GATE_KEY_TTL_SECONDS,
} from "../ephemeral-provision-gate.js";
import { webMemberActor } from "../principals.js";
import { waitForProvisionDelay } from "../provision-delay.js";
import { runIdempotent } from "../responses.js";
import type { GuardFor } from "../route-contracts.js";

export async function ephemeralProvisionRoute(
  context: AppContext,
  db: Repository,
  guard: GuardFor<"ephemeral.provision">,
): Promise<Response> {
  const env = context.env;
  const body = guard.body;
  const claimCode = validClaimCode(body.claim_code);
  writeFunnelEvent(env.FUNNEL_EVENTS, {
    kind: "ephemeral_provision_started",
    surface: "api",
    claimCode,
  });

  const provisionKey = crypto.randomUUID();
  const gateDecision = await consumeEphemeralProvisionGate(
    env.EPHEMERAL_PROVISION_GATE,
    provisionKey,
    EPHEMERAL_PROVISION_GATE_KEY_TTL_SECONDS,
  );
  if (!gateDecision) {
    return provisionUnavailableResponse(context, claimCode);
  }
  if (!gateDecision.allowed) {
    if (gateDecision.reason === "duplicate_nonce") {
      return provisionUnavailableResponse(context, claimCode);
    }
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

  await waitForProvisionDelay(env.EPHEMERAL_PROVISION_DELAY_MS);
  const result = await db.createEphemeralWorkspace({
    idempotencyKey: `ephemeral-provision:${provisionKey}`,
    ...(claimCode ? { claimCode } : {}),
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
          claimCode: parseClaimToken(guard.body.claim_token)?.claimCode,
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
