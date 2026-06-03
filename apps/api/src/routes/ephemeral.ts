import { buildErrorBody, getRequestId, REQUEST_ID_HEADER } from "@agent-paste/auth";
import type { Repository } from "@agent-paste/db";
import {
  consumePowNonce,
  DEFAULT_POW_CHALLENGE_TTL_SECONDS,
  issuePowChallenge,
  type PowNonceStore,
  verifyPowSolution,
} from "@agent-paste/tokens/pow";
import { getBoundResponders } from "@agent-paste/worker-runtime";
import type { AppContext, Env } from "../env.js";
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

  const nonceStore = powNonceStore(env);
  if (!nonceStore) {
    return getBoundResponders(context).respondError("database_unavailable");
  }
  const consumed = await consumePowNonce(nonceStore, challenge.nonce, DEFAULT_POW_CHALLENGE_TTL_SECONDS);
  if (!consumed) {
    return getBoundResponders(context).respondError("pow_invalid");
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

function powNonceStore(env: Env): PowNonceStore | null {
  const denylist = env.DENYLIST;
  if (!denylist?.get || !denylist.put) {
    return null;
  }
  const get = denylist.get.bind(denylist);
  return {
    get: (key) => get(key),
    put: (key, value, options) => denylist.put(key, value, options),
  };
}
