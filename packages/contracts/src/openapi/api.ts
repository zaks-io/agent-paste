import { OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import { registerActorPaths } from "./api.actor.js";
import { registerArtifactPaths } from "./api.artifacts.js";
import { registerBillingPaths } from "./api.billing.js";
import { registerEphemeralPaths } from "./api.ephemeral.js";
import { createApiPathHelpers } from "./api.helpers.js";
import { registerPublicPaths } from "./api.public.js";
import { registerWebPaths } from "./api.web.js";
import { registerWebAdminPaths } from "./api.web-admin.js";
import { registerApiSchemas, securitySchemes } from "./shared.js";
import { applyWebCursorParameterBounds } from "./web-cursor-bounds.js";

export type ApiOpenApiOptions = {
  serverUrl?: string | undefined;
  docsBaseUrl?: string | undefined;
};

export function buildApiOpenApiDocument(options: ApiOpenApiOptions = {}): Record<string, unknown> {
  const registry = new OpenAPIRegistry();
  registerApiSchemas(registry);

  for (const [name, scheme] of Object.entries(securitySchemes)) {
    registry.registerComponent("securitySchemes", name, scheme);
  }

  const helpers = createApiPathHelpers();

  registerActorPaths(registry, helpers);
  registerPublicPaths(registry, helpers);
  registerEphemeralPaths(registry, helpers);
  registerWebPaths(registry, helpers);
  registerWebAdminPaths(registry, helpers);
  registerBillingPaths(registry, helpers);
  registerArtifactPaths(registry, helpers);

  const generator = new OpenApiGeneratorV31(registry.definitions);
  const document = generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "Agent Paste API",
      version: "0.1.0",
      description: "Workspace-scoped JSON API for publishing and reading Agent View artifacts.",
    },
    servers: [{ url: options.serverUrl ?? "https://api.agent-paste.sh" }],
    security: [
      { ApiKeyBearer: [] },
      { WorkOsBearer: [] },
      { McpOAuthBearer: [] },
      { SignedAgentViewToken: [] },
      { SignedAccessLinkRequest: [] },
      { EphemeralProofOfWork: [] },
      { StripeSignature: [] },
      { CfAccessServiceToken: [] },
    ],
    ...(options.docsBaseUrl ? { externalDocs: { url: options.docsBaseUrl } } : {}),
  });
  applyWebCursorParameterBounds(document as unknown as Record<string, unknown>);
  return document as unknown as Record<string, unknown>;
}
