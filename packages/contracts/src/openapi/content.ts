import { OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import { z } from "../zod.js";
import { artifactRateLimitResponse } from "./responses.js";
import { registerContentSchemas, requestIdHeader } from "./shared.js";

const pathStringParam = (name: string, description: string) =>
  z.string().openapi({
    param: { name, in: "path", required: true, description },
  });

const contentPathParams = z.object({
  token: pathStringParam("token", "Signed content token."),
  path: pathStringParam("path", "File path within the artifact."),
});

const ContentNotFoundErrorEnvelope = z
  .object({
    error: z.object({
      code: z.enum(["not_found"]),
      message: z.string(),
      docs: z.string().url().optional(),
      request_id: z.string().min(1).optional(),
    }),
  })
  .openapi("ContentNotFoundErrorEnvelope");

const contentNotFoundResponse = {
  description: "Signed content token or artifact file was not found.",
  content: {
    "application/json": { schema: ContentNotFoundErrorEnvelope },
  },
};

export type ContentOpenApiOptions = {
  serverUrl?: string | undefined;
};

export function buildContentOpenApiDocument(options: ContentOpenApiOptions = {}): Record<string, unknown> {
  const registry = new OpenAPIRegistry();
  registerContentSchemas(registry);

  registry.registerPath({
    method: "get",
    path: "/v/{token}/{path}",
    operationId: "content.get",
    summary: "Resolve and serve a signed artifact file.",
    request: {
      params: contentPathParams,
      headers: [requestIdHeader],
    },
    responses: {
      "200": {
        description: "Artifact file bytes",
        content: {
          "application/octet-stream": { schema: { type: "string", format: "binary" } },
        },
      },
      "404": contentNotFoundResponse,
      "429": artifactRateLimitResponse,
    },
  });

  registry.registerPath({
    method: "head",
    path: "/v/{token}/{path}",
    operationId: "content.head",
    summary: "Resolve metadata for a signed artifact file.",
    request: {
      params: contentPathParams,
      headers: [requestIdHeader],
    },
    responses: {
      "200": { description: "Artifact file metadata" },
      "404": contentNotFoundResponse,
      "429": artifactRateLimitResponse,
    },
  });

  const generator = new OpenApiGeneratorV31(registry.definitions);
  const document = generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "Agent Paste Content API",
      version: "0.1.0",
      description: "Signed-URL static asset gateway for Agent Paste artifact files.",
    },
    servers: [{ url: options.serverUrl ?? "https://usercontent.agent-paste.sh" }],
  });
  return document as unknown as Record<string, unknown>;
}
