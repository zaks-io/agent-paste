import type { ApiActor, ApiKeyActor, PlatformActor } from "@agent-paste/db";
import type { Principal } from "@agent-paste/worker-runtime";

export function workspaceApiActor(principal: Principal): ApiActor | null {
  if (principal.kind === "api_key") {
    return principal.actor as ApiActor;
  }
  if (principal.kind === "workos_access_token" && principal.actor?.type === "member") {
    return principal.actor as ApiActor;
  }
  return null;
}

export function webMemberActor(principal: Principal): ApiActor | null {
  if (principal.kind !== "workos_access_token" || !principal.actor || principal.actor.type !== "member") {
    return null;
  }
  return principal.actor as ApiActor;
}

export function apiKeyActor(principal: Principal): ApiKeyActor | null {
  if (principal.kind !== "api_key" || principal.actor.type !== "api_key") {
    return null;
  }
  return principal.actor as ApiKeyActor;
}

export function platformActor(principal: Principal): PlatformActor | null {
  if (principal.kind !== "operator") {
    return null;
  }
  return { type: "platform", id: principal.actor.id };
}
