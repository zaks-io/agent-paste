import { generateCspNonce, sentryOptions } from "@agent-paste/worker-runtime";
import * as Sentry from "@sentry/cloudflare";
import handler from "@tanstack/react-start/server-entry";
import { applyAccessLinkSecurityHeaders, applyDashboardSecurityHeaders } from "./security-headers";
import { runWithCspNonce } from "./server/csp-nonce";
import type { WebEnv } from "./server/env";

const worker = {
  async fetch(request: Request, env: WebEnv, _ctx: ExecutionContext): Promise<Response> {
    // Mint a per-request CSP nonce and render inside its AsyncLocalStorage scope.
    // getRouter() reads it to set router.options.ssr.nonce, which TanStack stamps
    // onto every injected inline script + the <meta property="csp-nonce">. The CSP
    // header below trusts that same nonce, so script-src needs no 'unsafe-inline'.
    const nonce = generateCspNonce();
    const response = await runWithCspNonce(nonce, () => handler.fetch(request));
    const baselined = applyDashboardSecurityHeaders(response, env, nonce);
    return applyAccessLinkSecurityHeaders(request, baselined, env);
  },
};

export default Sentry.withSentry((env: WebEnv) => sentryOptions(env), worker);
