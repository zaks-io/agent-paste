import { WorkerEntrypoint } from "cloudflare:workers";
import type { RouteId } from "@agent-paste/contracts";
import { sentryOptions } from "@agent-paste/worker-runtime";
import * as Sentry from "@sentry/cloudflare";
import worker, { type Env, handleMcpApiRequest } from "./index.js";

export default worker;
export { EphemeralProvisionGate, WorkspaceWriteAllowance } from "./index.js";

export class McpApiEntrypoint extends WorkerEntrypoint<Env> {
  async fetchMcp(request: Request, subject: string, routeId: RouteId): Promise<Response> {
    return Sentry.wrapRequestHandler({ options: sentryOptions(this.env, "api"), request, context: this.ctx }, () =>
      handleMcpApiRequest(request, this.env, subject, routeId, this.ctx),
    );
  }
}
