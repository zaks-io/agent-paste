import {
  MCP_AUTHKIT_OAUTH_SCOPES,
  MCP_RESOURCE_INDICATOR,
  mcpProtectedResourceMetadata,
  trimTrailingSlashes,
} from "@agent-paste/contracts";
import { securityHeadersMiddleware, sentryOptions } from "@agent-paste/worker-runtime";
import * as Sentry from "@sentry/cloudflare";
import { type Context, Hono } from "hono";
import type { ApiServiceBinding } from "./forward.js";
import { handleMcpEndpoint } from "./transport.js";
import type { McpWorkOsEnv } from "./workos.js";

export type Env = McpWorkOsEnv & {
  AGENT_PASTE_ENV?: string;
  MCP_RESOURCE?: string;
  MCP_AUTHORIZATION_SERVER?: string;
  API?: ApiServiceBinding;
  SENTRY_DSN?: string;
};

type AppContext = Context<{ Bindings: Env }>;

const app = new Hono<{ Bindings: Env }>();

app.use("*", securityHeadersMiddleware());
app.get("/healthz", (context) => context.json({ ok: true, app: "mcp" }));
app.get("/.well-known/oauth-protected-resource", (context) => context.json(protectedResourceMetadata(context.env)));
app.get("/.well-known/oauth-protected-resource/*", (context) => context.json(protectedResourceMetadata(context.env)));
app.get("/.well-known/oauth-authorization-server", (context) => authorizationServerMetadataResponse(context));
app.get("/.well-known/openid-configuration", (context) => authorizationServerMetadataResponse(context));
app.get("/.well-known/oauth-authorization-server/*", (context) => authorizationServerMetadataResponse(context));
app.get("/.well-known/openid-configuration/*", (context) => authorizationServerMetadataResponse(context));
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
  const resource = env.MCP_RESOURCE ?? MCP_RESOURCE_INDICATOR;
  return mcpProtectedResourceMetadata({
    resource,
    ...(env.MCP_AUTHORIZATION_SERVER ? { authorizationServers: [env.MCP_AUTHORIZATION_SERVER] } : {}),
  });
}

function authorizationServerMetadataResponse(context: AppContext): Response {
  const metadata = authorizationServerMetadata(context.env);
  if (!metadata) {
    return Response.json(
      { error: { code: "oauth_metadata_not_configured", message: "oauth_metadata_not_configured" } },
      { status: 503 },
    );
  }
  return Response.json(metadata);
}

function authorizationServerMetadata(env: Env): Record<string, unknown> | null {
  const authorizationServer = normalizedUrl(
    env.MCP_AUTHORIZATION_SERVER ?? env.WORKOS_MCP_ISSUER ?? env.WORKOS_CLI_ISSUER,
  );
  if (!authorizationServer) {
    return null;
  }
  const resource = env.MCP_RESOURCE ?? MCP_RESOURCE_INDICATOR;
  const protectedResources = resourceAliases(resource);
  return {
    issuer: normalizedUrl(env.WORKOS_MCP_ISSUER) ?? authorizationServer,
    authorization_endpoint: `${authorizationServer}/oauth2/authorize`,
    token_endpoint: `${authorizationServer}/oauth2/token`,
    registration_endpoint: `${authorizationServer}/oauth2/register`,
    jwks_uri: env.WORKOS_MCP_JWKS_URL ?? `${authorizationServer}/oauth2/jwks`,
    introspection_endpoint: `${authorizationServer}/oauth2/introspection`,
    device_authorization_endpoint: `${authorizationServer}/oauth2/device_authorization`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token", "urn:ietf:params:oauth:grant-type:device_code"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: [...MCP_AUTHKIT_OAUTH_SCOPES],
    client_id_metadata_document_supported: true,
    resource,
    resource_metadata: `${trimTrailingSlashes(resource)}/.well-known/oauth-protected-resource`,
    protected_resources: protectedResources,
  };
}

function normalizedUrl(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  return trimTrailingSlashes(value);
}

function resourceAliases(resource: string): string[] {
  const trimmed = trimTrailingSlashes(resource);
  const withSlash = `${trimmed}/`;
  return resource.endsWith("/") ? [withSlash, trimmed] : [trimmed, withSlash];
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
                      resource_name: { type: "string" },
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
      "/.well-known/oauth-authorization-server": {
        get: {
          operationId: "mcp.oauthAuthorizationServer",
          responses: {
            200: {
              description: "OAuth authorization server metadata facade for compatibility clients",
              content: { "application/json": { schema: { type: "object" } } },
            },
          },
        },
      },
      "/.well-known/openid-configuration": {
        get: {
          operationId: "mcp.openIdConfiguration",
          responses: {
            200: {
              description: "OpenID Connect metadata facade for compatibility clients",
              content: { "application/json": { schema: { type: "object" } } },
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
