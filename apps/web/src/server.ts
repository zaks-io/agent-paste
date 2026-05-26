import { sentryOptions } from "@agent-paste/worker-runtime";
import * as Sentry from "@sentry/cloudflare";
import handler from "@tanstack/react-start/server-entry";
import type { WebEnv } from "./server/env";

const worker = {
  fetch(request: Request, _env: WebEnv, _ctx: ExecutionContext): Response | Promise<Response> {
    return handler.fetch(request);
  },
};

export default Sentry.withSentry((env: WebEnv) => sentryOptions(env), worker);
