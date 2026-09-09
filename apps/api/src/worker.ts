import { WorkerEntrypoint } from "cloudflare:workers";
import type { RouteId } from "@agent-paste/contracts";
import worker, { type Env, handleMcpApiRequest } from "./index.js";

export default worker;
export { EphemeralProvisionGate, WorkspaceWriteAllowance } from "./index.js";

export class McpApiEntrypoint extends WorkerEntrypoint<Env> {
  async fetchMcp(request: Request, subject: string, routeId: RouteId): Promise<Response> {
    return handleMcpApiRequest(request, this.env, subject, routeId, this.ctx);
  }
}
