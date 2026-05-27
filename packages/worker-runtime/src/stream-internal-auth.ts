import { constantTimeEqual } from "@agent-paste/tokens/crypto";

export const STREAM_INTERNAL_SECRET_HEADER = "x-agent-paste-stream-secret";

export function isAuthorizedStreamInternalRequest(request: Request, secret: string | undefined): boolean {
  if (!secret) {
    return false;
  }
  const provided = request.headers.get(STREAM_INTERNAL_SECRET_HEADER);
  return Boolean(provided && constantTimeEqual(provided, secret));
}

export function streamInternalSecretHeaders(secret: string | undefined): HeadersInit {
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
  };
  if (secret) {
    headers[STREAM_INTERNAL_SECRET_HEADER] = secret;
  }
  return headers;
}
