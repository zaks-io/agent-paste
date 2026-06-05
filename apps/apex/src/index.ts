import { generateCspNonce, sentryOptions } from "@agent-paste/worker-runtime";
import * as Sentry from "@sentry/cloudflare";
import { routeApex } from "./routes.js";

export type Env = {
  AGENT_PASTE_ENV?: string;
  ASSETS?: { fetch(request: Request): Promise<Response> };
  SENTRY_DSN?: string;
  CF_WEB_ANALYTICS_TOKEN?: string;
};

const worker = {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};

export default Sentry.withSentry((env: Env) => sentryOptions(env), worker);

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const response = routeApex(request, {
    nonce: generateCspNonce(),
    analyticsToken: env.CF_WEB_ANALYTICS_TOKEN,
  });
  if (response) {
    return response;
  }

  if (env.ASSETS) {
    const assetResponse = await env.ASSETS.fetch(request);
    if (assetResponse.status !== 404) {
      return assetResponse;
    }
  }

  return new Response("not_found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
