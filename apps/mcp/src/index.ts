import { mcpProtectedResourceMetadata } from "@agent-paste/contracts";
import { sentryOptions } from "@agent-paste/worker-runtime";
import * as Sentry from "@sentry/cloudflare";
import { Hono } from "hono";
import { handleMcpEndpoint } from "./transport.js";

export type Env = {
  AGENT_PASTE_ENV?: string;
  MCP_RESOURCE?: string;
  MCP_AUTHORIZATION_SERVER?: string;
  SENTRY_DSN?: string;
};

const app = new Hono<{ Bindings: Env }>();

app.get("/healthz", (context) => context.json({ ok: true, app: "mcp" }));
app.get("/.well-known/oauth-protected-resource", (context) => context.json(protectedResourceMetadata(context.env)));
app.get("/openapi.json", (context) => context.json(openApiDocument()));
app.all("/", (context) => handleMcpEndpoint(context.req.raw, context.env));
app.notFound((context) => context.json({ error: { code: "not_found", message: "not_found" } }, 404));
app.onError((error, context) => {
  console.error("Unhandled MCP error:", error);
  return context.json({ error: { code: "internal_error", message: "internal_error" } }, 500);
});

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    return await app.fetch(request, env);
  },
};

export default Sentry.withSentry((env: Env) => sentryOptions(env), worker);

function protectedResourceMetadata(env: Env): Record<string, unknown> {
  return mcpProtectedResourceMetadata({
    ...(env.MCP_RESOURCE ? { resource: env.MCP_RESOURCE } : {}),
    ...(env.MCP_AUTHORIZATION_SERVER ? { authorizationServers: [env.MCP_AUTHORIZATION_SERVER] } : {}),
  });
}

function openApiDocument(): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "Agent Paste MCP API",
      version: "0.1.0",
    },
    paths: {
      "/": {
        get: {
          operationId: "mcp.streamableHttpGet",
          responses: {
            405: { description: "SSE stream not offered in stateless v1" },
          },
        },
        post: {
          operationId: "mcp.streamableHttpPost",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { type: "object" },
              },
            },
          },
          responses: {
            200: { description: "JSON-RPC result (JSON or SSE)" },
            202: { description: "Accepted client notification or response" },
            400: { description: "Malformed JSON-RPC" },
            401: { description: "Missing or invalid OAuth bearer" },
          },
        },
      },
      "/healthz": {
        get: {
          operationId: "mcp.health",
          responses: { 200: { description: "Worker health" } },
        },
      },
      "/.well-known/oauth-protected-resource": {
        get: {
          operationId: "mcp.oauthProtectedResource",
          responses: {
            200: {
              description: "OAuth protected resource metadata",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["resource", "authorization_servers", "bearer_methods_supported", "scopes_supported"],
                    properties: {
                      resource: { type: "string", format: "uri" },
                      authorization_servers: { type: "array", items: { type: "string", format: "uri" } },
                      bearer_methods_supported: { type: "array", items: { type: "string" } },
                      scopes_supported: { type: "array", items: { type: "string" } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/openapi.json": {
        get: {
          operationId: "mcp.openApiDocument",
          responses: {
            200: {
              description: "OpenAPI document",
              content: { "application/json": { schema: { type: "object" } } },
            },
          },
        },
      },
    },
  };
}
