import { sentryOptions } from "@agent-paste/worker-runtime";
import * as Sentry from "@sentry/cloudflare";
import handler from "@tanstack/react-start/server-entry";
import { applyAccessLinkSecurityHeaders } from "./security-headers";
import type { WebEnv } from "./server/env";

const worker = {
  async fetch(request: Request, env: WebEnv, _ctx: ExecutionContext): Promise<Response> {
    const response = await handler.fetch(request);
    return applyAccessLinkSecurityHeaders(request, response, env);
  },
};

export default Sentry.withSentry((env: WebEnv) => sentryOptions(env), worker);
