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
type RateLimitOutcome = "allowed" | "limited" | "unavailable";

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
  const ipKey = clientIp?.trim();
  if (!ipKey) {
    return { ok: false, code: "ephemeral_provision_unavailable", retryAfter: "3600" } as const;
  }

  const globalOutcome = await checkRateLimit(bindings?.ephemeralProvisionGlobal, "global", "global");
  if (globalOutcome === "limited") {
    return { ok: false, code: "ephemeral_provision_rate_limited", retryAfter: "3600" } as const;
  }
  if (globalOutcome === "unavailable") {
    return { ok: false, code: "ephemeral_provision_unavailable", retryAfter: "3600" } as const;
  }

  const ipOutcome = await checkRateLimit(bindings?.ephemeralProvisionIp, "actor", ipKey);
  if (ipOutcome === "limited") {
    return { ok: false, code: "ephemeral_provision_rate_limited", retryAfter: "3600" } as const;
  }
  if (ipOutcome === "unavailable") {
    return { ok: false, code: "ephemeral_provision_unavailable", retryAfter: "3600" } as const;
  }

  return { ok: true } as const;
}

async function applyActorRateLimit(principal: Principal, bindings: RateLimitBindings | undefined) {
  if (principal.kind === "operator") {
    const actorOutcome = await checkRateLimit(bindings?.actor, "actor", `platform:${principal.actor.id}`);
    if (actorOutcome !== "allowed") {
      return { ok: false, code: "rate_limited_actor", retryAfter: "60" } as const;
    }
    return { ok: true } as const;
  }

  const actor = actorForPrincipal(principal);
  if (!actor?.workspace_id) {
    return { ok: false, code: "not_authenticated", retryAfter: "60" } as const;
  }

  const actorOutcome = await checkRateLimit(bindings?.actor, "actor", `${actor.workspace_id}:${actor.id}`);
  if (actorOutcome !== "allowed") {
    return { ok: false, code: "rate_limited_actor", retryAfter: "60" } as const;
  }

  const workspaceOutcome = await checkRateLimit(bindings?.workspace, "workspace", actor.workspace_id);
  if (workspaceOutcome !== "allowed") {
    return { ok: false, code: "rate_limited_workspace", retryAfter: "10" } as const;
  }

  return { ok: true } as const;
}

async function applyArtifactRateLimit(principal: Principal, bindings: RateLimitBindings | undefined) {
  const artifactId = artifactIdForPrincipal(principal);
  if (!artifactId) {
    return { ok: true } as const;
  }

  const outcome = await checkRateLimit(bindings?.artifact, "artifact", artifactId);
  if (outcome !== "allowed") {
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

async function checkRateLimit(
  binding: RateLimitBinding | undefined,
  scope: "actor" | "workspace" | "artifact" | "global",
  key: string,
): Promise<RateLimitOutcome> {
  if (!binding) {
    return "unavailable";
  }

  try {
    const outcome = await binding.limit({ key });
    return outcome.success ? "allowed" : "limited";
  } catch (error) {
    console.warn(`Rate limit ${scope} binding failed; denying request.`, error);
    return "unavailable";
  }
}
