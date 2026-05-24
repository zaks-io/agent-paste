import type { Clock } from "./clock.js";
import { sign, verify } from "./codec.js";

export type AgentViewTokenPayload = {
  artifact_id: string;
  revision_id: string;
  exp: number;
};

export function isValidAgentViewTokenPayload(value: unknown): value is AgentViewTokenPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const payload = value as Partial<AgentViewTokenPayload>;
  return (
    typeof payload.artifact_id === "string" &&
    payload.artifact_id.startsWith("art_") &&
    typeof payload.revision_id === "string" &&
    payload.revision_id.startsWith("rev_") &&
    typeof payload.exp === "number" &&
    Number.isInteger(payload.exp)
  );
}

export function mintAgentViewToken(payload: AgentViewTokenPayload, secret: string): Promise<string> {
  return sign(payload, secret);
}

export function verifyAgentViewToken(
  token: string,
  secret: string,
  clock?: Clock,
): Promise<AgentViewTokenPayload | null> {
  return verify(token, secret, { isValid: isValidAgentViewTokenPayload, clock });
}

/** Signs an agent-view token and builds the `api` URL `{baseUrl}/v1/public/agent-view/{token}`. */
export async function mintAgentViewUrl(input: {
  baseUrl: string;
  secret: string;
  payload: AgentViewTokenPayload;
}): Promise<string> {
  const token = await mintAgentViewToken(input.payload, input.secret);
  return `${input.baseUrl}/v1/public/agent-view/${encodeURIComponent(token)}`;
}
