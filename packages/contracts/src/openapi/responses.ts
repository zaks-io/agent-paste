import type { ResponseConfig, ZodMediaTypeObject } from "@asteasolutions/zod-to-openapi";
import { ErrorEnvelope } from "../common.js";
import { z } from "./zod-setup.js";

const errorEnvelopeContent = {
  "application/json": { schema: ErrorEnvelope },
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
  description: "Rate limit exceeded. Error codes include rate_limited_actor and rate_limited_workspace.",
  headers: retryAfterHeaders,
  content: errorEnvelopeContent,
};

export const emptyOkResponse: ResponseConfig = {
  description: "No content",
};

export function standardJsonResponses(
  successSchema: ZodMediaTypeObject["schema"],
  successStatus = 200,
): Record<string, ResponseConfig> {
  return {
    [String(successStatus)]: jsonOk(successSchema, `Success (${successStatus})`),
    "400": errorResponse,
    "401": errorResponse,
    "404": errorResponse,
    "409": errorResponse,
    "429": rateLimitResponse,
    "500": errorResponse,
    "503": errorResponse,
  };
}
