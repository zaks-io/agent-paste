import { GPC_SUPPORT_BODY, GPC_SUPPORT_PATH } from "@agent-paste/brand";
import { generateCspNonce, sentryOptions } from "@agent-paste/worker-runtime";
import * as Sentry from "@sentry/cloudflare";
import handler from "@tanstack/react-start/server-entry";
import { applyAccessLinkSecurityHeaders, applyDashboardSecurityHeaders } from "./security-headers";
import { runWithCspNonce } from "./server/csp-nonce";
import type { WebEnv } from "./server/env";

const WEB_HEALTH_PAYLOAD = { ok: true, app: "web" } as const;

export async function handleRequest(request: Request, env: WebEnv): Promise<Response> {
  const nonce = generateCspNonce();
  const staticResponse = wellKnownGpcResponse(request);
  const response =
    staticResponse ??
    (isHealthRequest(request)
      ? Response.json(WEB_HEALTH_PAYLOAD)
      : await runWithCspNonce(nonce, () => handler.fetch(request)));
  const baselined = applyDashboardSecurityHeaders(response, env, nonce);
  return applyAccessLinkSecurityHeaders(request, baselined, env, nonce);
}

const worker = {
  async fetch(request: Request, env: WebEnv, _ctx: ExecutionContext): Promise<Response> {
    // handleRequest owns the health fast path plus the per-request CSP nonce used
    // by TanStack SSR for every rendered app route.
    return handleRequest(request, env);
  },
};

function isHealthRequest(request: Request): boolean {
  return new URL(request.url).pathname === "/healthz";
}

function wellKnownGpcResponse(request: Request): Response | null {
  if (new URL(request.url).pathname !== GPC_SUPPORT_PATH) {
    return null;
  }
  return new Response(GPC_SUPPORT_BODY, {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300" },
  });
}

export default Sentry.withSentry((env: WebEnv) => sentryOptions(env), worker);
