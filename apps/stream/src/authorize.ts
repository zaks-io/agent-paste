import {
  LiveUpdateAuthorizeRequest,
  type LiveUpdateAuthorizeRequest as LiveUpdateAuthorizeRequestType,
  LiveUpdateAuthorizeResponse,
} from "@agent-paste/contracts";

export type ApiServiceBinding = {
  fetch(request: Request): Promise<Response>;
};

export async function authorizeLiveUpdate(
  api: ApiServiceBinding,
  request: LiveUpdateAuthorizeRequestType,
  options: { authorization?: string },
): Promise<LiveUpdateAuthorizeResponse | null> {
  const headers = new Headers({
    accept: "application/json",
    "content-type": "application/json",
    "x-agent-paste-caller": "stream",
  });
  if (options.authorization) {
    headers.set("authorization", options.authorization);
  }
  try {
    const response = await api.fetch(
      new Request("https://agent-paste.internal/v1/internal/live-updates/authorize", {
        method: "POST",
        headers,
        body: JSON.stringify(request),
      }),
    );
    if (!response.ok) {
      return null;
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return null;
    }
    const parsed = LiveUpdateAuthorizeResponse.safeParse(body);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function parseAuthorizeAccessLinkBody(publicId: string, body: unknown): LiveUpdateAuthorizeRequestType | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const blob = (body as { blob?: unknown }).blob;
  if (typeof blob !== "string" || blob.length === 0) {
    return null;
  }
  const parsed = LiveUpdateAuthorizeRequest.safeParse({
    kind: "access_link",
    public_id: publicId,
    blob,
  });
  return parsed.success ? parsed.data : null;
}
