import type { ErrorCode, RateLimitRequirement, RouteContract } from "@agent-paste/contracts";
import type { Principal, ScopedActor } from "./principal.js";

export type RateLimitBinding = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

export type RateLimitBindings = {
  actor?: RateLimitBinding | undefined;
  workspace?: RateLimitBinding | undefined;
  artifact?: RateLimitBinding | undefined;
  ephemeralProvisionIp?: RateLimitBinding | undefined;
  ephemeralProvisionGlobal?: RateLimitBinding | undefined;
};

export type RateLimitResult = { ok: true } | { ok: false; code: ErrorCode; retryAfter: string };

export type RateLimitContext = {
  clientIp?: string | undefined;
};

export async function applyRateLimit(
  contract: RouteContract,
  principal: Principal,
  bindings: RateLimitBindings | undefined,
  context: RateLimitContext = {},
): Promise<RateLimitResult> {
  switch (contract.rateLimit satisfies RateLimitRequirement) {
    case "none":
      return { ok: true };
    case "actor":
      return applyActorRateLimit(principal, bindings);
    case "artifact":
      return applyArtifactRateLimit(principal, bindings);
    case "ephemeral_provision":
      return applyEphemeralProvisionRateLimit(bindings, context.clientIp);
  }
}

export async function applyEphemeralProvisionRateLimit(
  bindings: RateLimitBindings | undefined,
  clientIp: string | undefined,
): Promise<RateLimitResult> {
  const ipKey = clientIp?.trim() || "unknown";

  // Global ceiling fails closed (503) when the binding is absent or errors — unlike actor/workspace caps.
  const globalOutcome = await rateLimitOrFailClosed(bindings?.ephemeralProvisionGlobal, "global");
  if (!globalOutcome.success) {
    return { ok: false, code: "ephemeral_provision_unavailable", retryAfter: "3600" } as const;
  }

  const ipOutcome = await rateLimitOrFailOpen(bindings?.ephemeralProvisionIp, "actor", ipKey);
  if (ipOutcome && !ipOutcome.success) {
    return { ok: false, code: "ephemeral_provision_rate_limited", retryAfter: "3600" } as const;
  }

  return { ok: true } as const;
}

async function applyActorRateLimit(principal: Principal, bindings: RateLimitBindings | undefined) {
  if (principal.kind === "operator") {
    const actorOutcome = await rateLimitOrFailOpen(bindings?.actor, "actor", `platform:${principal.actor.id}`);
    if (actorOutcome && !actorOutcome.success) {
      return { ok: false, code: "rate_limited_actor", retryAfter: "60" } as const;
    }
    return { ok: true } as const;
  }

  const actor = actorForPrincipal(principal);
  if (!actor?.workspace_id) {
    return { ok: false, code: "not_authenticated", retryAfter: "60" } as const;
  }

  const actorOutcome = await rateLimitOrFailOpen(bindings?.actor, "actor", `${actor.workspace_id}:${actor.id}`);
  if (actorOutcome && !actorOutcome.success) {
    return { ok: false, code: "rate_limited_actor", retryAfter: "60" } as const;
  }

  const workspaceOutcome = await rateLimitOrFailOpen(bindings?.workspace, "workspace", actor.workspace_id);
  if (workspaceOutcome && !workspaceOutcome.success) {
    return { ok: false, code: "rate_limited_workspace", retryAfter: "10" } as const;
  }

  return { ok: true } as const;
}

async function applyArtifactRateLimit(principal: Principal, bindings: RateLimitBindings | undefined) {
  const artifactId = artifactIdForPrincipal(principal);
  if (!artifactId) {
    return { ok: true } as const;
  }

  const outcome = await rateLimitOrFailOpen(bindings?.artifact, "artifact", artifactId);
  if (outcome && !outcome.success) {
    return { ok: false, code: "rate_limited_artifact", retryAfter: "60" } as const;
  }

  return { ok: true } as const;
}

function actorForPrincipal(principal: Principal): ScopedActor | null {
  if (principal.kind === "api_key") {
    return principal.actor;
  }
  if (principal.kind === "workos_access_token" && principal.actor) {
    return principal.actor;
  }
  return null;
}

function artifactIdForPrincipal(principal: Principal): string | null {
  if (principal.kind === "signed_content_token" || principal.kind === "signed_agent_view_token") {
    const payload = principal.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return null;
    }
    const artifactId = (payload as { artifact_id?: unknown }).artifact_id;
    return typeof artifactId === "string" ? artifactId : null;
  }
  return null;
}

async function rateLimitOrFailOpen(
  binding: RateLimitBinding | undefined,
  scope: "actor" | "workspace" | "artifact",
  key: string,
): Promise<{ success: boolean } | undefined> {
  if (!binding) {
    return undefined;
  }

  try {
    return await binding.limit({ key });
  } catch (error) {
    console.warn(`Rate limit ${scope} binding failed; allowing request.`, error);
    return undefined;
  }
}

async function rateLimitOrFailClosed(
  binding: RateLimitBinding | undefined,
  scope: "global",
): Promise<{ success: boolean }> {
  if (!binding) {
    return { success: false };
  }

  try {
    return await binding.limit({ key: scope });
  } catch (error) {
    console.warn(`Rate limit ${scope} binding failed; denying request.`, error);
    return { success: false };
  }
}
