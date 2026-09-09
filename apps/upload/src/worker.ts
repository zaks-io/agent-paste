import { WorkerEntrypoint } from "cloudflare:workers";
import type { RouteId } from "@agent-paste/contracts";
import worker, { type Env, handleMcpUploadRequest } from "./index.js";

export default worker;

export class McpUploadEntrypoint extends WorkerEntrypoint<Env> {
  async fetchMcp(request: Request, subject: string, routeId: RouteId): Promise<Response> {
    return handleMcpUploadRequest(request, this.env, subject, routeId);
  }
}
