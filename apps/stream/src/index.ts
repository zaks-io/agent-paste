import { BASELINE_SECURITY_HEADERS, sentryOptions } from "@agent-paste/worker-runtime";
import * as Sentry from "@sentry/cloudflare";
import { ArtifactLiveUpdates } from "./artifact-live.js";
import { authorizeLiveUpdate, parseAuthorizeAccessLinkBody } from "./authorize.js";

export { ArtifactLiveUpdates };

export type ApiServiceBinding = {
  fetch(request: Request): Promise<Response>;
};

export type Env = {
  API: ApiServiceBinding;
  ARTIFACT_LIVE: DurableObjectNamespace;
  AGENT_PASTE_ENV?: string;
  STREAM_BASE_URL?: string;
  STREAM_INTERNAL_SECRET?: string;
  SENTRY_DSN?: string;
};

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};

export default Sentry.withSentry((env: Env) => sentryOptions(env), worker);

const ACCESS_LINK_PATH = /^\/v1\/live\/access-links\/([0-9A-HJKMNP-TV-Z]{16})$/;
const DASHBOARD_PATH = /^\/v1\/live\/artifacts\/([^/]+)$/;

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/healthz") {
    return new Response("ok", { status: 200 });
  }

  const accessLinkMatch = ACCESS_LINK_PATH.exec(url.pathname);
  if (accessLinkMatch?.[1] && request.method === "POST") {
    return handleAccessLink(request, env, accessLinkMatch[1]);
  }

  const dashboardMatch = DASHBOARD_PATH.exec(url.pathname);
  if (dashboardMatch?.[1] && request.method === "GET") {
    return handleDashboard(request, env, dashboardMatch[1]);
  }

  return notFound();
}

async function handleAccessLink(request: Request, env: Env, publicId: string): Promise<Response> {
  const body = await readJson(request);
  const authorizeRequest = parseAuthorizeAccessLinkBody(publicId, body);
  if (!authorizeRequest) {
    return notFound();
  }
  const authorized = await authorizeLiveUpdate(env.API, authorizeRequest, {
    ...(env.STREAM_INTERNAL_SECRET ? { streamInternalSecret: env.STREAM_INTERNAL_SECRET } : {}),
  });
  if (!authorized) {
    return notFound();
  }
  return connectToArtifact(env, authorized, request.signal, {
    kind: "access_link",
    public_id: publicId as import("@agent-paste/contracts").AccessLinkPublicId,
    blob: authorizeRequest.blob,
  });
}

async function handleDashboard(request: Request, env: Env, artifactId: string): Promise<Response> {
  const authorization = request.headers.get("authorization");
  if (!authorization) {
    return notFound();
  }
  const authorized = await authorizeLiveUpdate(
    env.API,
    { kind: "dashboard", artifact_id: artifactId as import("@agent-paste/contracts").ArtifactId },
    {
      authorization,
      ...(env.STREAM_INTERNAL_SECRET ? { streamInternalSecret: env.STREAM_INTERNAL_SECRET } : {}),
    },
  );
  if (!authorized) {
    return notFound();
  }
  return connectToArtifact(env, authorized, request.signal, {
    kind: "dashboard",
    authorization,
  });
}

async function connectToArtifact(
  env: Env,
  authorized: { artifact_id: string; audience: "share" | "dashboard"; pointer: unknown },
  signal: AbortSignal,
  auth: import("./connection-auth.js").LiveConnectionAuth,
): Promise<Response> {
  const id = env.ARTIFACT_LIVE.idFromName(authorized.artifact_id);
  const stub = env.ARTIFACT_LIVE.get(id);
  const connectionId = crypto.randomUUID();
  return stub.fetch(
    new Request("https://artifact-live/sse/connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        connection_id: connectionId,
        artifact_id: authorized.artifact_id,
        audience: authorized.audience,
        pointer: authorized.pointer,
        auth,
      }),
      signal,
    }),
  );
}

function notFound(): Response {
  return new Response(JSON.stringify({ error: { code: "not_found", message: "not_found" } }), {
    status: 404,
    headers: { ...BASELINE_SECURITY_HEADERS, "content-type": "application/json; charset=utf-8" },
  });
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
