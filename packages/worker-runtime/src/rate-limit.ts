import type { ErrorCode, RateLimitRequirement, RouteContract } from "@agent-paste/contracts";
import type { Context } from "hono";
import type { Principal, ScopedActor } from "./principal.js";

export type RateLimitBinding = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

export type RateLimitBindings = {
  actor?: RateLimitBinding | undefined;
  workspace?: RateLimitBinding | undefined;
  artifact?: RateLimitBinding | undefined;
};

export type RateLimitResult = { ok: true } | { ok: false; code: ErrorCode; retryAfter: string };

export async function applyRateLimit(
  contract: RouteContract,
  principal: Principal,
  bindings: RateLimitBindings | undefined,
): Promise<RateLimitResult> {
  switch (contract.rateLimit satisfies RateLimitRequirement) {
    case "none":
      return { ok: true };
    case "actor":
      return applyActorRateLimit(principal, bindings);
    case "artifact":
      return applyArtifactRateLimit(principal, bindings);
  }
}

async function applyActorRateLimit(principal: Principal, bindings: RateLimitBindings | undefined) {
  if (principal.kind === "operator") {
    const actorOutcome = await rateLimitOrFailOpen(bindings?.actor, "actor", `platform:${principal.actor.id}`);
    if (actorOutcome && !actorOutcome.success) {
      return { ok: false, code: "rate_limited_actor", retryAfter: "60" } as const;
    }
    return { ok: true } as const;
  }

  if (principal.kind === "admin_token") {
    const adminId = adminIdForPrincipal(principal);
    if (!adminId) {
      return { ok: true } as const;
    }
    const actorOutcome = await rateLimitOrFailOpen(bindings?.actor, "actor", `platform:admin:${adminId}`);
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

function adminIdForPrincipal(principal: Principal): string | null {
  if (principal.kind !== "admin_token") {
    return null;
  }
  const actor = principal.actor;
  if (!actor || typeof actor !== "object" || Array.isArray(actor)) {
    return null;
  }
  const id = (actor as { id?: unknown }).id;
  return typeof id === "string" ? id : null;
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

export function routeContextFromHono(context: Context): { request: Request; params: Record<string, string> } {
  return { request: context.req.raw, params: context.req.param() };
}
