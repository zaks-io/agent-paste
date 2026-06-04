import type { ApiActor } from "@agent-paste/db";
import type { Principal } from "@agent-paste/worker-runtime";
import type { UploadActor } from "./env.js";

export function uploadSessionActor(principal: Principal): UploadActor | null {
  if (principal.kind === "api_key") {
    const actor = principal.actor;
    if (actor.type !== "api_key" || !actor.workspace_id) {
      return null;
    }
    return {
      type: "api_key",
      id: actor.id,
      workspace_id: actor.workspace_id,
    };
  }
  if (principal.kind === "workos_access_token" && principal.actor?.type === "member") {
    const actor = principal.actor as ApiActor;
    if (actor.type !== "member" || !actor.workspace_id) {
      return null;
    }
    return actor;
  }
  return null;
}
