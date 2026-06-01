import type { AdminActor, ApiActor, PlatformActor } from "../types.js";
import type { PlatformLockdown } from "../types.js";
import type { CommandActor, RunScope } from "./ports.js";

export const PLATFORM_SCOPE: RunScope = { kind: "platform" };

export function workspaceScope(workspaceId: string): RunScope {
  return { kind: "workspace", workspaceId };
}

export function expiresAtFromSeconds(now: string, expiresInSeconds: number | undefined): string | null {
  return expiresInSeconds === undefined ? null : new Date(Date.parse(now) + expiresInSeconds * 1000).toISOString();
}

export function isApiKeyExpired(apiKey: { expires_at: string | null }, now: Date = new Date()): boolean {
  return apiKey.expires_at !== null && Date.parse(apiKey.expires_at) <= now.getTime();
}

export function apiCommandActor(actor: ApiActor): CommandActor {
  if (actor.type !== "api_key") {
    throw new Error(`unexpected_actor_type:${actor.type}`);
  }
  return { type: "api_key", id: actor.id, workspaceId: actor.workspace_id };
}

export function memberCommandActor(actor: ApiActor): CommandActor {
  if (actor.type !== "member") {
    throw new Error(`unexpected_actor_type:${actor.type}`);
  }
  return { type: "member", id: actor.id, workspaceId: actor.workspace_id };
}

export function workspaceCommandActor(actor: ApiActor): CommandActor {
  if (actor.type === "api_key") {
    return apiCommandActor(actor);
  }
  if (actor.type === "member") {
    return memberCommandActor(actor);
  }
  throw new Error("unexpected_actor_type");
}

export function adminCommandActor(actor: AdminActor, workspaceId: string | null): CommandActor {
  return { type: actor.type, id: actor.id, workspaceId };
}

export function platformCommandActor(actor: PlatformActor): CommandActor {
  return { type: "platform", id: actor.id, workspaceId: null };
}

export function toLockdownDetail(lockdown: PlatformLockdown) {
  return {
    scope: lockdown.scope,
    target_id: lockdown.target_id,
    reason_code: lockdown.reason_code,
    set_at: lockdown.set_at,
    set_by: lockdown.set_by,
    lifted_at: lockdown.lifted_at,
    lifted_by: lockdown.lifted_by,
  };
}

export function nowIso(value?: Date): string {
  return (value ?? new Date()).toISOString();
}
