import type { ResponseConfig, ZodMediaTypeObject } from "@asteasolutions/zod-to-openapi";
import { ErrorEnvelope } from "../common.js";
import { z } from "../zod.js";

const errorEnvelopeContent = {
  "application/json": { schema: ErrorEnvelope },
};

const RateLimitErrorEnvelope = z
  .object({
    error: z.object({
      code: z.enum(["rate_limited_actor", "rate_limited_artifact", "rate_limited_workspace"]),
      message: z.string(),
      docs: z.string().url().optional(),
      request_id: z.string().min(1).optional(),
    }),
  })
  .openapi("RateLimitErrorEnvelope");

const rateLimitContent = {
  "application/json": { schema: RateLimitErrorEnvelope },
};

const ArtifactRateLimitErrorEnvelope = z
  .object({
    error: z.object({
      code: z.enum(["rate_limited_artifact"]),
      message: z.string(),
      docs: z.string().url().optional(),
      request_id: z.string().min(1).optional(),
    }),
  })
  .openapi("ArtifactRateLimitErrorEnvelope");

const artifactRateLimitContent = {
  "application/json": { schema: ArtifactRateLimitErrorEnvelope },
};

const retryAfterHeaders = z
  .object({
    "Retry-After": z.string().openapi({ description: "Seconds to wait before retrying." }),
  })
  .openapi({});

export function schemaRef(name: string): { $ref: string } {
  return { $ref: `#/components/schemas/${name}` };
}

export function jsonOk(schema: ZodMediaTypeObject["schema"], description = "OK"): ResponseConfig {
  return { description, content: { "application/json": { schema } } };
}

export const errorResponse: ResponseConfig = {
  description: "Error envelope",
  content: errorEnvelopeContent,
};

export const rateLimitResponse: ResponseConfig = {
  description:
    "Rate limit exceeded. Error codes include rate_limited_actor, rate_limited_artifact, and rate_limited_workspace.",
  headers: retryAfterHeaders,
  content: rateLimitContent,
};

export const artifactRateLimitResponse: ResponseConfig = {
  description: "Artifact read rate limit exceeded. Error code is rate_limited_artifact.",
  headers: retryAfterHeaders,
  content: artifactRateLimitContent,
};

export const emptyOkResponse: ResponseConfig = {
  description: "No content",
};

export type ResponseOptions = {
  authenticated?: boolean;
};

export function standardJsonResponses(
  successSchema: ZodMediaTypeObject["schema"],
  successStatus: number = 200,
  options: ResponseOptions = { authenticated: true },
): Record<string, ResponseConfig> {
  const base: Record<string, ResponseConfig> = {
    [String(successStatus)]: jsonOk(successSchema, `Success (${successStatus})`),
    "400": errorResponse,
    "404": errorResponse,
    "409": errorResponse,
    "429": rateLimitResponse,
    "500": errorResponse,
    "503": errorResponse,
  };
  if (options.authenticated !== false) {
    base["401"] = errorResponse;
  }
  return base;
}
