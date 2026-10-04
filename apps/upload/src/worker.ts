import { WorkerEntrypoint } from "cloudflare:workers";
import type { RouteId } from "@agent-paste/contracts";
import { sentryOptions } from "@agent-paste/worker-runtime";
import * as Sentry from "@sentry/cloudflare";
import worker, { type Env, handleMcpUploadRequest } from "./index.js";

export default worker;

export class McpUploadEntrypoint extends WorkerEntrypoint<Env> {
  async fetchMcp(request: Request, subject: string, routeId: RouteId): Promise<Response> {
    return Sentry.wrapRequestHandler({ options: sentryOptions(this.env, "upload"), request, context: this.ctx }, () =>
      handleMcpUploadRequest(request, this.env, subject, routeId),
    );
  }
}
