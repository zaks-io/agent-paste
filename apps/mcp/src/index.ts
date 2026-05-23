import { Hono } from "hono";

export type Env = {
  MCP_RESOURCE?: string;
  MCP_AUTHORIZATION_SERVER?: string;
};

const app = new Hono<{ Bindings: Env }>();

app.get("/healthz", (context) => context.json({ ok: true, app: "mcp" }));
app.get("/.well-known/oauth-protected-resource", (context) => context.json(protectedResourceMetadata(context.env)));
app.get("/openapi.json", (context) => context.json(openApiDocument()));
app.notFound((context) => context.json({ error: { code: "not_found", message: "not_found" } }, 404));
app.onError((error, context) => {
  console.error("Unhandled MCP error:", error);
  return context.json({ error: { code: "internal_error", message: "internal_error" } }, 500);
});

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return await app.fetch(request, env);
  },
};

function protectedResourceMetadata(env: Env): Record<string, unknown> {
  const resource = env.MCP_RESOURCE ?? "https://mcp.agent-paste.sh";
  const authorizationServer = env.MCP_AUTHORIZATION_SERVER;
  return {
    resource,
    authorization_servers: authorizationServer ? [authorizationServer] : [],
    bearer_methods_supported: ["header"],
    scopes_supported: ["write", "read", "share"],
  };
}

function openApiDocument(): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "Agent Paste MCP API",
      version: "0.1.0",
    },
    paths: {
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
