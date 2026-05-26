import { sentryOptions } from "@agent-paste/worker-runtime";
import * as Sentry from "@sentry/cloudflare";
import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import type { WebEnv } from "./server/env";

const entry = createServerEntry({
  fetch(request: Request) {
    return handler.fetch(request);
  },
});

const worker = {
  fetch(request: Request, _env: WebEnv, _ctx: ExecutionContext): Response | Promise<Response> {
    return entry.fetch(request);
  },
};

export default Sentry.withSentry((env: WebEnv) => sentryOptions(env), worker);
