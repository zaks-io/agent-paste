import { describe, expect, it, vi } from "vitest";
import {
  addLocalMcpRpcHeaders,
  createLocalMcpRpcWorker,
  LOCAL_MCP_RPC_ROUTE_HEADER,
  LOCAL_MCP_RPC_SECRET_HEADER,
  LOCAL_MCP_RPC_SUBJECT_HEADER,
} from "./local-mcp-rpc.mjs";

const secret = "per-run-secret";

describe("local MCP RPC boundary", () => {
  it("passes ordinary requests to the public worker", async () => {
    const publicFetch = vi.fn(async () => new Response("public"));
    const handleMcpRequest = vi.fn();
    const worker = createLocalMcpRpcWorker({ fetch: publicFetch }, handleMcpRequest, secret);

    const response = await worker.fetch(new Request("http://127.0.0.1/v1/whoami"), {});

    expect(await response.text()).toBe("public");
    expect(publicFetch).toHaveBeenCalledOnce();
    expect(handleMcpRequest).not.toHaveBeenCalled();
  });

  it("rejects forged MCP dispatch headers without the per-run secret", async () => {
    const publicFetch = vi.fn();
    const handleMcpRequest = vi.fn();
    const worker = createLocalMcpRpcWorker({ fetch: publicFetch }, handleMcpRequest, secret);
    const headers = new Headers({
      [LOCAL_MCP_RPC_SUBJECT_HEADER]: "user_victim",
      [LOCAL_MCP_RPC_ROUTE_HEADER]: "mcp.whoami",
    });

    const response = await worker.fetch(new Request("http://127.0.0.1/v1/mcp/whoami", { headers }), {});

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "not_authenticated" } });
    expect(publicFetch).not.toHaveBeenCalled();
    expect(handleMcpRequest).not.toHaveBeenCalled();
  });

  it("dispatches authenticated MCP requests without exposing internal headers", async () => {
    const publicFetch = vi.fn();
    const handleMcpRequest = vi.fn(async (request, _env, subject, routeId) => {
      expect(subject).toBe("user_member");
      expect(routeId).toBe("mcp.whoami");
      expect(request.headers.get(LOCAL_MCP_RPC_SECRET_HEADER)).toBeNull();
      expect(request.headers.get(LOCAL_MCP_RPC_SUBJECT_HEADER)).toBeNull();
      expect(request.headers.get(LOCAL_MCP_RPC_ROUTE_HEADER)).toBeNull();
      return new Response("mcp");
    });
    const worker = createLocalMcpRpcWorker({ fetch: publicFetch }, handleMcpRequest, secret);
    const headers = new Headers();
    addLocalMcpRpcHeaders(headers, { secret, subject: "user_member", routeId: "mcp.whoami" });

    const response = await worker.fetch(new Request("http://127.0.0.1/v1/mcp/whoami", { headers }), {});

    expect(await response.text()).toBe("mcp");
    expect(publicFetch).not.toHaveBeenCalled();
    expect(handleMcpRequest).toHaveBeenCalledOnce();
  });
});
