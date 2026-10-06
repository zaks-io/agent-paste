import type { ApiActor } from "./types.js";

export function resolveFeedbackContact(actor: ApiActor, workspaceContactEmail: string | null): string | null {
  return actor.type === "member" ? actor.email : workspaceContactEmail;
}
